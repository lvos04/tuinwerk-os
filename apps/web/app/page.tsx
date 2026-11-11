"use client";
import {
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Sprout,
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Boxes,
  Wrench,
  MapPin,
  ChartNoAxesCombined,
  Settings,
  Bell,
  Search,
  Plus,
  ChevronRight,
  ArrowUpRight,
  LogOut,
  Menu,
  X,
  Check,
  Clock,
  AlertTriangle,
  Download,
  RefreshCw,
  Leaf,
  UserRound,
  Upload,
  ScanLine,
} from "lucide-react";
import { Calendar, AnnotationEditor } from "./tools";
import { AdvancedTools, MediaGallery } from "./tools2";
import { YearPlanning } from "./year-planning";
type Row = Record<string, any>;
const statuses: Record<string, string> = {
  open: "Open",
  planned: "Gepland",
  in_progress: "Bezig",
  blocked: "Geblokkeerd",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
  archived: "Gearchiveerd",
};
const priorities: Record<string, string> = {
  low: "Laag",
  normal: "Normaal",
  high: "Hoog",
  critical: "Kritiek",
};
const nav = [
  ["dashboard", "Overzicht", LayoutDashboard],
  ["tasks", "Taken", ClipboardList],
  ["planning", "Planning", CalendarDays],
  ["assets", "Machines", Wrench],
  ["locations", "Locaties", MapPin],
  ["inventory", "Voorraad", Boxes],
  ["reports", "Rapportages", ChartNoAxesCombined],
  ["settings", "Beheer", Settings],
] as const;
const date = (v: any) =>
  v
    ? new Date(v).toLocaleDateString("nl-NL", {
        day: "numeric",
        month: "short",
      })
    : "Niet gepland";
const localDateTime = (s: string) =>
  s
    ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
const iso = (s: string) => (s ? new Date(s).toISOString() : null);
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({
  title = "Nog geen gegevens",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Leaf size={28} />
      <h3>{title}</h3>
      <p>
        {children || "Voeg je eerste gegevens toe om hier aan de slag te gaan."}
      </p>
    </div>
  );
}
export default function App() {
  const [token, setToken] = useState(""),
    [user, setUser] = useState<Row | null>(null),
    [page, setPage] = useState("dashboard"),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [mobile, setMobile] = useState(false);
  const [tasks, setTasks] = useState<Row[]>([]),
    [assets, setAssets] = useState<Row[]>([]),
    [locations, setLocations] = useState<Row[]>([]),
    [items, setItems] = useState<Row[]>([]),
    [users, setUsers] = useState<Row[]>([]),
    [schedules, setSchedules] = useState<Row[]>([]),
    [notifications, setNotifications] = useState<Row[]>([]);
  const [dialog, setDialog] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [filter, setFilter] = useState("active"),
    [view, setView] = useState("list"),
    [comments, setComments] = useState<Row[]>([]),
    [detailTab, setDetailTab] = useState("details"),
    [report, setReport] = useState<Row | null>(null),
    [rules, setRules] = useState<Row[]>([]),
    [counts, setCounts] = useState<Row[]>([]),
    [balances, setBalances] = useState<Row[]>([]),
    [sessions, setSessions] = useState<Row[]>([]);
  const refreshFlight = useRef<Promise<string> | null>(null);
  const deepLinkHandled = useRef(false);
  const [annotationTarget, setAnnotationTarget] = useState<Row | null>(null),
    [profilePrefs, setProfilePrefs] = useState<Row>({
      preferences: {},
      version: 0,
    });
  const [searchResults, setSearchResults] = useState<Row[]>([]),
    [adminStatus, setAdminStatus] = useState<Row | null>(null),
    [aiSuggestion, setAiSuggestion] = useState<Row | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!dialog) return;
    const old = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = modalRef.current;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDialog("");
        return;
      }
      if (e.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
      old?.focus();
    };
  }, [dialog]);
  const [assetHistory, setAssetHistory] = useState<Row | null>(null);
  const [attachments, setAttachments] = useState<Row[]>([]),
    [times, setTimes] = useState<Row[]>([]),
    [seasons, setSeasons] = useState<Row[]>([]),
    [prefs, setPrefs] = useState<Row | null>(null);
  const api = async (
    path: string,
    options: RequestInit = {},
    auth = token,
    retried = false,
  ): Promise<any> => {
    const res = await fetch("/api" + path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(auth ? { Authorization: "Bearer " + auth } : {}),
        ...options.headers,
      },
    });
    if (
      res.status === 401 &&
      auth &&
      !retried &&
      sessionStorage.getItem("tuinwerk-refresh")
    ) {
      if (!refreshFlight.current)
        refreshFlight.current = (async () => {
          const r = await fetch("/api/auth/refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              refreshToken: sessionStorage.getItem("tuinwerk-refresh"),
            }),
          });
          if (!r.ok) throw Error("Je sessie is verlopen. Log opnieuw in.");
          const data = await r.json();
          sessionStorage.setItem("tuinwerk-token", data.token);
          sessionStorage.setItem("tuinwerk-refresh", data.refreshToken);
          setToken(data.token);
          return data.token;
        })().finally(() => {
          refreshFlight.current = null;
        });
      return api(path, options, await refreshFlight.current, true);
    }
    if (!res.ok) {
      let b;
      try {
        b = await res.json();
      } catch {}
      if (res.status === 401 && auth) {
        sessionStorage.removeItem("tuinwerk-token");
        sessionStorage.removeItem("tuinwerk-refresh");
        setToken("");
        setUser(null);
      }
      throw new Error(
        res.status === 409
          ? "Conflict: deze gegevens zijn intussen gewijzigd of de voorraad is onvoldoende. Vernieuw en controleer je invoer."
          : (Array.isArray(b?.message) ? b.message.join(", ") : b?.message) ||
              "De aanvraag is mislukt (" + res.status + ").",
      );
    }
    if (res.status === 204) return null;
    return res.json();
  };
  const post = (path: string, data: Row) =>
    api(path, { method: "POST", body: JSON.stringify(data) });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const allPages = async (path: string, auth = token) => {
    let result: Row[] = [];
    for (let offset = 0; ; offset += 500) {
      const rows = await api(
        path + (path.includes("?") ? "&" : "?") + "limit=500&offset=" + offset,
        {},
        auth,
      );
      result = result.concat(rows);
      if (rows.length < 500) break;
    }
    return result;
  };
  const reload = async (auth = token) => {
    const endpoints = [
      "/tasks",
      "/assets",
      "/locations",
      "/inventory/items",
      "/users",
      "/schedules",
      "/notifications",
    ];
    const setters = [
      setTasks,
      setAssets,
      setLocations,
      setItems,
      setUsers,
      setSchedules,
      setNotifications,
    ];
    const results = await Promise.allSettled(
      endpoints.map((p) =>
        p === "/tasks"
          ? Promise.all([
              allPages("/tasks", auth),
              allPages("/tasks?status=archived", auth),
            ]).then((x) => x.flat())
          : p === "/inventory/items"
            ? allPages(p, auth)
            : api(p, {}, auth),
      ),
    );
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled")
        setters[i](Array.isArray(r.value) ? r.value : r.value?.items || []);
      else failures.push(endpoints[i] + ": " + r.reason.message);
    });
    if (failures.length) setError(failures.join(" · "));
  };
  useEffect(() => {
    const saved = sessionStorage.getItem("tuinwerk-token");
    if (saved) {
      setToken(saved);
      api("/auth/me", {}, saved)
        .then((u) => {
          setUser(u);
          return reload(saved);
        })
        .catch((e) => setError(e.message))
        .finally(() => setReady(true));
    } else setReady(true);
  }, []);
  useEffect(() => {
    if (!token) return;
    api("/profile/preferences")
      .then((p) => {
        setProfilePrefs(p);
        if (p.preferences?.taskFilter) setFilter(p.preferences.taskFilter);
      })
      .catch(() => {});
    if (page === "reports")
      run(async () => setReport(await api("/reports/summary")));
    if (page === "planning") {
      api("/recurrences")
        .then(setRules)
        .catch(() => {});
      api("/seasons")
        .then(setSeasons)
        .catch(() => {});
    }
    if (page === "settings") {
      api("/auth/sessions")
        .then(setSessions)
        .catch(() => {});
      api("/admin/status")
        .then(setAdminStatus)
        .catch(() => {});
    }
  }, [page, token]);
  const login = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      const result = await post("/auth/login", {
        email: f.get("email"),
        password: f.get("password"),
        otp: f.get("otp") || undefined,
      });
      sessionStorage.setItem("tuinwerk-token", result.token);
      sessionStorage.setItem("tuinwerk-refresh", result.refreshToken);
      setToken(result.token);
      setUser(result.user);
      await reload(result.token);
    });
  };
  const submit = (
    e: FormEvent<HTMLFormElement>,
    fn: (f: FormData) => Promise<void>,
  ) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      await fn(f);
      setDialog("");
      setNotice("Opgeslagen.");
      await reload();
    });
  };
  const openTask = async (t: Row) => {
    setSelected(t);
    setDetailTab("details");
    setDialog("taskDetail");
    setComments([]);
    try {
      const d = await api("/tasks/" + t.id);
      setSelected(d);
      const c = await api("/tasks/" + t.id + "/comments");
      setComments(c);
      setAttachments(await api("/attachments?taskId=" + t.id));
      setTimes(await api("/tasks/" + t.id + "/time"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const updateTask = async (data: Row) => {
    if (!selected) return;
    const result = await api("/tasks/" + selected.id, {
      method: "PATCH",
      body: JSON.stringify({ ...data, version: selected.version }),
    });
    setSelected(result);
    await reload();
  };
  useEffect(() => {
    if (!user || deepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search),
      type = params.get("type"),
      id = params.get("id");
    if (!type || !id) return;
    deepLinkHandled.current = true;
    run(async () => {
      if (type === "task") {
        await openTask(await api("/tasks/" + id));
        setPage("tasks");
      } else if (type === "asset") {
        setSelected(await api("/assets/" + id));
        setPage("assets");
        setDialog("assetDetail");
      } else if (type === "location") {
        const list = await api("/locations");
        const row = list.find((x: Row) => x.id === id);
        if (!row) throw Error("Locatie niet gevonden.");
        setSelected(row);
        setPage("locations");
        setDialog("location");
      } else if (type === "item") {
        const list = await api("/inventory/items");
        const row = list.find((x: Row) => x.id === id);
        if (!row) throw Error("Artikel niet gevonden.");
        setSelected(row);
        setBalances(await api("/inventory/balances?itemId=" + id));
        setPage("inventory");
        setDialog("itemDetail");
      }
    });
  }, [user]);
  const active = tasks.filter(
    (t) => !["completed", "cancelled", "archived"].includes(t.status),
  );
  const today = new Date().toISOString().slice(0, 10);
  const overdue = active.filter(
    (t) => t.deadline && t.deadline.slice(0, 10) < today,
  );
  const urgent = active.filter((t) =>
    ["critical", "high"].includes(t.priority),
  );
  const low = items.filter(
    (i) =>
      i.lowStock ||
      Number(i.quantity ?? i.totalStock ?? i.stock ?? 0) <
        Number(i.minimum ?? i.minimumStock ?? 0),
  );
  const filtered = tasks
    .filter(
      (t) =>
        (filter === "all" ||
          (filter === "active" &&
            !["completed", "archived", "cancelled"].includes(t.status)) ||
          (filter === "mine" && (t.assignedTo || []).includes(user?.id)) ||
          (filter === "unassigned" && !(t.assignedTo || []).length) ||
          (filter === "overdue" && overdue.some((o) => o.id === t.id)) ||
          t.status === filter) &&
        [t.title, t.description, t.category, (t.tags || []).join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      profilePrefs.preferences?.taskSort === "title"
        ? a.title.localeCompare(b.title)
        : profilePrefs.preferences?.taskSort === "deadline"
          ? (a.deadline || "9999").localeCompare(b.deadline || "9999")
          : profilePrefs.preferences?.taskSort === "priority"
            ? Object.keys(priorities).indexOf(b.priority) -
              Object.keys(priorities).indexOf(a.priority)
            : (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  const name = (list: Row[], id: string) =>
    list.find((x) => x.id === id)?.name || "—";
  const checklist = selected?.checklist || [];
  if (!ready)
    return (
      <div className="loading">
        <Sprout /> TuinWerk laden…
      </div>
    );
  if (!user)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            <Sprout size={34} />
            <span>
              TuinWerk <b>OS</b>
            </span>
          </div>
          <span className="eyebrow">RUIMTE OM TE GROEIEN</span>
          <h1>
            Goed werk begint
            <br />
            met overzicht.
          </h1>
          <p>
            Van de eerste melding tot de laatste controle.
            <br />
            Alle werkzaamheden op één plek.
          </p>
          <div className="login-art">
            <Leaf size={180} strokeWidth={0.7} />
            <div>
              <Check /> Samen aan het werk
            </div>
          </div>
          <small>Onderhoud · Planning · Voorraad</small>
        </section>
        <section className="login-form">
          <div>
            <span className="eyebrow">WELKOM TERUG</span>
            <h2>Aan de slag</h2>
            <p>Log in op de werkomgeving van jouw team.</p>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={login}>
              <Field label="E-mailadres">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="naam@bedrijf.nl"
                />
              </Field>
              <Field label="Wachtwoord">
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </Field>
              <Field label="Tweede factor (indien ingesteld)">
                <input
                  name="otp"
                  autoComplete="one-time-code"
                  placeholder="Authenticatie- of herstelcode"
                />
              </Field>
              <button className="primary" disabled={busy}>
                {busy ? "Even geduld…" : "Inloggen"} <ArrowUpRight size={18} />
              </button>
            </form>
            <p className="muted">
              Nog geen account? Je beheerder kan je toegang geven.
            </p>
          </div>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <aside className={"sidebar " + (mobile ? "visible" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("dashboard");
          }}
        >
          <Sprout size={31} />
          <span>
            TuinWerk <b>OS</b>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Leaf size={17} />
          </span>
          <div>
            Onze werkomgeving<small>Samen aan het werk</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">WERKPLEK</p>
        <nav>
          {nav
            .filter(([id]) => id !== "settings" || user.role === "admin")
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => {
                  setPage(id);
                  setSearch("");
                  setMobile(false);
                }}
              >
                <Icon size={19} />
                {label}
                {id === "tasks" && active.length > 0 && (
                  <span className="nav-count">{active.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <i /> Verbonden met je server
          </div>
          <button
            className="profile"
            onClick={() =>
              run(async () => {
                await post("/auth/logout", {});
                sessionStorage.removeItem("tuinwerk-token");
                sessionStorage.removeItem("tuinwerk-refresh");
                setToken("");
                setUser(null);
              })
            }
          >
            <span className="avatar">{user.name?.slice(0, 1) || "M"}</span>
            <span>
              {user.name}
              <small>
                {user.role === "admin" ? "Beheerder" : "Medewerker"}
              </small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button menu"
            aria-label="Menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <span className="breadcrumb">
            Werkplek <ChevronRight size={13} />{" "}
            <strong>{nav.find((n) => n[0] === page)?.[1]}</strong>
          </span>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label="Overal zoeken"
              onClick={() => {
                setSearchResults([]);
                setDialog("search");
              }}
            >
              <Search size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Gegevens vernieuwen"
              onClick={() => run(() => reload())}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="icon-button bell"
              aria-label="Meldingen"
              onClick={() => setDialog("notifications")}
            >
              <Bell size={19} />
              {notifications.some((n) => !n.readAt) && <i />}
            </button>
            <button
              className="avatar small"
              aria-label="Persoonlijke voorkeuren"
              onClick={() => setDialog("profilePrefs")}
            >
              {user.name?.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="alert error" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button aria-label="Sluiten" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {new Date().toLocaleDateString("nl-NL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <h1>
                {page === "dashboard"
                  ? `Goedendag, ${user.name?.split(" ")[0] || "collega"}`
                  : nav.find((n) => n[0] === page)?.[1]}
                {page === "dashboard" && <span className="greeting">☀</span>}
              </h1>
              <p>
                {
                  {
                    dashboard:
                      "Dit speelt er vandaag. Samen houden we alles draaiende.",
                    tasks:
                      "Van melding naar oplossing. Alle werkzaamheden bij elkaar.",
                    planning: "Maak ruimte voor het werk dat eraan komt.",
                    assets: "Je installaties en hun onderhoudshistorie.",
                    locations:
                      "Een duidelijke plek voor elke machine en ieder onderdeel.",
                    inventory: "Weet wat je hebt en waar je het vindt.",
                    reports: "Inzicht in werkzaamheden, tijd en verbruik.",
                    settings: "Beheer je team en je werkomgeving.",
                  }[page]
                }
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setSelected(null);
                setDialog(
                  page === "assets"
                    ? "asset"
                    : page === "locations"
                      ? "location"
                      : page === "inventory"
                        ? "item"
                        : page === "planning"
                          ? "schedule"
                          : page === "settings"
                            ? "user"
                            : "task",
                );
              }}
            >
              <Plus size={18} />
              {(
                {
                  assets: "Machine toevoegen",
                  locations: "Locatie toevoegen",
                  inventory: "Artikel toevoegen",
                  planning: "Werkblok plannen",
                  settings: "Medewerker toevoegen",
                } as Row
              )[page] || "Nieuwe taak"}
            </button>
          </div>
          <div className="toolbar">
            <button className="secondary" onClick={() => setDialog("advanced")}>
              {(
                {
                  tasks: "Sjablonen, bulk wijzigen en AI",
                  inventory: "Artikelen, minima en mutatiehistorie",
                  planning: "Seizoenen aanpassen",
                  reports: "Achtergrondexports en AI",
                  settings: "Accountbeveiliging en gegevensbeheer",
                } as Row
              )[page] || "Sjablonen en slimme taakvoorstellen"}
            </button>
          </div>
          {page === "dashboard" && (
            <>
              <div className="stats">
                {[
                  [
                    active.length,
                    "Openstaande taken",
                    "Alles wat nog aandacht vraagt",
                    ClipboardList,
                  ],
                  [
                    urgent.length,
                    "Hoge prioriteit",
                    "Eerst even naar kijken",
                    AlertTriangle,
                  ],
                  [
                    overdue.length,
                    "Achterstallig",
                    "Voorbij de deadline",
                    Clock,
                  ],
                  [low.length, "Lage voorraad", "Tijd om aan te vullen", Boxes],
                ].map(
                  ([v, label, sub, Icon]: any, i) =>
                    (!profilePrefs.preferences?.dashboardMetrics ||
                      profilePrefs.preferences.dashboardMetrics.includes(
                        String(i),
                      )) && (
                      <button
                        className={"stat stat-" + i}
                        key={label}
                        onClick={() => {
                          setPage(i === 3 ? "inventory" : "tasks");
                          setFilter(i === 2 ? "overdue" : "active");
                        }}
                      >
                        <div>
                          <span>{label}</span>
                          <Icon size={19} />
                        </div>
                        <strong>{v}</strong>
                        <small>
                          {sub}
                          <ArrowUpRight size={15} />
                        </small>
                      </button>
                    ),
                )}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-head">
                    <h2>
                      Werk dat aandacht vraagt{" "}
                      <span className="count">{active.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => {
                        setPage("tasks");
                        setFilter("active");
                      }}
                    >
                      Alle taken <ChevronRight size={15} />
                    </button>
                  </div>
                  {active.length ? (
                    <div className="task-list">
                      {[...active]
                        .sort(
                          (a, b) =>
                            Object.keys(priorities).indexOf(b.priority) -
                            Object.keys(priorities).indexOf(a.priority),
                        )
                        .slice(0, 6)
                        .map((t) => (
                          <button
                            className="task-row"
                            key={t.id}
                            onClick={() => openTask(t)}
                          >
                            <span className={"task-symbol " + t.priority}>
                              {t.priority === "critical" ? (
                                <AlertTriangle size={18} />
                              ) : (
                                <Wrench size={17} />
                              )}
                            </span>
                            <span className="task-text">
                              <strong>{t.title}</strong>
                              <small>
                                <MapPin size={12} />
                                {name(locations, t.locationId)} ·{" "}
                                {date(t.deadline)}
                              </small>
                            </span>
                            <span className={"badge " + t.status}>
                              {statuses[t.status]}
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                    </div>
                  ) : (
                    <Empty title="Een frisse start">
                      Maak een taak aan voor je eerste melding of
                      onderhoudsklus.
                    </Empty>
                  )}
                </section>
                <section className="panel today-panel">
                  <div className="panel-head">
                    <h2>Op de planning</h2>
                    <CalendarDays size={18} />
                  </div>
                  {schedules.filter(
                    (s) =>
                      (s.startsAt || s.startAt || s.start || "").slice(
                        0,
                        10,
                      ) === today,
                  ).length ? (
                    schedules
                      .filter(
                        (s) =>
                          (s.startsAt || s.startAt || s.start || "").slice(
                            0,
                            10,
                          ) === today,
                      )
                      .map((s) => (
                        <div className="schedule-mini" key={s.id}>
                          <span>
                            {new Date(
                              s.startsAt || s.startAt || s.start,
                            ).toLocaleTimeString("nl-NL", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <strong>
                            {s.title ||
                              tasks.find((t) => t.id === s.taskId)?.title}
                          </strong>
                        </div>
                      ))
                  ) : (
                    <Empty title="Ruimte in de agenda">
                      Er staan vandaag geen zichtbare werkblokken gepland.
                    </Empty>
                  )}
                  <button
                    className="secondary wide"
                    onClick={() => setPage("planning")}
                  >
                    Bekijk de planning <ArrowUpRight size={16} />
                  </button>
                </section>
                <section className="quick-banner">
                  <div className="banner-icon">
                    <Sprout size={28} />
                  </div>
                  <div>
                    <h3>Iets gezien dat aandacht nodig heeft?</h3>
                    <p>
                      Leg een storing direct vast. Je team kan meteen verder.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setDialog("task")}
                  >
                    <Plus size={17} /> Snelle melding
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "tasks" && (
            <>
              <div className="toolbar">
                <div className="tabs">
                  {[
                    ["active", "Open werk"],
                    ["mine", "Mijn taken"],
                    ["all", "Alle taken"],
                    ["completed", "Afgerond"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "active" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="segmented">
                  <button
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    Lijst
                  </button>
                  <button
                    className={view === "board" ? "active" : ""}
                    onClick={() => setView("board")}
                  >
                    Bord
                  </button>
                </div>
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={18} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Zoek op titel, omschrijving of categorie"
                    aria-label="Taken zoeken"
                  />
                </label>
                <select
                  aria-label="Taakfilter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="active">Open werk</option>
                  <option value="all">Alle taken</option>
                  <option value="mine">Mijn taken</option>
                  <option value="unassigned">Niet toegewezen</option>
                  <option value="overdue">Achterstallig</option>
                  {Object.entries(statuses).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {filtered.length ? (
                view === "board" ? (
                  <div className="board">
                    {Object.entries(statuses)
                      .slice(0, 5)
                      .map(([id, label]) => (
                        <section key={id}>
                          <h3>
                            {label}{" "}
                            <span>
                              {filtered.filter((t) => t.status === id).length}
                            </span>
                          </h3>
                          {filtered
                            .filter((t) => t.status === id)
                            .map((t) => (
                              <button
                                className="board-card"
                                key={t.id}
                                onClick={() => openTask(t)}
                              >
                                <span className={"badge " + t.priority}>
                                  {priorities[t.priority]}
                                </span>
                                <strong>{t.title}</strong>
                                <small>{name(locations, t.locationId)}</small>
                                <div>
                                  <Clock size={13} />
                                  {date(t.deadline)}
                                </div>
                              </button>
                            ))}
                        </section>
                      ))}
                  </div>
                ) : (
                  <div className="panel table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Taak</th>
                          <th>Status</th>
                          <th>Prioriteit</th>
                          <th>Locatie</th>
                          <th>Deadline</th>
                          <th>Toegewezen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <button
                                className="link title-link"
                                onClick={() => openTask(t)}
                              >
                                {t.title}
                              </button>
                              <small className="cell-sub">
                                {t.category || "Algemeen"}
                              </small>
                            </td>
                            <td>
                              <span className={"badge " + t.status}>
                                {statuses[t.status]}
                              </span>
                            </td>
                            <td>
                              <span className={"priority " + t.priority}>
                                ● {priorities[t.priority]}
                              </span>
                            </td>
                            <td>{name(locations, t.locationId)}</td>
                            <td>{date(t.deadline)}</td>
                            <td>
                              {(t.assignedTo || [])
                                .map((id: string) => name(users, id))
                                .join(", ") || "Niet toegewezen"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <Empty title="Geen taken gevonden">
                  Pas je filters aan of maak een nieuwe taak aan.
                </Empty>
              )}
            </>
          )}
          {page === "planning" && (
            <>
              <div className="toolbar">
                <div className="tabs">
                  {[
                    ["list", "Mijn planning"],
                    ["team", "Teamplanning"],
                    ["year", "Jaarplanning"],
                    ["calendar", "Kalender"],
                    ["maintenance", "Onderhoud"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={view === id ? "active" : ""}
                      onClick={() => setView(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="secondary"
                  onClick={() => setDialog("seasons")}
                >
                  Seizoensplanning
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setSelected(null);
                    setDialog("recurrence");
                  }}
                >
                  <RefreshCw size={16} /> Herhaling toevoegen
                </button>
              </div>
              {view === "calendar" ? (
                <Calendar
                  schedules={schedules}
                  onEdit={(s) => {
                    setSelected(s);
                    setDialog("schedule");
                  }}
                  onMove={async (s, start, end) => {
                    if (
                      s.shared &&
                      !window.confirm(
                        "Dit verplaatst een gedeeld werkblok. Betrokkenen ontvangen een melding. Doorgaan?",
                      )
                    )
                      return;
                    await run(async () => {
                      await api("/schedules/" + s.id, {
                        method: "PATCH",
                        body: JSON.stringify({
                          version: s.version,
                          startsAt: start,
                          endsAt: end,
                          confirmShared: true,
                        }),
                      });
                      await reload();
                    });
                  }}
                />
              ) : view === "maintenance" ? (
                <div className="panel">
                  {rules.length ? (
                    rules.map((r) => (
                      <div className="task-row" key={r.id}>
                        <RefreshCw size={18} />
                        <div className="task-text">
                          <strong>{r.title}</strong>
                          <small>
                            {r.config?.frequency} · vanaf{" "}
                            {date(r.config?.startDate)}
                          </small>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            setSelected(r);
                            setDialog("recurrence");
                          }}
                        >
                          Bewerken
                        </button>
                      </div>
                    ))
                  ) : (
                    <Empty title="Nog geen onderhoudsregels" />
                  )}
                </div>
              ) : view === "year" ? (
                <YearPlanning
                  api={api}
                  tasks={tasks}
                  assets={assets}
                  locations={locations}
                  openTask={openTask}
                />
              ) : (
                <div className="panel">
                  {schedules.filter(
                    (s) =>
                      view === "team" ||
                      s.userId === user.id ||
                      s.ownerId === user.id,
                  ).length ? (
                    schedules
                      .filter(
                        (s) =>
                          view === "team" ||
                          s.userId === user.id ||
                          s.ownerId === user.id,
                      )
                      .sort((a, b) =>
                        (a.startsAt || a.startAt || a.start).localeCompare(
                          b.startsAt || b.startAt || b.start,
                        ),
                      )
                      .map((s) => (
                        <div className="task-row" key={s.id}>
                          <CalendarDays size={20} />
                          <div className="task-text">
                            <strong>
                              {s.title ||
                                tasks.find((t) => t.id === s.taskId)?.title ||
                                "Werkblok"}
                            </strong>
                            <small>
                              {date(s.startsAt || s.startAt || s.start)} ·{" "}
                              {new Date(
                                s.startsAt || s.startAt || s.start,
                              ).toLocaleTimeString("nl-NL", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              –{" "}
                              {new Date(
                                s.endsAt || s.endAt || s.end,
                              ).toLocaleTimeString("nl-NL", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              · {name(users, s.userId || s.ownerId)}
                            </small>
                          </div>
                          <span className="badge">
                            {s.shared ? "Gedeeld" : "Persoonlijk"}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelected(s);
                              setDialog("schedule");
                            }}
                          >
                            Bewerken
                          </button>
                        </div>
                      ))
                  ) : (
                    <Empty title="Nog geen werkblokken">
                      Plan een taak of maak een persoonlijk werkblok.
                    </Empty>
                  )}
                </div>
              )}
            </>
          )}
          {(page === "assets" || page === "locations") && (
            <>
              <label className="search standalone">
                <Search size={18} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    page === "assets" ? "Zoek een machine" : "Zoek een locatie"
                  }
                />
              </label>
              <div className="cards">
                {(page === "assets" ? assets : locations)
                  .filter((x) =>
                    x.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((x) => (
                    <button
                      className="panel entity-card"
                      key={x.id}
                      onClick={() => {
                        setSelected(x);
                        setDialog(
                          page === "assets" ? "assetDetail" : "location",
                        );
                        if (page === "assets")
                          run(async () =>
                            setAssetHistory(
                              await api("/assets/" + x.id + "/history"),
                            ),
                          );
                      }}
                    >
                      <span className="entity-icon">
                        {page === "assets" ? <Wrench /> : <MapPin />}
                      </span>
                      <span className="badge">
                        {x.status || x.type || "Actief"}
                      </span>
                      <h3>{x.name}</h3>
                      <p>
                        {page === "assets"
                          ? [x.manufacturer, x.model]
                              .filter(Boolean)
                              .join(" ") || "Machine / installatie"
                          : x.parentId
                            ? name(locations, x.parentId)
                            : "Hoofdlocatie"}
                      </p>
                      <footer>
                        <MapPin size={14} />
                        {page === "assets"
                          ? name(locations, x.locationId)
                          : "Vaste locatie-ID"}
                        <ChevronRight size={16} />
                      </footer>
                    </button>
                  ))}
              </div>
              {!(page === "assets" ? assets : locations).length && (
                <Empty
                  title={
                    page === "assets"
                      ? "Nog geen machines"
                      : "Nog geen locaties"
                  }
                />
              )}
            </>
          )}
          {page === "inventory" && (
            <>
              <div className="toolbar">
                <div className="tabs">
                  <button
                    className={view !== "low" ? "active" : ""}
                    onClick={() => setView("list")}
                  >
                    Alle artikelen
                  </button>
                  <button
                    className={view === "low" ? "active" : ""}
                    onClick={() => setView("low")}
                  >
                    Aanvullijst <span className="count">{low.length}</span>
                  </button>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    setSelected(null);
                    setDialog("movement");
                  }}
                >
                  <Plus size={16} /> Voorraad boeken
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    run(async () => {
                      setCounts(await api("/inventory/counts"));
                      setDialog("counts");
                    })
                  }
                >
                  Inventarisatie
                </button>
              </div>
              <label className="search standalone">
                <Search size={18} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek op naam of artikelnummer"
                />
              </label>
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Artikel</th>
                      <th>Artikelnummer</th>
                      <th>Voorraad</th>
                      <th>Minimum</th>
                      <th>Eenheid</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(view === "low" ? low : items)
                      .filter((i) =>
                        (i.name + " " + (i.sku || i.articleNumber))
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((i) => (
                        <tr key={i.id}>
                          <td>
                            <button
                              className="link title-link"
                              onClick={() =>
                                run(async () => {
                                  setSelected(i);
                                  setBalances(
                                    await api(
                                      "/inventory/balances?itemId=" + i.id,
                                    ),
                                  );
                                  setDialog("itemDetail");
                                })
                              }
                            >
                              {i.name}
                            </button>
                          </td>
                          <td>{i.sku || i.articleNumber}</td>
                          <td>
                            <span
                              className={
                                Number(
                                  i.quantity ?? i.totalStock ?? i.stock ?? 0,
                                ) < Number(i.minimum ?? i.minimumStock)
                                  ? "low-stock"
                                  : ""
                              }
                            >
                              {i.quantity ?? i.totalStock ?? i.stock ?? 0}
                            </span>
                          </td>
                          <td>{i.minimum ?? i.minimumStock ?? 0}</td>
                          <td>{i.unit}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                setSelected(i);
                                setDialog("movement");
                              }}
                            >
                              Boeken <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!items.length && (
                  <Empty title="Je voorraad begint hier">
                    Voeg een artikel toe en boek de beginvoorraad op een
                    opslaglocatie.
                  </Empty>
                )}
              </div>
            </>
          )}
          {page === "reports" && (
            <>
              <section className="panel padded">
                <h2>Werkoverzicht</h2>
                <p className="muted">
                  Cijfers worden berekend uit de actuele registraties. Exporteer
                  gegevens voor verdere analyse.
                </p>
                {report && (
                  <div className="report-data">
                    {Object.entries(report)
                      .filter(
                        ([k, v]) => typeof v === "number" && k !== "sampleSize",
                      )
                      .map(([k, v]) => (
                        <div key={k}>
                          <small>
                            {(
                              {
                                total: "Totaal taken",
                                open: "Open",
                                completed: "Afgerond",
                                blocked: "Geblokkeerd",
                                overdue: "Achterstallig",
                                minutes: "Gewerkte minuten",
                                meanResolutionHours:
                                  "Gemiddelde doorlooptijd (uren)",
                              } as Row
                            )[k] || k}
                          </small>
                          <strong>
                            {typeof v === "number"
                              ? Math.round(v * 10) / 10
                              : String(v)}
                          </strong>
                        </div>
                      ))}
                  </div>
                )}
                <p className="muted">{report?.definition}</p>
                <form
                  className="form-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      const q = new URLSearchParams();
                      for (const [k, v] of f.entries())
                        if (v) q.set(k, String(v));
                      const r = await fetch("/api/reports/export?" + q, {
                        headers: { Authorization: "Bearer " + token },
                      });
                      if (!r.ok)
                        throw new Error("Export kon niet worden gemaakt.");
                      const blob = await r.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "tuinwerk-export." + f.get("format");
                      a.click();
                      URL.revokeObjectURL(url);
                      setNotice("Export gedownload.");
                    });
                  }}
                >
                  <Field label="Gegevens">
                    <select name="type">
                      <option value="tasks">Taken</option>
                      <option value="inventory">Voorraad</option>
                    </select>
                  </Field>
                  <Field label="Bestandstype">
                    <select name="format">
                      <option value="csv">CSV</option>
                      <option value="xlsx">Excel</option>
                      <option value="pdf">PDF</option>
                    </select>
                  </Field>
                  <Field label="Vanaf">
                    <input type="date" name="from" />
                  </Field>
                  <Field label="Tot en met">
                    <input type="date" name="to" />
                  </Field>
                  <button className="primary" disabled={busy}>
                    <Download size={17} /> Export downloaden
                  </button>
                </form>
              </section>
            </>
          )}
          {page === "settings" && (
            <div className="settings-grid">
              <section className="panel padded">
                <h2>Systeemstatus</h2>
                {adminStatus && (
                  <pre className="preview">
                    {JSON.stringify(adminStatus, null, 2)}
                  </pre>
                )}
                <h2>Teamleden</h2>
                {users.map((u) => (
                  <div className="task-row" key={u.id}>
                    <span className="avatar">{u.name?.slice(0, 1)}</span>
                    <span className="task-text">
                      <strong>{u.name}</strong>
                      <small>{u.email}</small>
                    </span>
                    <span className="badge">
                      {u.role === "admin" ? "Beheerder" : "Medewerker"}
                    </span>
                  </div>
                ))}
              </section>
              <section className="panel padded">
                <h2>Gegevens importeren</h2>
                <p className="muted">
                  Controleer eerst de voorbeeldweergave voordat je een import
                  bevestigt.
                </p>
                <button
                  className="secondary"
                  onClick={() => setDialog("import")}
                >
                  <Upload size={17} /> CSV / Todoist importeren
                </button>
                <hr />
                <h2>Aanmeldsessies</h2>
                {sessions.map((s) => (
                  <div className="task-row" key={s.id}>
                    <span className="task-text">
                      {s.device || s.deviceName || s.userAgent || "Apparaat"}
                      <small>{date(s.createdAt)}</small>
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        run(async () => {
                          await api("/auth/sessions/" + s.id, {
                            method: "DELETE",
                          });
                          setSessions(await api("/auth/sessions"));
                        })
                      }
                    >
                      Intrekken
                    </button>
                  </div>
                ))}
                {!sessions.length && (
                  <p className="muted">Geen sessiegegevens beschikbaar.</p>
                )}
              </section>
            </div>
          )}
          <footer className="page-footer">
            <Sprout size={14} /> TuinWerk OS{" "}
            <span>Alles op zijn plek. Samen vooruit.</span>
          </footer>
        </main>
      </div>
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog("")}>
          <section
            ref={modalRef}
            className={"modal " + (dialog === "taskDetail" ? "large" : "")}
            role="dialog"
            aria-modal="true"
            aria-label="Gegevens bewerken"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>
                {
                  (
                    {
                      task: "Nieuwe taak",
                      taskDetail: selected?.title,
                      asset: "Machine toevoegen",
                      assetDetail: selected?.name,
                      location: selected
                        ? "Locatie bewerken"
                        : "Locatie toevoegen",
                      item: "Artikel toevoegen",
                      itemDetail: selected?.name,
                      movement: "Voorraad boeken",
                      schedule: "Werkblok plannen",
                      recurrence: "Terugkerend onderhoud",
                      user: "Medewerker toevoegen",
                      notifications: "Meldingen",
                      counts: "Inventarisatie",
                      countDetail: selected?.name || "Telronde",
                      seasons: "Seizoensplanning",
                      notificationPrefs: "Meldingsvoorkeuren",
                      search: "Overal zoeken",
                      profilePrefs: "Persoonlijke voorkeuren",
                      annotation: "Foto bekijken en annoteren",
                      ai: "Taakvoorstel met AI",
                      advanced: "Aanvullende functies",
                      import: "Gegevens importeren",
                    } as Row
                  )[dialog]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Dialoog sluiten"
                onClick={() => setDialog("")}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {dialog === "task" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await post("/tasks", {
                      title: f.get("title"),
                      description: f.get("description"),
                      priority: f.get("priority"),
                      locationId: f.get("locationId") || null,
                      assetId: f.get("assetId") || null,
                      deadline: iso(String(f.get("deadline") || "")),
                      assignedTo: f.getAll("assignedTo"),
                      category: f.get("category"),
                      tags: String(f.get("tags") || "")
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean),
                      estimatedMinutes: f.get("estimatedMinutes")
                        ? Number(f.get("estimatedMinutes"))
                        : null,
                      plannedAt: iso(String(f.get("plannedAt") || "")),
                      availableFrom: iso(String(f.get("availableFrom") || "")),
                      dependencies: f.getAll("dependencies"),
                    });
                  })
                }
              >
                <Field label="Wat moet er gebeuren? *">
                  <input
                    name="title"
                    required
                    autoFocus
                    placeholder="Bijvoorbeeld: lekkende koppeling bij pomp 2"
                  />
                </Field>
                <Field label="Omschrijving">
                  <textarea name="description" rows={3} />
                </Field>
                <div className="form-grid">
                  <Field label="Prioriteit">
                    <select name="priority" defaultValue="normal">
                      {Object.entries(priorities).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Deadline">
                    <input type="datetime-local" name="deadline" />
                  </Field>
                  <Field label="Locatie">
                    <select
                      name="locationId"
                      defaultValue={selected?.locationId || ""}
                    >
                      <option value="">Geen locatie</option>
                      {locations
                        .filter((l) => l.active !== false)
                        .map((l) => (
                          <option value={l.id} key={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Machine">
                    <select name="assetId">
                      <option value="">Geen machine</option>
                      {assets.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Categorie">
                    <input
                      name="category"
                      placeholder="Reparatie, onderhoud…"
                    />
                  </Field>
                  <Field label="Gepland op">
                    <input name="plannedAt" type="datetime-local" />
                  </Field>
                  <Field label="Beschikbaar vanaf">
                    <input name="availableFrom" type="datetime-local" />
                  </Field>
                  <Field label="Geschatte minuten">
                    <input name="estimatedMinutes" type="number" min="0" />
                  </Field>
                  <Field label="Tags (komma gescheiden)">
                    <input name="tags" />
                  </Field>
                  <Field label="Afhankelijk van">
                    <select name="dependencies" multiple>
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Medewerkers (meerdere mogelijk)">
                    <select name="assignedTo" multiple>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button className="primary" disabled={busy}>
                  Taak aanmaken
                </button>
              </form>
            )}
            {dialog === "taskDetail" && selected && (
              <>
                {selected.dependencies?.some(
                  (id: string) =>
                    tasks.find((t) => t.id === id)?.status !== "completed",
                ) && (
                  <div className="alert error">
                    <AlertTriangle size={18} />
                    <span>
                      Voorgaand werk is nog niet afgerond:{" "}
                      {selected.dependencies
                        .filter(
                          (id: string) =>
                            tasks.find((t) => t.id === id)?.status !==
                            "completed",
                        )
                        .map(
                          (id: string) =>
                            tasks.find((t) => t.id === id)?.title || id,
                        )
                        .join(", ")}
                    </span>
                  </div>
                )}
                <div className="toolbar">
                  <span className={"badge " + selected.status}>
                    {statuses[selected.status]}
                  </span>
                  <span className={"badge " + selected.priority}>
                    {priorities[selected.priority]}
                  </span>
                  <span className="muted">Versie {selected.version}</span>
                </div>
                <div className="tabs detail-tabs">
                  {[
                    ["details", "Details"],
                    ["checklist", "Checklist"],
                    ["comments", "Reacties"],
                    ["time", "Tijd"],
                    ["media", "Bijlagen"],
                  ].map(([v, l]) => (
                    <button
                      className={detailTab === v ? "active" : ""}
                      key={v}
                      onClick={() => setDetailTab(v)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {detailTab === "details" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(async () => {
                        await updateTask({
                          title: f.get("title"),
                          description: f.get("description"),
                          status: f.get("status"),
                          reason: f.get("reason"),
                          priority: f.get("priority"),
                          assignedTo: f.getAll("assignedTo"),
                          deadline: iso(String(f.get("deadline") || "")),
                        });
                        setNotice("Taak bijgewerkt.");
                      });
                    }}
                  >
                    <Field label="Titel">
                      <input
                        name="title"
                        required
                        defaultValue={selected.title}
                        key={selected.id}
                      />
                    </Field>
                    <Field label="Omschrijving">
                      <textarea
                        name="description"
                        defaultValue={selected.description}
                        rows={3}
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="Status">
                        <select
                          name="status"
                          defaultValue={selected.status}
                          key={selected.status}
                        >
                          {Object.entries(statuses).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Prioriteit">
                        <select
                          name="priority"
                          defaultValue={selected.priority}
                        >
                          {Object.entries(priorities).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Deadline">
                        <input
                          name="deadline"
                          type="datetime-local"
                          defaultValue={
                            selected.deadline
                              ? new Date(
                                  new Date(selected.deadline).getTime() -
                                    new Date(
                                      selected.deadline,
                                    ).getTimezoneOffset() *
                                      60000,
                                )
                                  .toISOString()
                                  .slice(0, 16)
                              : ""
                          }
                        />
                      </Field>
                      <Field label="Toegewezen aan">
                        <select
                          name="assignedTo"
                          multiple
                          defaultValue={selected.assignedTo || []}
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Reden (verplicht bij blokkeren en heropenen)">
                      <input name="reason" />
                    </Field>
                    <button className="primary" disabled={busy}>
                      Wijzigingen opslaan
                    </button>
                  </form>
                )}
                {detailTab === "checklist" && (
                  <>
                    <div className="checklist">
                      {checklist.map((c: Row, i: number) => (
                        <label key={c.id || i}>
                          <input
                            type="checkbox"
                            checked={!!c.done}
                            onChange={(e) =>
                              run(() =>
                                updateTask({
                                  checklist: checklist.map(
                                    (x: Row, j: number) =>
                                      i === j
                                        ? { ...x, done: e.target.checked }
                                        : x,
                                  ),
                                }),
                              )
                            }
                          />
                          <span>
                            {c.text}
                            {c.required && <small> Verplicht</small>}
                          </span>
                        </label>
                      ))}
                    </div>
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          f = new FormData(form);
                        run(async () => {
                          await updateTask({
                            checklist: [
                              ...checklist,
                              {
                                id: crypto.randomUUID(),
                                text: f.get("text"),
                                required: f.get("required") === "on",
                                done: false,
                              },
                            ],
                          });
                          form.reset();
                        });
                      }}
                    >
                      <input
                        name="text"
                        aria-label="Checklistpunt"
                        required
                        placeholder="Nieuw checklistpunt"
                      />
                      <label>
                        <input type="checkbox" name="required" /> Verplicht
                      </label>
                      <button className="secondary" disabled={busy}>
                        <Plus size={16} />
                        Toevoegen
                      </button>
                    </form>
                  </>
                )}
                {detailTab === "comments" && (
                  <>
                    {comments.map((c) => (
                      <div className="comment" key={c.id}>
                        <strong>
                          {name(users, c.userId || c.authorId)}{" "}
                          <small>{date(c.createdAt)}</small>
                        </strong>
                        <p>{c.body}</p>
                      </div>
                    ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          f = new FormData(form);
                        run(async () => {
                          await post("/tasks/" + selected.id + "/comments", {
                            body: f.get("body"),
                          });
                          setComments(
                            await api("/tasks/" + selected.id + "/comments"),
                          );
                          form.reset();
                        });
                      }}
                    >
                      <Field label="Nieuwe reactie">
                        <textarea name="body" required rows={3} />
                      </Field>
                      <button className="primary" disabled={busy}>
                        Reactie plaatsen
                      </button>
                    </form>
                  </>
                )}
                {detailTab === "time" && (
                  <>
                    <div>
                      {times.map((t) => (
                        <div className="task-row" key={t.id}>
                          <Clock size={16} />
                          <span className="task-text">
                            {name(users, t.userId)}
                            <small>
                              {date(t.startedAt)} · {t.note}
                            </small>
                          </span>
                          <strong>{t.minutes ?? "Loopt"} min</strong>
                          {!t.endedAt && t.userId === user.id && (
                            <button
                              className="secondary"
                              onClick={() =>
                                run(async () => {
                                  await post("/time/" + t.id + "/stop", {});
                                  setTimes(
                                    await api(
                                      "/tasks/" + selected.id + "/time",
                                    ),
                                  );
                                })
                              }
                            >
                              Stop timer
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      className="secondary"
                      onClick={() =>
                        run(async () => {
                          await post("/tasks/" + selected.id + "/time", {
                            startedAt: new Date().toISOString(),
                          });
                          setTimes(
                            await api("/tasks/" + selected.id + "/time"),
                          );
                        })
                      }
                    >
                      <Clock size={16} /> Timer starten
                    </button>
                    <hr />
                    <form
                      onSubmit={(e) =>
                        submit(e, async (f) => {
                          await post("/tasks/" + selected.id + "/time", {
                            minutes: Number(f.get("minutes")),
                            note: f.get("note"),
                            startedAt: iso(String(f.get("startedAt"))),
                          });
                        })
                      }
                    >
                      <Field label="Starttijd">
                        <input
                          type="datetime-local"
                          name="startedAt"
                          required
                        />
                      </Field>
                      <Field label="Gewerkte minuten">
                        <input type="number" min="1" name="minutes" required />
                      </Field>
                      <Field label="Toelichting">
                        <input name="note" />
                      </Field>
                      <button className="primary" disabled={busy}>
                        Tijd registreren
                      </button>
                    </form>
                  </>
                )}
                {detailTab === "media" && (
                  <MediaGallery
                    api={api}
                    token={token}
                    taskId={selected.id}
                    onAnnotate={(a) => {
                      setAnnotationTarget(a);
                      setDialog("annotation");
                    }}
                  />
                )}
              </>
            )}
            {(dialog === "asset" || dialog === "location") && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    const body: Row = { name: f.get("name") };
                    if (dialog === "asset") {
                      Object.assign(body, {
                        manufacturer: f.get("manufacturer"),
                        model: f.get("model"),
                        serialNumber: f.get("serialNumber"),
                        locationId: f.get("locationId") || null,
                        status: f.get("status") || "active",
                      });
                      if (selected)
                        await api("/assets/" + selected.id, {
                          method: "PATCH",
                          body: JSON.stringify({
                            ...body,
                            version: selected.version,
                          }),
                        });
                      else await post("/assets", body);
                    } else {
                      Object.assign(body, {
                        parentId: f.get("parentId") || null,
                        type: f.get("type"),
                        active: f.get("active") === "on",
                      });
                      if (selected)
                        await api("/locations/" + selected.id, {
                          method: "PATCH",
                          body: JSON.stringify({
                            ...body,
                            version: selected.version,
                          }),
                        });
                      else await post("/locations", body);
                    }
                  })
                }
              >
                <Field label="Naam *">
                  <input
                    name="name"
                    required
                    defaultValue={selected?.name || ""}
                  />
                </Field>
                {dialog === "asset" ? (
                  <>
                    <div className="form-grid">
                      <Field label="Fabrikant">
                        <input
                          name="manufacturer"
                          defaultValue={selected?.manufacturer || ""}
                        />
                      </Field>
                      <Field label="Model">
                        <input
                          name="model"
                          defaultValue={selected?.model || ""}
                        />
                      </Field>
                    </div>
                    <Field label="Status">
                      <select
                        name="status"
                        defaultValue={selected?.status || "active"}
                      >
                        <option value="active">Actief</option>
                        <option value="out_of_service">Buiten bedrijf</option>
                        <option value="archived">Gearchiveerd</option>
                      </select>
                    </Field>
                    <Field label="Serienummer">
                      <input
                        name="serialNumber"
                        defaultValue={selected?.serialNumber || ""}
                      />
                    </Field>
                    <Field label="Locatie">
                      <select
                        name="locationId"
                        defaultValue={selected?.locationId || ""}
                      >
                        <option value="">Geen locatie</option>
                        {locations
                          .filter((l) => l.active !== false)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Bovenliggende locatie">
                      <select
                        name="parentId"
                        defaultValue={selected?.parentId || ""}
                      >
                        <option value="">Hoofdlocatie</option>
                        {locations
                          .filter(
                            (l) => l.active !== false && l.id !== selected?.id,
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <label className="checkbox">
                      <input
                        name="active"
                        type="checkbox"
                        defaultChecked={selected?.active !== false}
                      />{" "}
                      Actieve locatie
                    </label>
                    <Field label="Type">
                      <input
                        name="type"
                        defaultValue={selected?.type || ""}
                        placeholder="Kas, magazijn, stelling…"
                      />
                    </Field>
                  </>
                )}
                <button className="primary" disabled={busy}>
                  Opslaan
                </button>
              </form>
            )}
            {dialog === "assetDetail" && selected && (
              <>
                <div className="entity-summary">
                  <Wrench size={38} />
                  <div>
                    <p>
                      {selected.manufacturer} {selected.model}
                    </p>
                    <p>{name(locations, selected.locationId)}</p>
                    <small>Serienummer: {selected.serialNumber || "—"}</small>
                  </div>
                </div>
                <button
                  className="secondary"
                  onClick={() => setDialog("asset")}
                >
                  Machine bewerken
                </button>
                <h3 style={{ marginTop: 24 }}>Werkzaamheden en historie</h3>
                {(
                  assetHistory?.tasks ||
                  tasks.filter((t) => t.assetId === selected.id)
                ).map((t: Row) => (
                  <button
                    className="task-row wide"
                    key={t.id}
                    onClick={() => openTask(t)}
                  >
                    <span className="task-text">{t.title}</span>
                    <span className={"badge " + t.status}>
                      {statuses[t.status]}
                    </span>
                  </button>
                ))}
                {!tasks.some((t) => t.assetId === selected.id) && (
                  <p className="muted">Nog geen gekoppelde werkzaamheden.</p>
                )}
                {assetHistory?.parts?.length > 0 && (
                  <>
                    <h3>Gebruikte onderdelen</h3>
                    {assetHistory?.parts.map((p: Row) => (
                      <div className="task-row" key={p.id}>
                        <span className="task-text">{p.itemName}</span>
                        <strong>{p.quantity}</strong>
                        <small>{date(p.createdAt)}</small>
                      </div>
                    ))}
                  </>
                )}
                <button
                  className="secondary"
                  onClick={() =>
                    run(async () => {
                      const r = await fetch("/api/qr/asset/" + selected.id, {
                        headers: { Authorization: "Bearer " + token },
                      });
                      if (!r.ok)
                        throw Error("QR-label kon niet worden gemaakt.");
                      const url = URL.createObjectURL(await r.blob());
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "machine-label.pdf";
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  <ScanLine size={17} /> QR-label downloaden
                </button>
                <h3 style={{ marginTop: 25 }}>Foto’s en handleidingen</h3>
                <MediaGallery
                  api={api}
                  token={token}
                  assetId={selected.id}
                  onAnnotate={(a) => {
                    setAnnotationTarget(a);
                    setDialog("annotation");
                  }}
                />
              </>
            )}
            {dialog === "item" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await post("/inventory/items", {
                      sku: f.get("sku"),
                      name: f.get("name"),
                      unit: f.get("unit"),
                      minimum: Number(f.get("minimum")),
                      description: f.get("description"),
                    });
                  })
                }
              >
                <Field label="Artikelnaam *">
                  <input name="name" required />
                </Field>
                <div className="form-grid">
                  <Field label="Artikelnummer *">
                    <input name="sku" required />
                  </Field>
                  <Field label="Eenheid">
                    <select name="unit">
                      <option>stuk</option>
                      <option>meter</option>
                      <option>liter</option>
                      <option>doos</option>
                    </select>
                  </Field>
                  <Field label="Minimumvoorraad">
                    <input
                      name="minimum"
                      type="number"
                      min="0"
                      step="any"
                      defaultValue="0"
                    />
                  </Field>
                </div>
                <Field label="Omschrijving">
                  <textarea name="description" />
                </Field>
                <button className="primary" disabled={busy}>
                  Artikel toevoegen
                </button>
              </form>
            )}
            {dialog === "movement" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await post("/inventory/movements", {
                      operationId: crypto.randomUUID(),
                      itemId: f.get("itemId"),
                      locationId: f.get("locationId"),
                      toLocationId: f.get("toLocationId") || undefined,
                      type: f.get("type"),
                      quantity: Number(f.get("quantity")),
                      reason: f.get("reason"),
                      taskId: f.get("taskId") || undefined,
                    });
                  })
                }
              >
                <Field label="Artikel">
                  <select
                    name="itemId"
                    required
                    defaultValue={selected?.id || ""}
                  >
                    <option value="">Kies een artikel</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="Mutatie">
                    <select name="type">
                      <option value="receipt">Aanvulling</option>
                      <option value="usage">Verbruik</option>
                      <option value="transfer">Verplaatsing</option>
                      <option value="correction">
                        Correctie (getekend verschil)
                      </option>
                    </select>
                  </Field>
                  <Field label="Aantal">
                    <input type="number" name="quantity" required step="any" />
                  </Field>
                  <Field label="Opslaglocatie">
                    <select required name="locationId">
                      <option value="">Kies locatie</option>
                      {locations
                        .filter((l) => l.active !== false)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Naar locatie (bij verplaatsing)">
                    <select name="toLocationId">
                      <option value="">Niet van toepassing</option>
                      {locations
                        .filter((l) => l.active !== false)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <Field label="Gekoppelde taak">
                  <select name="taskId">
                    <option value="">Geen taak</option>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reden / toelichting">
                  <input name="reason" required />
                </Field>
                <p className="muted">
                  De server controleert beschikbare voorraad. Een mutatie wordt
                  pas na bevestiging definitief.
                </p>
                <button className="primary" disabled={busy}>
                  Mutatie bevestigen
                </button>
              </form>
            )}
            {dialog === "itemDetail" && (
              <>
                <h3>Voorraad per locatie</h3>
                {balances.map((b) => (
                  <div className="task-row" key={b.locationId}>
                    <MapPin size={17} />
                    <span className="task-text">
                      {name(locations, b.locationId)}
                    </span>
                    <strong>
                      {b.quantity} {selected?.unit}
                    </strong>
                  </div>
                ))}
                {!balances.length && (
                  <Empty title="Nog geen voorraad geboekt" />
                )}
                <button
                  className="primary"
                  onClick={() => setDialog("movement")}
                >
                  Voorraad boeken
                </button>
              </>
            )}
            {dialog === "schedule" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    const body = {
                      title: f.get("title"),
                      taskId: f.get("taskId") || null,
                      userId: user.id,
                      startsAt: iso(String(f.get("startsAt"))),
                      endsAt: iso(String(f.get("endsAt"))),
                      shared: f.get("shared") === "on",
                      participants: f.getAll("participants"),
                    };
                    if (selected)
                      await api("/schedules/" + selected.id, {
                        method: "PATCH",
                        body: JSON.stringify({
                          ...body,
                          version: selected.version,
                          confirmShared:
                            !selected.shared ||
                            selected.userId === user.id ||
                            window.confirm(
                              "Deze wijziging raakt een gedeelde planning. De deelnemers worden geïnformeerd. Doorgaan?",
                            ),
                        }),
                      });
                    else await post("/schedules", body);
                  })
                }
              >
                <Field label="Titel">
                  <input
                    name="title"
                    required
                    defaultValue={selected?.title || ""}
                  />
                </Field>
                <Field label="Taak">
                  <select name="taskId" defaultValue={selected?.taskId || ""}>
                    <option value="">Persoonlijk werkblok</option>
                    {tasks.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="Van">
                    <input
                      type="datetime-local"
                      name="startsAt"
                      defaultValue={localDateTime(selected?.startsAt)}
                      required
                    />
                  </Field>
                  <Field label="Tot">
                    <input
                      type="datetime-local"
                      name="endsAt"
                      defaultValue={localDateTime(selected?.endsAt)}
                      required
                    />
                  </Field>
                </div>
                <Field label="Deelnemers">
                  <select
                    name="participants"
                    multiple
                    defaultValue={selected?.participants || []}
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="checkbox">
                  <input
                    name="shared"
                    type="checkbox"
                    defaultChecked={selected?.shared}
                  />{" "}
                  Delen met het team
                </label>
                <p className="muted">
                  Dit werkblok wijzigt de deadline van de taak niet. Betrokken
                  medewerkers ontvangen een melding bij gedeelde wijzigingen.
                </p>
                <button className="primary" disabled={busy}>
                  Werkblok opslaan
                </button>
              </form>
            )}
            {dialog === "recurrence" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    const config: Row = {
                      frequency: f.get("frequency"),
                      interval: Number(f.get("interval")),
                      startDate: f.get("startDate"),
                      mode: f.get("mode"),
                    };
                    if (f.get("endDate")) config.endDate = f.get("endDate");
                    if (f.getAll("weekdays").length)
                      config.weekdays = f.getAll("weekdays").map(Number);
                    if (f.get("nth"))
                      config.nthWeekday = {
                        nth: Number(f.get("nth")),
                        weekday: Number(f.get("weekday")),
                      };
                    if (f.get("dates"))
                      config.dates = String(f.get("dates"))
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean);
                    if (f.get("exceptions"))
                      config.exceptions = String(f.get("exceptions"))
                        .split(",")
                        .map((x) => x.trim())
                        .filter(Boolean);
                    const body = {
                      title: f.get("title"),
                      config,
                      taskTemplate: {
                        ...selected?.taskTemplate,
                        assetId: f.get("assetId") || undefined,
                      },
                      active: f.get("active") === "on",
                    };
                    if (selected)
                      await api("/recurrences/" + selected.id, {
                        method: "PATCH",
                        body: JSON.stringify({
                          ...body,
                          version: selected.version,
                        }),
                      });
                    else await post("/recurrences", body);
                    setRules(await api("/recurrences"));
                  })
                }
              >
                <Field label="Onderhoudstaak">
                  <input
                    name="title"
                    required
                    defaultValue={selected?.title || ""}
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Frequentie">
                    <select
                      name="frequency"
                      defaultValue={selected?.config?.frequency || "monthly"}
                    >
                      <option value="daily">Dagelijks</option>
                      <option value="weekly">Wekelijks</option>
                      <option value="monthly">Maandelijks</option>
                      <option value="yearly">Jaarlijks</option>
                      <option value="dates">Expliciete datums</option>
                    </select>
                  </Field>
                  <Field label="Elke N periodes">
                    <input
                      name="interval"
                      type="number"
                      min="1"
                      defaultValue={selected?.config?.interval || 1}
                      required
                    />
                  </Field>
                  <Field label="Eerste datum">
                    <input
                      name="startDate"
                      type="date"
                      defaultValue={selected?.config?.startDate || ""}
                      required
                    />
                  </Field>
                  <Field label="Einddatum (optioneel)">
                    <input
                      name="endDate"
                      type="date"
                      defaultValue={selected?.config?.endDate || ""}
                    />
                  </Field>
                  <Field label="Machine">
                    <select
                      name="assetId"
                      defaultValue={selected?.taskTemplate?.assetId || ""}
                    >
                      <option value="">Geen machine</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Berekening">
                    <select
                      name="mode"
                      defaultValue={selected?.config?.mode || "calendar"}
                    >
                      <option value="calendar">Vaste kalender</option>
                      <option value="completion">
                        Vanaf laatste uitvoering
                      </option>
                    </select>
                  </Field>
                </div>
                <Field label="Weekdagen (bij wekelijks)">
                  <select
                    name="weekdays"
                    multiple
                    defaultValue={(selected?.config?.weekdays || []).map(
                      String,
                    )}
                  >
                    {[
                      "Zondag",
                      "Maandag",
                      "Dinsdag",
                      "Woensdag",
                      "Donderdag",
                      "Vrijdag",
                      "Zaterdag",
                    ].map((l, i) => (
                      <option key={i} value={i}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="form-grid">
                  <Field label="N-de weekdag (bij maandelijks)">
                    <select
                      name="nth"
                      defaultValue={selected?.config?.nthWeekday?.nth || ""}
                    >
                      <option value="">Vaste kalenderdag</option>
                      {[1, 2, 3, 4, 5, -1].map((n) => (
                        <option key={n} value={n}>
                          {n === -1 ? "Laatste" : n}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Weekdag">
                    <select
                      name="weekday"
                      defaultValue={selected?.config?.nthWeekday?.weekday ?? 1}
                    >
                      {[
                        "Zondag",
                        "Maandag",
                        "Dinsdag",
                        "Woensdag",
                        "Donderdag",
                        "Vrijdag",
                        "Zaterdag",
                      ].map((l, i) => (
                        <option key={i} value={i}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Expliciete datums (YYYY-MM-DD, komma gescheiden)">
                  <input
                    name="dates"
                    defaultValue={selected?.config?.dates?.join(", ") || ""}
                  />
                </Field>
                <Field label="Uitzonderingsdatums (komma gescheiden)">
                  <input
                    name="exceptions"
                    defaultValue={
                      selected?.config?.exceptions?.join(", ") || ""
                    }
                  />
                </Field>
                <label className="checkbox">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={selected?.active ?? true}
                  />{" "}
                  Onderhoudsregel actief
                </label>
                <p className="muted">
                  Wijzigingen gelden voor toekomstige, nog niet gestarte
                  beurten. Uitgevoerde historie blijft behouden.
                </p>
                <button className="primary" disabled={busy}>
                  Onderhoud opslaan
                </button>
              </form>
            )}
            {dialog === "user" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await post("/users", Object.fromEntries(f));
                  })
                }
              >
                <Field label="Naam">
                  <input name="name" required />
                </Field>
                <Field label="E-mailadres">
                  <input name="email" type="email" required />
                </Field>
                <Field label="Initieel wachtwoord (minimaal 12 tekens)">
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Rol">
                  <select name="role">
                    <option value="employee">Medewerker</option>
                    <option value="admin">Beheerder</option>
                  </select>
                </Field>
                <button className="primary" disabled={busy}>
                  Account aanmaken
                </button>
              </form>
            )}
            {dialog === "notifications" && (
              <>
                <button
                  className="secondary"
                  onClick={() =>
                    run(async () => {
                      setPrefs(await api("/notifications/preferences"));
                      setDialog("notificationPrefs");
                    })
                  }
                >
                  Voorkeuren en stille uren
                </button>
                {notifications.length ? (
                  notifications.map((n) => (
                    <button
                      className={"notification " + (!n.readAt ? "unread" : "")}
                      key={n.id}
                      onClick={() =>
                        run(async () => {
                          await api("/notifications/" + n.id + "/read", {
                            method: "PATCH",
                          });
                          await reload();
                        })
                      }
                    >
                      <Bell size={18} />
                      <span>
                        <strong>{n.title || n.type}</strong>
                        <p>{n.body || n.message}</p>
                        <small>
                          {date(n.createdAt)}
                          {!n.readAt ? " · Markeren als gelezen" : ""}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <Empty title="Helemaal bij">
                    Nieuwe meldingen verschijnen hier.
                  </Empty>
                )}
              </>
            )}
            {dialog === "counts" && (
              <>
                <form
                  onSubmit={(e) =>
                    submit(e, async (f) => {
                      await post("/inventory/counts", {
                        name: f.get("name"),
                        locationId: f.get("locationId") || undefined,
                      });
                    })
                  }
                >
                  <Field label="Naam telronde">
                    <input
                      name="name"
                      required
                      placeholder="Magazijntelling november"
                    />
                  </Field>
                  <Field label="Locatie">
                    <select name="locationId">
                      <option value="">Alle locaties</option>
                      {locations
                        .filter((l) => l.active !== false)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <button className="primary" disabled={busy}>
                    Telronde starten
                  </button>
                </form>
                <hr />
                {counts.map((c) => (
                  <button
                    className="task-row wide"
                    key={c.id}
                    onClick={() =>
                      run(async () => {
                        setSelected(await api("/inventory/counts/" + c.id));
                        setDialog("countDetail");
                      })
                    }
                  >
                    <span className="task-text">{c.name}</span>
                    <span className="badge">{c.status}</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </>
            )}
            {dialog === "countDetail" && selected && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await post(
                      "/inventory/counts/" + selected.id + "/confirm",
                      {
                        version: selected.version,
                        lines: selected.lines.map((l: Row, i: number) => ({
                          itemId: l.itemId,
                          locationId: l.locationId,
                          quantity: Number(f.get("quantity-" + i)),
                          expectedVersion: l.currentVersion,
                        })),
                      },
                    );
                  })
                }
              >
                <p className="muted">
                  Controleer de huidige voorraad vóór bevestiging. Verschillen
                  worden als correcties opgeslagen.
                </p>
                {selected.lines?.map((l: Row, i: number) => (
                  <Field
                    key={i}
                    label={`${name(items, l.itemId)} · ${name(locations, l.locationId)} · geregistreerd ${l.currentQuantity}`}
                  >
                    <input
                      name={"quantity-" + i}
                      type="number"
                      min="0"
                      step="any"
                      defaultValue={l.currentQuantity}
                      required
                    />
                  </Field>
                ))}
                <button
                  className="primary"
                  disabled={busy || selected.status === "confirmed"}
                >
                  Telling bevestigen
                </button>
              </form>
            )}
            {dialog === "seasons" && (
              <>
                <form
                  onSubmit={(e) =>
                    submit(e, async (f) => {
                      const activities = String(f.get("activities"))
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => {
                          const [offset, ...title] = line.split(";");
                          return {
                            title: title.join(";").trim(),
                            offsetDays: Number(offset),
                          };
                        });
                      await post("/seasons", {
                        name: f.get("name"),
                        activities,
                      });
                      setSeasons(await api("/seasons"));
                    })
                  }
                >
                  <Field label="Naam seizoenssjabloon">
                    <input name="name" required placeholder="Teeltwisseling" />
                  </Field>
                  <Field label="Activiteiten: relatieve dag; titel (één per regel)">
                    <textarea
                      name="activities"
                      required
                      rows={4}
                      placeholder={
                        "-7; Inspectie\n0; Schoonmaken\n2; Opstartcontrole"
                      }
                    />
                  </Field>
                  <button className="primary" disabled={busy}>
                    Sjabloon opslaan
                  </button>
                </form>
                <hr />
                {seasons.map((s) => (
                  <form
                    key={s.id}
                    onSubmit={(e) =>
                      submit(e, async (f) => {
                        await post("/seasons/" + s.id + "/activate", {
                          operationId: crypto.randomUUID(),
                          date: f.get("date"),
                          assigneeIds: f.getAll("assigneeIds"),
                        });
                      })
                    }
                  >
                    <h3>{s.name}</h3>
                    <p className="muted">{s.activities?.length} activiteiten</p>
                    <Field label="Datum gebeurtenis">
                      <input type="date" name="date" required />
                    </Field>
                    <Field label="Toewijzen">
                      <select name="assigneeIds" multiple>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button className="secondary" disabled={busy}>
                      Seizoen activeren
                    </button>
                    <hr />
                  </form>
                ))}
              </>
            )}
            {dialog === "notificationPrefs" && prefs && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await api("/notifications/preferences", {
                      method: "PUT",
                      body: JSON.stringify({
                        inApp: f.get("inApp") === "on",
                        push: f.get("push") === "on",
                        email: f.get("email") === "on",
                        criticalOverride: f.get("criticalOverride") === "on",
                        weekly: f.get("weekly") === "on",
                        quietStart: f.get("quietStart") || null,
                        quietEnd: f.get("quietEnd") || null,
                      }),
                    });
                  })
                }
              >
                {[
                  ["inApp", "In-app meldingen"],
                  ["push", "Push naar geregistreerde apparaten"],
                  ["email", "E-mailmeldingen"],
                  ["weekly", "Wekelijks werkoverzicht"],
                  [
                    "criticalOverride",
                    "Kritieke meldingen ook tijdens stille uren",
                  ],
                ].map(([k, l]) => (
                  <label className="checkbox" key={k}>
                    <input type="checkbox" name={k} defaultChecked={prefs[k]} />
                    {l}
                  </label>
                ))}
                <div className="form-grid">
                  <Field label="Stille uren vanaf">
                    <input
                      type="time"
                      name="quietStart"
                      defaultValue={prefs.quietStart || ""}
                    />
                  </Field>
                  <Field label="Tot">
                    <input
                      type="time"
                      name="quietEnd"
                      defaultValue={prefs.quietEnd || ""}
                    />
                  </Field>
                </div>
                <p className="muted">
                  Push en e-mail werken wanneer de beheerder het bijbehorende
                  transport heeft ingesteld.
                </p>
                <button className="primary" disabled={busy}>
                  Voorkeuren opslaan
                </button>
              </form>
            )}
            {dialog === "advanced" && (
              <AdvancedTools
                page={page}
                api={api}
                token={token}
                user={user}
                tasks={tasks}
                items={items}
                assets={assets}
                locations={locations}
                users={users}
                reload={reload}
              />
            )}
            {dialog === "annotation" && annotationTarget && (
              <AnnotationEditor
                attachment={annotationTarget}
                token={token}
                onSave={async (annotation) => {
                  await post(
                    "/attachments/" + annotationTarget.id + "/annotation",
                    { annotation, version: annotationTarget.version },
                  );
                  setDialog(
                    annotationTarget.taskId ? "taskDetail" : "assetDetail",
                  );
                  setDetailTab("media");
                }}
              />
            )}
            {dialog === "profilePrefs" && (
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    const preferences = {
                      ...profilePrefs.preferences,
                      taskFilter: f.get("taskFilter"),
                      dashboardMetrics: f.getAll("metric"),
                      taskSort: f.get("taskSort"),
                    };
                    const next = await api("/profile/preferences", {
                      method: "PATCH",
                      body: JSON.stringify({
                        version: profilePrefs.version,
                        preferences,
                      }),
                    });
                    setProfilePrefs(next);
                    setFilter(String(f.get("taskFilter")));
                  })
                }
              >
                <Field label="Standaard takenfilter">
                  <select
                    name="taskFilter"
                    defaultValue={
                      profilePrefs.preferences?.taskFilter || "active"
                    }
                  >
                    <option value="active">Open werk</option>
                    <option value="mine">Mijn taken</option>
                    <option value="all">Alle taken</option>
                    <option value="overdue">Achterstallig</option>
                  </select>
                </Field>
                <Field label="Taaksortering">
                  <select
                    name="taskSort"
                    defaultValue={
                      profilePrefs.preferences?.taskSort || "newest"
                    }
                  >
                    <option value="newest">Nieuwste eerst</option>
                    <option value="deadline">Deadline</option>
                    <option value="priority">Prioriteit</option>
                    <option value="title">Titel</option>
                  </select>
                </Field>
                <h3>Dashboardtegels</h3>
                {[
                  ["0", "Openstaande taken"],
                  ["1", "Hoge prioriteit"],
                  ["2", "Achterstallig"],
                  ["3", "Lage voorraad"],
                ].map(([v, l]) => (
                  <label className="checkbox" key={v}>
                    <input
                      name="metric"
                      type="checkbox"
                      value={v}
                      defaultChecked={
                        !profilePrefs.preferences?.dashboardMetrics ||
                        profilePrefs.preferences.dashboardMetrics.includes(v)
                      }
                    />
                    {l}
                  </label>
                ))}
                <button className="primary" disabled={busy}>
                  Voorkeuren opslaan
                </button>
              </form>
            )}
            {dialog === "search" && (
              <>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () =>
                      setSearchResults(
                        await api(
                          "/search?q=" + encodeURIComponent(String(f.get("q"))),
                        ),
                      ),
                    );
                  }}
                >
                  <input
                    name="q"
                    required
                    minLength={2}
                    placeholder="Zoek taken, machines, locaties en artikelen"
                    aria-label="Zoekterm"
                  />
                  <button className="primary" disabled={busy}>
                    Zoeken
                  </button>
                </form>
                {searchResults.map((r) => (
                  <a
                    className="task-row"
                    key={r.type + r.id}
                    href={"/?type=" + r.type + "&id=" + r.id}
                  >
                    <span className="task-text">{r.name}</span>
                    <span className="badge">
                      {(
                        {
                          task: "Taak",
                          asset: "Machine",
                          location: "Locatie",
                          item: "Artikel",
                        } as Row
                      )[r.type] || r.type}
                    </span>
                    <ChevronRight size={15} />
                  </a>
                ))}
              </>
            )}
            {dialog === "import" && (
              <ImportForm
                api={api}
                run={run}
                busy={busy}
                onDone={async () => {
                  setDialog("");
                  setNotice("Import verwerkt.");
                  await reload();
                }}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function ImportForm({
  api,
  run,
  busy,
  onDone,
}: {
  api: (p: string, o?: RequestInit) => Promise<any>;
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  onDone: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Row | null>(null),
    [kind, setKind] = useState("tasks");
  return (
    <>
      {!preview ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const file = f.get("file") as File;
              const bytes = new Uint8Array(await file.arrayBuffer());
              let raw = "";
              for (const b of bytes) raw += String.fromCharCode(b);
              setPreview(
                await api(
                  kind === "tasks"
                    ? "/imports/preview"
                    : "/imports/catalog/preview",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      kind,
                      filename: file.name,
                      content: btoa(raw),
                      mapping:
                        kind === "tasks"
                          ? {
                              title: f.get("titleColumn") || undefined,
                              description:
                                f.get("descriptionColumn") || undefined,
                              priority: f.get("priorityColumn") || undefined,
                              deadline: f.get("deadlineColumn") || undefined,
                            }
                          : undefined,
                    }),
                  },
                ),
              );
            });
          }}
        >
          <Field label="Importsoort">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="tasks">Taken / Todoist</option>
              <option value="inventory">Artikelen</option>
              <option value="locations">Locaties</option>
            </select>
          </Field>
          {kind === "tasks" && (
            <div className="form-grid">
              <Field label="Kolom titel">
                <input name="titleColumn" placeholder="CONTENT" />
              </Field>
              <Field label="Kolom omschrijving">
                <input name="descriptionColumn" placeholder="DESCRIPTION" />
              </Field>
              <Field label="Kolom prioriteit">
                <input name="priorityColumn" placeholder="PRIORITY" />
              </Field>
              <Field label="Kolom deadline">
                <input name="deadlineColumn" placeholder="DATE" />
              </Field>
            </div>
          )}
          <Field label="CSV- of Excelbestand">
            <input type="file" name="file" accept=".csv,.xlsx" required />
          </Field>
          <button className="primary" disabled={busy}>
            Voorbeeld controleren
          </button>
        </form>
      ) : (
        <>
          <p>
            {preview.rows?.length || 0} regels · {preview.duplicates || 0}{" "}
            duplicaten
          </p>
          <pre className="preview">
            {JSON.stringify(preview.rows?.slice(0, 10), null, 2)}
          </pre>
          {preview.invalid > 0 && (
            <div className="alert error">
              {preview.invalid} ongeldige regels
            </div>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(
                  (kind === "tasks" ? "/imports/" : "/imports/catalog/") +
                    preview.id +
                    "/confirm",
                  { method: "POST", body: "{}" },
                );
                await onDone();
              })
            }
          >
            Import bevestigen
          </button>
        </>
      )}
    </>
  );
}
