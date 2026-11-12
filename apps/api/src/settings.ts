import { PoolClient } from "pg";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  linkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
  Header,
} from "@nestjs/common";
import { AuthGuard, AdminGuard, CurrentUser, User, passwordHash } from "./auth";
import { query, transaction, audit } from "./db";
import {
  masterKey,
  totpKey,
  sealSecret,
  openSecret,
  settingsKeyPath,
} from "./settings-crypto";
export { sealSecret, openSecret, settingsKeyPath } from "./settings-crypto";
type Definition = {
  env?: string;
  default: any;
  kind:
    | "string"
    | "boolean"
    | "integer"
    | "number"
    | "url"
    | "origins"
    | "timezone";
  max?: number;
  min?: number;
};
export const settingDefinitions: Record<string, Definition> = {
  companyName: { default: "TuinWerk", kind: "string", max: 120 },
  appUrl: { env: "APP_URL", default: "", kind: "url" },
  corsOrigins: { env: "CORS_ORIGINS", default: [], kind: "origins" },
  appTimezone: {
    env: "APP_TIMEZONE",
    default: "Europe/Amsterdam",
    kind: "timezone",
  },
  smtpHost: { env: "SMTP_HOST", default: "", kind: "string", max: 253 },
  smtpPort: {
    env: "SMTP_PORT",
    default: 587,
    kind: "integer",
    min: 1,
    max: 65535,
  },
  smtpSecure: { env: "SMTP_SECURE", default: false, kind: "boolean" },
  smtpRequireTls: { env: "SMTP_REQUIRE_TLS", default: true, kind: "boolean" },
  smtpUser: { env: "SMTP_USER", default: "", kind: "string", max: 320 },
  smtpFrom: { env: "SMTP_FROM", default: "", kind: "string", max: 320 },
  aiEnabled: { env: "AI_ENABLED", default: false, kind: "boolean" },
  aiBaseUrl: { env: "AI_BASE_URL", default: "", kind: "url" },
  aiModel: { env: "AI_MODEL", default: "", kind: "string", max: 120 },
  aiDailyTokenBudget: {
    env: "AI_DAILY_TOKEN_BUDGET",
    default: 10000,
    kind: "integer",
    min: 1,
    max: 10000000,
  },
  aiDailyBudgetEur: {
    env: "AI_DAILY_BUDGET_EUR",
    default: 0,
    kind: "number",
    min: 0,
    max: 100000,
  },
  aiInputEurPerMillion: {
    env: "AI_INPUT_EUR_PER_MILLION",
    default: 0,
    kind: "number",
    min: 0,
    max: 10000,
  },
  aiOutputEurPerMillion: {
    env: "AI_OUTPUT_EUR_PER_MILLION",
    default: 0,
    kind: "number",
    min: 0,
    max: 10000,
  },
  pushEnabled: { env: "EXPO_PUSH_ENABLED", default: false, kind: "boolean" },
  maxUploadBytes: {
    env: "MAX_UPLOAD_BYTES",
    default: 10485760,
    kind: "integer",
    min: 1024,
    max: 52428800,
  },
  recurrenceLookaheadDays: {
    env: "RECURRENCE_LOOKAHEAD_DAYS",
    default: 28,
    kind: "integer",
    min: 0,
    max: 366,
  },
  backupEnabled: { default: false, kind: "boolean" },
  backupHour: { default: 2, kind: "integer", min: 0, max: 23 },
  backupRetentionDays: { default: 30, kind: "integer", min: 1, max: 3650 },
  backupOneDriveEnabled: { default: false, kind: "boolean" },
  oneDriveClientId: { default: "", kind: "string", max: 100 },
  oneDriveTenantId: { default: "consumers", kind: "string", max: 100 },
  oneDriveFolder: { default: "TuinWerk Backups", kind: "string", max: 120 },
};
const secretEnvs: Record<string, string | undefined> = {
  smtpPassword: "SMTP_PASSWORD",
  aiApiKey: "AI_API_KEY",
  expoAccessToken: "EXPO_ACCESS_TOKEN",
  oneDriveClientSecret: undefined,
  oneDriveRefreshToken: undefined,
  backupPassphrase: undefined,
};
const internalKeys = new Set([
  "oneDriveRefreshToken",
  "backupPassphrase",
  "backupEnabled",
  "backupHour",
  "backupRetentionDays",
  "backupOneDriveEnabled",
]);
const initialEnv: Record<string, string | undefined> = Object.fromEntries(
  [
    ...Object.values(settingDefinitions).map((d) => d.env),
    ...Object.values(secretEnvs),
  ]
    .filter((x): x is string => !!x)
    .map((k) => [k, process.env[k]]),
);
function fallback(key: string) {
  const d = settingDefinitions[key],
    v = d.env ? initialEnv[d.env] : undefined;
  if (v === undefined) return d.default;
  if (d.kind === "boolean") return v === "true";
  if (d.kind === "number" || d.kind === "integer") return Number(v);
  if (d.kind === "origins")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return v;
}
function safeObject(value: any) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validate(key: string, value: any) {
  const d = settingDefinitions[key];
  if (!Object.hasOwn(settingDefinitions, key))
    throw new BadRequestException(`Onbekende instelling: ${key}`);
  if (d.kind === "boolean" && typeof value !== "boolean")
    throw new BadRequestException(`${key}: kies ja of nee`);
  if (d.kind === "integer" || d.kind === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (d.kind === "integer" && !Number.isInteger(value)) ||
      value < (d.min ?? 0) ||
      value > (d.max ?? Infinity)
    )
      throw new BadRequestException(`${key}: ongeldig getal`);
  } else if (d.kind === "origins") {
    if (!Array.isArray(value) || value.length > 20)
      throw new BadRequestException("Maximaal 20 toegestane origins");
    for (const item of value) {
      const u = validUrl(item, key);
      if (u.origin !== item || u.pathname !== "/")
        throw new BadRequestException(
          "CORS origins bevatten alleen protocol en host, zonder afsluitende slash",
        );
    }
  } else if (d.kind !== "boolean") {
    if (
      typeof value !== "string" ||
      value.length > (d.max ?? 2000) ||
      /[\r\n\0]/.test(value)
    )
      throw new BadRequestException(`${key}: ongeldige tekst`);
    if (d.kind === "url" && value) {
      const u = validUrl(value, key);
      if (key === "aiBaseUrl" && u.protocol !== "https:")
        throw new BadRequestException("AI-provider vereist HTTPS");
    }
    if (d.kind === "timezone") {
      try {
        new Intl.DateTimeFormat("nl-NL", { timeZone: value });
      } catch {
        throw new BadRequestException("Onbekende tijdzone");
      }
    }
  }
  if (key === "smtpHost" && value && !/^[a-zA-Z0-9.:-]+$/.test(value))
    throw new BadRequestException("SMTP-host bevat ongeldige tekens");
  if (
    key === "oneDriveFolder" &&
    (!value.trim() ||
      value.split("/").some((part: string) => [".", ".."].includes(part)) ||
      /[\\:*?"<>|]/.test(value))
  )
    throw new BadRequestException("Ongeldige OneDrive-map");
  const idPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (key === "oneDriveClientId" && value && !idPattern.test(value))
    throw new BadRequestException("Ongeldig Microsoft client-ID");
  if (
    key === "oneDriveTenantId" &&
    !["common", "consumers", "organizations"].includes(value) &&
    !idPattern.test(value)
  )
    throw new BadRequestException("Ongeldige Microsoft tenant");
  if (
    key === "oneDriveFolder" &&
    (value.length > 120 || value.includes("/") || /[. ]$/.test(value))
  )
    throw new BadRequestException(
      "Kies één OneDrive-mapnaam van maximaal 120 tekens",
    );
  return value;
}
function validUrl(value: any, key: string) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error();
    return url;
  } catch {
    throw new BadRequestException(
      `${key}: gebruik een volledig HTTP(S)-adres zonder gebruikersnaam, wachtwoord of parameters`,
    );
  }
}
async function row() {
  const [r] = await query("SELECT * FROM system_settings WHERE id=1");
  if (!r) throw new Error("Instellingenmigratie ontbreekt");
  return r;
}
export async function getSetting(key: string) {
  if (!Object.hasOwn(settingDefinitions, key))
    throw new Error("Onbekende instelling");
  const r = await row();
  return Object.hasOwn(r.values, key) ? r.values[key] : fallback(key);
}
export async function readSecret(key: string): Promise<string | undefined> {
  if (!Object.hasOwn(secretEnvs, key)) throw new Error("Onbekend geheim");
  const r = await row();
  if (Object.hasOwn(r.secrets, key))
    return r.secrets[key] === null
      ? undefined
      : openSecret(r.secrets[key], key);
  const env = secretEnvs[key];
  return env ? initialEnv[env] : undefined;
}
export async function writeSecret(key: string, value: string, c?: PoolClient) {
  if (
    !Object.hasOwn(secretEnvs, key) ||
    typeof value !== "string" ||
    !value ||
    value.length > 32000
  )
    throw new Error("Ongeldig geheim");
  await ((sql: string, params: any[]) =>
    c ? c.query(sql, params) : query(sql, params))(
    "UPDATE system_settings SET secrets=jsonb_set(secrets,ARRAY[$1]::text[],$2::jsonb),version=version+1,updated_at=now() WHERE id=1",
    [key, JSON.stringify(sealSecret(value, key))],
  );
  if (!c) await refreshRuntimeSettings();
}
export async function deleteSecret(key: string, c?: PoolClient) {
  if (!Object.hasOwn(secretEnvs, key)) throw new Error("Onbekend geheim");
  await ((sql: string, params: any[]) =>
    c ? c.query(sql, params) : query(sql, params))(
    "UPDATE system_settings SET secrets=jsonb_set(secrets,ARRAY[$1]::text[],'null'::jsonb),version=version+1,updated_at=now() WHERE id=1",
    [key],
  );
  if (!c) await refreshRuntimeSettings();
}
export async function writeSetting(key: string, value: any, c?: PoolClient) {
  validate(key, value);
  await ((sql: string, params: any[]) =>
    c ? c.query(sql, params) : query(sql, params))(
    "UPDATE system_settings SET values=jsonb_set(values,ARRAY[$1]::text[],$2::jsonb),version=version+1,updated_at=now() WHERE id=1",
    [key, JSON.stringify(value)],
  );
  if (!c) await refreshRuntimeSettings();
}
export async function settingsSnapshot() {
  const r = await row();
  const values = Object.fromEntries(
    Object.keys(settingDefinitions).map((k) => [
      k,
      Object.hasOwn(r.values, k) ? r.values[k] : fallback(k),
    ]),
  );
  const configured = Object.fromEntries(
    Object.entries(secretEnvs).map(([k, env]) => [
      k,
      Object.hasOwn(r.secrets, k) ? !!r.secrets[k] : !!(env && initialEnv[env]),
    ]),
  );
  return { version: r.version, values, configured, updatedAt: r.updated_at };
}
let refreshing: Promise<void> | undefined;
export async function refreshRuntimeSettings() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const r = await row();
    const changes: Record<string, string | undefined> = {};
    for (const [k, d] of Object.entries(settingDefinitions)) {
      if (!d.env) continue;
      const v = Object.hasOwn(r.values, k) ? r.values[k] : fallback(k);
      changes[d.env] = d.kind === "origins" ? v.join(",") : String(v);
    }
    for (const [k, env] of Object.entries(secretEnvs)) {
      if (!env) continue;
      changes[env] = Object.hasOwn(r.secrets, k)
        ? r.secrets[k] === null
          ? undefined
          : openSecret(r.secrets[k], k)
        : initialEnv[env];
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") delete process.env[key];
      else process.env[key] = value;
    }
  })().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
export async function importLegacySettings() {
  const stored = await row();
  if (
    Object.values(stored.secrets).some((v) => typeof v === "string") &&
    !existsSync(settingsKeyPath())
  )
    throw new Error(
      "Versleutelde instellingen bestaan maar de sleutel ontbreekt; herstel de configuratiemap uit de back-up",
    );
  const [mfa] = await query(
    "SELECT EXISTS(SELECT 1 FROM users WHERE mfa_enabled=true) AS enabled",
  );
  if (
    mfa.enabled &&
    !existsSync(resolve(dirname(settingsKeyPath()), "totp.key")) &&
    !process.env.TOTP_ENCRYPTION_KEY
  )
    throw new Error(
      "Tweede-factor-sleutel ontbreekt; herstel de configuratiemap uit de back-up",
    );
  masterKey();
  totpKey();
  await transaction(async (c) => {
    const [r] = (
      await c.query("SELECT * FROM system_settings WHERE id=1 FOR UPDATE")
    ).rows;
    let changed = false;
    for (const [key, d] of Object.entries(settingDefinitions)) {
      if (
        d.env &&
        initialEnv[d.env] !== undefined &&
        !Object.hasOwn(r.values, key)
      ) {
        r.values[key] = fallback(key);
        changed = true;
      }
    }
    for (const [key, env] of Object.entries(secretEnvs)) {
      if (
        env &&
        initialEnv[env] !== undefined &&
        !Object.hasOwn(r.secrets, key)
      ) {
        r.secrets[key] = sealSecret(initialEnv[env]!, key);
        changed = true;
      }
    }
    if (changed)
      await c.query(
        "UPDATE system_settings SET values=$1,secrets=$2,version=version+1,updated_at=now() WHERE id=1",
        [JSON.stringify(r.values), JSON.stringify(r.secrets)],
      );
  });
}
export async function startRuntimeSettings() {
  await importLegacySettings();
  await initializeSetupCode();
  await refreshRuntimeSettings();
  const timer = setInterval(
    () =>
      void refreshRuntimeSettings().catch(() =>
        console.error(
          JSON.stringify({
            event: "settings_refresh_failed",
            message: "Instellingen konden niet veilig worden vernieuwd",
          }),
        ),
      ),
    2000,
  );
  timer.unref();
  return () => clearInterval(timer);
}
@Controller("settings")
@UseGuards(AuthGuard, AdminGuard)
export class SettingsController {
  @Get() @Header("Cache-Control", "no-store") get() {
    return settingsSnapshot();
  }
  @Patch() @Header("Cache-Control", "no-store") async update(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    if (
      !Number.isInteger(b.version) ||
      !safeObject(b.values ?? {}) ||
      !safeObject(b.secrets ?? {}) ||
      !Array.isArray(b.clearSecrets ?? [])
    )
      throw new BadRequestException("Versie en geldige instellingen verplicht");
    const values = b.values || {},
      secrets = b.secrets || {},
      clear = b.clearSecrets || [];
    for (const [key, value] of Object.entries(values)) {
      if (internalKeys.has(key))
        throw new BadRequestException(
          "Gebruik de speciale back-upinstellingen om herstelbaarheid te bevestigen",
        );
      validate(key, value);
    }
    for (const [key, value] of Object.entries(secrets)) {
      if (
        internalKeys.has(key) ||
        !Object.hasOwn(secretEnvs, key) ||
        typeof value !== "string" ||
        !value ||
        value.length > 32000
      )
        throw new BadRequestException(
          "Ongeldig geheim; laat leeg om te behouden of gebruik expliciet wissen",
        );
      if (key === "backupPassphrase" && value.length < 16)
        throw new BadRequestException(
          "Back-upwachtzin moet minimaal 16 tekens bevatten",
        );
    }
    if (
      clear.some(
        (key: any) =>
          typeof key !== "string" ||
          !Object.hasOwn(secretEnvs, key) ||
          internalKeys.has(key) ||
          Object.hasOwn(secrets, key),
      )
    )
      throw new BadRequestException("Ongeldig te wissen geheim");
    await transaction(async (c) => {
      const oneDriveChanged = [
        "oneDriveClientId",
        "oneDriveTenantId",
        "oneDriveFolder",
      ].some((key) => Object.hasOwn(values, key));
      if (oneDriveChanged)
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
        );
      const [old] = (
        await c.query("SELECT * FROM system_settings WHERE id=1 FOR UPDATE")
      ).rows;
      if (old.version !== b.version)
        throw new ConflictException("Instellingen gewijzigd; laad opnieuw");
      const nextValues = { ...old.values, ...values },
        nextSecrets = { ...old.secrets };
      for (const [k, v] of Object.entries(secrets))
        nextSecrets[k] = sealSecret(v as string, k);
      for (const k of clear) nextSecrets[k] = null;
      const identityChanged = ["oneDriveClientId", "oneDriveTenantId"].some(
        (key) =>
          Object.hasOwn(values, key) &&
          values[key] !==
            (Object.hasOwn(old.values, key) ? old.values[key] : fallback(key)),
      );
      if (identityChanged) {
        nextSecrets.oneDriveRefreshToken = null;
        await c.query("DELETE FROM onedrive_connection");
        await c.query(
          "UPDATE onedrive_device_flows SET status='cancelled',device_code='' WHERE status='pending'",
        );
      } else if (
        Object.hasOwn(values, "oneDriveFolder") &&
        values.oneDriveFolder !==
          (old.values.oneDriveFolder ?? fallback("oneDriveFolder"))
      ) {
        await c.query(
          "UPDATE onedrive_connection SET folder_id=NULL,updated_at=now() WHERE id=1",
        );
      }
      await c.query(
        "UPDATE system_settings SET values=$1,secrets=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=1",
        [JSON.stringify(nextValues), JSON.stringify(nextSecrets), u.id],
      );
      await audit(c, u.id, "settings", "1", "updated", {
        fields: Object.keys(values),
        secretsChanged: Object.keys(secrets),
        secretsCleared: clear,
      });
    });
    await refreshRuntimeSettings();
    return settingsSnapshot();
  }
}
export function setupTokenPath() {
  return resolve(dirname(settingsKeyPath()), "setup-token");
}
function readSetupCode() {
  try {
    return readFileSync(setupTokenPath(), "utf8").trim();
  } catch {
    throw new ForbiddenException(
      "Installatiecode niet beschikbaar; controleer de applicatielogs",
    );
  }
}
async function initializeSetupCode() {
  const [r] = await query("SELECT EXISTS(SELECT 1 FROM users) AS configured");
  if (r.configured || process.env.SETUP_DISABLED === "true") return;
  const path = setupTokenPath();
  if (existsSync(path)) {
    console.log(
      JSON.stringify({
        event: "initial_setup_code",
        message:
          "Eenmalige installatiecode voor TuinWerk; installatie is nog niet voltooid",
        setupCode: readSetupCode(),
      }),
    );
    return;
  }
  const code = process.env.SETUP_TOKEN || randomBytes(24).toString("base64url");
  const temp = path + "." + randomBytes(8).toString("hex");
  writeFileSync(temp, code + "\n", { mode: 0o600, flag: "wx" });
  let created = false;
  try {
    linkSync(temp, path);
    created = true;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
  } finally {
    unlinkSync(temp);
  }
  if (created)
    console.log(
      JSON.stringify({
        event: "initial_setup_code",
        message:
          "Eenmalige installatiecode voor TuinWerk; voer deze in op de eerste installatiepagina",
        setupCode: code,
      }),
    );
}
const attempts = new Map<string, { count: number; until: number }>();
@Controller("setup")
export class SetupController {
  @Get() @Header("Cache-Control", "no-store") async status() {
    const [r] = await query("SELECT EXISTS(SELECT 1 FROM users) AS configured");
    return {
      required: !r.configured && process.env.SETUP_DISABLED !== "true",
      requiresSetupCode: !r.configured && process.env.SETUP_DISABLED !== "true",
    };
  }
  @Post() @Header("Cache-Control", "no-store") async setup(
    @Body() b: any,
    @Req() req: any,
  ) {
    if (process.env.SETUP_DISABLED === "true")
      throw new ForbiddenException("Eerste installatie is uitgeschakeld");
    const key = req.ip || "unknown",
      now = Date.now(),
      old = attempts.get(key);
    if (old && old.until > now && old.count >= 5)
      throw new ForbiddenException("Te veel pogingen; probeer over 15 minuten");
    if (attempts.size > 10000)
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    attempts.set(key, {
      count: (old && old.until > now ? old.count : 0) + 1,
      until: now + 900000,
    });
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 200 ||
      typeof b.email !== "string" ||
      !b.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/) ||
      b.email.length > 320
    )
      throw new BadRequestException("Naam en geldig e-mailadres verplicht");
    const expected = readSetupCode();
    if (
      typeof b.setupCode !== "string" ||
      !timingSafeEqual(
        createHash("sha256").update(expected).digest(),
        createHash("sha256").update(b.setupCode).digest(),
      )
    )
      throw new ForbiddenException("Installatiecode onjuist");
    const password = passwordHash(b.password);
    if (b.companyName !== undefined) validate("companyName", b.companyName);
    if (b.appUrl !== undefined) {
      validate("appUrl", b.appUrl);
      if (!b.appUrl)
        throw new BadRequestException("App-adres mag niet leeg zijn");
    }
    masterKey();
    await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('initial-setup'))");
      if ((await c.query("SELECT id FROM users LIMIT 1")).rowCount)
        throw new ConflictException(
          "De installatie is al voltooid; meld je aan",
        );
      const [u] = (
        await c.query(
          "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",
          [b.name.trim(), b.email.toLowerCase(), password],
        )
      ).rows;
      const initialValues: Record<string, string> = {};
      if (b.companyName !== undefined)
        initialValues.companyName = b.companyName;
      if (b.appUrl !== undefined) initialValues.appUrl = b.appUrl;
      if (Object.keys(initialValues).length)
        await c.query(
          "UPDATE system_settings SET values=values||$1::jsonb,version=version+1,updated_by=$2,updated_at=now() WHERE id=1",
          [JSON.stringify(initialValues), u.id],
        );
      await audit(c, u.id, "system", "setup", "initialized");
    });
    try {
      unlinkSync(setupTokenPath());
    } catch {}
    await refreshRuntimeSettings();
    return { ok: true };
  }
}
