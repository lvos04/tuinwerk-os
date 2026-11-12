import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { migrate } from "../src/migrate";
import { createApp } from "../src/main";
import { query, pool } from "../src/db";
import { readSecret, writeSetting } from "../src/settings";
import {
  OneDriveController,
  uploadOneDriveBackup,
  downloadOneDriveBackup,
  listOneDriveBackups,
  OneDriveManifest,
  probeOneDrive,
  getOneDriveHealth,
} from "../src/onedrive";
const response = (value: any, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const realFetch = global.fetch;
const api = new OneDriveController();
const uid = randomUUID(),
  clientId = randomUUID(),
  backupId = randomUUID();
const user = {
  id: uid,
  email: "onedrive@test.local",
  name: "OneDrive test",
  role: "admin" as const,
};
const chunk = 320 * 1024 * 10;
const contents = Buffer.alloc(chunk * 2 + 17, 7);
const manifest: OneDriveManifest = {
  format: "tuinwerk-backup-v2",
  manifestVersion: 1,
  id: backupId,
  archiveName: backupId + ".twb",
  createdAt: new Date().toISOString(),
  size: contents.length,
  sha256: createHash("sha256").update(contents).digest("hex"),
  encryption: "aes-256-gcm+scrypt",
  contents: ["database", "uploads", "exports", "config"],
  appVersion: "0.2.0",
};
let probeBody = "",
  probeCreates = 0,
  probeDeletes = 0,
  badProbe = false;
let authorization = "pending",
  tokenCalls = 0,
  uploaded = 0,
  createSessions = 0,
  storedManifest: any,
  tamper = false,
  oversized = false,
  cancelledOversized = false;
const ranges: string[] = [];
const transferred: Buffer[] = [];
let abortAfterFirst: AbortController | undefined;
let waitingToken: ((value: Response) => void) | undefined;
global.fetch = (async (input: any, init: RequestInit = {}) => {
  const url = String(input);
  const headers = new Headers(init.headers);
  const method = init.method || "GET";
  if (
    url.includes("login.microsoftonline.com") &&
    url.endsWith("/devicecode")
  ) {
    const params = new URLSearchParams(String(init.body));
    assert.equal(
      params.get("scope"),
      "offline_access Files.ReadWrite.AppFolder",
    );
    return response({
      device_code: "PRIVATE_DEVICE_CODE",
      user_code: "ABCD-EFGH",
      verification_uri: "https://microsoft.com/devicelogin",
      expires_in: 900,
      interval: 5,
    });
  }
  if (url.includes("login.microsoftonline.com") && url.endsWith("/token")) {
    tokenCalls++;
    if (authorization === "waiting")
      return new Promise<Response>((r) => {
        waitingToken = r;
      });
    if (authorization === "pending")
      return response({ error: "authorization_pending" }, 400);
    if (authorization === "slow") return response({ error: "slow_down" }, 400);
    return response({
      access_token: "PRIVATE_ACCESS_TOKEN",
      refresh_token: "PRIVATE_REFRESH_TOKEN",
      expires_in: 3600,
    });
  }
  if (url === "https://graph.microsoft.com/v1.0/me/drive/special/approot") {
    assert.equal(headers.get("authorization"), "Bearer PRIVATE_ACCESS_TOKEN");
    return response({
      id: "app-root",
      folder: {},
      parentReference: { driveId: "drive-id", driveType: "personal" },
    });
  }
  if (url.includes("graph.microsoft.com") && url.includes("/items/app-root:/"))
    return response({ id: "backup-folder", folder: {} });
  if (url.includes("graph.microsoft.com") && url.includes("tuinwerk-probe-")) {
    if (method === "PUT") {
      probeCreates++;
      probeBody = String(init.body);
      return response({ id: "probe-item" }, 201);
    }
    if (method === "DELETE") {
      probeDeletes++;
      return new Response(null, { status: 204 });
    }
    return new Response(badProbe ? "wrong" : probeBody);
  }
  if (
    url === "https://graph.microsoft.com/v1.0/me/drive/items/probe-item" &&
    method === "DELETE"
  ) {
    probeDeletes++;
    return new Response(null, { status: 204 });
  }
  if (
    url.includes("graph.microsoft.com") &&
    url.endsWith("/createUploadSession")
  ) {
    createSessions++;
    assert.equal(headers.get("authorization"), "Bearer PRIVATE_ACCESS_TOKEN");
    return response({
      uploadUrl: "https://mock.up.1drv.com/upload?secret=PRIVATE_SESSION",
      expirationDateTime: new Date(Date.now() + 3600000).toISOString(),
    });
  }
  if (url.startsWith("https://mock.up.1drv.com/upload")) {
    assert.equal(headers.has("authorization"), false);
    if (method === "GET")
      return response({ nextExpectedRanges: [`${uploaded}-`] });
    const range = headers.get("content-range")!;
    ranges.push(range);
    assert.ok(range.startsWith(`bytes ${uploaded}-`));
    const bytes = Buffer.from(init.body as any);
    transferred.push(bytes);
    uploaded += bytes.length;
    if (uploaded < contents.length) {
      if (abortAfterFirst) {
        abortAfterFirst.abort();
        abortAfterFirst = undefined;
      }
      return response({ nextExpectedRanges: [`${uploaded}-`] }, 202);
    }
    return response({ id: "remote-archive", size: uploaded }, 201);
  }
  if (
    url.includes("graph.microsoft.com") &&
    url.includes(".manifest.json:/content")
  ) {
    if (method === "PUT") {
      storedManifest = JSON.parse(String(init.body));
      return response({ id: "remote-manifest" }, 201);
    }
    return new Response(null, {
      status: 302,
      headers: { location: "https://mock.files.1drv.com/manifest" },
    });
  }
  if (url === "https://mock.files.1drv.com/manifest") {
    assert.equal(headers.has("authorization"), false);
    if (oversized)
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(40000));
          },
          cancel() {
            cancelledOversized = true;
          },
        }),
      );
    return response(storedManifest);
  }
  if (url.includes("graph.microsoft.com") && url.includes(".twb:/content"))
    return new Response(null, {
      status: 302,
      headers: { location: "https://mock.files.1drv.com/archive" },
    });
  if (url === "https://mock.files.1drv.com/archive") {
    assert.equal(headers.has("authorization"), false);
    return new Response(tamper ? Buffer.alloc(contents.length, 8) : contents, {
      headers: { "content-length": String(contents.length) },
    });
  }
  if (url.includes("graph.microsoft.com") && url.includes("/children?"))
    return response({
      value: [
        { id: "remote-manifest", name: backupId + ".manifest.json", size: 500 },
        { id: "foreign", name: "family-photo.jpg", size: 30 },
      ],
    });
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
  throw new Error(
    "Unexpected mocked endpoint: " +
      new URL(url).origin +
      new URL(url).pathname,
  );
}) as typeof fetch;
async function main() {
  try {
    await migrate();
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [uid, user.email, user.name, "test-only", user.role],
    );
    await api.configure(user, {
      clientId,
      tenant: "consumers",
      folder: "TuinWerk Backups",
    });
    const start = await api.connect(user);
    assert.equal(start.userCode, "ABCD-EFGH");
    assert.equal(JSON.stringify(start).includes("PRIVATE"), false);
    const stored = (
      await query<any>("SELECT * FROM onedrive_device_flows WHERE id=$1", [
        start.id,
      ])
    )[0];
    assert.notEqual(stored.device_code, "PRIVATE_DEVICE_CODE");
    assert.match(stored.device_code, /^v1\./);
    assert.equal((await api.poll(user, start.id)).status, "pending");
    assert.equal(tokenCalls, 0);
    await query(
      "UPDATE onedrive_device_flows SET next_poll_at=now() WHERE id=$1",
      [start.id],
    );
    assert.equal((await api.poll(user, start.id)).status, "pending");
    assert.equal(tokenCalls, 1);
    authorization = "slow";
    await query(
      "UPDATE onedrive_device_flows SET next_poll_at=now() WHERE id=$1",
      [start.id],
    );
    assert.equal((await api.poll(user, start.id)).interval, 10);
    authorization = "connected";
    await query(
      "UPDATE onedrive_device_flows SET next_poll_at=now() WHERE id=$1",
      [start.id],
    );
    assert.equal((await api.poll(user, start.id)).status, "connected");
    assert.equal((await api.status()).connected, true);
    assert.equal(
      await readSecret("oneDriveRefreshToken"),
      "PRIVATE_REFRESH_TOKEN",
    );
    const secrets = (
      await query<any>("SELECT secrets FROM system_settings WHERE id=1")
    )[0].secrets;
    assert.ok(!JSON.stringify(secrets).includes("PRIVATE_REFRESH_TOKEN"));
    await probeOneDrive();
    assert.equal(probeCreates, 1);
    assert.equal(probeDeletes, 1);
    badProbe = true;
    await assert.rejects(() => probeOneDrive());
    assert.equal(probeCreates, 2);
    assert.equal(probeDeletes, 2);
    badProbe = false;
    const path = join(process.env.ONEDRIVE_TEST_DIR!, manifest.archiveName);
    await writeFile(path, contents);
    const abort = new AbortController();
    abortAfterFirst = abort;
    await assert.rejects(() =>
      uploadOneDriveBackup({
        archivePath: path,
        manifest,
        signal: abort.signal,
      }),
    );
    assert.equal(uploaded, chunk);
    const [failed] = await query<any>(
      "SELECT * FROM onedrive_transfers WHERE backup_id=$1 AND direction='upload'",
      [backupId],
    );
    assert.equal(failed.state, "failed");
    assert.ok(
      failed.upload_session &&
        !failed.upload_session.includes("PRIVATE_SESSION"),
    );
    const upload = await uploadOneDriveBackup({ archivePath: path, manifest });
    assert.equal(upload.remoteId, "remote-archive");
    assert.equal(createSessions, 1);
    assert.equal(ranges.length, 3);
    assert.deepEqual(Buffer.concat(transferred), contents);
    assert.deepEqual(storedManifest, manifest);
    assert.equal(
      JSON.stringify(await api.transfers()).includes("uploadSession"),
      false,
    );
    assert.deepEqual(await listOneDriveBackups(), [manifest]);
    oversized = true;
    await assert.rejects(() => listOneDriveBackups(), /te groot/);
    assert.equal(cancelledOversized, true);
    oversized = false;
    const destination = join(
      process.env.ONEDRIVE_TEST_DIR!,
      "restore",
      manifest.archiveName,
    );
    await downloadOneDriveBackup(backupId, destination);
    assert.deepEqual(await readFile(destination), contents);
    tamper = true;
    await assert.rejects(
      () =>
        downloadOneDriveBackup(
          backupId,
          join(process.env.ONEDRIVE_TEST_DIR!, "bad", manifest.archiveName),
        ),
      /controlehash/,
    );
    await assert.rejects(() =>
      stat(join(process.env.ONEDRIVE_TEST_DIR!, "bad", manifest.archiveName)),
    );
    tamper = false;
    await writeSetting("oneDriveClientId", randomUUID());
    assert.equal((await api.status()).connected, false);
    await assert.rejects(() => listOneDriveBackups(), /opnieuw/);
    await writeSetting("oneDriveClientId", clientId);
    const configA = {
        clientId: randomUUID(),
        tenant: "consumers",
        folder: "A",
      },
      configB = {
        clientId: randomUUID(),
        tenant: "organizations",
        folder: "B",
      };
    await Promise.all([
      api.configure(user, configA),
      api.configure(user, configB),
    ]);
    const finalConfig = await api.status();
    assert.ok(
      [configA, configB].some(
        (expected) =>
          expected.clientId === finalConfig.clientId &&
          expected.tenant === finalConfig.tenant &&
          expected.folder === finalConfig.folder,
      ),
    );
    await api.configure(user, {
      clientId,
      tenant: "consumers",
      folder: "TuinWerk Backups",
    });
    const concurrent = await api.connect(user);
    await query(
      "UPDATE onedrive_device_flows SET next_poll_at=now() WHERE id=$1",
      [concurrent.id],
    );
    authorization = "waiting";
    const polling = api.poll(user, concurrent.id);
    while (!waitingToken) await new Promise((r) => setTimeout(r, 5));
    const disconnecting = api.disconnect(user);
    waitingToken!(
      response({
        access_token: "PRIVATE_ACCESS_TOKEN",
        refresh_token: "NEW_REFRESH_TOKEN",
        expires_in: 3600,
      }),
    );
    await polling;
    await disconnecting;
    assert.equal(await readSecret("oneDriveRefreshToken"), undefined);
    assert.equal((await api.status()).connected, false);
    assert.equal((await query("SELECT * FROM onedrive_connection")).length, 0);
    const employeeId = randomUUID(),
      adminToken = randomUUID(),
      employeeToken = randomUUID();
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'employee@test.local','Employee','test-only','employee')",
      [employeeId],
    );
    for (const [userId, token] of [
      [uid, adminToken],
      [employeeId, employeeToken],
    ])
      await query(
        "INSERT INTO sessions(user_id,token_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,now()+interval '1 hour',now()+interval '1 day')",
        [
          userId,
          createHash("sha256").update(token).digest("hex"),
          randomUUID(),
        ],
      );
    const app = await createApp();
    try {
      await app.listen(0, "127.0.0.1");
      const url = await app.getUrl();
      assert.equal(
        (await fetch(url + "/api/admin/onedrive/status")).status,
        401,
      );
      assert.equal(
        (
          await fetch(url + "/api/admin/onedrive/status", {
            headers: { Authorization: "Bearer " + employeeToken },
          })
        ).status,
        403,
      );
      const allowed = await fetch(url + "/api/admin/onedrive/status", {
        headers: { Authorization: "Bearer " + adminToken },
      });
      assert.equal(allowed.status, 200);
      assert.equal((await allowed.text()).includes("PRIVATE"), false);
    } finally {
      await app.close();
    }
    console.log("ONEDRIVE_SCENARIO_OK");
  } finally {
    global.fetch = realFetch;
    await pool.end();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
