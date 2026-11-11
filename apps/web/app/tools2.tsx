"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
type Row = Record<string, any>;
type Api = (path: string, options?: RequestInit) => Promise<any>;
const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);
const options = (rows: Row[]) =>
  rows.map((r) => (
    <option key={r.id} value={r.id}>
      {r.name || r.title}
    </option>
  ));
const json = (method: string, body: Row) => ({
  method,
  body: JSON.stringify(body),
});
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AdvancedTools({
  page,
  api,
  token,
  user,
  tasks,
  items,
  assets,
  locations,
  users,
  reload,
}: {
  page: string;
  api: Api;
  token: string;
  user: Row;
  tasks: Row[];
  items: Row[];
  assets: Row[];
  locations: Row[];
  users: Row[];
  reload: () => Promise<void>;
}) {
  const tabs: Record<string, string> =
    page === "tasks"
      ? { templates: "Taaksjablonen", bulk: "Bulk wijzigen", ai: "AI-voorstel" }
      : page === "inventory"
        ? {
            items: "Artikelen bewerken",
            minimum: "Minima per locatie",
            counts: "Telling aanvullen",
            journal: "Mutatiehistorie",
          }
        : page === "planning"
          ? { seasons: "Seizoenen aanpassen" }
          : page === "reports"
            ? { exports: "Achtergrondexports", ai: "AI-voorstel" }
            : page === "settings"
              ? {
                  mfa: "Tweede factor",
                  admin: "Gegevensbeheer",
                  users: "Accounts bewerken",
                }
              : { templates: "Taaksjablonen", ai: "AI-voorstel" };
  const [tab, setTab] = useState(Object.keys(tabs)[0]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [extra, setExtra] = useState<Row[]>([]),
    [mfa, setMfa] = useState<Row | null>(null),
    [setup, setSetup] = useState<Row | null>(null),
    [recovery, setRecovery] = useState<string[]>([]),
    [suggestion, setSuggestion] = useState(""),
    [aiStatus, setAiStatus] = useState<Row | null>(null);
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
  const load = async () => {
    setSelected(null);
    if (tab === "templates") setRows(await api("/templates"));
    if (tab === "exports") setRows(await api("/reports/jobs"));
    if (tab === "seasons") {
      setRows(await api("/seasons"));
      setExtra(await api("/seasons/activations"));
    }
    if (tab === "counts") setRows(await api("/inventory/counts"));
    if (tab === "minimum") setRows(await api("/inventory/balances"));
    if (tab === "journal") setRows(await api("/inventory/movements"));
    if (tab === "mfa") setMfa(await api("/auth/mfa"));
    if (tab === "ai") setAiStatus(await api("/ai/status"));
  };
  useEffect(() => {
    void work(load);
  }, [tab]);
  const submit = (
    e: FormEvent<HTMLFormElement>,
    fn: (f: FormData) => Promise<void>,
  ) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void work(() => fn(f));
  };
  const download = async (path: string, name: string) => {
    await api("/auth/me");
    const active = sessionStorage.getItem("tuinwerk-token") || token;
    const r = await fetch("/api" + path, {
      headers: { Authorization: "Bearer " + active },
    });
    if (!r.ok) throw Error("Download niet beschikbaar.");
    saveBlob(await r.blob(), name);
  };
  return (
    <>
      <div className="tabs" style={{ marginBottom: 22, flexWrap: "wrap" }}>
        {Object.entries(tabs).map(([id, l]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {l}
          </button>
        ))}
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
      {tab === "exports" && (
        <>
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                await api(
                  "/reports/jobs",
                  json(
                    "POST",
                    Object.fromEntries([...f.entries()].filter(([, v]) => v)),
                  ),
                );
                setRows(await api("/reports/jobs"));
                setNotice(
                  "Export staat in de wachtrij. De achtergrondworker verwerkt deze aanvraag.",
                );
              })
            }
          >
            <div className="form-grid">
              <F label="Gegevens">
                <select name="type">
                  <option value="tasks">Taken</option>
                  <option value="inventory">Voorraad</option>
                  <option value="assets">Machines</option>
                </select>
              </F>
              <F label="Formaat">
                <select name="format">
                  <option value="xlsx">Excel</option>
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                </select>
              </F>
              <F label="Vanaf">
                <input name="from" type="date" />
              </F>
              <F label="Tot en met">
                <input name="to" type="date" />
              </F>
              <F label="Locatie">
                <select name="locationId">
                  <option value="">Alle locaties</option>
                  {options(locations)}
                </select>
              </F>
              <F label="Machine">
                <select name="assetId">
                  <option value="">Alle machines</option>
                  {options(assets)}
                </select>
              </F>
            </div>
            <button className="primary" disabled={busy}>
              Export aanvragen
            </button>
          </form>
          <hr />
          <button
            className="secondary"
            onClick={() =>
              void work(async () => setRows(await api("/reports/jobs")))
            }
          >
            Status vernieuwen
          </button>
          {rows.map((r) => (
            <div className="task-row" key={r.id}>
              <span className="task-text">
                <strong>
                  {r.filters?.type} · {r.filters?.format?.toUpperCase()}
                </strong>
                <small>
                  {new Date(r.createdAt).toLocaleString("nl-NL")} ·{" "}
                  {(
                    {
                      queued: "In wachtrij",
                      running: "Bezig",
                      completed: "Gereed",
                      failed: "Mislukt",
                    } as Row
                  )[r.status] || r.status}
                  {r.error && " · " + r.error}
                </small>
              </span>
              {r.status === "completed" && (
                <button
                  className="secondary"
                  onClick={() =>
                    void work(() =>
                      download(
                        "/reports/jobs/" + r.id + "/download",
                        "tuinwerk-export." + r.filters.format,
                      ),
                    )
                  }
                >
                  Download
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {tab === "ai" && (
        <>
          <p className="muted">
            AI maakt alleen een voorstel. Alleen de tekst hieronder wordt na
            jouw toestemming naar de ingestelde provider gestuurd. Controleer
            het resultaat voordat je het opslaat.
          </p>
          <div className="alert">
            {aiStatus?.enabled
              ? "Provider: " + aiStatus.provider + " · " + aiStatus.model
              : "AI is uitgeschakeld. De beheerder kan de provider, sleutel en budgetten instellen in de serverconfiguratie."}
          </div>
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                const r = await api(
                  "/ai/suggest",
                  json("POST", {
                    text: f.get("text"),
                    consent: f.get("consent") === "on",
                  }),
                );
                setSuggestion(r.suggestion);
              })
            }
          >
            <F label="Tekst voor de AI-provider">
              <textarea name="text" required maxLength={4000} rows={5} />
            </F>
            <label className="checkbox">
              <input name="consent" type="checkbox" required /> Ik geef
              toestemming deze tekst met de getoonde provider te delen.
            </label>
            <button className="primary" disabled={busy || !aiStatus?.enabled}>
              Voorstel genereren
            </button>
          </form>
          {suggestion && (
            <>
              <hr />
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    if (
                      !window.confirm(
                        "Heb je het voorstel gecontroleerd en wil je deze taak aanmaken?",
                      )
                    )
                      return;
                    await api(
                      "/tasks",
                      json("POST", {
                        operationId: crypto.randomUUID(),
                        title: f.get("title"),
                        description: f.get("description"),
                      }),
                    );
                    setSuggestion("");
                    await reload();
                    setNotice("Gecontroleerd voorstel als taak opgeslagen.");
                  })
                }
              >
                <F label="Titel na jouw controle">
                  <input name="title" required maxLength={300} />
                </F>
                <F label="Corrigeer het voorstel">
                  <textarea
                    name="description"
                    defaultValue={suggestion}
                    rows={10}
                  />
                </F>
                <button className="primary" disabled={busy}>
                  Gecontroleerd voorstel opslaan
                </button>
              </form>
            </>
          )}
        </>
      )}
      {tab === "mfa" && (
        <>
          <p className="muted">
            Beveilig je beheerdersaccount met een authenticator-app. Elke
            herstelcode werkt één keer.
          </p>
          {!mfa?.available && (
            <div className="alert error">
              De serverbeheerder moet eerst TOTP_ENCRYPTION_KEY instellen.
            </div>
          )}
          <p>
            Tweede factor:{" "}
            <strong>{mfa?.enabled ? "Ingeschakeld" : "Uitgeschakeld"}</strong>
          </p>
          {!mfa?.enabled && !setup && (
            <form
              onSubmit={(e) =>
                submit(e, async (f) =>
                  setSetup(
                    await api(
                      "/auth/mfa/setup",
                      json("POST", { password: f.get("password") }),
                    ),
                  ),
                )
              }
            >
              <F label="Bevestig je wachtwoord">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </F>
              <button className="primary" disabled={busy || !mfa?.available}>
                Tweede factor instellen
              </button>
            </form>
          )}
          {setup && (
            <>
              <p>
                Voeg in je authenticator handmatig een tijdgebonden account toe
                met deze sleutel:
              </p>
              <code
                style={{
                  display: "block",
                  padding: 15,
                  overflowWrap: "anywhere",
                  background: "#f2f5ed",
                }}
              >
                {setup.secret}
              </code>
              <p className="muted">
                Account: {user.email} · TuinWerk OS · 6 cijfers · 30 seconden
              </p>
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    const r = await api(
                      "/auth/mfa/enable",
                      json("POST", { otp: f.get("otp") }),
                    );
                    setRecovery(r.recoveryCodes);
                    setSetup(null);
                    setMfa(await api("/auth/mfa"));
                    setNotice(
                      "Tweede factor ingeschakeld. Bewaar de herstelcodes nu veilig.",
                    );
                  })
                }
              >
                <F label="Code uit je authenticator">
                  <input
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </F>
                <button className="primary" disabled={busy}>
                  Activeren
                </button>
              </form>
            </>
          )}
          {recovery.length > 0 && (
            <>
              <h3>Herstelcodes — alleen nu zichtbaar</h3>
              <pre className="preview">{recovery.join("\n")}</pre>
              <button
                className="secondary"
                onClick={() =>
                  saveBlob(
                    new Blob([recovery.join("\n")], { type: "text/plain" }),
                    "tuinwerk-herstelcodes.txt",
                  )
                }
              >
                Herstelcodes downloaden
              </button>
              <label className="checkbox">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) setRecovery([]);
                  }}
                />{" "}
                Ik heb deze codes veilig opgeslagen; verberg ze.
              </label>
            </>
          )}
          {mfa?.enabled && (
            <>
              <hr />
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    if (
                      !window.confirm(
                        "Tweede factor uitschakelen voor dit account?",
                      )
                    )
                      return;
                    await api(
                      "/auth/mfa/disable",
                      json("POST", {
                        password: f.get("password"),
                        otp: f.get("otp"),
                      }),
                    );
                    setMfa(await api("/auth/mfa"));
                    setNotice("Tweede factor uitgeschakeld.");
                  })
                }
              >
                <F label="Wachtwoord">
                  <input name="password" type="password" required />
                </F>
                <F label="Authenticatiecode of herstelcode">
                  <input name="otp" required />
                </F>
                <button className="secondary" disabled={busy}>
                  Tweede factor uitschakelen
                </button>
              </form>
            </>
          )}
        </>
      )}
      {tab === "templates" && (
        <>
          <F label="Sjabloon">
            <select
              value={selected?.id || ""}
              onChange={(e) =>
                setSelected(rows.find((r) => r.id === e.target.value) || null)
              }
            >
              <option value="">Nieuw sjabloon</option>
              {options(rows)}
            </select>
          </F>
          <form
            key={selected?.id || "new"}
            onSubmit={(e) =>
              submit(e, async (f) => {
                const template = {
                  ...selected?.template,
                  title: f.get("title"),
                  description: f.get("description"),
                  category: f.get("category"),
                  priority: f.get("priority"),
                  estimatedMinutes: Number(f.get("minutes") || 0),
                  assetId: f.get("assetId") || null,
                  checklist: String(f.get("checklist"))
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((text) => ({
                      id: crypto.randomUUID(),
                      text,
                      required: true,
                      done: false,
                    })),
                };
                await api(
                  selected ? "/templates/" + selected.id : "/templates",
                  json(selected ? "PATCH" : "POST", {
                    operationId: crypto.randomUUID(),
                    version: selected?.version,
                    name: f.get("name"),
                    template,
                  }),
                );
                await load();
                setNotice("Sjabloon opgeslagen.");
              })
            }
          >
            <F label="Sjabloonnaam">
              <input name="name" required defaultValue={selected?.name || ""} />
            </F>
            <F label="Standaardtitel">
              <input
                name="title"
                required
                defaultValue={selected?.template?.title || ""}
              />
            </F>
            <F label="Omschrijving">
              <textarea
                name="description"
                defaultValue={selected?.template?.description || ""}
              />
            </F>
            <div className="form-grid">
              <F label="Categorie">
                <input
                  name="category"
                  defaultValue={selected?.template?.category || "onderhoud"}
                />
              </F>
              <F label="Geschatte minuten">
                <input
                  name="minutes"
                  type="number"
                  min="0"
                  defaultValue={selected?.template?.estimatedMinutes || 0}
                />
              </F>
              <F label="Prioriteit">
                <select
                  name="priority"
                  defaultValue={selected?.template?.priority || "normal"}
                >
                  <option value="low">Laag</option>
                  <option value="normal">Normaal</option>
                  <option value="high">Hoog</option>
                  <option value="critical">Kritiek</option>
                </select>
              </F>
              <F label="Machine">
                <select
                  name="assetId"
                  defaultValue={selected?.template?.assetId || ""}
                >
                  <option value="">Geen vaste machine</option>
                  {options(assets)}
                </select>
              </F>
            </div>
            <F label="Verplichte checklist (één punt per regel)">
              <textarea
                name="checklist"
                rows={4}
                defaultValue={
                  selected?.template?.checklist
                    ?.map((c: Row) => c.text)
                    .join("\n") || ""
                }
              />
            </F>
            <button className="primary" disabled={busy}>
              Sjabloon opslaan
            </button>
          </form>
          {selected && (
            <>
              <hr />
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await api(
                      "/templates/" + selected.id + "/apply",
                      json("POST", { operationId: crypto.randomUUID() }),
                    );
                    await reload();
                    setNotice("Nieuwe taak uit het sjabloon aangemaakt.");
                  })
                }
              >
                Taak uit dit sjabloon aanmaken
              </button>
            </>
          )}
        </>
      )}
      {tab === "bulk" && (
        <form
          onSubmit={(e) =>
            submit(e, async (f) => {
              const chosen = f.getAll("task");
              if (!chosen.length) throw Error("Selecteer minstens één taak.");
              if (
                !window.confirm(
                  `${chosen.length} taken wijzigen? Iedere taak wordt afzonderlijk op conflicten gecontroleerd.`,
                )
              )
                return;
              const failures: string[] = [];
              let done = 0;
              for (const id of chosen) {
                const t = tasks.find((x) => x.id === id)!;
                try {
                  await api(
                    "/tasks/" + id,
                    json("PATCH", {
                      version: t.version,
                      status: f.get("status") || undefined,
                      priority: f.get("priority") || undefined,
                      reason: f.get("reason"),
                      ...(f.get("assign") === "on"
                        ? { assignedTo: f.getAll("assignedTo") }
                        : {}),
                    }),
                  );
                  done++;
                } catch (e) {
                  failures.push(t.title + ": " + (e as Error).message);
                }
              }
              await reload();
              setNotice(
                `${done} taken gewijzigd.${failures.length ? " Niet gewijzigd: " + failures.join(" · ") : ""}`,
              );
            })
          }
        >
          <div className="form-grid">
            <F label="Nieuwe status">
              <select name="status">
                <option value="">Ongewijzigd</option>
                {Object.entries({
                  open: "Open",
                  planned: "Gepland",
                  in_progress: "Bezig",
                  blocked: "Geblokkeerd",
                  completed: "Afgerond",
                  cancelled: "Geannuleerd",
                  archived: "Gearchiveerd",
                }).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </F>
            <F label="Nieuwe prioriteit">
              <select name="priority">
                <option value="">Ongewijzigd</option>
                <option value="low">Laag</option>
                <option value="normal">Normaal</option>
                <option value="high">Hoog</option>
                <option value="critical">Kritiek</option>
              </select>
            </F>
          </div>
          <F label="Reden (voor blokkeren en heropenen)">
            <input name="reason" />
          </F>
          <label className="checkbox">
            <input type="checkbox" name="assign" /> Toewijzing vervangen door
            onderstaande medewerkers
          </label>
          <F label="Medewerkers">
            <select name="assignedTo" multiple>
              {options(users)}
            </select>
          </F>
          <div style={{ maxHeight: 250, overflow: "auto" }}>
            {tasks
              .filter((t) => t.status !== "archived")
              .map((t) => (
                <label className="checkbox" key={t.id}>
                  <input type="checkbox" name="task" value={t.id} />
                  {t.title}
                </label>
              ))}
          </div>
          <button className="primary" disabled={busy}>
            Geselecteerde taken wijzigen
          </button>
        </form>
      )}
      {tab === "items" && (
        <>
          <F label="Artikel bewerken">
            <select
              value={selected?.id || ""}
              onChange={(e) =>
                setSelected(items.find((r) => r.id === e.target.value) || null)
              }
            >
              <option value="">Kies een artikel</option>
              {options(items)}
            </select>
          </F>
          {selected && (
            <form
              key={selected.id}
              onSubmit={(e) =>
                submit(e, async (f) => {
                  await api(
                    "/inventory/items/" + selected.id,
                    json("PATCH", {
                      version: selected.version,
                      name: f.get("name"),
                      sku: f.get("sku"),
                      unit: f.get("unit"),
                      minimum: Number(f.get("minimum")),
                      price: f.get("price") ? Number(f.get("price")) : null,
                      supplier: f.get("supplier"),
                      supplierSku: f.get("supplierSku"),
                      description: f.get("description"),
                      category: f.get("category"),
                      compatibleAssetIds: f.getAll("compatibleAssetIds"),
                      active: f.get("active") === "on",
                    }),
                  );
                  setSelected(null);
                  await reload();
                  setNotice("Artikel bijgewerkt.");
                })
              }
            >
              <F label="Artikelnaam">
                <input name="name" required defaultValue={selected.name} />
              </F>
              <div className="form-grid">
                <F label="Artikelnummer">
                  <input name="sku" required defaultValue={selected.sku} />
                </F>
                <F label="Eenheid">
                  <input name="unit" required defaultValue={selected.unit} />
                </F>
                <F label="Minimum totaal">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    name="minimum"
                    defaultValue={selected.minimum}
                  />
                </F>
                <F label="Prijsindicatie per eenheid">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    name="price"
                    defaultValue={selected.price || ""}
                  />
                </F>
                <F label="Leverancier (referentie)">
                  <input name="supplier" defaultValue={selected.supplier} />
                </F>
                <F label="Artikelnummer leverancier">
                  <input
                    name="supplierSku"
                    defaultValue={selected.supplierSku}
                  />
                </F>
              </div>
              <F label="Categorie">
                <input name="category" defaultValue={selected.category} />
              </F>
              <F label="Omschrijving">
                <textarea
                  name="description"
                  defaultValue={selected.description}
                />
              </F>
              <F label="Compatibele machines">
                <select
                  name="compatibleAssetIds"
                  multiple
                  defaultValue={selected.compatibleAssetIds || []}
                >
                  {options(assets)}
                </select>
              </F>
              <label className="checkbox">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={selected.active}
                />{" "}
                Actief in catalogus
              </label>
              <button className="primary" disabled={busy}>
                Artikel opslaan
              </button>
            </form>
          )}
        </>
      )}
      {tab === "minimum" && (
        <>
          {rows.map((b) => (
            <form
              className="task-row"
              key={b.itemId + b.locationId}
              onSubmit={(e) =>
                submit(e, async (f) => {
                  await api(
                    "/inventory/balances/" + b.itemId + "/" + b.locationId,
                    json("PATCH", {
                      version: b.version,
                      minimum:
                        f.get("minimum") === ""
                          ? null
                          : Number(f.get("minimum")),
                    }),
                  );
                  await load();
                  await reload();
                  setNotice("Minimumvoorraad bijgewerkt.");
                })
              }
            >
              <span className="task-text">
                <strong>{items.find((x) => x.id === b.itemId)?.name}</strong>
                <small>
                  {locations.find((x) => x.id === b.locationId)?.name} · saldo{" "}
                  {b.quantity}
                </small>
              </span>
              <F label="Minimum">
                <input
                  name="minimum"
                  style={{ width: 90 }}
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={b.minimum ?? ""}
                  placeholder="Geen"
                />
              </F>
              <button className="secondary" disabled={busy}>
                Opslaan
              </button>
            </form>
          ))}
          {!rows.length && (
            <p>
              Boek eerst voorraad op een locatie om een locatie-minimum in te
              stellen.
            </p>
          )}
        </>
      )}
      {tab === "counts" && (
        <>
          <F label="Telronde">
            <select
              value={selected?.id || ""}
              onChange={(e) => {
                const id = e.target.value;
                if (id)
                  void work(async () =>
                    setSelected(await api("/inventory/counts/" + id)),
                  );
                else setSelected(null);
              }}
            >
              <option value="">Kies een telronde</option>
              {options(rows)}
            </select>
          </F>
          {selected && (
            <>
              <p className="muted">
                Status: {selected.status}. Voeg een fysiek gevonden artikel toe,
                ook als er nog geen saldo geregistreerd is. De telling bevestig
                je via Inventarisatie.
              </p>
              <form
                onSubmit={(e) =>
                  submit(e, async (f) => {
                    await api(
                      "/inventory/counts/" + selected.id + "/lines",
                      json("POST", {
                        version: selected.version,
                        itemId: f.get("itemId"),
                        locationId: f.get("locationId"),
                      }),
                    );
                    setSelected(await api("/inventory/counts/" + selected.id));
                    setNotice("Telregel toegevoegd.");
                  })
                }
              >
                <F label="Gevonden artikel">
                  <select name="itemId" required>
                    <option value="">Kies artikel</option>
                    {options(items)}
                  </select>
                </F>
                <F label="Opslaglocatie">
                  <select name="locationId" required>
                    <option value="">Kies locatie</option>
                    {options(locations.filter((x) => x.active !== false))}
                  </select>
                </F>
                <button
                  className="primary"
                  disabled={busy || selected.status === "confirmed"}
                >
                  Telregel toevoegen
                </button>
              </form>
              <h3 style={{ marginTop: 25 }}>Mutaties sinds start telling</h3>
              {selected.movementsDuringCount?.map((m: Row) => (
                <div className="task-row" key={m.id}>
                  <span className="task-text">
                    {items.find((i) => i.id === m.itemId)?.name}
                    <small>
                      {new Date(m.createdAt).toLocaleString("nl-NL")} ·{" "}
                      {m.reason}
                    </small>
                  </span>
                  <strong>{m.quantity}</strong>
                  <span className="badge">{m.type}</span>
                </div>
              ))}
              {!selected.movementsDuringCount?.length && (
                <p className="muted">Geen tussentijdse mutaties.</p>
              )}
            </>
          )}
        </>
      )}
      {tab === "journal" && (
        <>
          <button className="secondary" onClick={() => void work(load)}>
            Vernieuwen
          </button>
          {rows.map((m) => (
            <div className="task-row" key={m.id}>
              <span className="task-text">
                <strong>
                  {items.find((i) => i.id === m.itemId)?.name || m.itemId}
                </strong>
                <small>
                  {locations.find((l) => l.id === m.locationId)?.name} ·{" "}
                  {new Date(m.createdAt).toLocaleString("nl-NL")} · {m.reason}
                </small>
              </span>
              <span className="badge">
                {(
                  {
                    receipt: "Aanvulling",
                    usage: "Verbruik",
                    transfer: "Verplaatsing",
                    correction: "Correctie",
                  } as Row
                )[m.type] || m.type}
              </span>
              <strong>{m.quantity}</strong>
            </div>
          ))}
        </>
      )}
      {tab === "seasons" && (
        <>
          <F label="Bestaand seizoenssjabloon">
            <select
              value={selected?.id || ""}
              onChange={(e) =>
                setSelected(rows.find((r) => r.id === e.target.value) || null)
              }
            >
              <option value="">Kies een sjabloon</option>
              {options(rows)}
            </select>
          </F>
          {selected && (
            <form
              key={selected.id}
              onSubmit={(e) =>
                submit(e, async (f) => {
                  const activities = String(f.get("activities"))
                    .split("\n")
                    .filter(Boolean)
                    .map((line, index) => {
                      const [offset, ...title] = line.split(";");
                      return {
                        ...selected.activities?.[index],
                        title: title.join(";").trim(),
                        offsetDays: Number(offset),
                      };
                    });
                  await api(
                    "/seasons/" + selected.id,
                    json("PATCH", {
                      version: selected.version,
                      name: f.get("name"),
                      activities,
                    }),
                  );
                  await load();
                  setNotice("Sjabloon bijgewerkt voor volgende activaties.");
                })
              }
            >
              <F label="Naam">
                <input name="name" required defaultValue={selected.name} />
              </F>
              <F label="Activiteiten: relatieve dag; titel">
                <textarea
                  name="activities"
                  required
                  rows={6}
                  defaultValue={selected.activities
                    .map((a: Row) => a.offsetDays + "; " + a.title)
                    .join("\n")}
                />
              </F>
              <button className="primary" disabled={busy}>
                Sjabloon bijwerken
              </button>
            </form>
          )}
          <hr />
          <h3>Geactiveerde seizoenen verschuiven</h3>
          {extra.map((a) => (
            <form
              key={a.id}
              onSubmit={(e) =>
                submit(e, async (f) => {
                  if (
                    !window.confirm(
                      "Alle nog niet gestarte activiteiten naar de nieuwe seizoensdatum verplaatsen?",
                    )
                  )
                    return;
                  const r = await api(
                    "/seasons/activations/" + a.id + "/shift",
                    json("POST", {
                      version: a.version,
                      date: f.get("date"),
                      ...(f.get("reassign") === "on"
                        ? { assigneeIds: f.getAll("assigneeIds") }
                        : {}),
                    }),
                  );
                  await load();
                  await reload();
                  setNotice(
                    `${r.shifted.length} taken verplaatst; ${r.skipped.length} gestarte/uitgevoerde taken behouden.`,
                  );
                })
              }
            >
              <h3>{a.name}</h3>
              <F label="Nieuwe gebeurtenisdatum">
                <input
                  type="date"
                  name="date"
                  required
                  defaultValue={String(a.anchorDate).slice(0, 10)}
                />
              </F>
              <label className="checkbox">
                <input name="reassign" type="checkbox" /> Betrokken medewerkers
                vervangen
              </label>
              <F label="Medewerkers">
                <select name="assigneeIds" multiple>
                  {options(users)}
                </select>
              </F>
              <button className="secondary" disabled={busy}>
                Seizoen verschuiven
              </button>
              <hr />
            </form>
          ))}
        </>
      )}
      {tab === "admin" && user.role === "admin" && (
        <>
          <h3>Volledige gegevensexport</h3>
          <p className="muted">
            Download de databasegegevens als JSON. Bijlagen en
            serverconfiguratie worden apart via de back-up-/herstelprocedure
            meegenomen.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void work(() =>
                download("/admin/export", "tuinwerk-gegevens.json"),
              )
            }
          >
            Gegevensexport downloaden
          </button>
          <hr />
          <h3>Definitief verwijderen</h3>
          <p className="muted">
            Alleen gearchiveerde gegevens zonder historische verwijzingen kunnen
            worden verwijderd. De server controleert dit en registreert de
            reden.
          </p>
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                if (
                  !window.confirm(
                    "Dit verwijdert het opgegeven gearchiveerde record definitief. Doorgaan?",
                  )
                )
                  return;
                await api(
                  "/admin/data/" + f.get("type") + "/" + f.get("id"),
                  json("DELETE", {
                    confirm: f.get("confirm"),
                    reason: f.get("reason"),
                  }),
                );
                await reload();
                setNotice("Record definitief verwijderd.");
              })
            }
          >
            <F label="Type">
              <select name="type">
                <option value="task">Taak</option>
                <option value="asset">Machine</option>
                <option value="location">Locatie</option>
                <option value="item">Artikel</option>
              </select>
            </F>
            <F label="Record-ID">
              <input name="id" required />
            </F>
            <F label="Herhaal record-ID ter bevestiging">
              <input name="confirm" required />
            </F>
            <F label="Reden">
              <textarea name="reason" required />
            </F>
            <button className="secondary" disabled={busy}>
              Definitief verwijderen
            </button>
          </form>
        </>
      )}
      {tab === "users" && user.role === "admin" && (
        <>
          <F label="Account">
            <select
              value={selected?.id || ""}
              onChange={(e) =>
                setSelected(users.find((r) => r.id === e.target.value) || null)
              }
            >
              <option value="">Kies medewerker</option>
              {options(users)}
            </select>
          </F>
          {selected && (
            <form
              key={selected.id}
              onSubmit={(e) =>
                submit(e, async (f) => {
                  await api(
                    "/users/" + selected.id,
                    json("PATCH", {
                      name: f.get("name"),
                      role: f.get("role"),
                      active: f.get("active") === "on",
                      ...(f.get("password")
                        ? { password: f.get("password") }
                        : {}),
                    }),
                  );
                  await reload();
                  setSelected(null);
                  setNotice("Account bijgewerkt.");
                })
              }
            >
              <F label="Naam">
                <input name="name" defaultValue={selected.name} required />
              </F>
              <F label="Rol">
                <select name="role" defaultValue={selected.role}>
                  <option value="employee">Medewerker</option>
                  <option value="admin">Beheerder</option>
                </select>
              </F>
              <F label="Nieuw wachtwoord (leeg = behouden)">
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                />
              </F>
              <label className="checkbox">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={selected.active !== false}
                />{" "}
                Account actief
              </label>
              <button className="primary" disabled={busy}>
                Account opslaan
              </button>
            </form>
          )}
        </>
      )}
    </>
  );
}
export function MediaGallery({
  api,
  token,
  taskId,
  assetId,
  onAnnotate,
}: {
  api: Api;
  token: string;
  taskId?: string;
  assetId?: string;
  onAnnotate?: (a: Row) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [uploads, setUploads] = useState<
      { id: string; file: File; status: string; error?: string }[]
    >([]),
    [phase, setPhase] = useState("before"),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(""),
    [uploading, setUploading] = useState(false);
  const load = async () =>
    setRows(
      await api(
        "/attachments?" + (taskId ? "taskId=" + taskId : "assetId=" + assetId),
      ),
    );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [taskId, assetId]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (uploads.some((u) => u.status !== "done")) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [uploads]);
  const send = async (id?: string) => {
    setUploading(true);
    try {
      for (const u of uploads.filter(
        (x) => x.status !== "done" && (!id || x.id === id),
      )) {
        setUploads((prev) =>
          prev.map((x) =>
            x.id === u.id ? { ...x, status: "uploading", error: undefined } : x,
          ),
        );
        try {
          const f = new FormData();
          f.append("file", u.file);
          f.append(taskId ? "taskId" : "assetId", taskId || assetId!);
          f.append("phase", phase);
          f.append("operationId", u.id);
          await api("/attachments", { method: "POST", body: f });
          setUploads((prev) =>
            prev.map((x) => (x.id === u.id ? { ...x, status: "done" } : x)),
          );
        } catch (e) {
          setUploads((prev) =>
            prev.map((x) =>
              x.id === u.id
                ? { ...x, status: "failed", error: (e as Error).message }
                : x,
            ),
          );
        }
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const file = async (a: Row, view: boolean) => {
    try {
      await api("/auth/me");
      const r = await fetch("/api/attachments/" + a.id + "/file", {
        headers: {
          Authorization:
            "Bearer " + (sessionStorage.getItem("tuinwerk-token") || token),
        },
      });
      if (!r.ok) throw Error("Bijlage kon niet worden opgehaald.");
      const blob = await r.blob();
      if (view) setPreview(URL.createObjectURL(blob));
      else saveBlob(blob, a.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {error && <div className="alert error">{error}</div>}
      <div>
        {rows.map((a) => (
          <div className="task-row" key={a.id}>
            <span className="task-text">
              <strong>{a.name}</strong>
              <small>
                {
                  ({ before: "Voor", during: "Tijdens", after: "Na" } as Row)[
                    a.phase
                  ]
                }{" "}
                · {Math.ceil(a.size / 1024)} KB
              </small>
            </span>
            {a.mimeType?.startsWith("image/") && (
              <button
                className="text-button"
                onClick={() =>
                  onAnnotate ? onAnnotate(a) : void file(a, true)
                }
              >
                Bekijken{onAnnotate ? " / annoteren" : ""}
              </button>
            )}
            <button className="text-button" onClick={() => void file(a, false)}>
              Download
            </button>
          </div>
        ))}
      </div>
      {preview && (
        <div>
          <button className="secondary" onClick={() => setPreview("")}>
            Foto sluiten
          </button>
          <a href={preview} target="_blank" rel="noreferrer">
            <img
              src={preview}
              alt="Bijlage op volledige grootte openen"
              style={{ width: "100%", marginTop: 10 }}
            />
          </a>
        </div>
      )}
      <hr />
      <F label="Foto’s of PDF-documenten (meerdere mogelijk)">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => {
            setUploads((previous) => [
              ...previous,
              ...Array.from(e.target.files || []).map((file) => ({
                id: crypto.randomUUID(),
                file,
                status: "pending",
              })),
            ]);
            e.target.value = "";
          }}
        />
      </F>
      <F label="Moment">
        <select
          value={phase}
          disabled={uploads.some(
            (x) =>
              x.status === "uploading" ||
              x.status === "failed" ||
              x.status === "done",
          )}
          onChange={(e) => setPhase(e.target.value)}
        >
          <option value="before">Voor</option>
          <option value="during">Tijdens</option>
          <option value="after">Na</option>
        </select>
      </F>
      {uploads.map((u) => (
        <div className="task-row" key={u.id}>
          <span className="task-text">
            <strong>{u.file.name}</strong>
            <small>
              {
                (
                  {
                    pending: "Wacht op upload",
                    uploading: "Bezig met uploaden",
                    done: "Opgeslagen",
                    failed: "Mislukt",
                  } as Row
                )[u.status]
              }
              {u.error ? " · " + u.error : ""}
            </small>
          </span>
          {u.status === "failed" && (
            <button
              className="secondary"
              disabled={uploading}
              onClick={() => void send(u.id)}
            >
              Opnieuw proberen
            </button>
          )}
        </div>
      ))}
      {uploads.length > 0 && (
        <>
          <p className="muted">
            Houd dit venster open totdat alle bestanden opgeslagen zijn. Elke
            retry gebruikt dezelfde operatie-ID; succesvolle bestanden worden
            niet opnieuw geüpload.
          </p>
          <button
            className="primary"
            disabled={uploading || uploads.every((u) => u.status === "done")}
            onClick={() => void send()}
          >
            Wachtende bestanden uploaden
          </button>
        </>
      )}
    </>
  );
}
