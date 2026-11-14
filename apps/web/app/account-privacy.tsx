"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { SettingsApi, SettingsRow as Row } from "./system-settings";
export function AccountPrivacy({
  api,
  onDeleted,
}: {
  api: SettingsApi;
  onDeleted: () => void;
}) {
  const [privacy, setPrivacy] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [expanded, setExpanded] = useState(false),
    [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    void api("/auth/privacy")
      .then(setPrivacy)
      .catch((e) => setError(e.message));
  }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (confirmation !== "VERWIJDER MIJN ACCOUNT") return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/account", {
        method: "DELETE",
        body: JSON.stringify({
          password: f.get("password"),
          otp: f.get("otp") || undefined,
          confirmation,
        }),
      });
      if (!result.deleted) throw Error("Het account is niet verwijderd.");
      sessionStorage.removeItem("tuinwerk-token");
      sessionStorage.removeItem("tuinwerk-refresh");
      sessionStorage.removeItem("tuinwerk-setup-email");
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="account-privacy">
      <h3>
        <ShieldCheck size={17} /> Privacy en je account
      </h3>
      <p className="muted">
        Lees welke gegevens worden gebruikt en hoe je ondersteuning krijgt.
      </p>
      <div className="toolbar">
        <a
          className="text-button"
          href="/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Privacybeleid <ExternalLink size={13} />
        </a>
        <a
          className="text-button"
          href="/support"
          target="_blank"
          rel="noreferrer"
        >
          Hulp en contact <ExternalLink size={13} />
        </a>
        <a
          className="text-button"
          href="/account-deletion"
          target="_blank"
          rel="noreferrer"
        >
          Uitleg accountverwijdering <ExternalLink size={13} />
        </a>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <button className="secondary" onClick={() => setExpanded(!expanded)}>
        {expanded ? "Verwijdering sluiten" : "Mijn account verwijderen"}
      </button>
      {expanded && (
        <form onSubmit={submit}>
          <p>
            Dit verwijdert je persoonlijke account en beëindigt je sessies.
            Gedeelde werkregistraties blijven voor de bedrijfsvoering bestaan
            met geanonimiseerde gebruikersverwijzingen. Je kunt deze actie niet
            ongedaan maken.
          </p>
          {privacy?.removed?.length > 0 && (
            <>
              <h4>Dit wordt verwijderd</h4>
              <ul>
                {privacy?.removed.map((text: string) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </>
          )}
          {privacy?.retained?.length > 0 && (
            <>
              <h4>Dit blijft behouden</h4>
              <ul>
                {privacy?.retained.map((text: string) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </>
          )}
          {privacy?.fileCleanup && (
            <p className="muted">{privacy.fileCleanup}</p>
          )}
          {privacy?.canDelete === false && (
            <div className="alert error">{privacy.lastAdministrator}</div>
          )}
          <label className="field">
            <span>Bevestig je huidige wachtwoord</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>Tweede factor of herstelcode (indien ingesteld)</span>
            <input
              name="otp"
              autoComplete="one-time-code"
              required={!!privacy?.mfaRequired}
            />
          </label>
          <label className="field">
            <span>Typ VERWIJDER MIJN ACCOUNT ter bevestiging</span>
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <button
            className="danger-button"
            disabled={
              busy ||
              !privacy?.canDelete ||
              confirmation !== "VERWIJDER MIJN ACCOUNT"
            }
          >
            {busy
              ? "Account verwijderen…"
              : "Mijn account definitief verwijderen"}
          </button>
        </form>
      )}
    </section>
  );
}
