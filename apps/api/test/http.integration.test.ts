import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query } from "../src/db";
import { passwordHash } from "../src/auth";
import { createApp } from "../src/main";
after(() => pool.end());
test(
  "HTTP auth, employee permissions, idempotent media and revoked sessions",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    try {
      const base = await app.getUrl();
      const email = randomUUID() + "@http.test";
      await query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4)",
        [email, "HTTP test", passwordHash("HttpPassword123!"), "employee"],
      );
      const call = (
        path: string,
        token?: string,
        body?: any,
        method?: string,
      ) =>
        fetch(base + "/api" + path, {
          method: method || (body ? "POST" : "GET"),
          headers: {
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      assert.equal((await call("/tasks")).status, 401);
      const login = await call("/auth/login", undefined, {
        email,
        password: "HttpPassword123!",
      });
      assert.equal(login.status, 201);
      const { token, refreshToken } = (await login.json()) as any;
      assert.equal(
        (
          await call("/users", token, {
            email: "evil@test.invalid",
            name: "Admin",
            password: "Password123456!",
            role: "admin",
          })
        ).status,
        403,
      );
      const created = await call("/tasks", token, {
        title: "Foto taak",
        operationId: randomUUID(),
      });
      assert.equal(created.status, 201);
      const task = (await created.json()) as any;
      const op = randomUUID();
      const upload = async (bytes: number[], name: string) => {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(bytes)]), name);
        form.append("taskId", task.id);
        form.append("operationId", op);
        return fetch(base + "/api/attachments", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: form,
        });
      };
      assert.equal(
        (await upload([60, 115, 99, 114, 105, 112, 116, 62], "evil.jpg"))
          .status,
        400,
      );
      const a = await upload([255, 216, 255, 224, 0, 0], "foto.jpg");
      assert.equal(a.status, 201);
      const one = (await a.json()) as any;
      const b = await upload([255, 216, 255, 224, 0, 0], "foto.jpg");
      assert.equal(((await b.json()) as any).id, one.id);
      assert.equal(
        (await call("/attachments/" + one.id + "/file")).status,
        401,
      );
      const refresh = await call("/auth/refresh", undefined, { refreshToken });
      assert.equal(refresh.status, 201);
      assert.equal((await call("/tasks", token)).status, 401);
      assert.equal(
        (await call("/auth/refresh", undefined, { refreshToken })).status,
        401,
      );
    } finally {
      await app.close();
    }
  },
);
test(
  "admin MFA requires confirmation, rejects missing OTP, consumes recovery codes once",
  { skip: !process.env.DATABASE_URL },
  async () => {
    process.env.TOTP_ENCRYPTION_KEY = "a".repeat(64);
    const { totp } = await import("../src/totp");
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    try {
      const base = await app.getUrl(),
        email = randomUUID() + "@mfa.test";
      await query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4)",
        [email, "MFA test", passwordHash("MfaPassword123!"), "admin"],
      );
      const call = (path: string, body: any, token?: string) =>
        fetch(base + "/api" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: JSON.stringify(body),
        });
      const { token } = (await (
        await call("/auth/login", { email, password: "MfaPassword123!" })
      ).json()) as any;
      const setup = (await (
        await call("/auth/mfa/setup", { password: "MfaPassword123!" }, token)
      ).json()) as any;
      assert.ok(setup.secret);
      const before = await call("/auth/login", {
        email,
        password: "MfaPassword123!",
      });
      assert.equal(before.status, 201);
      const enabled = await call(
        "/auth/mfa/enable",
        { otp: totp(setup.secret) },
        token,
      );
      assert.equal(enabled.status, 201);
      const { recoveryCodes } = (await enabled.json()) as any;
      assert.equal(recoveryCodes.length, 10);
      const missing = await call("/auth/login", {
        email,
        password: "MfaPassword123!",
      });
      assert.equal(missing.status, 401);
      assert.equal(((await missing.json()) as any).mfaRequired, true);
      assert.equal(
        (
          await call("/auth/login", {
            email,
            password: "MfaPassword123!",
            otp: recoveryCodes[0],
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await call("/auth/login", {
            email,
            password: "MfaPassword123!",
            otp: recoveryCodes[0],
          })
        ).status,
        401,
      );
    } finally {
      await app.close();
    }
  },
);
