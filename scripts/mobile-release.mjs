/** Safe release diagnostics and optional nonsecret build metadata preparation. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const root = path.resolve(import.meta.dirname, ".."),
  mobile = path.join(root, "apps/mobile");
const args = new Set(process.argv.slice(2)),
  platform = process.env.MOBILE_PLATFORM || "all";
const app = JSON.parse(fs.readFileSync(path.join(mobile, "app.json"))),
  eas = JSON.parse(fs.readFileSync(path.join(mobile, "eas.json"))),
  metadata = JSON.parse(
    fs.readFileSync(path.join(mobile, "store/metadata.json")),
  );
const e = app.expo,
  env = process.env,
  checks = [];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function check(name, ok, scope, detail) {
  checks.push({ name, status: ok ? "pass" : "blocked", scope, detail });
}
function securePublic(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(
        u.hostname,
      ) &&
      !/(^|\.)(example\.(com|org|net|nl)|test|invalid|localhost)$/.test(
        u.hostname,
      )
    );
  } catch {
    return false;
  }
}
if (env.TUINWERK_EAS_PROJECT_ID) {
  if (!uuid.test(env.TUINWERK_EAS_PROJECT_ID))
    throw Error("Invalid public EAS project ID");
  e.extra = {
    ...e.extra,
    eas: { ...e.extra?.eas, projectId: env.TUINWERK_EAS_PROJECT_ID },
  };
}
if (env.TUINWERK_EXPO_OWNER) e.owner = env.TUINWERK_EXPO_OWNER;
for (const [variable, target, key] of [
  ["TUINWERK_IOS_BUNDLE_ID", e.ios, "bundleIdentifier"],
  ["TUINWERK_ANDROID_PACKAGE", e.android, "package"],
])
  if (env[variable]) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(env[variable])
    )
      throw Error("Invalid application identifier");
    target[key] = env[variable];
  }
if (env.TUINWERK_GOOGLE_SERVICES_FILE) {
  if (!fs.existsSync(env.TUINWERK_GOOGLE_SERVICES_FILE))
    throw Error("Google services configuration file missing");
  e.android.googleServicesFile = env.TUINWERK_GOOGLE_SERVICES_FILE;
}
for (const [variable, key] of Object.entries({
  TUINWERK_PRIVACY_URL: "privacyPolicyUrl",
  TUINWERK_SUPPORT_URL: "supportUrl",
  TUINWERK_ACCOUNT_DELETION_URL: "accountDeletionUrl",
  TUINWERK_SUPPORT_EMAIL: "supportEmail",
  TUINWERK_COPYRIGHT_OWNER: "copyrightOwner",
  TUINWERK_REVIEW_SERVER_URL: "reviewServerUrl",
  TUINWERK_ASC_APP_ID: "appleNumericAppId",
}))
  if (env[variable]) metadata[key] = env[variable];
if (metadata.appleNumericAppId) {
  if (!/^\d+$/.test(metadata.appleNumericAppId))
    throw Error("App Store Connect numeric app ID is invalid");
  eas.submit.production.ios.ascAppId = metadata.appleNumericAppId;
}
if (env.APPLE_ASC_API_KEY_FILE) {
  eas.submit.production.ios.ascApiKeyPath = env.APPLE_ASC_API_KEY_FILE;
  eas.submit.production.ios.ascApiKeyId = env.APPLE_ASC_KEY_ID;
  eas.submit.production.ios.ascApiKeyIssuerId = env.APPLE_ASC_ISSUER_ID;
}
if (env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE)
  eas.submit.production.android.serviceAccountKeyPath =
    env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
let localSession = false;
try {
  localSession = !!JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".expo/state.json")),
  ).auth?.sessionSecret;
} catch {}
check(
  "Expo project linked",
  uuid.test(e.extra?.eas?.projectId || ""),
  "account",
  "Use eas init with the owner account or set the public project ID.",
);
check(
  "Expo authentication available",
  !!env.EXPO_TOKEN || localSession,
  "account",
  "Presence only; CI additionally verifies eas whoami. No credentials are printed.",
);
check(
  "Application identifiers",
  !!e.ios.bundleIdentifier && !!e.android.package,
  "configuration",
  "Confirm ownership in App Store Connect and Google Play before the first release.",
);
const icon = fs.readFileSync(path.resolve(mobile, e.icon));
check(
  "Opaque 1024px iOS icon",
  icon.readUInt32BE(16) === 1024 &&
    icon.readUInt32BE(20) === 1024 &&
    ![4, 6].includes(icon[25]),
  "configuration",
  "Original PNG, no alpha channel.",
);
check(
  "Xcode 26 build image",
  /xcode-26\./.test(eas.build.production.ios.image),
  "configuration",
  "Pinned image meets the iOS 26 SDK build requirement; validate again before submission.",
);
const catalog = fs.readFileSync(
  path.join(root, "node_modules/react-native/gradle/libs.versions.toml"),
  "utf8",
);
check(
  "Android target API 36",
  /targetSdk\s*=\s*"36"/.test(catalog),
  "configuration",
  "React Native SDK defaults are verified from installed packages.",
);
check(
  "Tracking disabled",
  e.ios.privacyManifests?.NSPrivacyTracking === false,
  "configuration",
  "Declared data flows must still match App Privacy and Data safety forms.",
);
check(
  "Minimal camera and picker permissions",
  ["expo-camera", "expo-image-picker"].every((name) =>
    e.plugins.some(
      (plugin) =>
        Array.isArray(plugin) &&
        plugin[0] === name &&
        plugin[1]?.microphonePermission === false,
    ),
  ) &&
    [
      "RECORD_AUDIO",
      "SYSTEM_ALERT_WINDOW",
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE",
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO",
    ].every((name) =>
      e.android.blockedPermissions.includes(`android.permission.${name}`),
    ),
  "configuration",
  "Camera only when requested; system photo picker avoids broad media access. Final signed manifests remain a release gate.",
);
for (const key of [
  "privacyPolicyUrl",
  "supportUrl",
  "accountDeletionUrl",
  "reviewServerUrl",
])
  check(
    key,
    securePublic(metadata[key]),
    "store",
    "Must be an actual public HTTPS URL supplied by the publisher.",
  );
check(
  "Support and publisher identity",
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(metadata.supportEmail || "") &&
    !!metadata.copyrightOwner,
  "store",
  "Actual publisher contact required; placeholders are not submitted.",
);
if (platform !== "android")
  check(
    "App Store Connect app record",
    /^\d+$/.test(metadata.appleNumericAppId || ""),
    "store",
    "Numeric app ID from the publisher account.",
  );
if (args.has("--submit")) {
  if (platform === "android") {
    let valid = false;
    try {
      const key = JSON.parse(
        fs.readFileSync(env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE),
      );
      valid =
        key.type === "service_account" &&
        !!key.private_key &&
        !!key.client_email;
    } catch {}
    check(
      "Google Play upload credentials",
      valid,
      "submission",
      "Key file shape checked, actual Play permissions are verified only by submission.",
    );
  }
  if (platform === "ios")
    check(
      "App Store Connect upload credentials",
      !!env.APPLE_ASC_API_KEY_FILE &&
        fs.existsSync(env.APPLE_ASC_API_KEY_FILE) &&
        !!env.APPLE_ASC_KEY_ID &&
        uuid.test(env.APPLE_ASC_ISSUER_ID || ""),
      "submission",
      "Key file and metadata present; actual account permissions are verified only by submission.",
    );
}
if (args.has("--check-public") || args.has("--require-store")) {
  for (const key of ["privacyPolicyUrl", "supportUrl", "accountDeletionUrl"]) {
    let accessible = false;
    if (securePublic(metadata[key]))
      try {
        const response = await fetch(metadata[key], {
          redirect: "follow",
          signal: AbortSignal.timeout(20000),
        });
        accessible =
          response.ok &&
          securePublic(response.url) &&
          response.headers.get("content-type")?.includes("text/html");
        await response.body?.cancel();
      } catch {}
    check(
      key + " reachable",
      accessible,
      "store",
      "The public policy/support/deletion page must load without a reviewer login.",
    );
  }
  let ready = false;
  if (securePublic(metadata.reviewServerUrl))
    try {
      const response = await fetch(
        new URL("/api/public/info", metadata.reviewServerUrl),
        { signal: AbortSignal.timeout(20000) },
      );
      ready =
        response.ok &&
        securePublic(response.url) &&
        (await response.json()).ready === true;
    } catch {}
  check(
    "Review server public settings ready",
    ready,
    "store",
    "The actual review backend must expose /api/public/info with ready=true; use fictitious data.",
  );
}
if (args.has("--apply")) {
  fs.writeFileSync(
    path.join(mobile, "app.json"),
    JSON.stringify(app, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(mobile, "eas.json"),
    JSON.stringify(eas, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(mobile, "store/metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
}
const required = new Set([
  "configuration",
  ...(args.has("--require-account") ? ["account"] : []),
  ...(args.has("--require-store") ? ["store"] : []),
  ...(args.has("--submit") ? ["submission"] : []),
]);
const report = {
  generatedAt: new Date().toISOString(),
  platform,
  configurationValid: !checks.some(
    (c) => c.scope === "configuration" && c.status === "blocked",
  ),
  storeReady: !checks.some((c) => c.status === "blocked"),
  checks,
};
if (env.MOBILE_READINESS_REPORT)
  fs.writeFileSync(
    env.MOBILE_READINESS_REPORT,
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(JSON.stringify(report, null, 2));
if (checks.some((c) => required.has(c.scope) && c.status === "blocked"))
  process.exitCode = 1;
