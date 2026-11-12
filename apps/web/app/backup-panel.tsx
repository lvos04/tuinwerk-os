"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArchiveRestore,
  Check,
  Download,
  HardDrive,
  KeyRound,
  RefreshCw,
} from "lucide-react";
import type { SettingsApi, SettingsRow } from "./system-settings";

type Row = SettingsRow;
const j = (method: string, body: Row): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
const F = ({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) => (
  <label className="field">
    <span>{label}</span>
    {children}
    {help && <small className="muted">{help}</small>}
  </label>
);
const formatDate = (value: any) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString("nl-NL")
    : "Datum onbekend";
const size = (bytes: any) =>
  Number.isFinite(Number(bytes))
    ? (Number(bytes) / 1024 / 1024).toLocaleString("nl-NL", {
        maximumFractionDigits: 1,
      }) + " MB"
    : "Grootte onbekend";
const jobState = (job: Row) => job.status || job.state;
const terminal = (job: Row) =>
  ["completed", "failed", "cancelled"].includes(jobState(job));
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupPanel({
  api,
  token,
  connectionRevision = 0,
}: {
  api: SettingsApi;
  token: string;
  connectionRevision?: number;
}) {
  const [status, setStatus] = useState<Row | null>(null),
    [jobs, setJobs] = useState<Row[]>([]),
    [archives, setArchives] = useState<Row[]>([]),
    [uploaded, setUploaded] = useState<Row[]>([]),
    [transfers, setTransfers] = useState<Row[]>([]),
    [remote, setRemote] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [generated, setGenerated] = useState<Row | null>(null),
    [downloaded, setDownloaded] = useState(false),
    [saved, setSaved] = useState(false),
    [recovery, setRecovery] = useState(""),
    [source, setSource] = useState("local"),
    [archiveId, setArchiveId] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [restoreJob, setRestoreJob] = useState<Row | null>(null),
    [confirm, setConfirm] = useState("");
  const mounted = useRef(true);
  const load = async () => {
    const [s, js, as, ts] = await Promise.all([
      api("/admin/backups/status"),
      api("/admin/backups/jobs"),
      api("/admin/backups/archives"),
      api("/admin/onedrive/transfers"),
    ]);
    if (mounted.current) {
      setStatus(s);
      setJobs(js);
      setArchives(as);
      setTransfers(ts);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (connectionRevision) void load().catch((e) => setError(e.message));
    void api("/admin/onedrive/backups")
      .then((rows) => {
        if (mounted.current) setRemote(rows);
      })
      .catch(() => {
        if (mounted.current) setRemote([]);
      });
  }, [connectionRevision]);
  useEffect(() => {
    if (
      !jobs.some(
        (job) =>
          !terminal(job) || ["pending", "uploading"].includes(job.remoteState),
      ) &&
      !(preview && !terminal(preview)) &&
      !(restoreJob && !terminal(restoreJob))
    )
      return;
    let stopped = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          await load();
          if (preview && !terminal(preview)) {
            const p = await api("/admin/backups/jobs/" + preview.id);
            if (!stopped) setPreview(p);
          }
          if (restoreJob && !terminal(restoreJob)) {
            const r = await api("/admin/backups/jobs/" + restoreJob.id);
            if (!stopped) setRestoreJob(r);
          }
        } catch (e) {
          if (!stopped)
            setError(
              restoreJob
                ? "De server is tijdelijk niet bereikbaar tijdens herstel. Laat dit venster open; we proberen opnieuw."
                : (e as Error).message,
            );
        }
      })();
    }, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    jobs.map((x) => x.id + jobState(x) + x.remoteState).join("|"),
    preview?.id,
    preview && jobState(preview),
    restoreJob?.id,
    restoreJob && jobState(restoreJob),
  ]);
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
  const submit = (
    e: FormEvent<HTMLFormElement>,
    fn: (f: FormData) => Promise<void>,
  ) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void work(() => fn(f));
  };
  const config = status?.config || {};
  const localArchives = [
    ...archives.filter((a) => a.localAvailable !== false),
    ...uploaded.filter(
      (a) => !archives.some((existing) => existing.id === a.id),
    ),
  ];
  const manifest = preview?.result?.manifest;
  const downloadArchive = async (id: string) => {
    await api("/auth/me");
    const r = await fetch("/api/admin/backups/archives/" + id + "/download", {
      headers: {
        Authorization:
          "Bearer " + (sessionStorage.getItem("tuinwerk-token") || token),
      },
    });
    if (!r.ok) throw Error("Back-upbestand kon niet worden gedownload.");
    downloadBlob(await r.blob(), id + ".twb");
  };
  return (
    <section className="panel padded system-section">
      <div className="panel-title">
        <div>
          <h2>Volledige back-up en herstel</h2>
          <p className="muted">
            Een versleuteld archief met database, foto’s, documenten, exports en
            benodigde configuratie. Herstel eerst controleren, daarna bewust
            uitvoeren.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Back-upstatus vernieuwen"
          onClick={() => void work(load)}
        >
          <RefreshCw size={18} />
        </button>
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
      {!status ? (
        <p role="status">Back-upstatus laden…</p>
      ) : (
        <>
          <div className="backup-status-grid">
            <div>
              <HardDrive size={21} />
              <small>Back-updienst</small>
              <strong>
                {status.helper?.available
                  ? "Beschikbaar"
                  : "Nog niet beschikbaar"}
              </strong>
            </div>
            <div>
              <KeyRound size={21} />
              <small>Versleuteling</small>
              <strong>
                {config.backupPassphraseConfigured
                  ? "Ingesteld"
                  : "Herstelsleutel bewaren"}
              </strong>
            </div>
            <div>
              <ArchiveRestore size={21} />
              <small>Laatste back-up</small>
              <strong>
                {status.lastBackup
                  ? formatDate(
                      status.lastBackup.completedAt ||
                        status.lastBackup.createdAt ||
                        status.lastBackup.manifest?.createdAt,
                    )
                  : "Nog geen back-up"}
              </strong>
            </div>
          </div>
          {!status.helper?.available && (
            <p className="alert">
              De back-updienst is nog niet gereed. Controleer in TrueNAS of de
              volledige TuinWerk-app draait. De app toont voortgang zodra de
              dienst beschikbaar is.
            </p>
          )}
          <details
            className="backup-key"
            open={!config.backupPassphraseConfigured || !!generated}
          >
            <summary>
              <strong>Herstelsleutel veilig bewaren</strong>
            </summary>
            <p className="muted">
              Bewaar de herstelsleutel buiten deze NAS, bijvoorbeeld in je
              wachtwoordmanager. Zonder deze sleutel kun je een versleuteld
              archief op een nieuwe server niet openen. Een nieuwe sleutel
              verandert oude archieven niet: bewaar oudere sleutels zolang die
              back-ups bestaan.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  if (
                    config.backupPassphraseConfigured &&
                    !window.confirm(
                      "Een nieuwe herstelsleutel maken? Bewaar je oude sleutel voor bestaande archieven.",
                    )
                  )
                    return;
                  setGenerated(
                    await api("/admin/backups/recovery-key", j("POST", {})),
                  );
                  setDownloaded(false);
                  setSaved(false);
                })
              }
            >
              {config.backupPassphraseConfigured
                ? "Nieuwe herstelsleutel maken"
                : "Herstelsleutel maken"}
            </button>
            {generated && (
              <div className="recovery-card">
                <p>
                  Deze sleutel is nog niet actief. Download het herstelbestand
                  en bevestig dat je het veilig hebt opgeslagen.
                </p>
                <button
                  className="primary"
                  onClick={() => {
                    downloadBlob(
                      new Blob([generated.recoveryText], {
                        type: "text/plain;charset=utf-8",
                      }),
                      generated.filename || "tuinwerk-herstelsleutel.txt",
                    );
                    setDownloaded(true);
                  }}
                >
                  <Download size={16} /> Herstelbestand downloaden
                </button>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={saved}
                    disabled={!downloaded}
                    onChange={(e) => setSaved(e.target.checked)}
                  />{" "}
                  Ik heb het herstelbestand buiten deze server opgeslagen.
                </label>
                <button
                  className="secondary"
                  disabled={busy || !saved || !downloaded}
                  onClick={() =>
                    void work(async () => {
                      await api(
                        "/admin/backups/config",
                        j("PUT", {
                          version: config.version,
                          backupPassphrase: generated.passphrase,
                          recoveryConfirmed: true,
                        }),
                      );
                      setGenerated(null);
                      setSaved(false);
                      setDownloaded(false);
                      await load();
                      setNotice(
                        "Versleuteling ingesteld. Je kunt nu een volledige back-up maken.",
                      );
                    })
                  }
                >
                  <Check size={16} /> Deze sleutel activeren
                </button>
              </div>
            )}
          </details>
          <form
            key={JSON.stringify(config)}
            onSubmit={(e) =>
              submit(e, async (f) => {
                await api(
                  "/admin/backups/config",
                  j("PUT", {
                    version: config.version,
                    backupEnabled: f.get("backupEnabled") === "on",
                    backupHour: Number(f.get("backupHour")),
                    appTimezone: f.get("appTimezone"),
                    backupRetentionDays: Number(f.get("backupRetentionDays")),
                    backupOneDriveEnabled:
                      f.get("backupOneDriveEnabled") === "on",
                  }),
                );
                await load();
                setNotice("Back-upplanning opgeslagen.");
              })
            }
          >
            <h3>Automatische back-ups</h3>
            <label className="checkbox">
              <input
                name="backupEnabled"
                type="checkbox"
                defaultChecked={config.backupEnabled}
              />{" "}
              Dagelijks een volledige back-up maken
            </label>
            <div className="form-grid">
              <F label="Uur van de dagelijkse back-up">
                <select name="backupHour" defaultValue={config.backupHour ?? 2}>
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </F>
              <F label="Tijdzone">
                <input
                  name="appTimezone"
                  defaultValue={config.appTimezone || "Europe/Amsterdam"}
                  required
                />
              </F>
              <F label="Lokale bewaartermijn (dagen)">
                <input
                  name="backupRetentionDays"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={config.backupRetentionDays ?? 30}
                  required
                />
              </F>
            </div>
            <label className="checkbox">
              <input
                name="backupOneDriveEnabled"
                type="checkbox"
                defaultChecked={config.backupOneDriveEnabled}
              />{" "}
              Na iedere back-up ook een versleutelde kopie in OneDrive bewaren
            </label>
            <button
              className="secondary"
              disabled={busy || !config.backupPassphraseConfigured}
            >
              Planning opslaan
            </button>
          </form>
          <hr />
          <button
            className="primary"
            disabled={
              busy ||
              !status.helper?.available ||
              !config.backupPassphraseConfigured ||
              !!status.activeJob
            }
            onClick={() =>
              void work(async () => {
                await api(
                  "/admin/backups",
                  j("POST", {
                    uploadToOneDrive: !!config.backupOneDriveEnabled,
                  }),
                );
                await load();
                setNotice(
                  "Volledige back-up gestart. Je kunt de voortgang hieronder volgen.",
                );
              })
            }
          >
            Nu volledige back-up maken
          </button>
          <h3 style={{ marginTop: 28 }}>Voortgang en geschiedenis</h3>
          {!jobs.length && (
            <p className="muted">
              Er zijn nog geen back-up- of herstelopdrachten.
            </p>
          )}
          {jobs.slice(0, 20).map((job) => (
            <div className="task-row" key={job.id}>
              <span className="task-text">
                <strong>
                  {(
                    {
                      backup: "Volledige back-up",
                      restore: "Herstel",
                      restore_preview: "Herstelcontrole",
                      "restore-preview": "Herstelcontrole",
                    } as Row
                  )[job.operation || job.type || job.kind] || "Back-upopdracht"}
                </strong>
                <small>
                  {formatDate(job.createdAt)} ·{" "}
                  {job.message || job.phase || job.error || ""}
                </small>
                {job.remoteState && (
                  <small>
                    OneDrive:{" "}
                    {(
                      {
                        pending: "Wacht op kopiëren",
                        uploading: "Wordt gekopieerd",
                        completed: "Kopie bevestigd",
                        failed: "Kopiëren mislukt",
                      } as Row
                    )[job.remoteState] || job.remoteState}
                  </small>
                )}
                {transfers
                  .filter(
                    (t) =>
                      t.backupId === job.archiveId && t.state === "running",
                  )
                  .slice(0, 1)
                  .map((t) => (
                    <span key={t.id}>
                      <small>
                        {t.direction === "download"
                          ? "Download uit OneDrive"
                          : "Upload naar OneDrive"}
                        : {size(t.bytesTransferred)} van {size(t.size)}
                      </small>
                      <progress
                        max={Number(t.size) || 1}
                        value={Number(t.bytesTransferred) || 0}
                        aria-label="OneDrive-overdracht"
                      />
                    </span>
                  ))}
                {typeof job.progress === "number" && (
                  <progress
                    max={100}
                    value={job.progress}
                    aria-label="Voortgang"
                  />
                )}
              </span>
              <span
                className={
                  "badge " +
                  (jobState(job) === "completed"
                    ? "completed"
                    : jobState(job) === "failed"
                      ? "critical"
                      : "")
                }
              >
                {(
                  {
                    preparing: "Voorbereiden",
                    queued: "Wacht op uitvoering",
                    running: "Bezig",
                    completed: "Voltooid",
                    failed: "Mislukt",
                    cancelled: "Geannuleerd",
                  } as Row
                )[jobState(job)] || jobState(job)}
              </span>
              {job.operation === "backup" &&
                jobState(job) === "completed" &&
                [undefined, null, "failed", "completed"].includes(
                  job.remoteState,
                ) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        await api(
                          "/admin/backups/jobs/" + job.id + "/retry-onedrive",
                          j("POST", {}),
                        );
                        await load();
                        setNotice("OneDrive-kopie in de wachtrij gezet.");
                      })
                    }
                  >
                    {job.remoteState === "failed"
                      ? "OneDrive opnieuw proberen"
                      : "Naar OneDrive kopiëren"}
                  </button>
                )}
            </div>
          ))}
          <h3 style={{ marginTop: 28 }}>Beschikbare lokale archieven</h3>
          {!localArchives.length && (
            <p className="muted">Nog geen lokaal archief beschikbaar.</p>
          )}
          {localArchives.map((archive) => {
            const m = archive.manifest || archive;
            return (
              <div className="task-row" key={archive.id}>
                <span className="task-text">
                  <strong>
                    {archive.uploaded
                      ? "Geüpload — nog te controleren"
                      : formatDate(m.createdAt)}
                  </strong>
                  <small>{size(m.size)} · Volledig versleuteld archief</small>
                </span>
                <button
                  className="text-button"
                  disabled={busy || archive.uploaded}
                  onClick={() => void work(() => downloadArchive(archive.id))}
                >
                  Download
                </button>
              </div>
            );
          })}
          <details className="restore-section">
            <summary>
              <strong>Back-up herstellen op deze server</strong>
            </summary>
            <p>
              Herstel vervangt de huidige database, bestanden en configuratie.
              Eerst controleren we het archief en tonen we de inhoud. Alleen na
              jouw expliciete bevestiging wordt de toepassing tijdelijk gestopt
              en teruggezet.
            </p>
            <form
              onSubmit={(e) =>
                submit(e, async (f) => {
                  const file = f.get("file") as File;
                  if (!file?.name)
                    throw Error("Kies een gedownload back-uparchief.");
                  const upload = new FormData();
                  upload.append("file", file);
                  const result = await api("/admin/backups/archives/upload", {
                    method: "POST",
                    body: upload,
                  });
                  await load();
                  setUploaded((previous) => [
                    ...previous.filter((a) => a.id !== result.archiveId),
                    { id: result.archiveId, size: file.size, uploaded: true },
                  ]);
                  setSource("local");
                  setArchiveId(result.archiveId);
                  setPreview(null);
                  setNotice(
                    "Archief op deze server geplaatst. Vul de bijbehorende herstelsleutel in en controleer het archief.",
                  );
                })
              }
            >
              <F
                label="Archief vanaf je computer toevoegen"
                help="Voor een nieuwe server: kies het eerder gedownloade .twb-bestand. Behoud de oorspronkelijke bestandsnaam met de archief-ID."
              >
                <input type="file" name="file" accept=".twb" required />
              </F>
              <button className="secondary" disabled={busy}>
                {busy ? "Archief verwerken…" : "Archief toevoegen"}
              </button>
            </form>
            <hr />
            <form
              onSubmit={(e) =>
                submit(e, async () => {
                  if (!archiveId) throw Error("Selecteer een back-up.");
                  setPreview(
                    await api(
                      "/admin/backups/restore-preview",
                      j("POST", {
                        archiveId,
                        source,
                        recoverySecret: recovery,
                      }),
                    ),
                  );
                  setConfirm("");
                  setRestoreJob(null);
                })
              }
            >
              <div className="form-grid">
                <F label="Waar staat de back-up?">
                  <select
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                      setArchiveId("");
                      setPreview(null);
                    }}
                  >
                    <option value="local">Op deze server</option>
                    <option value="onedrive">In OneDrive</option>
                  </select>
                </F>
                <F label="Back-up kiezen">
                  <select
                    required
                    value={archiveId}
                    onChange={(e) => {
                      setArchiveId(e.target.value);
                      setPreview(null);
                    }}
                  >
                    <option value="">Kies een archief</option>
                    {(source === "local" ? localArchives : remote).map(
                      (archive) => {
                        const m = archive.manifest || archive;
                        return (
                          <option key={archive.id} value={archive.id}>
                            {formatDate(m.createdAt)} · {size(m.size)} ·{" "}
                            {archive.id.slice(0, 8)}
                          </option>
                        );
                      },
                    )}
                  </select>
                </F>
              </div>
              {source === "onedrive" && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void work(async () =>
                      setRemote(await api("/admin/onedrive/backups")),
                    )
                  }
                >
                  OneDrive-lijst vernieuwen
                </button>
              )}
              <F
                label="Herstelsleutel van dit archief"
                help="Gebruik de sleutel uit het herstelbestand dat bij deze back-up hoort."
              >
                <input
                  type="password"
                  value={recovery}
                  onChange={(e) => {
                    setRecovery(e.target.value);
                    setPreview(null);
                  }}
                  autoComplete="off"
                  minLength={20}
                  maxLength={512}
                  required
                />
              </F>
              <button
                className="secondary"
                disabled={busy || !archiveId || !status.helper?.available}
              >
                Archief controleren
              </button>
            </form>
            {preview && !terminal(preview) && (
              <p role="status">
                Archief controleren… Het archief wordt nog niet hersteld.
              </p>
            )}
            {preview && jobState(preview) === "failed" && (
              <div className="alert error">
                {preview.error ||
                  "De controle is mislukt. Controleer de sleutel en het archief."}
              </div>
            )}
            {preview && jobState(preview) === "completed" && manifest && (
              <div className="restore-preview">
                <h3>Gecontroleerd herstelpunt</h3>
                <dl>
                  <dt>Datum</dt>
                  <dd>{formatDate(manifest.createdAt)}</dd>
                  <dt>Inhoud</dt>
                  <dd>
                    {(manifest.contents || [])
                      .map(
                        (v: string) =>
                          (
                            ({
                              database: "Database",
                              uploads: "Foto’s en documenten",
                              exports: "Exports",
                              config: "Configuratie en beveiligingssleutels",
                            }) as Row
                          )[v] || v,
                      )
                      .join(", ")}
                  </dd>
                  <dt>Grootte</dt>
                  <dd>{size(manifest.size)}</dd>
                  <dt>Versie</dt>
                  <dd>{manifest.appVersion || "Niet opgegeven"}</dd>
                  <dt>Bestandscontrole</dt>
                  <dd style={{ overflowWrap: "anywhere" }}>
                    {preview.result.sha256 || manifest.sha256}
                  </dd>
                </dl>
                <form
                  onSubmit={(e) =>
                    submit(e, async () => {
                      if (confirm !== "HERSTEL " + archiveId)
                        throw Error("Typ de bevestiging exact over.");
                      setRestoreJob(
                        await api(
                          "/admin/backups/restore",
                          j("POST", {
                            previewId: preview.id,
                            confirm,
                            recoverySecret: recovery,
                          }),
                        ),
                      );
                      setNotice(
                        "Herstel gestart. De toepassing kan tijdelijk onbereikbaar zijn. Wacht tot de server weer beschikbaar is.",
                      );
                      await load();
                    })
                  }
                >
                  <F
                    label={`Typ HERSTEL ${archiveId} om de huidige gegevens te vervangen`}
                  >
                    <input
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      autoComplete="off"
                    />
                  </F>
                  <button
                    className="primary"
                    disabled={
                      busy || !!restoreJob || confirm !== "HERSTEL " + archiveId
                    }
                  >
                    Huidige gegevens vervangen en herstellen
                  </button>
                </form>
              </div>
            )}
            {restoreJob && (
              <div
                className={
                  "alert " +
                  (jobState(restoreJob) === "failed" ? "error" : "success")
                }
                role="status"
              >
                {jobState(restoreJob) === "completed"
                  ? "Herstel voltooid. Vernieuw de pagina en meld je opnieuw aan met een account uit de herstelde back-up."
                  : jobState(restoreJob) === "failed"
                    ? restoreJob.error ||
                      "Herstel mislukt. Controleer de opdrachtgeschiedenis."
                    : "Herstel is bezig. Sluit de server niet af."}
                {jobState(restoreJob) === "completed" && (
                  <button
                    className="secondary"
                    onClick={() => window.location.reload()}
                  >
                    Werkplek opnieuw openen
                  </button>
                )}
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
