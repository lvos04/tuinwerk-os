import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pool, query } from "../src/db";
import {
  AdminGuard,
  AdminRoleGuard,
  AuthController,
  passwordHash,
  requireRecentReauth,
  resetLoginAttempts,
} from "../src/auth";
import { createApp, trustProxySetting, LARGE_JSON_ROUTES } from "../src/main";
import {
  migrate,
  migrationChecksum,
  migrationOrder,
  HISTORICAL_DUPLICATE_PREFIXES,
} from "../src/migrate";
import { cleanupSessions, resetSessionCleanup } from "../src/session-cleanup";
after(() => pool.end());
const db = { skip: !process.env.DATABASE_URL };

test("TRUST_PROXY wordt veilig vertaald; standaard alleen loopback", () => {
  assert.equal(trustProxySetting(undefined), "loopback");
  assert.equal(trustProxySetting(""), "loopback");
  assert.equal(trustProxySetting("false"), false);
  assert.equal(trustProxySetting("1"), 1);
  assert.equal(trustProxySetting("true"), true);
  assert.deepEqual(trustProxySetting("loopback, 10.0.0.0/8"), [
    "loopback",
    "10.0.0.0/8",
  ]);
  assert.ok(LARGE_JSON_ROUTES.some((r) => r.test("/api/imports/preview")));
  assert.ok(!LARGE_JSON_ROUTES.some((r) => r.test("/api/tasks")));
});

test("migraties: vaste volgorde-regel en alleen historische dubbele nummers", () => {
  const names = migrationOrder(
    readdirSync(resolve(__dirname, "../migrations")),
  );
  assert.ok(
    names.indexOf("008_operations_extensions.sql") <
      names.indexOf("008_reporting_jobs.sql"),
  );
  const seen = new Map<string, number>();
  for (const n of names) {
    const prefix = n.slice(0, n.indexOf("_"));
    assert.match(prefix, /^\d{3}$/, n);
    seen.set(prefix, (seen.get(prefix) || 0) + 1);
  }
  for (const [prefix, count] of seen)
    if (count > 1)
      assert.ok(
        HISTORICAL_DUPLICATE_PREFIXES.has(prefix),
        `Nieuw dubbel migratienummer ${prefix}; kies een uniek volgnummer`,
      );
  assert.equal(migrationChecksum("a\r\nb"), migrationChecksum("a\nb"));
});

test("migraties registreren checksums en melden wijzigingen", db, async () => {
  const dir = resolve(__dirname, "../migrations");
  process.env.MIGRATIONS_DIR = dir;
  await migrate();
  const rows = await query("SELECT name,checksum FROM schema_migrations");
  assert.ok(rows.length >= 21);
  assert.ok(rows.every((r) => /^[a-f0-9]{64}$/.test(r.checksum)));
  const target = "001_core.sql";
  const [orig] = rows.filter((r) => r.name === target);
  try {
    await query("UPDATE schema_migrations SET checksum=$2 WHERE name=$1", [
      target,
      "0".repeat(64),
    ]);
    const warned = await migrate();
    assert.deepEqual(warned.mismatches, [target]);
    process.env.MIGRATION_CHECKSUM_MODE = "strict";
    await assert.rejects(() => migrate(), /checksum/);
  } finally {
    delete process.env.MIGRATION_CHECKSUM_MODE;
    await query("UPDATE schema_migrations SET checksum=$2 WHERE name=$1", [
      target,
      orig.checksum,
    ]);
  }
  // Oude registraties zonder checksum worden aangevuld.
  await query("UPDATE schema_migrations SET checksum=NULL WHERE name=$1", [
    target,
  ]);
  assert.deepEqual((await migrate()).mismatches, []);
  const [again] = await query(
    "SELECT checksum FROM schema_migrations WHERE name=$1",
    [target],
  );
  assert.equal(again.checksum, orig.checksum);
});

test("aanmeldbeperking per account en per IP", db, async () => {
  resetLoginAttempts();
  process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT = "3";
  process.env.LOGIN_MAX_FAILURES_PER_IP = "4";
  const email = randomUUID() + "@lockout.test";
  await query(
    "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Lockout',$2,'employee')",
    [email, passwordHash("LockoutPassword1!")],
  );
  const auth = new AuthController();
  const attempt = (ip: string, password: string, who = email) =>
    auth.login({ email: who, password }, { ip }).then(
      () => 201,
      (e: any) => e.getStatus(),
    );
  try {
    // Per account: fouten vanaf verschillende IP's tellen samen.
    assert.equal(await attempt("198.51.100.1", "fout-wachtwoord"), 401);
    assert.equal(await attempt("198.51.100.2", "fout-wachtwoord"), 401);
    assert.equal(await attempt("198.51.100.3", "fout-wachtwoord"), 401);
    assert.equal(await attempt("198.51.100.4", "LockoutPassword1!"), 403);
    // Een ander account vanaf een ander IP blijft werken.
    resetLoginAttempts();
    assert.equal(await attempt("198.51.100.9", "LockoutPassword1!"), 201);
    // Per IP: fouten op verschillende accounts tellen samen.
    for (let i = 0; i < 4; i++)
      assert.equal(
        await attempt("203.0.113.7", "x", randomUUID() + "@none.test"),
        401,
      );
    assert.equal(await attempt("203.0.113.7", "LockoutPassword1!"), 403);
    assert.equal(await attempt("203.0.113.8", "LockoutPassword1!"), 201);
  } finally {
    delete process.env.LOGIN_MAX_FAILURES_PER_ACCOUNT;
    delete process.env.LOGIN_MAX_FAILURES_PER_IP;
    resetLoginAttempts();
    await query(
      "DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE email=$1)",
      [email],
    );
  }
});

const ctx = (user: any) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

test("MFA verplicht voor beheerders is optioneel (standaard uit)", () => {
  const admin = { role: "admin", mfa_enabled: false };
  const prev = process.env.ADMIN_MFA_REQUIRED;
  try {
    delete process.env.ADMIN_MFA_REQUIRED;
    assert.equal(new AdminGuard().canActivate(ctx(admin)), true);
    process.env.ADMIN_MFA_REQUIRED = "true";
    assert.throws(
      () => new AdminGuard().canActivate(ctx(admin)),
      (e: any) =>
        e.getStatus() === 403 && e.getResponse().mfaSetupRequired === true,
    );
    // MFA instellen blijft mogelijk.
    assert.equal(new AdminRoleGuard().canActivate(ctx(admin)), true);
    assert.equal(
      new AdminGuard().canActivate(ctx({ ...admin, mfa_enabled: true })),
      true,
    );
    assert.throws(() =>
      new AdminRoleGuard().canActivate(ctx({ role: "employee" })),
    );
  } finally {
    if (prev === undefined) delete process.env.ADMIN_MFA_REQUIRED;
    else process.env.ADMIN_MFA_REQUIRED = prev;
  }
});

test("herbevestiging bij gevoelige acties is optioneel (standaard uit)", () => {
  const prev = process.env.SENSITIVE_ACTION_REAUTH;
  try {
    delete process.env.SENSITIVE_ACTION_REAUTH;
    requireRecentReauth({ reauthenticated_at: null });
    process.env.SENSITIVE_ACTION_REAUTH = "true";
    assert.throws(
      () => requireRecentReauth({ reauthenticated_at: null }),
      (e: any) =>
        e.getStatus() === 403 &&
        e.getResponse().reauthRequired === true &&
        e.getResponse().method === "password",
    );
    assert.throws(
      () =>
        requireRecentReauth({
          mfa_enabled: true,
          reauthenticated_at: new Date(Date.now() - 10 * 60000),
        }),
      (e: any) => e.getResponse().method === "otp",
    );
    requireRecentReauth({ reauthenticated_at: new Date() });
  } finally {
    if (prev === undefined) delete process.env.SENSITIVE_ACTION_REAUTH;
    else process.env.SENSITIVE_ACTION_REAUTH = prev;
  }
});

test("verlopen sessies worden opgeruimd", db, async () => {
  const email = randomUUID() + "@sessions.test";
  const [u] = await query(
    "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Sessies',$2,'employee') RETURNING id",
    [email, passwordHash("SessionsPassword1!")],
  );
  await query(
    "INSERT INTO sessions(user_id,token_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,now()-interval '40 days',now()-interval '10 days'),($1,$4,$5,now()-interval '1 hour',now()+interval '20 days')",
    [u.id, randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  );
  resetSessionCleanup();
  assert.ok(((await cleanupSessions()) ?? 0) >= 1);
  assert.equal(await cleanupSessions(), null, "hooguit één keer per dag");
  const left = await query(
    "SELECT refresh_expires_at>now() AS valid FROM sessions WHERE user_id=$1",
    [u.id],
  );
  assert.deepEqual(
    left.map((r) => r.valid),
    [true],
  );
  await query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
});

test(
  "HTTP: proxy-IP, herbevestiging, MFA-instelling, body-limiet, rapport en Swagger",
  db,
  async () => {
    resetLoginAttempts();
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    const suffix = randomUUID();
    const email = `security-admin-${suffix}@test.invalid`;
    const [admin] = await query(
      "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Beveiliging',$2,'admin') RETURNING id",
      [email, passwordHash("SecurityPassword1!")],
    );
    const base = (await app.getUrl()) + "/api";
    const call = (
      path: string,
      token?: string,
      body?: any,
      method?: string,
      headers: Record<string, string> = {},
    ) =>
      fetch(base + path, {
        method: method || (body !== undefined ? "POST" : "GET"),
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body:
          body === undefined
            ? undefined
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
      });
    let assetId: string | undefined;
    try {
      // X-Forwarded-For van de gebundelde nginx (loopback) wordt vertrouwd.
      process.env.LOGIN_MAX_ATTEMPTS = "2";
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await call(
              "/auth/login",
              undefined,
              { email, password: "fout" },
              "POST",
              { "X-Forwarded-For": "192.0.2.10" },
            )
          ).status,
          401,
        );
      assert.equal(
        (
          await call(
            "/auth/login",
            undefined,
            { email, password: "SecurityPassword1!" },
            "POST",
            { "X-Forwarded-For": "192.0.2.10" },
          )
        ).status,
        403,
      );
      const login = await call(
        "/auth/login",
        undefined,
        { email, password: "SecurityPassword1!" },
        "POST",
        { "X-Forwarded-For": "192.0.2.11" },
      );
      assert.equal(login.status, 201);
      delete process.env.LOGIN_MAX_ATTEMPTS;
      resetLoginAttempts();
      const { token } = (await login.json()) as any;
      const me = (await (await call("/auth/me", token)).json()) as any;
      assert.deepEqual(Object.keys(me).sort(), [
        "email",
        "id",
        "name",
        "role",
        "session_id",
      ]);

      // Herbevestiging met wachtwoord (gebruiker zonder MFA).
      assert.equal(
        (await call("/auth/reauth", token, { password: "fout" })).status,
        401,
      );
      const re = await call("/auth/reauth", token, {
        password: "SecurityPassword1!",
      });
      assert.equal(re.status, 201);
      assert.equal(((await re.json()) as any).validForSeconds, 300);
      const [s] = await query(
        "SELECT reauthenticated_at FROM sessions WHERE user_id=$1",
        [admin.id],
      );
      assert.ok(s.reauthenticated_at);

      // MFA verplichten kan niet zonder eigen tweede factor.
      const settings = (await (await call("/settings", token)).json()) as any;
      assert.equal(settings.values.adminMfaRequired, false);
      assert.equal(settings.values.sensitiveActionReauth, false);
      assert.equal(settings.values.koppelingEnabled, false);
      const refused = await call(
        "/settings",
        token,
        { version: settings.version, values: { adminMfaRequired: true } },
        "PATCH",
      );
      assert.equal(refused.status, 400);

      // Kleine standaard body-limiet; imports mogen groter.
      const big = JSON.stringify({ title: "x".repeat(2 * 1024 * 1024) });
      const tooLarge = await call("/tasks", token, big);
      assert.equal(tooLarge.status, 413);
      assert.equal(
        ((await tooLarge.json()) as any).message,
        "Aanvraag is te groot",
      );
      const importBig = await call(
        "/imports/preview",
        token,
        JSON.stringify({
          filename: "x.txt",
          content: "A".repeat(2 * 1024 * 1024),
        }),
      );
      assert.notEqual(importBig.status, 413);
      assert.equal((await call("/tasks", token, "{kapot")).status, 400);

      // reports/summary aggregeert in SQL met dezelfde uitkomsten.
      const [asset] = await query(
        "INSERT INTO assets(name) VALUES($1) RETURNING id",
        ["Rapportmachine " + suffix],
      );
      assetId = asset.id;
      const ins = (status: string, extra: string, values: any[] = []) =>
        query(
          `INSERT INTO tasks(title,status,category,asset_id,created_by,updated_by${extra ? "," + extra.split("=")[0] : ""}) VALUES('Rapport',$1,'reparatie',$2,$3,$3${extra ? ",$4" : ""})`,
          [status, asset.id, admin.id, ...values],
        );
      const created = new Date(Date.now() - 10 * 3600000);
      await ins("open", "planned_at=", ["2026-11-18T10:00:00Z"]);
      await ins("blocked", "deadline=", [new Date(Date.now() - 3600000)]);
      await ins("completed", "completed_at=", [new Date()]);
      await query(
        "UPDATE tasks SET created_at=$2 WHERE asset_id=$1 AND status='completed'",
        [asset.id, created],
      );
      const sum = (await (
        await call("/reports/summary?assetId=" + asset.id, token)
      ).json()) as any;
      assert.equal(sum.total, 3);
      assert.equal(sum.open, 2);
      assert.equal(sum.completed, 1);
      assert.equal(sum.blocked, 1);
      assert.equal(sum.overdue, 1);
      assert.equal(sum.sampleSize, 1);
      assert.ok(Math.abs(sum.meanResolutionHours - 10) < 0.1);
      assert.deepEqual(sum.faultsByAsset, { ["Rapportmachine " + suffix]: 3 });
      assert.deepEqual(sum.workloadByWeek, { "2026-11-16": 1 });

      // Swagger-versie komt uit APP_VERSION / package.json.
      const doc = (await (await fetch(base + "/docs-json")).json()) as any;
      assert.equal(
        doc.info.version,
        process.env.APP_VERSION || require("../package.json").version,
      );
    } finally {
      delete process.env.LOGIN_MAX_ATTEMPTS;
      resetLoginAttempts();
      if (assetId)
        await query("DELETE FROM tasks WHERE asset_id=$1", [assetId]);
      if (assetId) await query("DELETE FROM assets WHERE id=$1", [assetId]);
      await query("DELETE FROM sessions WHERE user_id=$1", [admin.id]);
      await app.close();
    }
  },
);
