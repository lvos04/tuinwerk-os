import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, pool } from "../src/db";
import { passwordHash } from "../src/auth";
import { createApp } from "../src/main";
import { processBackupResults } from "../src/backups";
after(() => pool.end());
test(
  "Backup API protects recovery secrets, serializes jobs and binds restores",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuinwerk-backup-api-"));
    process.env.BACKUP_CONTROL_DIR = join(dir, "control");
    process.env.BACKUP_DIR = join(dir, "backups");
    await mkdir(join(dir, "control", "results"), { recursive: true });
    await mkdir(join(dir, "backups"));
    await writeFile(
      join(dir, "control", "heartbeat.json"),
      JSON.stringify({ lastSeen: new Date().toISOString() }),
    );
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      actors: string[] = [];
    const call = (path: string, token?: string, body?: any, method?: string) =>
      fetch(base + "/api" + path, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    try {
      const tokens: Record<string, string> = {};
      for (const role of ["admin", "employee"]) {
        const email = randomUUID() + "@backup.test";
        const user = (
          await query(
            "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id",
            [
              email,
              "Backup test " + role,
              passwordHash("Backup test password123!"),
              role,
            ],
          )
        )[0];
        actors.push(user.id);
        const response = await call("/auth/login", undefined, {
          email,
          password: "Backup test password123!",
        });
        tokens[role] = ((await response.json()) as any).token;
      }
      assert.equal((await call("/admin/backups/status")).status, 401);
      assert.equal(
        (await call("/admin/backups/status", tokens.employee)).status,
        403,
      );
      assert.equal(
        (await call("/admin/backups", tokens.employee, {})).status,
        403,
      );
      assert.equal(
        (await call("/admin/backups/recovery-key", tokens.employee, {})).status,
        403,
      );
      const response = await call(
        "/admin/backups/recovery-key",
        tokens.admin,
        {},
      );
      assert.equal(response.headers.get("cache-control"), "no-store");
      const recovery = (await response.json()) as any;
      assert.ok(recovery.passphrase.length >= 40);
      assert.ok(recovery.recoveryText.includes(recovery.passphrase));
      const status = (await (
        await call("/admin/backups/status", tokens.admin)
      ).json()) as any;
      assert.equal(
        (
          await call(
            "/admin/backups/config",
            tokens.admin,
            {
              version: status.config.version,
              backupPassphrase: recovery.passphrase,
            },
            "PUT",
          )
        ).status,
        400,
      );
      const saved = await call(
        "/admin/backups/config",
        tokens.admin,
        {
          version: status.config.version,
          backupPassphrase: recovery.passphrase,
          recoveryConfirmed: true,
          backupEnabled: false,
          backupOneDriveEnabled: false,
        },
        "PUT",
      );
      assert.equal(saved.status, 200);
      const savedConfig = (await saved.json()) as any;
      assert.equal(savedConfig.backupPassphraseConfigured, true);
      assert.equal(
        JSON.stringify(savedConfig).includes(recovery.passphrase),
        false,
      );
      assert.equal(
        (
          await call(
            "/admin/backups/config",
            tokens.admin,
            { version: status.config.version, backupHour: 5 },
            "PUT",
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await query("SELECT secrets FROM system_settings WHERE id=1")
        )[0].secrets.backupPassphrase.includes(recovery.passphrase),
        false,
      );
      const simultaneous = await Promise.all([
        call("/admin/backups", tokens.admin, {}),
        call("/admin/backups", tokens.admin, {}),
      ]);
      assert.deepEqual(simultaneous.map((r) => r.status).sort(), [201, 409]);
      const job = (await simultaneous
        .find((r) => r.status === 201)!
        .json()) as any;
      assert.equal(job.state, "queued");
      const requestPath = join(dir, "control", "requests", job.id + ".json"),
        request = JSON.parse(await readFile(requestPath, "utf8"));
      assert.equal(request.recoverySecret, recovery.passphrase);
      assert.equal(request.archive, job.archiveId + ".twb");
      assert.equal(request.archiveSource, "local");
      assert.equal((await stat(requestPath)).mode & 0o777, 0o600);
      assert.equal(JSON.stringify(job).includes(recovery.passphrase), false);
      // Fixtures represent trusted bridge responses. Cryptography is tested by the real bridge suite.
      const bytes = Buffer.from("trusted-helper-ciphertext-fixture"),
        digest = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(dir, "backups", job.archiveId + ".twb"), bytes);
      const manifest = {
        format: "tuinwerk-backup-v2",
        id: job.archiveId,
        createdAt: new Date().toISOString(),
        archiveName: job.archiveId + ".twb",
        size: bytes.length,
        sha256: digest,
        encryption: "aes-256-gcm+scrypt",
        contents: ["database", "uploads", "exports", "config"],
        appVersion: "test",
        manifestVersion: 1,
      };
      const respond = async (j: any, operation: string, extra: any = {}) => {
        await unlink(join(dir, "control", "requests", j.id + ".json")).catch(
          () => {},
        );
        await writeFile(
          join(dir, "control", "results", j.id + ".json"),
          JSON.stringify({
            id: j.id,
            requestedBy: actors[0],
            operation,
            state: "completed",
            completedAt: new Date().toISOString(),
            archive: manifest.archiveName,
            archiveSource: "local",
            manifest,
            sha256: digest,
            ...extra,
          }),
        );
        await processBackupResults();
      };
      await respond(job, "backup");
      const download = await call(
        "/admin/backups/archives/" + job.archiveId + "/download",
        tokens.admin,
      );
      assert.equal(download.status, 200);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
      assert.equal(
        (
          await call(
            "/admin/backups/archives/" + job.archiveId + "/download",
            tokens.employee,
          )
        ).status,
        403,
      );
      assert.equal(
        (await call("/admin/backups/restore-checks", tokens.employee)).status,
        403,
      );
      const drillResponse = await call(
        "/admin/backups/restore-checks",
        tokens.admin,
        {
          archiveId: job.archiveId,
          source: "local",
          recoverySecret: recovery.passphrase,
        },
      );
      assert.equal(drillResponse.status, 201);
      const drill = (await drillResponse.json()) as any;
      const recordBody = {
        version: drill.version,
        taskChecked: true,
        fileChecked: true,
        taskReference: "Testtaak pomp 2",
        fileReference: "pomp-controle.jpg",
        notes: "Beheerder bevestigt aparte testinstallatie",
      };
      assert.equal(
        (
          await call(
            "/admin/backups/restore-checks/" + drill.id + "/record",
            tokens.admin,
            recordBody,
          )
        ).status,
        400,
        "no operator record before successful technical check",
      );
      await respond({ id: drill.jobId }, "restore_preview", {
        previewId: drill.jobId,
      });
      const technical = (await (
        await call("/admin/backups/restore-checks", tokens.admin)
      ).json()) as any[];
      const technicalRow = technical.find((row) => row.id === drill.id);
      assert.equal(technicalRow.technicalState, "completed");
      assert.equal(
        technicalRow.recordedAt,
        null,
        "technical preview alone is not a recorded restore proof",
      );
      assert.equal(technicalRow.canRecord, true);
      assert.equal(
        (
          await call(
            "/admin/backups/restore-checks/" + drill.id + "/record",
            tokens.admin,
            { ...recordBody, fileChecked: false },
          )
        ).status,
        400,
      );
      const recordedResponse = await call(
        "/admin/backups/restore-checks/" + drill.id + "/record",
        tokens.admin,
        recordBody,
      );
      assert.equal(recordedResponse.status, 201);
      const recorded = (await recordedResponse.json()) as any;
      assert.ok(recorded.recordedAt);
      assert.equal(recorded.productionRestorePerformed, false);
      assert.equal(
        (
          await call(
            "/admin/backups/restore-checks/" + drill.id + "/record",
            tokens.admin,
            recordBody,
          )
        ).status,
        201,
        "same record retry is idempotent",
      );
      assert.equal(
        (
          await call(
            "/admin/backups/restore-checks/" + drill.id + "/record",
            tokens.admin,
            { ...recordBody, taskReference: "Andere taak" },
          )
        ).status,
        409,
        "immutable audit record",
      );
      const proofAudit = await query(
        "SELECT * FROM audit_events WHERE entity_type='backup_check' AND entity_id=$1 AND action='operator_checks_recorded'",
        [drill.id],
      );
      assert.equal(proofAudit.length, 1);
      assert.equal(proofAudit[0].details.productionRestorePerformed, false);
      assert.equal(
        (
          await query(
            "SELECT id FROM backup_jobs WHERE operation='restore' AND requested_by=$1",
            [actors[0]],
          )
        ).length,
        0,
        "periodic checks do not queue a destructive restore",
      );
      assert.equal(
        (
          await call("/admin/backups/restore-preview", tokens.admin, {
            archiveId: job.archiveId,
            source: "local",
          })
        ).status,
        400,
      );
      const previewResponse = await call(
        "/admin/backups/restore-preview",
        tokens.admin,
        {
          archiveId: job.archiveId,
          source: "local",
          recoverySecret: recovery.passphrase,
        },
      );
      assert.equal(previewResponse.status, 201);
      const preview = (await previewResponse.json()) as any;
      await respond(preview, "restore_preview", { previewId: preview.id });
      assert.equal(
        (
          await call("/admin/backups/restore", tokens.admin, {
            previewId: preview.id,
            recoverySecret: recovery.passphrase,
            confirm: "yes",
          })
        ).status,
        400,
      );
      const restoredResponse = await call(
        "/admin/backups/restore",
        tokens.admin,
        {
          previewId: preview.id,
          recoverySecret: recovery.passphrase,
          confirm: "HERSTEL " + job.archiveId,
        },
      );
      assert.equal(restoredResponse.status, 201);
      const restored = (await restoredResponse.json()) as any;
      const restoreRequest = JSON.parse(
        await readFile(
          join(dir, "control", "requests", restored.id + ".json"),
          "utf8",
        ),
      );
      assert.equal(restoreRequest.previewId, preview.id);
      assert.equal(restoreRequest.expectedSha256, digest);
      assert.equal(restoreRequest.archiveSource, "local");
      // A restored snapshot may contain an orphan running source job but no restore-job row.
      await query("DELETE FROM backup_jobs WHERE id=$1", [restored.id]);
      await unlink(join(dir, "control", "results", job.id + ".json"));
      await query("UPDATE backup_jobs SET state='running' WHERE id=$1", [
        job.id,
      ]);
      await respond(restored, "restore");
      assert.equal(
        (
          await query("SELECT state FROM backup_jobs WHERE id=$1", [
            restored.id,
          ])
        )[0].state,
        "completed",
      );
      assert.equal(
        (await query("SELECT state FROM backup_jobs WHERE id=$1", [job.id]))[0]
          .state,
        "failed",
      );
      const remote = await call(
        "/admin/backups/restore-preview",
        tokens.admin,
        {
          archiveId: randomUUID(),
          source: "onedrive",
          recoverySecret: recovery.passphrase,
        },
      );
      assert.equal(remote.status, 201);
      const remoteJob = (await remote.json()) as any;
      assert.equal(remoteJob.state, "preparing");
      assert.equal(
        JSON.stringify(remoteJob).includes(recovery.passphrase),
        false,
      );
      const preparation = (
        await query("SELECT preparation FROM backup_jobs WHERE id=$1", [
          remoteJob.id,
        ])
      )[0].preparation;
      assert.ok(preparation.recoverySecret);
      assert.equal(
        JSON.stringify(preparation).includes(recovery.passphrase),
        false,
      );
      await query(
        "UPDATE backup_jobs SET state='failed',preparation=NULL,error='Test finished' WHERE id=$1",
        [remoteJob.id],
      );
    } finally {
      await query(
        "DELETE FROM backup_restore_checks WHERE requested_by=ANY($1::uuid[])",
        [actors],
      );
      await query(
        "DELETE FROM backup_archives WHERE id IN (SELECT archive_id FROM backup_jobs WHERE requested_by=ANY($1::uuid[]))",
        [actors],
      );
      await query(
        "DELETE FROM backup_jobs WHERE requested_by=ANY($1::uuid[])",
        [actors],
      );
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
