import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsPatch, backupSettingsPayload } from "../src/settings-payload";
test("settings patch preserves blank secrets and excludes internal OAuth/backup fields", () => {
  const payload = settingsPatch(
    7,
    { companyName: "Tuin", pushEnabled: true },
    {
      companyName: "Tuin",
      pushEnabled: false,
      backupEnabled: true,
      oneDriveRefreshToken: "must-not-leave-form",
    },
    { smtpPassword: "", aiApiKey: "new-key", oneDriveRefreshToken: "internal" },
    [],
  );
  assert.deepEqual(payload, {
    version: 7,
    values: { pushEnabled: false },
    secrets: { aiApiKey: "new-key" },
    clearSecrets: [],
  });
});
test("explicit secret removal remains separate and cannot overwrite a new secret", () => {
  assert.deepEqual(
    settingsPatch(1, {}, {}, {}, [
      "smtpPassword",
      "smtpPassword",
      "backupPassphrase",
    ]).clearSecrets,
    ["smtpPassword"],
  );
  assert.throws(
    () => settingsPatch(1, {}, {}, { smtpPassword: "new" }, ["smtpPassword"]),
    /tegelijk/,
  );
});
test("recovery setup requires explicit off-device acknowledgement and preserves exact passphrase", () => {
  const config = {
    version: 3,
    backupHour: 2,
    backupRetentionDays: 30,
    backupEnabled: true,
    backupOneDriveEnabled: false,
    appTimezone: "Europe/Amsterdam",
  };
  const passphrase = "  sufficiently long recovery phrase  ";
  assert.throws(
    () => backupSettingsPayload(config, passphrase, false),
    /buiten deze NAS/,
  );
  assert.equal(
    backupSettingsPayload(config, passphrase, true).backupPassphrase,
    passphrase,
  );
  assert.equal(
    "backupPassphrase" in backupSettingsPayload(config, "", false),
    false,
  );
  assert.throws(
    () => backupSettingsPayload({ ...config, backupHour: "" }, "", false),
    /back-uptijd/,
  );
});
