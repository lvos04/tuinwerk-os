const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process"),
  path = require("node:path");
const root = path.resolve(__dirname, "../.."),
  script = path.join(root, "scripts/mobile-release.mjs");
test("release diagnostics validate source configuration without exposing an available token", () => {
  const marker = "private-token-do-not-print";
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, EXPO_TOKEN: marker },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.configurationValid, true);
  assert.equal(result.stdout.includes(marker), false);
  assert.equal(result.stderr.includes(marker), false);
});
test("store gate rejects localhost/insecure policy and review endpoints", () => {
  const result = spawnSync(process.execPath, [script, "--require-store"], {
    cwd: root,
    env: {
      ...process.env,
      TUINWERK_PRIVACY_URL: "http://localhost/privacy",
      TUINWERK_SUPPORT_URL: "http://127.0.0.1/support",
      TUINWERK_ACCOUNT_DELETION_URL: "https://example.com/delete",
      TUINWERK_REVIEW_SERVER_URL: "https://10.1.2.3",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.storeReady, false);
  assert.ok(
    report.checks.some(
      (c) => c.name === "privacyPolicyUrl reachable" && c.status === "blocked",
    ),
  );
  assert.ok(
    report.checks.some(
      (c) =>
        c.name === "Review server public settings ready" &&
        c.status === "blocked",
    ),
  );
});
test("unexecuted device template is never accepted as 24-hour hardware evidence", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts/check-device-acceptance.mjs"),
      path.join(root, "docs/acceptance/mobile-session.template.json"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.consistent, false);
  assert.equal(report.hardwareExecutionIndependentlyVerified, false);
  assert.ok(report.issues.some((i) => i.includes("24 actual hours")));
});
