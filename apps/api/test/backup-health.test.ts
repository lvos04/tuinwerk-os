import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessBackupHealth } from "../src/backups";
const now = new Date("2027-01-10T12:00:00Z");
const healthy = () => ({
  config: {
    backupEnabled: true,
    backupOneDriveEnabled: true,
    backupRestoreCheckEnabled: true,
    backupRestoreCheckIntervalDays: 90,
  },
  helper: { available: true },
  lastLocalSuccess: "2027-01-10T02:00:00Z",
  lastJob: { state: "completed", remoteState: "completed" },
  lastCheck: { recordedAt: "2027-01-01T12:00:00Z" },
  cloud: {
    connected: true,
    reauthenticationRequired: false,
    lastSuccessfulTransfer: "2027-01-10T03:00:00Z",
  },
  storage: [
    {
      scope: "archives",
      availableBytes: 10 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
    },
  ],
});
test("Backup health uses successful local/cloud timestamps and states exact next review date", () => {
  const h = assessBackupHealth(healthy(), now);
  assert.deepEqual(h.alerts, []);
  assert.equal(h.lastLocalSuccess, "2027-01-10T02:00:00Z");
  assert.equal(h.lastCloudSuccess, "2027-01-10T03:00:00Z");
  assert.equal(h.restoreCheck.dueAt, "2027-04-01T12:00:00.000Z");
  assert.equal(h.restoreCheck.due, false);
});
test("Backup health distinguishes failed attempts, expired permissions, overdue copies, disk pressure and due checks", () => {
  const input: any = healthy();
  input.helper.available = false;
  input.lastLocalSuccess = "2027-01-08T00:00:00Z";
  input.lastJob = {
    state: "failed",
    error: "Geen ruimte",
    remoteState: "failed",
  };
  input.cloud = {
    connected: true,
    reauthenticationRequired: true,
    lastSuccessfulTransfer: null,
  };
  input.lastCheck = null;
  input.storage = [
    { scope: "archives", availableBytes: 100, totalBytes: 10000 },
    { scope: "work", availableBytes: null, totalBytes: null },
  ];
  const h = assessBackupHealth(input, now);
  const codes = h.alerts.map((a: any) => a.code);
  for (const key of [
    "helper_unavailable",
    "local_overdue",
    "backup_failed",
    "cloud_permission_expired",
    "cloud_overdue",
    "cloud_upload_failed",
    "low_space_archives",
    "restore_check_due",
  ])
    assert.ok(codes.includes(key));
  assert.ok(
    !codes.includes("low_space_work"),
    "unmeasured capacity is not reported as low",
  );
  assert.equal(
    h.lastLocalSuccess,
    input.lastLocalSuccess,
    "failed latest attempt must not overwrite last success",
  );
  assert.equal(h.restoreCheck.lastRecordedAt, null);
  assert.ok(h.alerts.every((a: any) => a.action));
  assert.equal(h.cloud.quota, undefined, "no fabricated cloud quota");
});
test("Disabling reminder suppresses due alert while preserving recorded history", () => {
  const input: any = healthy();
  input.config.backupRestoreCheckEnabled = false;
  input.lastCheck = { recordedAt: "2020-01-01T00:00:00Z" };
  const h = assessBackupHealth(input, now);
  assert.equal(h.restoreCheck.due, false);
  assert.equal(h.restoreCheck.lastRecordedAt, "2020-01-01T00:00:00Z");
  assert.ok(!h.alerts.some((a: any) => a.code === "restore_check_due"));
});
