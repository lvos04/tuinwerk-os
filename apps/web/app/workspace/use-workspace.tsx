"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import { priorities, type Row } from "./ui";
import { reauthFromResponse } from "../reauth";

/** Alle toestand en handelingen van Workspace; gedeeld door de schermcomponenten. */
export function useWorkspace() {
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
  const [connectionRevision, setConnectionRevision] = useState(0);
  const [taskContext, setTaskContext] = useState<Row | null>(null);
  useEffect(() => {
    if (dialog !== "task") setTaskContext(null);
  }, [dialog]);
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
      if (
        res.status === 403 &&
        !retried &&
        (await reauthFromResponse(b, (credentials) =>
          api(
            "/auth/reauth",
            { method: "POST", body: JSON.stringify(credentials) },
            auth,
            true,
          ),
        ))
      )
        return api(path, options, auth, true);
      if (res.status === 401 && auth) {
        sessionStorage.removeItem("tuinwerk-token");
        sessionStorage.removeItem("tuinwerk-refresh");
        setToken("");
        setUser(null);
      }
      throw new Error(
        res.status === 409
          ? "Conflict: " +
              (Array.isArray(b?.message)
                ? b.message.join(", ")
                : b?.message ||
                  "Gegevens zijn gewijzigd. Vernieuw en controleer je invoer.")
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
    setDetailTab("work");
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
    if (params.get("account") === "privacy") {
      deepLinkHandled.current = true;
      setDialog("profilePrefs");
      return;
    }
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
  return {
    token,
    setToken,
    user,
    setUser,
    page,
    setPage,
    ready,
    setReady,
    busy,
    setBusy,
    error,
    setError,
    notice,
    setNotice,
    search,
    setSearch,
    mobile,
    setMobile,
    tasks,
    setTasks,
    assets,
    setAssets,
    locations,
    setLocations,
    items,
    setItems,
    users,
    setUsers,
    schedules,
    setSchedules,
    notifications,
    setNotifications,
    dialog,
    setDialog,
    selected,
    setSelected,
    filter,
    setFilter,
    view,
    setView,
    comments,
    setComments,
    detailTab,
    setDetailTab,
    report,
    setReport,
    rules,
    setRules,
    counts,
    setCounts,
    balances,
    setBalances,
    sessions,
    setSessions,
    connectionRevision,
    setConnectionRevision,
    taskContext,
    setTaskContext,
    refreshFlight,
    deepLinkHandled,
    annotationTarget,
    setAnnotationTarget,
    profilePrefs,
    setProfilePrefs,
    searchResults,
    setSearchResults,
    adminStatus,
    setAdminStatus,
    aiSuggestion,
    setAiSuggestion,
    modalRef,
    assetHistory,
    setAssetHistory,
    attachments,
    setAttachments,
    times,
    setTimes,
    seasons,
    setSeasons,
    prefs,
    setPrefs,
    api,
    post,
    run,
    allPages,
    reload,
    login,
    submit,
    openTask,
    updateTask,
    active,
    today,
    overdue,
    urgent,
    low,
    filtered,
    name,
    checklist,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
/** Toestand na aanmelding: de gebruiker is bekend. */
export type WorkspaceView = Omit<Workspace, "user"> & { user: Row };
