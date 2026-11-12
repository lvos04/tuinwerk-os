const editableValues = new Set([
  "companyName",
  "appUrl",
  "corsOrigins",
  "appTimezone",
  "smtpHost",
  "smtpPort",
  "smtpSecure",
  "smtpRequireTls",
  "smtpUser",
  "smtpFrom",
  "aiEnabled",
  "aiBaseUrl",
  "aiModel",
  "aiDailyTokenBudget",
  "aiDailyBudgetEur",
  "aiInputEurPerMillion",
  "aiOutputEurPerMillion",
  "pushEnabled",
  "maxUploadBytes",
  "recurrenceLookaheadDays",
]);
const editableSecrets = new Set([
  "smtpPassword",
  "aiApiKey",
  "expoAccessToken",
]);
export function settingsPatch(
  version: number,
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  secretInputs: Record<string, string>,
  clearSecrets: string[],
) {
  if (!Number.isInteger(version))
    throw new Error("Laad eerst de actuele serverinstellingen.");
  const values = Object.fromEntries(
    Object.entries(current).filter(
      ([key, value]) =>
        editableValues.has(key) &&
        JSON.stringify(value) !== JSON.stringify(baseline[key]),
    ),
  );
  for (const value of Object.values(values))
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Vul geldige getallen in.");
  const secrets = Object.fromEntries(
    Object.entries(secretInputs).filter(
      ([key, value]) => editableSecrets.has(key) && value !== "",
    ),
  );
  const clear = [...new Set(clearSecrets)].filter((key) =>
    editableSecrets.has(key),
  );
  if (clear.some((key) => Object.hasOwn(secrets, key)))
    throw new Error("Een geheim kan niet tegelijk vervangen en gewist worden.");
  return { version, values, secrets, clearSecrets: clear };
}
export function backupSettingsPayload(
  config: Record<string, any>,
  passphrase: string,
  recoveryConfirmed: boolean,
) {
  if (!Number.isInteger(config.version))
    throw new Error("Laad eerst de actuele back-upconfiguratie.");
  if (passphrase && (passphrase.length < 20 || passphrase.length > 512))
    throw new Error("De herstelcode moet 20–512 tekens bevatten.");
  if (passphrase && !recoveryConfirmed)
    throw new Error(
      "Bewaar eerst de herstelsleutel buiten deze NAS en bevestig dit.",
    );
  if (config.backupHour === "" || config.backupRetentionDays === "")
    throw new Error("Vul een back-uptijd en bewaartermijn in.");
  const backupHour = Number(config.backupHour),
    backupRetentionDays = Number(config.backupRetentionDays);
  if (
    !Number.isInteger(backupHour) ||
    backupHour < 0 ||
    backupHour > 23 ||
    !Number.isInteger(backupRetentionDays) ||
    backupRetentionDays < 1 ||
    backupRetentionDays > 3650
  )
    throw new Error(
      "Kies een uur van 0–23 en een bewaartermijn van 1–3650 dagen.",
    );
  return {
    version: config.version,
    backupEnabled: !!config.backupEnabled,
    backupHour,
    appTimezone: config.appTimezone,
    backupRetentionDays,
    backupOneDriveEnabled: !!config.backupOneDriveEnabled,
    ...(passphrase
      ? { backupPassphrase: passphrase, recoveryConfirmed: true }
      : {}),
  };
}
