import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { migrate } from "../src/migrate";
import { createApp } from "../src/main";
import { query, pool, transaction } from "../src/db";
import {
  readSecret,
  writeSecret,
  writeSetting,
  settingsSnapshot,
  refreshRuntimeSettings,
  SetupController,
  setupTokenPath,
  settingsKeyPath,
} from "../src/settings";
async function main() {
  if (process.argv[2] === "verify") {
    assert.equal(await readSecret("smtpPassword"), "updated-secret-only");
    const snapshot = await settingsSnapshot();
    assert.equal(snapshot.values.companyName, "Testkas");
    assert.equal(snapshot.values.appUrl, "https://nas.test.invalid");
    await refreshRuntimeSettings();
    assert.equal(process.env.SMTP_PASSWORD, "updated-secret-only");
    console.log("RESTART_OK");
    return;
  }
  if (process.argv[2] === "restart-before-setup") {
    const restarted = await createApp();
    await restarted.close();
    return;
  }
  await migrate();
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  try {
    const base = await app.getUrl();
    const request = async (
      path: string,
      body?: any,
      token?: string,
      method?: string,
    ) =>
      fetch(base + "/api" + path, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    const status = (await (await request("/setup")).json()) as any;
    assert.equal(status.required, true);
    assert.equal(status.requiresSetupCode, true);
    assert.ok(!JSON.stringify(status).includes("integration-setup-code"));
    assert.equal(statSync(settingsKeyPath()).mode & 0o777, 0o600);
    assert.equal(statSync(setupTokenPath()).mode & 0o777, 0o600);
    const originalToken = readFileSync(setupTokenPath(), "utf8");
    const restartLog = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("test/settings-scenario.ts"),
        "restart-before-setup",
      ],
      { env: process.env, encoding: "utf8" },
    );
    assert.ok(restartLog.includes("integration-setup-code"));
    assert.equal(readFileSync(setupTokenPath(), "utf8"), originalToken);
    const setup = new SetupController();
    for (let i = 0; i < 5; i++)
      await assert.rejects(() =>
        setup.setup(
          {
            name: "Admin",
            email: "admin@test.invalid",
            password: "Password123456!",
            setupCode: "bad",
          },
          { ip: "blocked-client" },
        ),
      );
    await assert.rejects(() =>
      setup.setup(
        {
          name: "Admin",
          email: "admin@test.invalid",
          password: "Password123456!",
          setupCode: "integration-setup-code",
        },
        { ip: "blocked-client" },
      ),
    );
    const payload = {
      name: "Admin",
      email: "admin@test.invalid",
      password: "Password123456!",
      setupCode: "integration-setup-code",
      companyName: "Testkas",
      appUrl: "https://nas.test.invalid",
    };
    const results = await Promise.all([
      request("/setup", payload),
      request("/setup", { ...payload, email: "second@test.invalid" }),
    ]);
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal((await query("SELECT * FROM users")).length, 1);
    assert.equal(
      ((await (await request("/setup")).json()) as any).required,
      false,
    );
    await assert.rejects(() =>
      setup.setup(payload, { ip: "different-client" }),
    );
    const [admin] = await query("SELECT * FROM users");
    const login = (await (
      await request("/auth/login", {
        email: admin.email,
        password: payload.password,
      })
    ).json()) as any;
    const token = login.token;
    assert.ok(token);
    const beforeResponse = await request("/settings", undefined, token);
    assert.equal(beforeResponse.headers.get("cache-control"), "no-store");
    const before = (await beforeResponse.json()) as any;
    assert.equal(before.values.appUrl, "https://nas.test.invalid");
    assert.equal(process.env.APP_URL, "https://nas.test.invalid");
    assert.equal(before.configured.smtpPassword, true);
    assert.ok(!JSON.stringify(before).includes("legacy-secret-only"));
    assert.equal(await readSecret("smtpPassword"), "legacy-secret-only");
    const update = await request(
      "/settings",
      {
        version: before.version,
        values: {
          smtpPort: 2525,
          appTimezone: "UTC",
          maxUploadBytes: 2048,
          corsOrigins: ["https://allowed.example"],
        },
        secrets: { smtpPassword: "updated-secret-only" },
      },
      token,
      "PATCH",
    );
    assert.equal(update.status, 200);
    const updated = (await update.json()) as any;
    assert.equal(updated.values.smtpPort, 2525);
    assert.equal(process.env.SMTP_PORT, "2525");
    const cors = await fetch(base + "/api/setup", {
      headers: { Origin: "https://allowed.example" },
    });
    assert.equal(
      cors.headers.get("access-control-allow-origin"),
      "https://allowed.example",
    );
    const deniedCors = await fetch(base + "/api/setup", {
      headers: { Origin: "https://other.example" },
    });
    assert.equal(deniedCors.headers.get("access-control-allow-origin"), null);
    const createdTask = (await (
      await request("/tasks", { title: "Upload limiet" }, token)
    ).json()) as any;
    const form = new FormData();
    form.append("taskId", createdTask.id);
    form.append("file", new Blob([new Uint8Array(3000)]), "large.jpg");
    const upload = await fetch(base + "/api/attachments", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
    });
    assert.equal(upload.status, 413);
    assert.ok(!JSON.stringify(updated).includes("updated-secret-only"));
    assert.equal(
      (
        await request(
          "/settings",
          { version: before.version, values: { companyName: "Old" } },
          token,
          "PATCH",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/settings",
          {
            version: updated.version,
            secrets: { oneDriveRefreshToken: "injected" },
          },
          token,
          "PATCH",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/settings",
          { version: updated.version, values: { backupEnabled: true } },
          token,
          "PATCH",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/settings",
          { version: updated.version, values: { smtpPort: 70000 } },
          token,
          "PATCH",
        )
      ).status,
      400,
    );
    const raw = JSON.stringify(await query("SELECT * FROM system_settings"));
    assert.ok(!raw.includes("updated-secret-only"));
    assert.ok(!raw.includes("legacy-secret-only"));
    const events = JSON.stringify(await query("SELECT * FROM audit_events"));
    assert.ok(!events.includes("updated-secret-only"));
    assert.match(
      execFileSync(
        process.execPath,
        ["--import", "tsx", resolve("test/settings-scenario.ts"), "verify"],
        {
          env: {
            ...process.env,
            SMTP_PASSWORD: undefined,
            TOTP_ENCRYPTION_KEY: undefined,
          },
          encoding: "utf8",
        },
      ),
      /RESTART_OK/,
    );
    await request(
      "/users",
      {
        name: "Employee",
        email: "employee@test.invalid",
        password: "EmployeePassword123!",
        role: "employee",
      },
      token,
    );
    const employee = (await (
      await request("/auth/login", {
        email: "employee@test.invalid",
        password: "EmployeePassword123!",
      })
    ).json()) as any;
    assert.equal(
      (await request("/settings", undefined, employee.token)).status,
      403,
    );
    assert.equal(
      (
        await request(
          "/settings",
          { version: updated.version, values: { companyName: "No" } },
          employee.token,
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal((await request("/settings")).status, 401);
    const cleared = await request(
      "/settings",
      { version: updated.version, clearSecrets: ["smtpPassword"] },
      token,
      "PATCH",
    );
    assert.equal(cleared.status, 200);
    assert.equal(
      ((await cleared.json()) as any).configured.smtpPassword,
      false,
    );
    assert.equal(await readSecret("smtpPassword"), undefined);
    const oldClient = "11111111-1111-4111-8111-111111111111",
      nextClient = "22222222-2222-4222-8222-222222222222";
    await writeSetting("oneDriveClientId", oldClient);
    await writeSecret("oneDriveRefreshToken", "private-refresh");
    await query(
      "INSERT INTO onedrive_connection(id,client_id,tenant,drive_id,drive_type,connected_by,folder_id) VALUES(1,$1,'consumers','drive','personal',$2,'folder')",
      [oldClient, admin.id],
    );
    await query(
      "INSERT INTO onedrive_device_flows(created_by,device_code,client_id,tenant,interval_seconds,expires_at,next_poll_at) VALUES($1,'encrypted-placeholder',$2,'consumers',5,now()+interval '10 minutes',now())",
      [admin.id, oldClient],
    );
    const beforeIdentity = await settingsSnapshot();
    const locker = await pool.connect();
    await locker.query("BEGIN");
    await locker.query(
      "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
    );
    let settled = false;
    const pending = request(
      "/settings",
      {
        version: beforeIdentity.version,
        values: {
          oneDriveClientId: nextClient,
          oneDriveTenantId: "organizations",
        },
      },
      token,
      "PATCH",
    ).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(settled, false);
    assert.equal((await settingsSnapshot()).values.oneDriveClientId, oldClient);
    await locker.query("COMMIT");
    locker.release();
    assert.equal((await pending).status, 200);
    assert.equal(
      (await settingsSnapshot()).values.oneDriveClientId,
      nextClient,
    );
    assert.equal(
      (await settingsSnapshot()).values.oneDriveTenantId,
      "organizations",
    );
    assert.equal(await readSecret("oneDriveRefreshToken"), undefined);
    assert.equal((await query("SELECT * FROM onedrive_connection")).length, 0);
    assert.equal(
      (await query("SELECT status FROM onedrive_device_flows"))[0].status,
      "cancelled",
    );
    await assert.rejects(() =>
      transaction(async (c) => {
        await writeSetting("oneDriveClientId", oldClient, c);
        await writeSetting("oneDriveTenantId", "consumers", c);
        throw new Error("rollback");
      }),
    );
    assert.equal(
      (await settingsSnapshot()).values.oneDriveClientId,
      nextClient,
    );
    assert.equal(
      (await settingsSnapshot()).values.oneDriveTenantId,
      "organizations",
    );
    console.log("SETTINGS_SCENARIO_OK");
  } finally {
    await app.close();
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
