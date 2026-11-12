"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Star,
  Plus,
  X,
  CalendarDays,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { MediaGallery } from "./tools2";
import type { SettingsApi, SettingsRow as Row } from "./system-settings";
const json = (method: string, body: Row): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
const label = (rows: Row[], id: string) =>
  rows.find((r) => r.id === id)?.name || "Onbekend";

export function FavoriteShortcuts({
  api,
  assets,
  locations,
  onUse,
  onCreated,
}: {
  api: SettingsApi;
  assets: Row[];
  locations: Row[];
  onUse: (favorite: Row) => void;
  onCreated: (task: Row) => Promise<void>;
}) {
  const [favorites, setFavorites] = useState<Row[]>([]),
    [templates, setTemplates] = useState<Row[]>([]),
    [type, setType] = useState("asset"),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [f, t] = await Promise.all([
      api("/profile/favorites"),
      api("/templates"),
    ]);
    setFavorites(f);
    setTemplates(t);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const catalog =
    type === "asset"
      ? assets.filter((a) => a.status !== "archived")
      : type === "location"
        ? locations.filter((l) => l.active !== false)
        : templates;
  return (
    <section className="panel favorites-panel">
      <div className="panel-head">
        <h2>
          <Star size={16} /> Mijn snelkoppelingen
        </h2>
        <button className="text-button" onClick={() => setEditing(!editing)}>
          {editing ? "Sluiten" : "Favorieten beheren"}
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="favorite-links">
        {favorites.map((f) => (
          <div className="favorite-link" key={f.type + f.id}>
            <button
              disabled={busy || !f.available}
              onClick={() =>
                void work(async () => {
                  if (f.type === "template") {
                    await onCreated(
                      await api(
                        "/templates/" + f.id + "/apply",
                        json("POST", { operationId: crypto.randomUUID() }),
                      ),
                    );
                  } else onUse(f);
                })
              }
            >
              <Star size={16} />
              <span>
                <strong>{f.name}</strong>
                <small>
                  {!f.available
                    ? "Niet meer beschikbaar"
                    : f.type === "template"
                      ? "Nieuwe taak uit sjabloon"
                      : f.type === "asset"
                        ? "Melding bij machine"
                        : "Melding op locatie"}
                </small>
              </span>
            </button>
            {editing && (
              <button
                className="icon-button"
                aria-label={"Favoriet " + f.name + " verwijderen"}
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await api("/profile/favorites/" + f.type + "/" + f.id, {
                      method: "DELETE",
                    });
                    await load();
                  })
                }
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
      {!favorites.length && (
        <p className="muted empty-inline">
          Zet veelgebruikte machines, locaties en sjablonen hier klaar voor een
          snelle melding.
        </p>
      )}
      {editing && (
        <form
          className="favorite-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void work(async () => {
              await api(
                "/profile/favorites",
                json("PUT", { type, id: f.get("id") }),
              );
              await load();
            });
          }}
        >
          <label className="field">
            <span>Soort favoriet</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="asset">Machine</option>
              <option value="location">Locatie</option>
              <option value="template">Taaksjabloon</option>
            </select>
          </label>
          <label className="field">
            <span>Favoriet kiezen</span>
            <select name="id" key={type} required>
              <option value="">Selecteer…</option>
              {catalog.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.title}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" disabled={busy}>
            <Plus size={16} /> Toevoegen aan favorieten
          </button>
        </form>
      )}
    </section>
  );
}

export function CapacityPlanning({
  api,
  user,
  users,
  onOpenTask,
}: {
  api: SettingsApi;
  user: Row;
  users: Row[];
  onOpenTask: (task: Row) => Promise<void>;
}) {
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10)),
    [filter, setFilter] = useState(""),
    [capacity, setCapacity] = useState<Row | null>(null),
    [profile, setProfile] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState("");
  const start = new Date(anchor + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const from = start.toISOString().slice(0, 10),
    end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const to = end.toISOString().slice(0, 10);
  const load = async () => {
    const [c, p] = await Promise.all([
      api(
        "/planning/capacity?from=" +
          from +
          "&to=" +
          to +
          (filter ? "&userId=" + filter : ""),
      ),
      api("/profile/capacity"),
    ]);
    setCapacity(c);
    setProfile(p);
  };
  useEffect(() => {
    setError("");
    void load().catch((e) => setError(e.message));
  }, [from, filter]);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const people = Array.from(
    new Set<string>((capacity?.days || []).map((d: Row) => d.userId)),
  );
  return (
    <section className="panel padded capacity-panel">
      <div className="panel-title">
        <div>
          <h2>
            <CalendarDays size={18} /> Capaciteit en achterstand
          </h2>
          <p className="muted">
            Zie gepland werk naast beschikbare tijd. Verborgen privéwerkblokken
            van anderen worden niet meegerekend of getoond.
          </p>
        </div>
        <button className="secondary" onClick={() => setEditing(!editing)}>
          {editing ? "Sluiten" : "Mijn beschikbare uren"}
        </button>
      </div>
      <div className="toolbar">
        <label className="field">
          <span>Week van</span>
          <input
            type="date"
            value={anchor}
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
            required
          />
        </label>
        <label className="field">
          <span>Medewerker</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Hele team</option>
            {users
              .filter((u) => u.active !== false)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {editing && profile && (
        <form
          className="capacity-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await api(
                "/profile/capacity",
                json("PATCH", {
                  version: profile.version,
                  weekdayMinutes: Array.from({ length: 7 }, (_, i) =>
                    Math.round(Number(f.get("day-" + i)) * 60),
                  ),
                }),
              );
              await load();
              setNotice("Beschikbare uren opgeslagen.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {[
            "Zondag",
            "Maandag",
            "Dinsdag",
            "Woensdag",
            "Donderdag",
            "Vrijdag",
            "Zaterdag",
          ].map((day, i) => (
            <label className="field" key={day}>
              <span>{day} (uren)</span>
              <input
                name={"day-" + i}
                type="number"
                min="0"
                max="24"
                step="0.25"
                defaultValue={(profile.weekdayMinutes?.[i] || 0) / 60}
                required
              />
            </label>
          ))}
          <button className="primary" disabled={busy}>
            Beschikbaarheid opslaan
          </button>
        </form>
      )}
      {capacity && (
        <>
          <div className="table-wrap">
            <table className="capacity-table">
              <thead>
                <tr>
                  <th>Medewerker</th>
                  {dates.map((date) => (
                    <th key={date}>
                      {new Date(date + "T12:00:00Z").toLocaleDateString(
                        "nl-NL",
                        { weekday: "short", day: "numeric", month: "short" },
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((id) => (
                  <tr key={id}>
                    <td>
                      {capacity.days.find((d: Row) => d.userId === id)?.name ||
                        label(users, id)}
                    </td>
                    {dates.map((date) => {
                      const d = capacity.days.find(
                        (x: Row) => x.userId === id && x.date === date,
                      );
                      return (
                        <td
                          key={date}
                          className={
                            d?.overloadedMinutes > 0
                              ? "capacity-overloaded"
                              : ""
                          }
                        >
                          {d ? (
                            <>
                              <strong>
                                {(d.plannedMinutes / 60).toLocaleString(
                                  "nl-NL",
                                  { maximumFractionDigits: 1 },
                                )}{" "}
                                /{" "}
                                {(d.capacityMinutes / 60).toLocaleString(
                                  "nl-NL",
                                  { maximumFractionDigits: 1 },
                                )}{" "}
                                u
                              </strong>
                              {d.overloadedMinutes > 0 && (
                                <small>
                                  <AlertTriangle size={12} />{" "}
                                  {d.overloadedMinutes} min te veel
                                </small>
                              )}
                              {d.scope === "shared-only" && (
                                <small>Alleen gedeelde planning</small>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted capacity-definition">{capacity.definition}</p>
          <div className="overdue-maintenance">
            <h3>
              Achterstallig onderhoud{" "}
              <span className="count">
                {capacity.overdueMaintenance?.count || 0}
              </span>
            </h3>
            {capacity.overdueMaintenance?.taskIds?.length ? (
              capacity.overdueMaintenance.taskIds
                .slice(0, 20)
                .map((id: string, i: number) => (
                  <button
                    className="secondary"
                    key={id}
                    onClick={() => void onOpenTask({ id })}
                  >
                    Onderhoudstaak {i + 1} openen
                  </button>
                ))
            ) : (
              <p className="muted">Geen achterstallig onderhoud gevonden.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export function TaskWorkbench({
  api,
  token,
  task,
  user,
  items,
  locations,
  onUpdated,
  onReload,
}: {
  api: SettingsApi;
  token: string;
  task: Row;
  user: Row;
  items: Row[];
  locations: Row[];
  onUpdated: (task: Row) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [times, setTimes] = useState<Row[]>([]),
    [parts, setParts] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [itemId, setItemId] = useState(""),
    [balances, setBalances] = useState<Row[]>([]),
    [reason, setReason] = useState("");
  const stockOperation = useRef<{ signature: string; id: string } | null>(null);
  const load = async () => {
    const [t, p] = await Promise.all([
      api("/tasks/" + task.id + "/time"),
      api("/inventory/movements?taskId=" + task.id),
    ]);
    setTimes(t);
    setParts(p);
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [task.id]);
  useEffect(() => {
    if (!itemId) {
      setBalances([]);
      return;
    }
    void api("/inventory/balances?itemId=" + itemId)
      .then(setBalances)
      .catch((e) => setError(e.message));
  }, [itemId]);
  const work = async (fn: () => Promise<void>) => {
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
  const update = async (body: Row) =>
    onUpdated(
      await api(
        "/tasks/" + task.id,
        json("PATCH", { version: task.version, ...body }),
      ),
    );
  const running = times.find((t) => !t.endedAt && t.userId === user.id);
  const doneMinutes = times.reduce((sum, t) => sum + Number(t.minutes || 0), 0);
  const locked = ["completed", "cancelled", "archived"].includes(task.status);
  if (!task.version) return <p role="status">Taak laden…</p>;
  return (
    <div className="workbench">
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <div className="workbench-heading">
        <p>
          {task.description ||
            "Leg tijdens het werk je controlepunten, tijd, onderdelen en foto’s vast."}
        </p>
        <div className="workbench-actions">
          {!locked && (
            <button
              className="secondary"
              disabled={busy || task.status === "in_progress"}
              onClick={() => void work(() => update({ status: "in_progress" }))}
            >
              Werk starten
            </button>
          )}
          {!locked && (
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  if (
                    !window.confirm(
                      "Taak afronden? De server controleert verplichte checklistpunten.",
                    )
                  )
                    return;
                  await update({ status: "completed" });
                  if (running) {
                    await api(
                      "/time/" + running.id + "/stop",
                      json("POST", {}),
                    );
                    await load();
                  }
                  setNotice("Taak afgerond.");
                })
              }
            >
              Werk afronden
            </button>
          )}
        </div>
      </div>
      <div className="workbench-grid">
        <section className="workbench-section">
          <h3>Checklist</h3>
          {!(task.checklist || []).length && (
            <p className="muted">
              Nog geen checklistpunten. Voeg ze toe onder Checklist.
            </p>
          )}
          {(task.checklist || []).map((line: Row, index: number) => (
            <label className="checkbox" key={line.id || index}>
              <input
                type="checkbox"
                checked={!!line.done}
                disabled={busy || locked}
                onChange={(e) =>
                  void work(() =>
                    update({
                      checklist: task.checklist.map((entry: Row, i: number) =>
                        i === index
                          ? { ...entry, done: e.target.checked }
                          : entry,
                      ),
                    }),
                  )
                }
              />
              <span>
                {line.text}
                {line.required && <small> · verplicht</small>}
              </span>
            </label>
          ))}
        </section>
        <section className="workbench-section">
          <h3>
            <Clock size={16} /> Werktijd
          </h3>
          <p className="muted">
            {Math.round(doneMinutes)} minuten geregistreerd
            {running ? " · jouw timer loopt" : ""}.
          </p>
          <button
            className="secondary"
            disabled={busy || (locked && !running)}
            onClick={() =>
              void work(async () => {
                if (running)
                  await api("/time/" + running.id + "/stop", json("POST", {}));
                else
                  await api(
                    "/tasks/" + task.id + "/time",
                    json("POST", { startedAt: new Date().toISOString() }),
                  );
                await load();
                setNotice(
                  running
                    ? "Timer gepauzeerd en tijd vastgelegd."
                    : "Timer gestart.",
                );
              })
            }
          >
            {running ? "Pauzeer timer" : "Start / hervat timer"}
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void work(async () => {
                await api(
                  "/tasks/" + task.id + "/time",
                  json("POST", {
                    minutes: Number(f.get("minutes")),
                    note: f.get("note"),
                  }),
                );
                await load();
                form.reset();
                setNotice("Werktijd toegevoegd.");
              });
            }}
          >
            <label className="field">
              <span>Minuten handmatig toevoegen</span>
              <input name="minutes" type="number" min="1" required />
            </label>
            <label className="field">
              <span>Toelichting op tijd</span>
              <input name="note" />
            </label>
            <button className="text-button" disabled={busy || locked}>
              Tijd vastleggen
            </button>
          </form>
        </section>
        <section className="workbench-section">
          <h3>Gebruikte onderdelen</h3>
          {parts.length > 0 && (
            <ul className="workbench-parts">
              {parts.map((p) => (
                <li key={p.id}>
                  {label(items, p.itemId)} · {p.quantity}{" "}
                  {items.find((i) => i.id === p.itemId)?.unit}
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form),
                body = {
                  itemId,
                  locationId: f.get("locationId"),
                  quantity: Number(f.get("quantity")),
                  type: "usage",
                  reason: f.get("reason"),
                  taskId: task.id,
                };
              void work(async () => {
                const signature = JSON.stringify(body);
                if (
                  !stockOperation.current ||
                  stockOperation.current.signature !== signature
                )
                  stockOperation.current = {
                    signature,
                    id: crypto.randomUUID(),
                  };
                await api(
                  "/inventory/movements",
                  json("POST", {
                    ...body,
                    operationId: stockOperation.current.id,
                  }),
                );
                stockOperation.current = null;
                await load();
                await onReload();
                setBalances(await api("/inventory/balances?itemId=" + itemId));
                setNotice(
                  "Onderdeelverbruik bevestigd en aan deze taak gekoppeld.",
                );
              });
            }}
          >
            <label className="field">
              <span>Onderdeel</span>
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                required
              >
                <option value="">Kies een onderdeel</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.sku}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Uit opslaglocatie</span>
              <select name="locationId" key={itemId} required>
                <option value="">Kies voorraadlocatie</option>
                {balances
                  .filter((b) => Number(b.quantity) > 0)
                  .map((b) => (
                    <option key={b.locationId} value={b.locationId}>
                      {label(locations, b.locationId)} · {b.quantity}{" "}
                      beschikbaar
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Verbruikt aantal</span>
                <input
                  name="quantity"
                  type="number"
                  min="0.001"
                  step="any"
                  defaultValue="1"
                  required
                />
              </label>
              <label className="field">
                <span>Reden verbruik</span>
                <input
                  name="reason"
                  defaultValue={"Voor taak: " + task.title}
                  required
                />
              </label>
            </div>
            <button className="secondary" disabled={busy || locked}>
              Verbruik boeken
            </button>
          </form>
        </section>
        <section className="workbench-section workbench-media">
          <h3>Foto’s en documenten</h3>
          {task.status === "archived" ? (
            <p className="muted">
              Deze taak is gearchiveerd. Bestaande bijlagen staan onder
              Bijlagen.
            </p>
          ) : (
            <MediaGallery api={api} token={token} taskId={task.id} />
          )}
        </section>
      </div>
    </div>
  );
}
