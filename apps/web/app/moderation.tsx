"use client";
import { useEffect, useState } from "react";
import type { SettingsApi, SettingsRow as Row } from "./system-settings";
export function ReportContent({
  api,
  type,
  id,
}: {
  api: SettingsApi;
  type: string;
  id: string;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="text-button"
        onClick={() => setOpen(!open)}
      >
        Inhoud melden
      </button>
      {open && (
        <div className="panel padded">
          <label>
            Waarom meld je deze inhoud?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={10}
              maxLength={2000}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={busy || reason.trim().length < 10}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/moderation/reports", {
                  method: "POST",
                  body: JSON.stringify({
                    targetType: type,
                    targetId: id,
                    reason,
                  }),
                });
                setMessage(
                  "Melding ontvangen. Een beheerder kan deze beoordelen.",
                );
                setReason("");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Melding versturen
          </button>
          <p role="status">{message}</p>
        </div>
      )}
    </div>
  );
}
export function ModerationPanel({
  api,
  users,
}: {
  api: SettingsApi;
  users: Row[];
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [settings, setSettings] = useState<Row | null>(null),
    [phrases, setPhrases] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [r, s] = await Promise.all([
      api("/moderation/reports"),
      api("/moderation/settings"),
    ]);
    setRows(r);
    setSettings(s);
    setPhrases(s.prohibitedPhrases.join("\n"));
  };
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      setMessage("Opgeslagen.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel padded system-section">
      <h2>Inhoud en meldingen</h2>
      <p>
        Beoordeel meldingen binnen deze werkomgeving. Verborgen inhoud is niet
        meer toegankelijk voor medewerkers.{" "}
        <a href="/community" target="_blank" rel="noreferrer">
          Gedragsregels
        </a>
      </p>
      {message && (
        <p role="status" className="alert">
          {message}
        </p>
      )}
      <details>
        <summary>Geblokkeerde woorden en zinnen</summary>
        <label>
          Eén woord of zin per regel
          <textarea
            value={phrases}
            onChange={(e) => setPhrases(e.target.value)}
          />
        </label>
        <button
          disabled={busy || !settings}
          className="secondary"
          onClick={() =>
            void run(() =>
              api("/moderation/settings", {
                method: "PUT",
                body: JSON.stringify({
                  version: settings?.version,
                  prohibitedPhrases: phrases
                    .split("\n")
                    .map((v) => v.trim())
                    .filter(Boolean),
                }),
              }),
            )
          }
        >
          Inhoudsfilter opslaan
        </button>
      </details>
      {!rows.length && <p className="muted">Geen meldingen.</p>}
      {rows.map((r) => (
        <form
          className="panel padded"
          key={r.id}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(() =>
              api("/moderation/reports/" + r.id + "/resolve", {
                method: "POST",
                body: JSON.stringify({
                  version: r.version,
                  action: f.get("action"),
                  note: f.get("note"),
                }),
              }),
            );
          }}
        >
          <strong>
            {r.targetType} · {r.status}
          </strong>
          <p>
            <strong>Melding:</strong> {r.reason}
          </p>
          <p className="muted">
            Gemeld door {r.reporterName || "Verwijderd account"} · Auteur:{" "}
            {r.targetAuthorName || "Verwijderd account"}
          </p>
          {r.snapshot && (
            <blockquote>
              <strong>{r.snapshot.label}</strong>
              {r.snapshot.description && <p>{r.snapshot.description}</p>}
            </blockquote>
          )}
          {(r.targetType === "task" || r.snapshot?.taskId) && (
            <a
              href={"/?type=task&id=" + (r.snapshot?.taskId || r.targetId)}
              target="_blank"
              rel="noreferrer"
            >
              Taak bekijken (indien beschikbaar)
            </a>
          )}
          {r.targetType === "attachment" && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void run(async () => {
                  await api("/auth/me");
                  const result = await fetch(
                    "/api/attachments/" + r.targetId + "/file",
                    {
                      headers: {
                        Authorization:
                          "Bearer " + sessionStorage.getItem("tuinwerk-token"),
                      },
                    },
                  );
                  if (!result.ok)
                    throw Error(
                      "Bijlage niet beschikbaar of reeds in quarantaine.",
                    );
                  const url = URL.createObjectURL(await result.blob());
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = r.snapshot?.label || "bijlage";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Bijlage downloaden voor beoordeling
            </button>
          )}
          <label>
            Besluit
            <select name="action">
              <option value="dismiss">Melding afwijzen</option>
              <option value="hide">Inhoud verbergen</option>
              <option value="restore">Inhoud herstellen</option>
            </select>
          </label>
          <label>
            Motivering
            <textarea name="note" required minLength={10} maxLength={2000} />
          </label>
          <button className="secondary" disabled={busy}>
            Besluit vastleggen
          </button>
        </form>
      ))}
      <details>
        <summary>Medewerker blokkeren</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              !confirm(
                "Deze medewerker blokkeren en actieve sessies beëindigen?",
              )
            )
              return;
            void run(() =>
              api("/moderation/users/" + f.get("userId") + "/block", {
                method: "POST",
                body: JSON.stringify({ reason: f.get("reason") }),
              }),
            );
          }}
        >
          <label>
            Medewerker
            <select name="userId" required>
              <option value="">Kies medewerker</option>
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Reden
            <textarea name="reason" minLength={10} maxLength={2000} required />
          </label>
          <button className="danger" disabled={busy}>
            Medewerker blokkeren
          </button>
        </form>
      </details>
    </section>
  );
}
