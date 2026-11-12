import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  linkSync,
  unlinkSync,
  chmodSync,
  statSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
export function settingsKeyPath() {
  return resolve(
    process.env.SETTINGS_KEY_FILE ||
      resolve(
        process.env.SETTINGS_DIR ||
          (existsSync("/data")
            ? "/data/config"
            : resolve(process.cwd(), "config")),
        "settings.key",
      ),
  );
}
/** Atomic hard-link publication prevents another process reading a partially written key. */
function persistedKey(path: string, initial?: string): Buffer {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    readFileSync(path);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const temp =
      path + "." + process.pid + "." + randomBytes(8).toString("hex");
    if (initial !== undefined && !/^[0-9a-f]{64}$/i.test(initial))
      throw new Error("Bestaande encryptiesleutel is ongeldig");
    writeFileSync(temp, (initial || randomBytes(32).toString("hex")) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    try {
      linkSync(temp, path);
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    } finally {
      unlinkSync(temp);
    }
  }
  const value = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new Error(
      "Instellingensleutel is ongeldig; herstel de oorspronkelijke sleutel uit de back-up",
    );
  const stat = statSync(path);
  if (process.getuid && stat.uid !== process.getuid())
    throw new Error("Instellingensleutel heeft onjuist eigenaarschap");
  chmodSync(path, 0o600);
  return Buffer.from(value, "hex");
}
export function masterKey() {
  return persistedKey(settingsKeyPath());
}
export function totpKey() {
  return persistedKey(
    resolve(dirname(settingsKeyPath()), "totp.key"),
    process.env.TOTP_ENCRYPTION_KEY,
  );
}
export function derivedKey(purpose: string) {
  return createHmac("sha256", masterKey())
    .update("tuinwerk:" + purpose)
    .digest();
}
export function sealSecret(value: string, context = "settings") {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", derivedKey("settings"), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}
export function openSecret(value: string, context = "settings") {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined)
    throw new Error("Versleutelde instelling is ongeldig");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    derivedKey("settings"),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
