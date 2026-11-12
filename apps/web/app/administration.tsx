"use client";
import { ModerationPanel } from "./moderation";
import { useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Circle,
  Mail,
  Smartphone,
  Cloud,
  Settings,
  Users,
  HardDrive,
  Plug,
} from "lucide-react";
import {
  ApplicationSettings,
  OneDriveConnection,
  type SettingsApi,
  type SettingsRow as Row,
} from "./system-settings";
import { BackupPanel } from "./backup-panel";
import { AdvancedTools } from "./tools2";
const json = (body: Row): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
const tabs = [
  ["settings", "Instellingen", Settings],
  ["employees", "Medewerkers", Users],
  ["integrations", "Integraties", Plug],
  ["backups", "Back-ups", HardDrive],
] as const;

function IntegrationTests({
  api,
  revision,
}: {
  api: SettingsApi;
  revision: number;
}) {
  const [status, setStatus] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [result, setResult] = useState<Row | null>(null),
    [busy, setBusy] = useState(""),
    [deviceId, setDeviceId] = useState("");
  const load = async () => setStatus(await api("/admin/integrations/status"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [revision]);
  const test = async (kind: string) => {
    setBusy(kind);
    setError("");
    setResult(null);
    try {
      setResult(
        await api(
          "/admin/integrations/test/" + kind,
          json({
            confirm: true,
            ...(kind === "push" && deviceId ? { deviceId } : {}),
          }),
        ),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="panel padded system-section integration-tests">
      <h2>Koppelingen echt controleren</h2>
      <p className="muted">
        Voer een test uit nadat je de instellingen hebt opgeslagen. Een
        geslaagde configuratie alleen bewijst nog niet dat een bericht aankomt
        of dat OneDrive bereikbaar is.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div
          className={
            "alert " + (result.status === "passed" ? "success" : "error")
          }
          role="status"
        >
          {result.message}
        </div>
      )}
      <div className="integration-test-grid">
        <article>
          <Mail size={23} />
          <h3>E-mail</h3>
          <p>
            Een echte testmail wordt uitsluitend verstuurd naar jouw
            beheerdersadres:{" "}
            <strong>{status?.recipient || "adres wordt geladen"}</strong>.
          </p>
          <button
            className="secondary"
            disabled={!!busy || !status?.recipient}
            onClick={() => void test("smtp")}
          >
            {busy === "smtp"
              ? "Testmail versturen…"
              : "Testmail naar mij sturen"}
          </button>
        </article>
        <article>
          <Smartphone size={23} />
          <h3>Push op jouw toestel</h3>
          <p>
            Stuur een echte testmelding naar een door jouw account geregistreerd
            toestel.
          </p>
          <label className="field">
            <span>Mijn testtoestel</span>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">Kies een toestel</option>
              {(status?.devices || [])
                .filter((d: Row) => d.active)
                .map((d: Row, i: number) => (
                  <option key={d.id} value={d.id}>
                    {d.name || d.platform || "Toestel"} · {i + 1}
                  </option>
                ))}
            </select>
          </label>
          {!status?.devices?.some((d: Row) => d.active) && (
            <small className="muted">
              Registreer eerst push in de native app op dit account.
            </small>
          )}
          <button
            className="secondary"
            disabled={!!busy || !deviceId}
            onClick={() => void test("push")}
          >
            {busy === "push"
              ? "Testmelding versturen…"
              : "Testmelding naar mijn toestel"}
          </button>
        </article>
        <article>
          <Cloud size={23} />
          <h3>OneDrive</h3>
          <p>
            Deze test maakt een klein testbestand in de eigen TuinWerk-appmap,
            leest het terug en verwijdert het weer.
          </p>
          <button
            className="secondary"
            disabled={!!busy}
            onClick={() => void test("onedrive")}
          >
            {busy === "onedrive"
              ? "OneDrive testen…"
              : "OneDrive lezen en schrijven testen"}
          </button>
        </article>
      </div>
      {status?.checks?.length > 0 && (
        <div className="integration-checks">
          {status?.checks.map((c: Row) => (
            <div className="task-row" key={c.key}>
              <span className="task-text">
                <strong>{c.label}</strong>
                <small>{c.detail}</small>
              </span>
              <span
                className={
                  "badge " +
                  (c.status === "passed"
                    ? "completed"
                    : c.status === "failed"
                      ? "critical"
                      : "")
                }
              >
                {(
                  {
                    ready: "Ingesteld",
                    missing: "Nog instellen",
                    untested: "Nog testen",
                    passed: "Test geslaagd",
                    failed: "Test mislukt",
                  } as Row
                )[c.status] || c.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OnboardingChecklist({
  api,
  revision,
  users,
  locations,
  assets,
  onNavigate,
}: {
  api: SettingsApi;
  revision: number;
  users: Row[];
  locations: Row[];
  assets: Row[];
  onNavigate: (tab: string) => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState(true);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api("/settings"),
      api("/admin/backups/status"),
      api("/admin/onedrive/status"),
    ])
      .then(([settings, backups, onedrive]) => {
        if (!cancelled) setData({ settings, backups, onedrive });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const steps = [
    {
      label: "Bedrijfsnaam en bereikbaar adres",
      done:
        !!data?.settings?.values.companyName && !!data?.settings?.values.appUrl,
      tab: "settings",
      detail: "Controleer het adres voor medewerkers en QR-labels.",
    },
    {
      label: "Medewerkers toegang geven",
      done: users.filter((u) => u.active !== false).length > 1,
      tab: "employees",
      detail: "Maak accounts voor de mensen die met je samenwerken.",
    },
    {
      label: "Locaties en machines vastleggen",
      done:
        locations.some((l) => l.active !== false) &&
        assets.some((a) => a.status !== "archived"),
      tab: "catalog",
      detail: "Voeg je eerste locaties en machines toe via het hoofdmenu.",
    },
    {
      label: "Herstelsleutel buiten de NAS bewaren",
      done: !!data?.backups?.config?.backupPassphraseConfigured,
      tab: "backups",
      detail: "Download en bewaar de sleutel voordat je back-ups maakt.",
    },
    {
      label: "Eerste volledige back-up controleren",
      done: data?.backups?.lastBackup?.state === "completed",
      tab: "backups",
      detail: "Maak een back-up en voer de beschikbare herstelcontrole uit.",
    },
    {
      label: "Externe OneDrive-kopie instellen",
      done:
        !!data?.onedrive?.connected &&
        !!data?.backups?.config?.backupOneDriveEnabled,
      tab: "integrations",
      detail: "Verbind OneDrive en zet automatisch extern kopiëren aan.",
    },
  ];
  const finished = steps.filter((s) => s.done).length;
  return (
    <section className="panel onboarding-panel">
      <button
        className="onboarding-heading"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div>
          <h2>Je werkplek gebruiksklaar maken</h2>
          <p>
            {finished} van {steps.length} stappen klaar
          </p>
        </div>
        <progress
          value={finished}
          max={steps.length}
          aria-label="Voortgang inrichting"
        />
      </button>
      {error && <p className="alert error">{error}</p>}
      {expanded && (
        <div className="onboarding-steps">
          {steps.map((step) => (
            <button
              key={step.label}
              onClick={() => onNavigate(step.tab)}
              className={step.done ? "done" : ""}
            >
              {step.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              <span className="badge">{step.done ? "Gereed" : "Openen"}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function Administration({
  api,
  token,
  user,
  users,
  items,
  assets,
  locations,
  tasks,
  sessions,
  adminStatus,
  reload,
  onSecurity,
  onCreateUser,
  onImport,
  onCatalog,
  children,
}: {
  api: SettingsApi;
  token: string;
  user: Row;
  users: Row[];
  items: Row[];
  assets: Row[];
  locations: Row[];
  tasks: Row[];
  sessions: Row[];
  adminStatus: Row | null;
  reload: () => Promise<void>;
  onSecurity: () => void;
  onCreateUser: () => void;
  onImport: () => void;
  onCatalog: () => void;
  children?: ReactNode;
}) {
  const [tab, setTab] = useState("settings"),
    [revision, setRevision] = useState(0);
  const changed = () => setRevision((v) => v + 1);
  return (
    <div className="administration">
      <OnboardingChecklist
        api={api}
        revision={revision}
        users={users}
        assets={assets}
        locations={locations}
        onNavigate={(destination) =>
          destination === "catalog" ? onCatalog() : setTab(destination)
        }
      />
      <nav
        className="admin-navigation"
        aria-label="Beheeronderdelen"
        role="tablist"
      >
        {tabs.map(([id, name, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              changed();
            }}
          >
            <Icon size={19} />
            {name}
          </button>
        ))}
      </nav>
      <div role="tabpanel" aria-label={tabs.find((t) => t[0] === tab)?.[1]}>
        {tab === "settings" && (
          <>
            <ApplicationSettings
              key="general"
              api={api}
              onSecurity={onSecurity}
              onChanged={changed}
              sectionIds={["general", "maintenance"]}
            />
            <section className="panel padded system-section">
              <h2>Beveiliging en gegevens</h2>
              <p className="muted">
                Beheer tweede factor, ingelogde apparaten, imports en volledige
                gegevensexports.
              </p>
              <div className="toolbar">
                <button className="secondary" onClick={onSecurity}>
                  Beveiliging en gegevensbeheer openen
                </button>
                <button className="secondary" onClick={onImport}>
                  Gegevens importeren
                </button>
              </div>
              {children}
              <ModerationPanel api={api} users={users} />
            </section>
          </>
        )}
        {tab === "employees" && (
          <>
            <section className="panel padded system-section">
              <div className="panel-title">
                <div>
                  <h2>Je team</h2>
                  <p className="muted">
                    Iedere medewerker kan taken aanmaken, toewijzen en
                    uitvoeren. Beheerders beheren daarnaast de instellingen.
                  </p>
                </div>
                <button className="primary" onClick={onCreateUser}>
                  Medewerker toevoegen
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Naam</th>
                      <th>E-mailadres</th>
                      <th>Rol</th>
                      <th>Toegang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.email}</td>
                        <td>
                          {u.role === "admin" ? "Beheerder" : "Medewerker"}
                        </td>
                        <td>
                          <span className="badge">
                            {u.active === false ? "Inactief" : "Actief"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel padded system-section">
              <h2>Account aanpassen</h2>
              <AdvancedTools
                onlyTab="users"
                page="settings"
                api={api}
                token={token}
                user={user}
                tasks={tasks}
                items={items}
                assets={assets}
                locations={locations}
                users={users}
                reload={async () => {
                  await reload();
                  changed();
                }}
              />
            </section>
          </>
        )}
        {tab === "integrations" && (
          <>
            <ApplicationSettings
              key="integrations"
              api={api}
              onSecurity={onSecurity}
              onChanged={changed}
              sectionIds={["mail", "ai", "push"]}
              title="Koppelingen instellen"
            />
            <OneDriveConnection api={api} onChanged={changed} />
            <IntegrationTests api={api} revision={revision} />
          </>
        )}
        {tab === "backups" && (
          <BackupPanel
            api={api}
            token={token}
            connectionRevision={revision}
            onOpenIntegrations={() => setTab("integrations")}
          />
        )}
      </div>
    </div>
  );
}
