"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  Sprout,
} from "lucide-react";

export type SettingsRow = Record<string, any>;
export type SettingsApi = (path: string, options?: RequestInit) => Promise<any>;
export function SettingField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {help && <small className="muted">{help}</small>}
    </label>
  );
}
export const requestJson = (
  method: string,
  body: SettingsRow,
): RequestInit => ({ method, body: JSON.stringify(body) });

export function SetupGate({ children }: { children: ReactNode }) {
  const [required, setRequired] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [step, setStep] = useState(1),
    [form, setForm] = useState({
      companyName: "",
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      setupCode: "",
    });
  async function status() {
    setError("");
    try {
      const r = await fetch("/api/setup");
      const b = await r.json();
      if (!r.ok) throw Error(b.message || "De server is nog niet bereikbaar.");
      setRequired(b.required);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void status();
  }, []);
  if (required === false) return <>{children}</>;
  if (required === null)
    return (
      <main className="setup-screen">
        <section className="panel setup-card">
          <div className="brand">
            <Sprout />
            TuinWerk OS
          </div>
          <h1>Je werkomgeving openen</h1>
          {error ? (
            <>
              <div className="alert error" role="alert">
                {error}
              </div>
              <button className="primary" onClick={() => void status()}>
                Opnieuw verbinden
              </button>
            </>
          ) : (
            <p role="status">We controleren of TuinWerk al is ingericht…</p>
          )}
        </section>
      </main>
    );
  const update = (key: keyof typeof form, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("De wachtwoorden zijn niet gelijk.");
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/setup", {
        ...requestJson("POST", {
          companyName: form.companyName,
          appUrl: window.location.origin,
          name: form.name,
          email: form.email,
          password: form.password,
          setupCode: form.setupCode,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.message || "Inrichten is niet gelukt.");
      sessionStorage.setItem("tuinwerk-setup-email", form.email);
      setForm((previous) => ({
        ...previous,
        password: "",
        confirmPassword: "",
      }));
      setRequired(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="setup-screen">
      <section className="panel setup-card">
        <div className="brand">
          <Sprout />
          TuinWerk <b>OS</b>
        </div>
        <span className="eyebrow">EERSTE KEER · STAP {step} VAN 2</span>
        <h1>Welkom op je eigen werkplek</h1>
        <p className="muted">
          Maak je eerste beheerdersaccount aan. Daarna stel je meldingen,
          back-ups en koppelingen in via Beheer.
        </p>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={submit}>
          {step === 1 ? (
            <>
              <SettingField
                label="Eenmalige installatiecode"
                help="Open TrueNAS → Apps → TuinWerk → Logs en kopieer de installatiecode. Dit voorkomt dat iemand anders jouw nieuwe werkplek als eerste kan claimen."
              >
                <input
                  value={form.setupCode}
                  onChange={(e) => update("setupCode", e.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingField>
              <SettingField label="Bedrijfsnaam">
                <input
                  value={form.companyName}
                  onChange={(e) => update("companyName", e.target.value)}
                  required
                  maxLength={120}
                  autoComplete="organization"
                />
              </SettingField>
              <SettingField label="Je naam">
                <input
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </SettingField>
              <SettingField label="E-mailadres beheerder">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  required
                  autoComplete="username"
                />
              </SettingField>
              <div className="form-grid">
                <SettingField
                  label="Wachtwoord"
                  help="Gebruik minimaal 12 tekens."
                >
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                  />
                </SettingField>
                <SettingField label="Herhaal wachtwoord">
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) => update("confirmPassword", e.target.value)}
                    minLength={12}
                    maxLength={256}
                    required
                    autoComplete="new-password"
                  />
                </SettingField>
              </div>
              <button className="primary">
                Controleren <ChevronRight size={17} />
              </button>
            </>
          ) : (
            <>
              <div className="setup-summary">
                <ShieldCheck size={30} />
                <div>
                  <h3>{form.companyName}</h3>
                  <p>
                    {form.name}
                    <br />
                    {form.email}
                  </p>
                  <span className="badge">Eerste beheerder</span>
                </div>
              </div>
              <p>
                Je gegevens blijven op je eigen server. Externe AI, e-mail, push
                en OneDrive worden pas gebruikt nadat je ze zelf instelt.
              </p>
              <div className="toolbar">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setStep(1)}
                >
                  Terug
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Werkplek aanmaken…" : "Werkplek aanmaken"}
                  <Check size={17} />
                </button>
              </div>
            </>
          )}
        </form>
      </section>
    </main>
  );
}

export function OneDriveConnection({
  api,
  onChanged,
}: {
  api: SettingsApi;
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState<SettingsRow | null>(null),
    [flow, setFlow] = useState<SettingsRow | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => setStatus(await api("/admin/onedrive/status"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
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
  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api(
          "/admin/onedrive/connect/" + flow.id + "/poll",
          requestJson("POST", {}),
        );
        if (cancelled) return;
        if (result.status === "connected") {
          setFlow(null);
          await load();
          setNotice(
            "OneDrive is verbonden. Je kunt nu een versleutelde back-up naar OneDrive kopiëren.",
          );
          onChanged?.();
          return;
        }
        if (["denied", "expired", "cancelled"].includes(result.status)) {
          setFlow(null);
          setError(
            result.status !== "expired"
              ? "De Microsoft-aanmelding is geannuleerd. Je kunt opnieuw verbinden."
              : "De aanmeldcode is verlopen. Start opnieuw om een nieuwe code te krijgen.",
          );
          return;
        }
        timer = setTimeout(
          poll,
          Math.max(5, Number(result.interval || flow.interval) || 5) * 1000,
        );
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          timer = setTimeout(poll, 15000);
        }
      }
    };
    timer = setTimeout(poll, Math.max(5, Number(flow.interval) || 5) * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow?.id]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void work(async () => {
      await api(
        "/admin/onedrive/config",
        requestJson("PUT", {
          clientId: f.get("clientId"),
          tenant: f.get("tenant"),
          folder: f.get("folder"),
        }),
      );
      await load();
      setNotice("OneDrive-instellingen opgeslagen.");
      onChanged?.();
    });
  };
  return (
    <section className="panel padded system-section">
      <h2>OneDrive als externe back-up</h2>
      <p className="muted">
        Bewaar een versleutelde kopie in de eigen TuinWerk-appmap in OneDrive,
        buiten deze server. Je meldt je rechtstreeks bij Microsoft aan; TuinWerk
        toont of bewaart je Microsoft-wachtwoord niet.
      </p>
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
      <div className="connection-state">
        <span className={status?.connected ? "badge completed" : "badge"}>
          {status?.connected ? "Verbonden" : "Niet verbonden"}
        </span>
        {status?.account && (
          <span>
            {typeof status.account === "string"
              ? status.account
              : status.account?.displayName ||
                status.account?.email ||
                "Microsoft-account"}
          </span>
        )}
      </div>
      <details className="setup-help">
        <summary>Eenmalig: je eigen Microsoft-appregistratie maken</summary>
        <ol>
          <li>
            Open{" "}
            <a
              href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
              target="_blank"
              rel="noreferrer"
            >
              Microsoft Entra → App-registraties <ExternalLink size={13} />
            </a>{" "}
            en maak een nieuwe registratie voor TuinWerk Back-ups.
          </li>
          <li>
            Kies als ondersteunde accounts zowel organisatieaccounts als
            persoonlijke Microsoft-accounts wanneer je eigen OneDrive wilt
            gebruiken.
          </li>
          <li>
            Open bij de registratie <strong>Verificatie</strong> en schakel{" "}
            <strong>Openbare clientstromen toestaan</strong> in. Voor de
            apparaatcode-aanmelding is geen clientgeheim nodig.
          </li>
          <li>
            Kopieer de <strong>Toepassings-id (client-id)</strong> naar het veld
            hieronder. Dit is een identificatie, geen wachtwoord.
          </li>
          <li>
            Sla op, klik op Verbinden en geef in Microsoft toestemming voor
            toegang tot alleen de eigen appmap van TuinWerk in OneDrive. Een
            organisatiebeheerder kan deze toestemming moeten goedkeuren.
          </li>
        </ol>
        <p className="muted">
          Deze eenmalige registratie is nodig omdat TuinWerk op jouw eigen
          server draait. Je Microsoft-account moet toegang hebben tot OneDrive.
        </p>
      </details>
      <form onSubmit={submit} key={status?.clientId || "unconfigured"}>
        <SettingField
          label="Microsoft-toepassings-id"
          help="De client-id uit je eigen appregistratie, in de vorm van een UUID."
        >
          <input
            name="clientId"
            defaultValue={status?.clientId || ""}
            required
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
        </SettingField>
        <div className="form-grid">
          <SettingField label="Soort Microsoft-account">
            <select name="tenant" defaultValue={status?.tenant || "common"}>
              <option value="common">Persoonlijk of werk/school</option>
              <option value="consumers">Alleen persoonlijk</option>
              <option value="organizations">Alleen werk/school</option>
            </select>
          </SettingField>
          <SettingField label="Back-upmap binnen de TuinWerk-appmap">
            <input
              name="folder"
              defaultValue={status?.folder || "TuinWerk Backups"}
              required
            />
          </SettingField>
        </div>
        <button className="secondary" disabled={busy || !!flow}>
          Instellingen opslaan
        </button>
      </form>
      <div className="toolbar" style={{ marginTop: 20 }}>
        <button
          className="primary"
          disabled={busy || !!flow || !status?.configured}
          onClick={() =>
            void work(async () =>
              setFlow(
                await api("/admin/onedrive/connect", requestJson("POST", {})),
              ),
            )
          }
        >
          {status?.connected ? "Opnieuw verbinden" : "Verbinden met Microsoft"}
        </button>
        {status?.connected && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void work(async () => {
                if (
                  !window.confirm(
                    "OneDrive loskoppelen? Bestaande externe back-ups blijven in OneDrive staan.",
                  )
                )
                  return;
                await api("/admin/onedrive/connection", { method: "DELETE" });
                await load();
                setNotice("OneDrive is losgekoppeld.");
                onChanged?.();
              })
            }
          >
            Verbinding verbreken
          </button>
        )}
      </div>
      {flow && (
        <div className="device-code">
          <h3>Rond de aanmelding af bij Microsoft</h3>
          <p>
            Open de Microsoft-pagina, voer deze code in en meld je aan met het
            account voor je back-ups.
          </p>
          <strong aria-label="Microsoft-aanmeldcode">{flow.userCode}</strong>
          <a
            className="primary"
            href={flow.verificationUri}
            target="_blank"
            rel="noreferrer"
          >
            Microsoft-aanmelding openen <ExternalLink size={16} />
          </a>
          <p role="status">
            Wachten op je toestemming bij Microsoft… Deze code verloopt op{" "}
            {new Date(flow.expiresAt).toLocaleTimeString("nl-NL")}.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setFlow(null);
              setNotice("Aanmelding gestopt. Je kunt later opnieuw verbinden.");
            }}
          >
            Aanmelding stoppen
          </button>
        </div>
      )}
    </section>
  );
}

type FieldDefinition = {
  key: string;
  label: string;
  kind?: "checkbox" | "number" | "url" | "password" | "email" | "textarea";
  help?: string;
  min?: number;
  max?: number;
  step?: number | string;
  placeholder?: string;
  secret?: boolean;
};
const sections: {
  id: string;
  title: string;
  description: string;
  fields: FieldDefinition[];
}[] = [
  {
    id: "general",
    title: "Algemeen",
    description: "De naam en bereikbaarheid van je eigen werkomgeving.",
    fields: [
      { key: "companyName", label: "Bedrijfsnaam" },
      {
        key: "supportEmail",
        label: "E-mailadres voor ondersteuning",
        kind: "email",
        help: "Gebruik een echt bereikbaar adres van je organisatie; dit wordt op de publieke hulppagina getoond.",
      },
      {
        key: "privacyContactEmail",
        label: "E-mailadres voor privacyvragen",
        kind: "email",
        help: "Dit contactadres verschijnt in het privacybeleid.",
      },
      {
        key: "privacyRetentionDescription",
        label: "Bewaartermijnen en verwijderbeleid",
        kind: "textarea",
        help: "Beschrijf de daadwerkelijke bewaartermijnen van je organisatie. Deze tekst wordt openbaar in het privacybeleid gepubliceerd.",
      },
      {
        key: "appUrl",
        label: "Adres van TuinWerk",
        kind: "url",
        help: "Het adres dat je medewerkers openen, bijvoorbeeld https://tuinwerk.bedrijf.nl. QR-labels gebruiken dit adres.",
      },
      {
        key: "appTimezone",
        label: "Tijdzone",
        help: "Bijvoorbeeld Europe/Amsterdam. Wordt gebruikt voor dagelijkse planning en back-ups.",
      },
      {
        key: "corsOrigins",
        label: "Extra toegestane webadressen",
        kind: "textarea",
        help: "Meestal leeg laten. Alleen nodig als je webapp vanaf een ander adres draait. Eén volledig adres per regel, zonder afsluitende slash.",
      },
    ],
  },
  {
    id: "maintenance",
    title: "Onderhoud en bestanden",
    description:
      "Bepaal hoe ver onderhoudstaken vooruit worden aangemaakt en hoe groot uploads mogen zijn.",
    fields: [
      {
        key: "recurrenceLookaheadDays",
        label: "Onderhoudstaken vooruit aanmaken (dagen)",
        kind: "number",
        min: 0,
        max: 366,
        help: "De jaarplanning blijft ook voorspellingen buiten dit venster tonen.",
      },
      {
        key: "maxUploadBytes",
        label: "Maximale bestandsgrootte (MB)",
        kind: "number",
        min: 1,
        max: 50,
        help: "Geldt per foto of document; bestaande bestanden blijven bewaard.",
      },
    ],
  },
  {
    id: "mail",
    title: "E-mailmeldingen",
    description:
      "Gebruik de SMTP-gegevens van je eigen e-mailprovider. Medewerkers bepalen zelf welke berichten zij ontvangen.",
    fields: [
      {
        key: "smtpHost",
        label: "SMTP-server",
        placeholder: "smtp.provider.nl",
      },
      {
        key: "smtpPort",
        label: "SMTP-poort",
        kind: "number",
        min: 1,
        max: 65535,
      },
      {
        key: "smtpSecure",
        label: "Directe TLS-verbinding (meestal poort 465)",
        kind: "checkbox",
      },
      {
        key: "smtpRequireTls",
        label: "Versleuteling via STARTTLS verplichten (meestal poort 587)",
        kind: "checkbox",
      },
      { key: "smtpUser", label: "SMTP-gebruikersnaam" },
      {
        key: "smtpPassword",
        label: "SMTP-wachtwoord",
        kind: "password",
        secret: true,
      },
      {
        key: "smtpFrom",
        label: "Afzender",
        placeholder: "TuinWerk <onderhoud@bedrijf.nl>",
      },
    ],
  },
  {
    id: "ai",
    title: "Optionele AI-assistent",
    description:
      "Standaard uit. Een medewerker geeft per verzoek toestemming en controleert elk voorstel voordat er iets wordt opgeslagen.",
    fields: [
      { key: "aiEnabled", label: "AI-assistent inschakelen", kind: "checkbox" },
      {
        key: "aiBaseUrl",
        label: "API-adres van je AI-provider",
        kind: "url",
        placeholder: "https://api.openai.com/v1",
        help: "HTTPS-adres van een provider met een Chat Completions-interface.",
      },
      { key: "aiApiKey", label: "API-sleutel", kind: "password", secret: true },
      {
        key: "aiModel",
        label: "Modelnaam",
        placeholder: "Modelnaam bij je provider",
      },
      {
        key: "aiDailyTokenBudget",
        label: "Maximum tokens per dag",
        kind: "number",
        min: 1,
        max: 10000000,
      },
      {
        key: "aiDailyBudgetEur",
        label: "Dagbudget in euro",
        kind: "number",
        min: 0,
        max: 100000,
        step: "any",
      },
      {
        key: "aiInputEurPerMillion",
        label: "Invoerprijs per miljoen tokens (€)",
        kind: "number",
        min: 0,
        max: 10000,
        step: "any",
      },
      {
        key: "aiOutputEurPerMillion",
        label: "Uitvoerprijs per miljoen tokens (€)",
        kind: "number",
        min: 0,
        max: 10000,
        step: "any",
        help: "Vul de actuele providerprijzen in; zonder geldige prijzen en budget blijft verzending geblokkeerd.",
      },
    ],
  },
  {
    id: "push",
    title: "Pushmeldingen naar telefoons",
    description:
      "De mobiele app registreert ieder toestel na toestemming. Voor daadwerkelijke levering moeten de native builds met APNs/FCM zijn ingericht.",
    fields: [
      {
        key: "pushEnabled",
        label: "Pushbezorging via Expo inschakelen",
        kind: "checkbox",
      },
      {
        key: "expoAccessToken",
        label: "Expo-toegangstoken (indien beveiliging dit vereist)",
        kind: "password",
        secret: true,
      },
    ],
  },
];
export function ApplicationSettings({
  api,
  onSecurity,
  onChanged,
  sectionIds,
  title = "Instellingen van je werkomgeving",
}: {
  api: SettingsApi;
  onSecurity: () => void;
  onChanged?: () => void;
  sectionIds?: string[];
  title?: string;
}) {
  const [snapshot, setSnapshot] = useState<SettingsRow | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [section, setSection] = useState(sectionIds?.[0] || "general");
  const load = async () => setSnapshot(await api("/settings"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const current = sections.find((s) => s.id === section)!;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!snapshot) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const values: SettingsRow = {},
        secrets: SettingsRow = {},
        clearSecrets: string[] = [];
      for (const def of current.fields) {
        if (def.secret) {
          const input = String(f.get(def.key) || "");
          if (input) secrets[def.key] = input;
          else if (f.get("clear-" + def.key) === "on")
            clearSecrets.push(def.key);
          continue;
        }
        const raw = f.get(def.key);
        values[def.key] =
          def.kind === "checkbox"
            ? raw === "on"
            : def.key === "corsOrigins"
              ? String(raw || "")
                  .split(/\n|,/)
                  .map((x) => x.trim())
                  .filter(Boolean)
              : def.kind === "number"
                ? Number(raw) * (def.key === "maxUploadBytes" ? 1024 * 1024 : 1)
                : String(raw || "").trim();
      }
      const next = await api(
        "/settings",
        requestJson("PATCH", {
          version: snapshot.version,
          values,
          secrets,
          clearSecrets,
        }),
      );
      setSnapshot(next);
      onChanged?.();
      setNotice(
        "Instellingen opgeslagen. De diensten nemen de wijzigingen automatisch over.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel padded system-section">
      <h2>{title}</h2>
      <div className="tabs settings-tabs">
        {sections
          .filter((s) => !sectionIds || sectionIds.includes(s.id))
          .map((s) => (
            <button
              className={section === s.id ? "active" : ""}
              key={s.id}
              onClick={() => {
                setSection(s.id);
                setError("");
                setNotice("");
              }}
            >
              {s.title}
            </button>
          ))}
        <button onClick={onSecurity}>Beveiliging</button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() =>
              void load()
                .then(() => setError(""))
                .catch((e) => setError(e.message))
            }
          >
            Actuele instellingen laden
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {!snapshot ? (
        <p role="status">Instellingen laden…</p>
      ) : (
        <form key={section + snapshot.version} onSubmit={submit}>
          <h3>{current.title}</h3>
          <p className="muted">{current.description}</p>
          <div className="form-grid">
            {current.fields.map((def) => {
              const value = snapshot.values[def.key],
                configured = snapshot.configured[def.key];
              if (def.kind === "checkbox")
                return (
                  <label className="checkbox" key={def.key}>
                    <input
                      type="checkbox"
                      name={def.key}
                      defaultChecked={!!value}
                    />
                    {def.label}
                  </label>
                );
              return (
                <div key={def.key}>
                  <SettingField
                    label={def.label}
                    help={
                      def.help ||
                      (def.secret
                        ? "Leeg laten behoudt het opgeslagen geheim. Het huidige geheim wordt nooit teruggestuurd naar je browser."
                        : undefined)
                    }
                  >
                    {def.kind === "textarea" ? (
                      <textarea
                        name={def.key}
                        rows={3}
                        defaultValue={
                          Array.isArray(value) ? value.join("\n") : value || ""
                        }
                      />
                    ) : (
                      <input
                        name={def.key}
                        type={def.kind || "text"}
                        defaultValue={
                          def.secret
                            ? ""
                            : def.key === "maxUploadBytes"
                              ? Number(value) / 1024 / 1024
                              : def.key === "appUrl"
                                ? value || window.location.origin
                                : (value ?? "")
                        }
                        placeholder={
                          def.secret
                            ? configured
                              ? "Ingesteld — leeg laten om te behouden"
                              : "Nog niet ingesteld"
                            : def.placeholder
                        }
                        min={def.min}
                        max={def.max}
                        step={def.step || 1}
                        autoComplete={def.secret ? "new-password" : undefined}
                      />
                    )}
                  </SettingField>
                  {def.secret && configured && (
                    <label className="checkbox">
                      <input type="checkbox" name={"clear-" + def.key} />{" "}
                      Opgeslagen geheim expliciet verwijderen
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <button className="primary" disabled={busy}>
            {busy ? "Opslaan…" : "Instellingen opslaan"}
          </button>
        </form>
      )}
      <div className="security-note">
        <ShieldCheck size={19} />
        <p>
          Geheimen worden versleuteld opgeslagen. De server maakt zijn eigen
          beveiligingssleutel aan. Tweede factor, accounts en sessies beheer je
          onder Beveiliging; je hoeft hiervoor geen sleutel in een
          configuratiebestand te zetten.
        </p>
      </div>
    </section>
  );
}
