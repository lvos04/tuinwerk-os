"use client";
import { useEffect, useState } from "react";
import type { SettingsApi, SettingsRow } from "./system-settings";
type Row = SettingsRow;
const when = (value: any) =>
  value ? new Date(value).toLocaleString("nl-NL") : "Nog niet";
export function BackupCheckPanel({
  api,
  local,
  remote,
  onRecorded,
  disabled,
}: {
  api: SettingsApi;
  local: Row[];
  remote: Row[];
  onRecorded: () => Promise<void>;
  disabled: boolean;
}) {
  const [checks, setChecks] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [source, setSource] = useState("local"),
    [archiveId, setArchiveId] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [taskReference, setTaskReference] = useState(""),
    [fileReference, setFileReference] = useState(""),
    [taskChecked, setTaskChecked] = useState(false),
    [fileChecked, setFileChecked] = useState(false),
    [notes, setNotes] = useState("");
  const load = async () =>
    setChecks(await api("/admin/backups/restore-checks"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  const pending = checks.some(
    (row) => !["completed", "failed"].includes(row.technicalState),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [pending]);
  const current = checks.find((row) => row.id === selected);
  const run = async (fn: () => Promise<void>) => {
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
  return (
    <section
      id="backup-checks"
      className="panel padded"
      style={{ marginTop: 24 }}
    >
      <h3>Periodieke herstelcontrole</h3>
      <p>
        1. Ontsleutel een gekozen archief en controleer de inhoud en checksums.
        Deze stap vervangt niets op deze server.
      </p>
      <p>
        2. Controleer in een <strong>aparte herstelde testinstallatie</strong>{" "}
        een bekende taak en een foto of document. Noteer hieronder wat je daar
        hebt teruggevonden. De archiefcontrole alleen bewijst nog geen geslaagd
        gegevensherstel.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const result = await api("/admin/backups/restore-checks", {
              method: "POST",
              body: JSON.stringify({
                archiveId,
                source,
                recoverySecret: secret,
              }),
            });
            setSelected(result.id);
            setSecret("");
            setTaskChecked(false);
            setFileChecked(false);
            setTaskReference("");
            setFileReference("");
            setNotes("");
            await load();
          });
        }}
      >
        <div className="form-grid">
          <label className="field">
            <span>Archiefbron</span>
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setArchiveId("");
              }}
            >
              <option value="local">Op deze server</option>
              <option value="onedrive">OneDrive</option>
            </select>
          </label>
          <label className="field">
            <span>Te controleren archief</span>
            <select
              required
              value={archiveId}
              onChange={(e) => setArchiveId(e.target.value)}
            >
              <option value="">Kies een back-up</option>
              {(source === "local" ? local : remote).map((row) => (
                <option value={row.id} key={row.id}>
                  {when((row.manifest || row).createdAt)} · {row.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Extern bewaarde herstelsleutel</span>
          <input
            type="password"
            autoComplete="off"
            required
            minLength={20}
            maxLength={512}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <button className="secondary" disabled={busy || disabled || !archiveId}>
          Stap 1 — veilige archiefcontrole starten
        </button>
      </form>
      {current && (
        <div className="restore-preview" style={{ marginTop: 16 }}>
          <h4>Geselecteerde controle</h4>
          <p>
            {current.technicalState === "completed"
              ? "Ontsleuteling, archiefstructuur en checksums gecontroleerd."
              : current.technicalState === "failed"
                ? "Archiefcontrole mislukt."
                : "Archiefcontrole loopt…"}
          </p>
          {current.error && <p className="alert error">{current.error}</p>}
          {current.result?.manifest && (
            <p>
              Archiefdatum: {when(current.result.manifest.createdAt)} · Inhoud:
              database, bestanden, exports en configuratie.
            </p>
          )}
          {current.recordedAt ? (
            <p className="alert success">
              Menselijke taak- en bestandscontroles vastgelegd op{" "}
              {when(current.recordedAt)}. Deze registratie is geen automatisch
              bewijs van een productieherstel.
            </p>
          ) : (
            current.technicalState === "completed" &&
            current.canRecord !== false && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api(
                      "/admin/backups/restore-checks/" + current.id + "/record",
                      {
                        method: "POST",
                        body: JSON.stringify({
                          version: current.version,
                          taskChecked,
                          fileChecked,
                          taskReference,
                          fileReference,
                          notes,
                        }),
                      },
                    );
                    await load();
                    await onRecorded();
                  });
                }}
              >
                <h4>Stap 2 — controles uit je aparte hersteltest vastleggen</h4>
                <label className="field">
                  <span>Gecontroleerde taak (titel of referentie)</span>
                  <input
                    required
                    minLength={3}
                    maxLength={1000}
                    value={taskReference}
                    onChange={(e) => setTaskReference(e.target.value)}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    required
                    checked={taskChecked}
                    onChange={(e) => setTaskChecked(e.target.checked)}
                  />
                  Ik heb deze taak in de aparte herstelde testinstallatie
                  geopend en de gegevens gecontroleerd.
                </label>
                <label className="field">
                  <span>Gecontroleerd bestand (foto-/documentnaam)</span>
                  <input
                    required
                    minLength={3}
                    maxLength={1000}
                    value={fileReference}
                    onChange={(e) => setFileReference(e.target.value)}
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    required
                    checked={fileChecked}
                    onChange={(e) => setFileChecked(e.target.checked)}
                  />
                  Ik heb dit bestand in de aparte herstelde testinstallatie
                  geopend en de inhoud bekeken.
                </label>
                <label className="field">
                  <span>Notitie, bijvoorbeeld testserver en bevindingen</span>
                  <textarea
                    maxLength={4000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !taskChecked || !fileChecked}
                >
                  Daadwerkelijke controles vastleggen
                </button>
              </form>
            )
          )}
        </div>
      )}
      <h4>Controlehistorie</h4>
      <button className="text-button" onClick={() => void run(load)}>
        Historie vernieuwen
      </button>
      {!checks.length && (
        <p className="muted">Nog geen periodieke controle gestart.</p>
      )}
      {checks.slice(0, 15).map((row) => (
        <div
          key={row.id}
          style={{ borderTop: "1px solid #dce4dc", padding: "12px 0" }}
        >
          <button
            className="text-button"
            onClick={() => {
              setSelected(row.id);
              setTaskChecked(false);
              setFileChecked(false);
              setTaskReference("");
              setFileReference("");
              setNotes("");
            }}
          >
            {when(row.createdAt)} ·{" "}
            {row.source === "onedrive" ? "OneDrive" : "Lokaal"} ·{" "}
            {row.recordedAt
              ? "Controles vastgelegd"
              : row.technicalState === "completed"
                ? "Alleen archief technisch gecontroleerd"
                : row.technicalState === "failed"
                  ? "Mislukt"
                  : "In uitvoering"}
          </button>
          {row.recordedAt && (
            <p className="muted">
              Taak: {row.taskReference} · Bestand: {row.fileReference}
              {row.notes ? " · " + row.notes : ""}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
