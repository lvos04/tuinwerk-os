// Isolated runtime acceptance: first-admin setup, encrypted settings, queued full backup/restore.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const [phase, container, url, stateFile] = process.argv.slice(2);
const source = {
    email: "restore@example.test",
    password: "restore-test-password-0001",
  },
  temporary = {
    email: "temporary@example.test",
    password: "temporary-test-password-0001",
  };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let token;
async function api(p, body, method = "GET") {
  const r = await fetch(url + "/api" + p, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let b;
  try {
    b = await r.json();
  } catch {
    b = {};
  }
  if (!r.ok)
    throw Object.assign(Error(p + ": " + JSON.stringify(b)), {
      status: r.status,
    });
  return b;
}
async function login(credentials) {
  token = (await api("/auth/login", credentials, "POST")).token;
}
async function setup(credentials) {
  for (let i = 0; i < 60; i++) {
    try {
      await api("/health");
      break;
    } catch {
      await pause(500);
    }
  }
  if (!(await api("/setup")).required) {
    await login(credentials);
    return;
  }
  const lines = execFileSync("docker", ["logs", container], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).split("\n");
  const record = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((x) => x?.event === "initial_setup_code");
  assert.ok(record?.setupCode, "initial code must be available in owner logs");
  await api(
    "/setup",
    {
      ...credentials,
      name: "Herstelproef",
      setupCode: record.setupCode,
      companyName: "Kas herstelproef",
    },
    "POST",
  );
  await login(credentials);
  assert.equal((await api("/setup")).required, false);
}
async function waitJob(id, credentials) {
  for (let i = 0; i < 180; i++) {
    try {
      const job = await api("/admin/backups/jobs/" + id);
      if (["completed", "failed"].includes(job.state)) return job;
    } catch (e) {
      if (e.status === 401 && credentials) {
        try {
          await login(credentials);
        } catch {}
      }
    }
    await pause(500);
  }
  throw Error("Job timeout");
}
function secretHash() {
  return execFileSync(
    "docker",
    [
      "exec",
      "-u",
      "node",
      container,
      "node",
      "-e",
      "const s=require('/app/api/dist/settings');s.readSecret('smtpPassword').then(v=>{console.log(require('crypto').createHash('sha256').update(v||'').digest('hex'));process.exit(0)}).catch(()=>process.exit(1));",
    ],
    { encoding: "utf8" },
  ).trim();
}
if (phase === "source") {
  await setup(source);
  const settings = await api("/settings");
  const secret = "runtime-restore-secret-" + Date.now();
  await api(
    "/settings",
    {
      version: settings.version,
      values: { companyName: "Herstelde tuin", recurrenceLookaheadDays: 42 },
      secrets: { smtpPassword: secret },
    },
    "PATCH",
  );
  const recovery = await api("/admin/backups/recovery-key", {}, "POST");
  const config = (await api("/admin/backups/status")).config;
  await api(
    "/admin/backups/config",
    {
      version: config.version,
      backupPassphrase: recovery.passphrase,
      recoveryConfirmed: true,
      backupEnabled: false,
      backupRetentionDays: 30,
    },
    "PUT",
  );
  execFileSync(
    process.execPath,
    ["scripts/runtime-smoke.mjs", "seed", url, stateFile + ".records"],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        TEST_ADMIN_EMAIL: source.email,
        TEST_ADMIN_PASSWORD: source.password,
      },
    },
  );
  const expectedSecretHash = createHash("sha256").update(secret).digest("hex");
  assert.equal(secretHash(), expectedSecretHash);
  const keyHash = execFileSync(
    "docker",
    ["exec", container, "sha256sum", "/data/config/settings.key"],
    { encoding: "utf8" },
  ).split(" ")[0];
  const created = await api("/admin/backups", {}, "POST");
  const job = await waitJob(created.id, source);
  assert.equal(job.state, "completed", JSON.stringify(job));
  assert.equal(job.result.manifest.encryption, "aes-256-gcm+scrypt");
  assert.ok(job.result.manifest.contents.includes("config"));
  await writeFile(
    stateFile,
    JSON.stringify({
      archiveId: job.archiveId,
      recoverySecret: recovery.passphrase,
      expectedSecretHash,
      keyHash,
    }),
    { mode: 0o600 },
  );
  const download = await fetch(
    url + "/api/admin/backups/archives/" + job.archiveId + "/download",
    { headers: { Authorization: "Bearer " + token } },
  );
  assert.ok(download.ok);
  await writeFile(
    stateFile + ".archive",
    Buffer.from(await download.arrayBuffer()),
    { mode: 0o600 },
  );
  console.log("UI API setup + settings + full encrypted backup passed.");
} else if (phase === "verify") {
  const expected = JSON.parse(await readFile(stateFile, "utf8"));
  await login(source);
  assert.equal((await api("/settings")).values.companyName, "Herstelde tuin");
  assert.equal(secretHash(), expected.expectedSecretHash);
  assert.equal(
    execFileSync(
      "docker",
      ["exec", container, "sha256sum", "/data/config/settings.key"],
      { encoding: "utf8" },
    ).split(" ")[0],
    expected.keyHash,
  );
  execFileSync(
    process.execPath,
    ["scripts/runtime-smoke.mjs", "verify", url, stateFile + ".records"],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        TEST_ADMIN_EMAIL: source.email,
        TEST_ADMIN_PASSWORD: source.password,
      },
    },
  );
  assert.equal((await api("/admin/backups/status")).activeJob, null);
  const repeat = await api("/admin/backups", {}, "POST");
  assert.equal((await waitJob(repeat.id, source)).state, "completed");
  console.log(
    "Fresh restore verified: settings key + secret decrypt, original records and repeat backup.",
  );
} else if (phase === "restore") {
  const expected = JSON.parse(await readFile(stateFile, "utf8"));
  await setup(temporary);
  const form = new FormData();
  form.set(
    "file",
    new Blob([await readFile(stateFile + ".archive")]),
    expected.archiveId + ".twb",
  );
  const upload = await fetch(url + "/api/admin/backups/archives/upload", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form,
  });
  assert.ok(upload.ok, await upload.text());
  const wrong = await api(
    "/admin/backups/restore-preview",
    {
      archiveId: expected.archiveId,
      source: "local",
      recoverySecret: "wrong-but-long-recovery-code",
    },
    "POST",
  );
  assert.equal((await waitJob(wrong.id, temporary)).state, "failed");
  assert.equal((await api("/auth/me")).email, temporary.email);
  const preview = await api(
    "/admin/backups/restore-preview",
    {
      archiveId: expected.archiveId,
      source: "local",
      recoverySecret: expected.recoverySecret,
    },
    "POST",
  );
  const checked = await waitJob(preview.id, temporary);
  assert.equal(checked.state, "completed", JSON.stringify(checked));
  assert.equal(checked.result.archiveSource, "upload");
  const restore = await api(
    "/admin/backups/restore",
    {
      previewId: preview.id,
      recoverySecret: expected.recoverySecret,
      confirm: "HERSTEL " + expected.archiveId,
    },
    "POST",
  );
  const done = await waitJob(restore.id, source);
  assert.equal(done.state, "completed", JSON.stringify(done));
  await login(source);
  assert.equal((await api("/settings")).values.companyName, "Herstelde tuin");
  assert.equal(secretHash(), expected.expectedSecretHash);
  assert.equal(
    execFileSync(
      "docker",
      ["exec", container, "sha256sum", "/data/config/settings.key"],
      { encoding: "utf8" },
    ).split(" ")[0],
    expected.keyHash,
  );
  execFileSync(
    process.execPath,
    ["scripts/runtime-smoke.mjs", "verify", url, stateFile + ".records"],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        TEST_ADMIN_EMAIL: source.email,
        TEST_ADMIN_PASSWORD: source.password,
      },
    },
  );
  assert.equal((await api("/admin/backups/status")).activeJob, null);
  const repeat = await api("/admin/backups", {}, "POST");
  assert.equal((await waitJob(repeat.id, source)).state, "completed");
  console.log(
    "Fresh UI restore passed: bad key rejected, original settings key+secret decrypt, photo/task/stock/recurrence verified, next backup works.",
  );
} else throw Error("Usage: source|restore CONTAINER URL /tmp/state.json");
