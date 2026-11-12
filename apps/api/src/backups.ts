import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import type { Response } from "express";
import { AdminGuard, AuthGuard, CurrentUser, User } from "./auth";
import { audit, camel, query, transaction } from "./db";
import { validId } from "./inventory";
import { getSetting, readSecret, sealSecret, openSecret } from "./settings";

let backupAbort = new AbortController();
export function stopBackupProcessing() {
  backupAbort.abort();
}
const operations = ["backup", "restore_preview", "restore"];
const configKeys = [
  "backupEnabled",
  "backupHour",
  "appTimezone",
  "backupRetentionDays",
  "backupOneDriveEnabled",
  "backupRestoreCheckEnabled",
  "backupRestoreCheckIntervalDays",
];
const control = () =>
  resolve(process.env.BACKUP_CONTROL_DIR || "/data/control");
const backups = () => resolve(process.env.BACKUP_DIR || "/data/backups");
const jobFields =
  "id,operation,state,requested_by,archive_id,source,upload_to_onedrive,schedule_key,result,error,remote_state,remote_result,created_at,updated_at,completed_at";
function recoverySecret(value: any): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 512)
    throw new BadRequestException(
      "Gebruik een herstelcode of wachtzin van 20–512 tekens. Bewaar deze buiten de NAS.",
    );
  return value;
}
function filename(id: string) {
  return validId(id) + ".twb";
}
async function config() {
  const snapshot = (
    await query("SELECT values,secrets,version FROM system_settings WHERE id=1")
  )[0];
  const values: Record<string, any> = {};
  for (const key of configKeys)
    values[key] = Object.hasOwn(snapshot.values, key)
      ? snapshot.values[key]
      : await getSetting(key);
  return {
    ...values,
    version: snapshot.version,
    backupPassphraseConfigured: !!snapshot.secrets.backupPassphrase,
  };
}

async function helperStatus() {
  try {
    const heartbeat = JSON.parse(
      await readFile(resolve(control(), "heartbeat.json"), "utf8"),
    );
    const lastSeen = heartbeat.lastSeen;
    if (typeof lastSeen !== "string" || !Number.isFinite(Date.parse(lastSeen)))
      return { available: false, lastSeen: null };
    return { available: Date.now() - Date.parse(lastSeen) < 120000, lastSeen };
  } catch {
    return { available: false, lastSeen: null };
  }
}
async function requireHelper() {
  if (!(await helperStatus()).available)
    throw new ServiceUnavailableException(
      "De back-upservice is niet bereikbaar. Controleer de installatie en probeer opnieuw.",
    );
}
function safeManifest(raw: any) {
  if (!raw || typeof raw !== "object")
    throw new BadRequestException("Back-upmanifest ontbreekt");
  const id = validId(raw.id);
  if (
    raw.archiveName !== filename(id) ||
    raw.format !== "tuinwerk-backup-v2" ||
    raw.encryption !== "aes-256-gcm+scrypt" ||
    !Array.isArray(raw.contents) ||
    !["database", "uploads", "exports", "config"].every((part) =>
      raw.contents.includes(part),
    ) ||
    !/^[a-f0-9]{64}$/i.test(raw.sha256) ||
    !Number.isSafeInteger(raw.size) ||
    raw.size < 1 ||
    !Number.isFinite(Date.parse(raw.createdAt))
  )
    throw new BadRequestException("Geen complete, herkenbare TuinWerk-back-up");
  return {
    format: raw.format,
    id,
    createdAt: raw.createdAt,
    archiveName: raw.archiveName,
    size: raw.size,
    sha256: raw.sha256,
    encryption: raw.encryption,
    contents: ["database", "uploads", "exports", "config"],
    appVersion: String(raw.appVersion || "unknown").slice(0, 100),
    manifestVersion: 1,
  };
}
function safeResult(raw: any) {
  const result: Record<string, any> = {};
  if (raw.manifest) result.manifest = safeManifest(raw.manifest);
  if (raw.sha256 && /^[a-f0-9]{64}$/i.test(raw.sha256))
    result.sha256 = raw.sha256;
  if (Number.isSafeInteger(raw.size) && raw.size > 0) result.size = raw.size;
  if (raw.archive && /^[a-f0-9-]{36}\.twb$/i.test(raw.archive))
    result.archive = raw.archive;
  if (raw.previewId) result.previewId = validId(raw.previewId);
  if (["local", "upload", "onedrive"].includes(raw.archiveSource))
    result.archiveSource = raw.archiveSource;
  if (raw.needsOperator === true) result.needsOperator = true;
  return result;
}
async function enqueueSpool(
  job: any,
  secret: string,
  extra: Record<string, any> = {},
) {
  const dir = resolve(control(), "requests");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = resolve(dir, job.id + ".json"),
    temporary = resolve(dir, job.id + "." + randomUUID() + ".tmp");
  const request = {
    id: job.id,
    operation: job.operation,
    requestedBy: job.requested_by,
    archive: filename(job.archive_id),
    recoverySecret: secret,
    archiveSource: job.source === "onedrive" ? "onedrive" : "local",
    ...extra,
  };
  try {
    await writeFile(temporary, JSON.stringify(request), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, target);
    await query(
      "UPDATE backup_jobs SET state='queued',updated_at=now() WHERE id=$1 AND state='preparing'",
      [job.id],
    );
  } catch (error) {
    await unlink(temporary).catch(() => {});
    await query(
      "UPDATE backup_jobs SET state='failed',error='Aanvraag kon niet veilig worden opgeslagen',updated_at=now(),completed_at=now() WHERE id=$1 AND state='preparing'",
      [job.id],
    );
    throw error;
  }
}
async function createJob(
  userId: string,
  operation: string,
  archiveId: string,
  source = "local",
  upload = false,
  scheduleKey?: string,
) {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('backup-job'))");
    if (scheduleKey) {
      const prior = (
        await c.query("SELECT * FROM backup_jobs WHERE schedule_key=$1", [
          scheduleKey,
        ])
      ).rows[0];
      if (prior) return { job: prior, existing: true };
    }
    if (
      (
        await c.query(
          "SELECT id FROM backup_jobs WHERE state IN ('preparing','queued','running')",
        )
      ).rows.length
    )
      throw new ConflictException(
        "Er wordt al een back-up of herstel uitgevoerd. Wacht tot deze gereed is.",
      );
    const job = (
      await c.query(
        "INSERT INTO backup_jobs(id,operation,requested_by,archive_id,source,upload_to_onedrive,schedule_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomUUID(),
          operation,
          userId,
          archiveId,
          source,
          upload,
          scheduleKey || null,
        ],
      )
    ).rows[0];
    await audit(c, userId, "backup", job.id, operation + "_requested", {
      archiveId,
      source,
      scheduled: !!scheduleKey,
    });
    return { job, existing: false };
  });
}
export async function requestBackup(
  userId: string,
  b: any = {},
  scheduleKey?: string,
) {
  await requireHelper();
  const secret = recoverySecret(
    b.recoverySecret || (await readSecret("backupPassphrase")),
  );
  const upload =
    b.uploadToOneDrive ?? (await getSetting("backupOneDriveEnabled"));
  if (typeof upload !== "boolean")
    throw new BadRequestException("OneDrive-keuze moet ja/nee zijn");
  const { job, existing } = await createJob(
    userId,
    "backup",
    randomUUID(),
    "local",
    upload,
    scheduleKey,
  );
  if (!existing)
    await enqueueSpool(job, secret, {
      retentionDays: await getSetting("backupRetentionDays"),
    });
  return camel(
    (
      await query(`SELECT ${jobFields} FROM backup_jobs WHERE id=$1`, [job.id])
    )[0],
  );
}

/** Results are outside the restored database so a restore job remains visible after recovery. */
export async function processBackupResults() {
  let files: string[];
  try {
    files = await readdir(resolve(control(), "results"));
  } catch {
    return;
  }
  for (const name of files
    .filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))
    .sort()) {
    let raw: any;
    try {
      raw = JSON.parse(
        await readFile(resolve(control(), "results", name), "utf8"),
      );
      validId(raw.id);
      validId(raw.requestedBy);
      if (
        name !== raw.id + ".json" ||
        !operations.includes(raw.operation) ||
        !["completed", "failed"].includes(raw.state) ||
        typeof raw.completedAt !== "string" ||
        !Number.isFinite(Date.parse(raw.completedAt))
      )
        continue;
    } catch {
      continue;
    }
    let result: Record<string, any>;
    try {
      result = safeResult(raw);
    } catch {
      continue;
    }
    const archiveId =
      result.manifest?.id || (raw.archive ? raw.archive.slice(0, -4) : null);
    if (archiveId)
      try {
        validId(archiveId);
      } catch {
        continue;
      }
    const error =
      raw.state === "failed"
        ? String(raw.error || "Back-upservice meldde een fout").slice(0, 500)
        : null;
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('backup-results'))");
      const old = (
        await c.query("SELECT * FROM backup_jobs WHERE id=$1 FOR UPDATE", [
          raw.id,
        ])
      ).rows[0];
      if (old && ["completed", "failed"].includes(old.state)) return;
      if (raw.operation === "restore" && raw.state === "completed")
        await c.query(
          "UPDATE backup_jobs SET state='failed',error='Onderbroken doordat een volledig herstel is uitgevoerd',completed_at=now(),updated_at=now() WHERE state IN ('preparing','queued','running') AND id<>$1 AND created_at<=$2::timestamptz",
          [raw.id, raw.completedAt],
        );
      await c.query(
        "INSERT INTO backup_jobs(id,operation,state,requested_by,archive_id,result,error,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET state=excluded.state,result=excluded.result,error=excluded.error,updated_at=now(),completed_at=excluded.completed_at",
        [
          raw.id,
          raw.operation,
          raw.state,
          raw.requestedBy,
          archiveId,
          JSON.stringify(result),
          error,
          raw.completedAt,
        ],
      );
      if (
        ["backup", "restore_preview"].includes(raw.operation) &&
        raw.state === "completed" &&
        result.manifest
      ) {
        await c.query(
          "INSERT INTO backup_archives(id,filename,manifest) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest",
          [
            archiveId,
            result.manifest.archiveName,
            JSON.stringify(result.manifest),
          ],
        );
        if (raw.operation === "backup" && old?.upload_to_onedrive)
          await c.query(
            "UPDATE backup_jobs SET remote_state='pending' WHERE id=$1",
            [raw.id],
          );
      }
    });
  }
  const queued = await query("SELECT id FROM backup_jobs WHERE state='queued'");
  for (const job of queued) {
    try {
      await access(resolve(control(), "requests", job.id + ".json"));
    } catch {
      await query(
        "UPDATE backup_jobs SET state='running',updated_at=now() WHERE id=$1 AND state='queued'",
        [job.id],
      );
    }
  }
}
async function processPreparations() {
  const jobs = await query(
    "SELECT * FROM backup_jobs WHERE state='preparing' AND source='onedrive' AND preparation IS NOT NULL ORDER BY created_at LIMIT 1",
  );
  const job = jobs[0];
  if (!job) return;
  try {
    const secret = openSecret(
      job.preparation.recoverySecret,
      "backup-job:" + job.id,
    );
    const { downloadOneDriveBackup } = await import("./onedrive");
    const dir = resolve(control(), "uploads");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await downloadOneDriveBackup(
      job.archive_id,
      resolve(dir, filename(job.archive_id)),
      { signal: backupAbort.signal },
    );
    await enqueueSpool(job, secret);
    await query("UPDATE backup_jobs SET preparation=NULL WHERE id=$1", [
      job.id,
    ]);
  } catch {
    if (!backupAbort.signal.aborted)
      await query(
        "UPDATE backup_jobs SET state='failed',preparation=NULL,error='OneDrive-archief kon niet worden opgehaald of gecontroleerd',updated_at=now(),completed_at=now() WHERE id=$1 AND state='preparing'",
        [job.id],
      );
  }
}

async function processRemoteUploads() {
  await query(
    "UPDATE backup_jobs SET remote_state='pending',updated_at=now() WHERE remote_state='uploading' AND updated_at<now()-interval '10 minutes'",
  );
  const job = await transaction(async (c) => {
    const found = (
      await c.query(
        "SELECT * FROM backup_jobs WHERE state='completed' AND remote_state='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!found) return null;
    await c.query(
      "UPDATE backup_jobs SET remote_state='uploading',updated_at=now() WHERE id=$1",
      [found.id],
    );
    return found;
  });
  if (!job) return;
  try {
    const { uploadOneDriveBackup } = await import("./onedrive");
    const result = await uploadOneDriveBackup({
      archivePath: resolve(backups(), filename(job.archive_id)),
      manifest: job.result.manifest,
      operationId: job.id,
      signal: backupAbort.signal,
    });
    await query(
      "UPDATE backup_jobs SET remote_state='completed',remote_result=$2,updated_at=now() WHERE id=$1",
      [job.id, JSON.stringify(result)],
    );
    await query(
      "UPDATE backup_archives SET remote_state='completed',remote_result=$2 WHERE id=$1",
      [job.archive_id, JSON.stringify(result)],
    );
  } catch {
    await query(
      "UPDATE backup_jobs SET remote_state=$2,remote_result=$3,updated_at=now() WHERE id=$1",
      [
        job.id,
        backupAbort.signal.aborted ? "pending" : "failed",
        JSON.stringify({
          message: backupAbort.signal.aborted
            ? "Upload onderbroken; wordt na herstart opnieuw aangeboden."
            : "OneDrive-kopie mislukt. De lokale versleutelde back-up is behouden; probeer opnieuw.",
        }),
      ],
    );
  }
}
export function assessBackupHealth(input: any, now = new Date()) {
  const alerts: any[] = [];
  const add = (
    code: string,
    severity: string,
    title: string,
    message: string,
    action: string,
  ) => alerts.push({ code, severity, title, message, action });
  const lastLocalSuccess = input.lastLocalSuccess || null;
  const lastCloudSuccess = input.cloud?.lastSuccessfulTransfer || null;
  const localOverdue =
    !!input.config.backupEnabled &&
    (!lastLocalSuccess ||
      now.getTime() - Date.parse(lastLocalSuccess) > 36 * 3600000);
  if (!input.helper.available)
    add(
      "helper_unavailable",
      "critical",
      "Back-updienst niet bereikbaar",
      "Controleer of de volledige TuinWerk-app in TrueNAS draait en vernieuw daarna de status.",
      "check_service",
    );
  if (!input.config.backupEnabled)
    add(
      "schedule_disabled",
      "info",
      "Dagelijkse back-up staat uit",
      "Schakel dagelijkse back-ups in nadat je de herstelsleutel buiten de NAS hebt bewaard.",
      "configure_backup",
    );
  if (localOverdue)
    add(
      "local_overdue",
      "critical",
      "Lokale back-up ontbreekt of is te oud",
      "Er is geen succesvolle lokale back-up van de afgelopen 36 uur. Start nu een back-up en controleer de uitkomst.",
      "create_backup",
    );
  if (input.lastJob?.state === "failed")
    add(
      "backup_failed",
      "critical",
      "Laatste back-uppoging mislukt",
      input.lastJob.error ||
        "Bekijk de jobgeschiedenis, herstel de oorzaak en start opnieuw.",
      "create_backup",
    );
  if (
    input.config.backupOneDriveEnabled &&
    input.cloud?.reauthenticationRequired
  )
    add(
      "cloud_permission_expired",
      "critical",
      "OneDrive opnieuw verbinden",
      "De laatste providerreactie geeft aan dat toestemming niet meer geldig is. Verbind het OneDrive-account opnieuw bij Integraties.",
      "open_onedrive",
    );
  else if (input.config.backupOneDriveEnabled && !input.cloud?.connected)
    add(
      "cloud_disconnected",
      "warning",
      "OneDrive is niet verbonden",
      "Verbind je OneDrive-account om weer externe kopieën te kunnen maken.",
      "open_onedrive",
    );
  if (
    input.config.backupOneDriveEnabled &&
    (!lastCloudSuccess ||
      now.getTime() - Date.parse(lastCloudSuccess) > 36 * 3600000)
  )
    add(
      "cloud_overdue",
      "warning",
      "Externe kopie ontbreekt of is te oud",
      "De laatste bevestigde upload is ouder dan 36 uur of ontbreekt. Controleer de verbinding en bied de lokale back-up opnieuw aan.",
      "open_onedrive",
    );
  if (input.lastJob?.remoteState === "failed")
    add(
      "cloud_upload_failed",
      "warning",
      "OneDrive-kopie mislukt",
      "De lokale back-up blijft beschikbaar. Controleer de verbinding en gebruik OneDrive opnieuw proberen in de jobgeschiedenis.",
      "open_onedrive",
    );
  for (const disk of input.storage || [])
    if (
      disk.availableBytes !== null &&
      (disk.availableBytes < 1073741824 ||
        (disk.totalBytes > 0 && disk.availableBytes / disk.totalBytes < 0.1))
    )
      add(
        "low_space_" + disk.scope,
        "warning",
        disk.scope === "archives"
          ? "Weinig ruimte voor back-ups"
          : "Weinig werkruimte voor herstel",
        "Maak ruimte vrij in de betreffende TrueNAS-dataset. Verwijder geen laatste herstelbron voordat een andere kopie is gecontroleerd.",
        "free_space",
      );
  const intervalDays = Number(
      input.config.backupRestoreCheckIntervalDays || 90,
    ),
    lastRecordedAt = input.lastCheck?.recordedAt || null;
  const dueAt = lastRecordedAt
    ? new Date(
        Date.parse(lastRecordedAt) + intervalDays * 86400000,
      ).toISOString()
    : null;
  const due =
    !!input.config.backupRestoreCheckEnabled &&
    (!dueAt || Date.parse(dueAt) <= now.getTime());
  if (due)
    add(
      "restore_check_due",
      "warning",
      "Periodieke herstelcontrole nodig",
      lastRecordedAt
        ? "De ingestelde periode sinds je laatste vastgelegde controle is verstreken."
        : "Er is nog geen technische archiefcontrole met vastgelegde menselijke controles.",
      "run_restore_check",
    );
  return {
    lastLocalSuccess,
    lastCloudSuccess,
    localOverdue,
    cloud: input.cloud,
    storage: input.storage,
    restoreCheck: {
      enabled: !!input.config.backupRestoreCheckEnabled,
      intervalDays,
      lastRecordedAt,
      dueAt,
      due,
    },
    alerts,
  };
}
async function backupHealth(configValues: any, helper: any, now = new Date()) {
  const lastLocal = (
    await query(
      "SELECT completed_at FROM backup_jobs WHERE operation='backup' AND state='completed' ORDER BY completed_at DESC LIMIT 1",
    )
  )[0];
  const lastJob = camel(
    (
      await query(
        "SELECT state,error,remote_state FROM backup_jobs WHERE operation='backup' ORDER BY created_at DESC LIMIT 1",
      )
    )[0] || null,
  );
  const lastCheck = camel(
    (
      await query(
        "SELECT recorded_at FROM backup_restore_checks WHERE recorded_at IS NOT NULL ORDER BY recorded_at DESC LIMIT 1",
      )
    )[0] || null,
  );
  const { getOneDriveHealth } = await import("./onedrive");
  const cloud = await getOneDriveHealth();
  const storage = await Promise.all(
    [
      ["archives", backups()],
      ["work", control()],
    ].map(async ([scope, path]) => {
      try {
        const disk = await statfs(path);
        return {
          scope,
          availableBytes: disk.bavail * disk.bsize,
          totalBytes: disk.blocks * disk.bsize,
        };
      } catch {
        return { scope, availableBytes: null, totalBytes: null };
      }
    }),
  );
  return assessBackupHealth(
    {
      config: configValues,
      helper,
      lastLocalSuccess: lastLocal?.completed_at?.toISOString(),
      lastJob,
      lastCheck,
      cloud,
      storage,
    },
    now,
  );
}
async function restoreCheckReminder(now: Date) {
  if (!(await getSetting("backupRestoreCheckEnabled"))) return;
  const interval = Number(await getSetting("backupRestoreCheckIntervalDays"));
  const last = (
    await query(
      "SELECT id,recorded_at FROM backup_restore_checks WHERE recorded_at IS NOT NULL ORDER BY recorded_at DESC LIMIT 1",
    )
  )[0];
  if (
    last &&
    now.getTime() - new Date(last.recorded_at).getTime() < interval * 86400000
  )
    return;
  const key = "restore-check:" + (last?.id || "initial") + ":" + interval;
  await transaction(async (c) => {
    const admins = (
      await c.query(
        "SELECT u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.active AND u.role='admin' AND (coalesce(p.in_app,true) OR coalesce(p.email,false) OR coalesce(p.push,false))",
      )
    ).rows;
    for (const admin of admins) {
      const claimed = await c.query(
        "INSERT INTO backup_check_reminders(reminder_key,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id",
        [key, admin.id],
      );
      if (claimed.rowCount)
        await c.query(
          "INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'backup_check','Periodieke herstelcontrole nodig','Open Beheer → Back-ups: controleer een archief en leg daarna je taak- en bestandscontroles uit een aparte testinstallatie vast.')",
          [admin.id],
        );
    }
  });
}

export async function backupTick(now = new Date()) {
  if (backupAbort.signal.aborted) return;
  await processBackupResults();
  await restoreCheckReminder(now);
  await processPreparations();
  await processRemoteUploads();
  if (backupAbort.signal.aborted || !(await getSetting("backupEnabled")))
    return;
  const timezone = await getSetting("appTimezone");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (Number(parts.hour) < Number(await getSetting("backupHour"))) return;
  const day = `${parts.year}-${parts.month}-${parts.day}`,
    key = "daily:" + day;
  const admin = (
    await query(
      "SELECT id FROM users WHERE role='admin' AND active ORDER BY created_at LIMIT 1",
    )
  )[0];
  if (!admin) return;
  try {
    await requestBackup(admin.id, {}, key);
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
  }
}

@Controller("admin/backups")
@UseGuards(AuthGuard, AdminGuard)
export class BackupsController {
  @Get("status") async status() {
    await processBackupResults();
    const currentConfig = await config(),
      helper = await helperStatus();
    return {
      config: currentConfig,
      helper,
      health: await backupHealth(currentConfig, helper),
      activeJob: camel(
        (
          await query(
            `SELECT ${jobFields} FROM backup_jobs WHERE state IN ('preparing','queued','running') LIMIT 1`,
          )
        )[0] || null,
      ),
      lastBackup: camel(
        (
          await query(
            `SELECT ${jobFields} FROM backup_jobs WHERE operation='backup' ORDER BY created_at DESC LIMIT 1`,
          )
        )[0] || null,
      ),
    };
  }
  @Put("config") async saveConfig(@Body() b: any, @CurrentUser() u: User) {
    if (!Number.isInteger(b.version))
      throw new BadRequestException(
        "Instellingenversie ontbreekt; laad de instellingen opnieuw",
      );
    const values: Record<string, any> = {};
    for (const key of configKeys) if (key in b) values[key] = b[key];
    for (const key of [
      "backupEnabled",
      "backupOneDriveEnabled",
      "backupRestoreCheckEnabled",
    ])
      if (key in values && typeof values[key] !== "boolean")
        throw new BadRequestException("Aan/uit-instelling is ongeldig");
    if (
      "backupHour" in values &&
      (!Number.isInteger(values.backupHour) ||
        values.backupHour < 0 ||
        values.backupHour > 23)
    )
      throw new BadRequestException("Kies een uur van 0 tot 23");
    if (
      "backupRetentionDays" in values &&
      (!Number.isInteger(values.backupRetentionDays) ||
        values.backupRetentionDays < 1 ||
        values.backupRetentionDays > 3650)
    )
      throw new BadRequestException("Bewaartermijn moet 1–3650 dagen zijn");
    if (
      "backupRestoreCheckIntervalDays" in values &&
      (!Number.isInteger(values.backupRestoreCheckIntervalDays) ||
        values.backupRestoreCheckIntervalDays < 1 ||
        values.backupRestoreCheckIntervalDays > 3650)
    )
      throw new BadRequestException("Controle-interval moet 1–3650 dagen zijn");
    if ("appTimezone" in values)
      try {
        new Intl.DateTimeFormat("nl-NL", {
          timeZone: values.appTimezone,
        }).format();
      } catch {
        throw new BadRequestException("Ongeldige tijdzone");
      }
    let secret: string | undefined;
    if ("backupPassphrase" in b) {
      secret = recoverySecret(b.backupPassphrase);
      if (b.recoveryConfirmed !== true)
        throw new BadRequestException(
          "Bewaar eerst de herstelcode buiten de NAS en bevestig dat deze veilig is opgeslagen.",
        );
    }
    if (
      values.backupEnabled &&
      !secret &&
      !(await readSecret("backupPassphrase"))
    )
      throw new BadRequestException(
        "Stel eerst een veilig bewaarde herstelcode in",
      );
    if (
      values.backupOneDriveEnabled &&
      (!(await getSetting("oneDriveClientId")) ||
        !(await readSecret("oneDriveRefreshToken")))
    )
      throw new BadRequestException(
        "Verbind eerst het OneDrive-account voordat je automatische externe kopieën inschakelt",
      );
    await transaction(async (c) => {
      const settings = (
        await c.query("SELECT * FROM system_settings WHERE id=1 FOR UPDATE")
      ).rows[0];
      if (settings.version !== b.version)
        throw new ConflictException(
          "Instellingen zijn gewijzigd; laad opnieuw voordat je opslaat",
        );
      const secrets = { ...settings.secrets };
      if (secret)
        secrets.backupPassphrase = sealSecret(secret, "backupPassphrase");
      await c.query(
        "UPDATE system_settings SET values=$1,secrets=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=1",
        [
          JSON.stringify({ ...settings.values, ...values }),
          JSON.stringify(secrets),
          u.id,
        ],
      );
      await audit(c, u.id, "backup", "config", "configured", {
        fields: Object.keys(values),
        recoveryCodeChanged: !!secret,
        recoveryConfirmed: !!secret,
      });
    });
    return config();
  }
  @Post("recovery-key") @Header("Cache-Control", "no-store") recovery() {
    const passphrase = randomBytes(32).toString("base64url");
    return {
      passphrase,
      filename: "TuinWerk-herstelcode.txt",
      recoveryText: `TuinWerk OS — herstelcode\n\n${passphrase}\n\nBewaar dit bestand buiten de NAS, bijvoorbeeld in een wachtwoordkluis. Deze code ontsleutelt jouw volledige back-ups. Zonder deze code zijn de bestanden niet herstelbaar. Bewaar eerdere codes wanneer je een nieuwe code instelt.\n`,
    };
  }
  @Post() create(@Body() b: any, @CurrentUser() u: User) {
    return requestBackup(u.id, b || {});
  }
  @Get("jobs") async jobs() {
    await processBackupResults();
    return camel(
      await query(
        `SELECT ${jobFields} FROM backup_jobs ORDER BY created_at DESC LIMIT 100`,
      ),
    );
  }
  @Get("jobs/:id") async job(@Param("id") id: string) {
    validId(id);
    await processBackupResults();
    const row = (
      await query(`SELECT ${jobFields} FROM backup_jobs WHERE id=$1`, [id])
    )[0];
    if (!row) throw new NotFoundException();
    return camel(row);
  }
  @Get("archives") async archives() {
    await processBackupResults();
    const rows = await query(
      "SELECT * FROM backup_archives ORDER BY created_at DESC LIMIT 500",
    );
    return camel(
      await Promise.all(
        rows.map(async (row) => {
          let localAvailable = false;
          try {
            let path = resolve(backups(), filename(row.id));
            try {
              await access(path);
            } catch {
              path = resolve(control(), "uploads", filename(row.id));
            }
            const info = await lstat(path);
            localAvailable = info.isFile() && !info.isSymbolicLink();
          } catch {}
          return { ...row, localAvailable };
        }),
      ),
    );
  }
  @Get("archives/:id/download") async download(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    validId(id);
    const row = (
      await query("SELECT * FROM backup_archives WHERE id=$1", [id])
    )[0];
    if (!row) throw new NotFoundException("Back-up niet gevonden");
    let path = resolve(backups(), filename(id));
    try {
      await access(path);
    } catch {
      path = resolve(control(), "uploads", filename(id));
    }
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await file.stat()).isFile()) throw Error();
    } catch {
      throw new NotFoundException(
        "Lokaal archief ontbreekt; controleer de OneDrive-kopie",
      );
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("application/octet-stream").attachment(filename(id));
    file
      .createReadStream()
      .on("error", () => res.destroy())
      .pipe(res);
  }
  @Post("archives/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = resolve(control(), "uploads");
          mkdir(dir, { recursive: true, mode: 0o700 }).then(
            () => cb(null, dir),
            (error) => cb(error as Error, dir),
          );
        },
        filename: (_req, _file, cb) => cb(null, randomUUID() + ".uploading"),
      }),
      limits: { files: 1, fileSize: 20 * 1024 * 1024 * 1024, fields: 2 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    if (!file) throw new BadRequestException("Back-upbestand ontbreekt");
    try {
      const original = /^[a-f0-9-]{36}\.twb$/i.test(file.originalname)
        ? file.originalname.slice(0, -4)
        : undefined;
      const archiveId = validId(b?.archiveId || original);
      if (original && original.toLowerCase() !== archiveId.toLowerCase())
        throw new BadRequestException(
          "Bestandsnaam en back-up-ID komen niet overeen",
        );
      await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('backup-job'))");
        if (
          (
            await c.query(
              "SELECT id FROM backup_jobs WHERE archive_id=$1 AND state IN ('preparing','queued','running')",
              [archiveId],
            )
          ).rows.length
        )
          throw new ConflictException("Dit archief wordt momenteel verwerkt");
        await rename(
          file.path,
          resolve(control(), "uploads", filename(archiveId)),
        );
        await audit(c, u.id, "backup_archive", archiveId, "uploaded", {
          size: file.size,
        });
      });
      return { archiveId, source: "local", size: file.size };
    } catch (error) {
      await unlink(file.path).catch(() => {});
      throw error;
    }
  }
  @Post("jobs/:id/retry-onedrive") async retryRemote(
    @Param("id") id: string,
    @CurrentUser() u: User,
  ) {
    validId(id);
    const rows = await query(
      "UPDATE backup_jobs SET remote_state='pending',upload_to_onedrive=true,updated_at=now() WHERE id=$1 AND operation='backup' AND state='completed' AND (remote_state IS NULL OR remote_state IN ('failed','completed')) RETURNING id",
      [id],
    );
    if (!rows.length)
      throw new ConflictException(
        "Deze back-up is niet beschikbaar voor een nieuwe OneDrive-kopie",
      );
    return { id, state: "pending" };
  }
  @Get("restore-checks") async checks(@CurrentUser() u: User) {
    await processBackupResults();
    return camel(
      await query(
        "SELECT c.*,c.requested_by=$1::uuid AS can_record,j.state AS technical_state,j.completed_at AS technical_checked_at,j.error,j.result FROM backup_restore_checks c JOIN backup_jobs j ON j.id=c.job_id ORDER BY c.created_at DESC LIMIT 100",
        [u.id],
      ),
    );
  }
  @Post("restore-checks") async startCheck(
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    const job = await this.preview(b, u);
    return transaction(async (c) => {
      const row = (
        await c.query(
          "INSERT INTO backup_restore_checks(job_id,archive_id,source,requested_by) VALUES($1,$2,$3,$4) RETURNING *",
          [job.id, b.archiveId, b.source || "local", u.id],
        )
      ).rows[0];
      await audit(c, u.id, "backup_check", row.id, "started", {
        archiveId: b.archiveId,
        jobId: job.id,
        productionRestorePerformed: false,
      });
      return { ...camel(row), technicalState: job.state };
    });
  }
  @Post("restore-checks/:id/record") async recordCheck(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    if (b.taskChecked !== true || b.fileChecked !== true)
      throw new BadRequestException(
        "Bevestig beide daadwerkelijk uitgevoerde controles in je aparte hersteltest",
      );
    for (const key of ["taskReference", "fileReference"])
      if (
        typeof b[key] !== "string" ||
        b[key].trim().length < 3 ||
        b[key].length > 1000
      )
        throw new BadRequestException(
          "Noteer welke taak en welk bestand je hebt gecontroleerd",
        );
    if (
      b.notes !== undefined &&
      (typeof b.notes !== "string" || b.notes.length > 4000)
    )
      throw new BadRequestException("Notitie maximaal 4000 tekens");
    await processBackupResults();
    return transaction(async (c) => {
      const row = (
        await c.query(
          "SELECT c.*,j.state AS technical_state,j.result FROM backup_restore_checks c JOIN backup_jobs j ON j.id=c.job_id WHERE c.id=$1 AND c.requested_by=$2 FOR UPDATE OF c",
          [id, u.id],
        )
      ).rows[0];
      if (!row)
        throw new NotFoundException(
          "Controle niet gevonden of door een andere beheerder gestart",
        );
      if (row.technical_state !== "completed" || !row.result.manifest)
        throw new BadRequestException(
          "De technische archiefcontrole moet eerst succesvol afgerond zijn",
        );
      if (row.recorded_at) {
        if (
          row.task_reference === b.taskReference.trim() &&
          row.file_reference === b.fileReference.trim() &&
          row.notes === (b.notes || "")
        )
          return camel(row);
        throw new ConflictException(
          "Een vastgelegde controle is onveranderlijk; start een nieuwe controle",
        );
      }
      if (row.version !== b.version)
        throw new ConflictException("Controle is gewijzigd; laad opnieuw");
      const result = (
        await c.query(
          "UPDATE backup_restore_checks SET task_checked=true,file_checked=true,task_reference=$2,file_reference=$3,notes=$4,recorded_at=now(),recorded_by=$5,version=version+1 WHERE id=$1 RETURNING *",
          [
            id,
            b.taskReference.trim(),
            b.fileReference.trim(),
            b.notes || "",
            u.id,
          ],
        )
      ).rows[0];
      await audit(c, u.id, "backup_check", id, "operator_checks_recorded", {
        archiveId: row.archive_id,
        technicalSha256: row.result.sha256,
        taskReference: b.taskReference.trim(),
        fileReference: b.fileReference.trim(),
        productionRestorePerformed: false,
        verificationScope: "archive_validation_and_operator_checks",
      });
      return { ...camel(result), productionRestorePerformed: false };
    });
  }
  @Post("restore-preview") async preview(
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    await requireHelper();
    const archiveId = validId(b.archiveId),
      secret = recoverySecret(b.recoverySecret);
    const source = b.source ?? "local";
    if (!["local", "onedrive"].includes(source))
      throw new BadRequestException("Kies lokale opslag of OneDrive");
    const { job } = await createJob(u.id, "restore_preview", archiveId, source);
    try {
      let archiveSource = "local";
      if (source === "onedrive") {
        await query("UPDATE backup_jobs SET preparation=$2 WHERE id=$1", [
          job.id,
          JSON.stringify({
            recoverySecret: sealSecret(secret, "backup-job:" + job.id),
          }),
        ]);
        return this.job(job.id);
      } else {
        let exists = false;
        for (const path of [
          resolve(backups(), filename(archiveId)),
          resolve(control(), "uploads", filename(archiveId)),
        ])
          try {
            const info = await lstat(path);
            if (info.isFile() && !info.isSymbolicLink() && !exists) {
              exists = true;
              archiveSource =
                path === resolve(backups(), filename(archiveId))
                  ? "local"
                  : "upload";
            }
          } catch {}
        if (!exists)
          throw new NotFoundException(
            "Lokaal archief ontbreekt; upload eerst het gedownloade back-upbestand",
          );
      }
      await enqueueSpool(job, secret, { archiveSource });
      return this.job(job.id);
    } catch (error) {
      await query(
        "UPDATE backup_jobs SET state='failed',error='Back-up kon niet voor controle worden opgehaald',updated_at=now(),completed_at=now() WHERE id=$1 AND state='preparing'",
        [job.id],
      );
      throw error;
    }
  }
  @Post("restore") async restore(@Body() b: any, @CurrentUser() u: User) {
    await requireHelper();
    validId(b.previewId);
    const secret = recoverySecret(b.recoverySecret);
    await processBackupResults();
    const preview = (
      await query(
        "SELECT * FROM backup_jobs WHERE id=$1 AND operation='restore_preview' AND state='completed' AND requested_by=$2",
        [b.previewId, u.id],
      )
    )[0];
    if (
      !preview ||
      Date.now() - new Date(preview.completed_at).getTime() > 3600000
    )
      throw new BadRequestException(
        "Voer eerst opnieuw een herstelcontrole uit",
      );
    if (b.confirm !== "HERSTEL " + preview.archive_id)
      throw new BadRequestException(
        "Bevestig met HERSTEL gevolgd door de exacte back-up-ID",
      );
    const digest = preview.result.sha256 || preview.result.manifest?.sha256;
    if (!/^[a-f0-9]{64}$/i.test(digest || ""))
      throw new BadRequestException(
        "Herstelcontrole mist een geldige checksum",
      );
    const { job } = await createJob(
      u.id,
      "restore",
      preview.archive_id,
      preview.source,
    );
    await enqueueSpool(job, secret, {
      previewId: preview.id,
      expectedSha256: digest,
      archiveSource:
        preview.result.archiveSource ||
        (preview.source === "onedrive" ? "onedrive" : "local"),
    });
    return this.job(job.id);
  }
}
