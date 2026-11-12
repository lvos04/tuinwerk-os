import React, { useEffect, useState } from "react";
import { Alert, Linking, Share, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Session, authorizedRequest } from "./api";
import { settingsPatch, backupSettingsPayload } from "./settings-payload";
import {
  NativeButton as Button,
  NativeField as Field,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
type Row = Record<string, any>;
type SettingField = {
  key: string;
  label: string;
  kind?: "boolean" | "number" | "origins" | "secret";
  help?: string;
};
const groups: Record<string, { title: string; fields: SettingField[] }> = {
  general: {
    title: "Bedrijf en werking",
    fields: [
      { key: "companyName", label: "Bedrijfsnaam" },
      { key: "appUrl", label: "Publiek HTTPS-adres van TuinWerk" },
      {
        key: "corsOrigins",
        label: "Toegestane webadressen (één adres per regel)",
        kind: "origins",
        help: "Alleen protocol en host, zonder afsluitende slash. Je mobiele app heeft deze browserinstelling niet nodig.",
      },
      { key: "appTimezone", label: "Tijdzone (bijvoorbeeld Europe/Amsterdam)" },
      {
        key: "maxUploadBytes",
        label: "Maximale uploadgrootte in bytes",
        kind: "number",
      },
      {
        key: "recurrenceLookaheadDays",
        label: "Onderhoud vooruit aanmaken (dagen)",
        kind: "number",
      },
    ],
  },
  mail: {
    title: "E-mail",
    fields: [
      { key: "smtpHost", label: "SMTP-server" },
      { key: "smtpPort", label: "Poort", kind: "number" },
      { key: "smtpSecure", label: "Directe TLS-verbinding", kind: "boolean" },
      {
        key: "smtpRequireTls",
        label: "Versleuteling verplicht",
        kind: "boolean",
      },
      { key: "smtpUser", label: "Gebruikersnaam" },
      { key: "smtpPassword", label: "Nieuw SMTP-wachtwoord", kind: "secret" },
      { key: "smtpFrom", label: "Afzenderadres" },
    ],
  },
  ai: {
    title: "Optionele AI",
    fields: [
      {
        key: "aiEnabled",
        label: "AI-module inschakelen",
        kind: "boolean",
        help: "Gebruikers bevestigen iedere externe tekstoverdracht afzonderlijk.",
      },
      { key: "aiBaseUrl", label: "HTTPS-adres van de AI-provider" },
      { key: "aiModel", label: "Model" },
      { key: "aiApiKey", label: "Nieuwe API-sleutel", kind: "secret" },
      {
        key: "aiDailyTokenBudget",
        label: "Dagelijks tokenbudget",
        kind: "number",
      },
      {
        key: "aiDailyBudgetEur",
        label: "Dagelijks budget in euro",
        kind: "number",
      },
      {
        key: "aiInputEurPerMillion",
        label: "Euro per miljoen invoertokens",
        kind: "number",
      },
      {
        key: "aiOutputEurPerMillion",
        label: "Euro per miljoen uitvoertokens",
        kind: "number",
      },
    ],
  },
  push: {
    title: "Pushmeldingen",
    fields: [
      {
        key: "pushEnabled",
        label: "Push via Expo inschakelen",
        kind: "boolean",
      },
      {
        key: "expoAccessToken",
        label: "Nieuw Expo-toegangstoken",
        kind: "secret",
        help: "APNs/FCM en signing blijven onderdeel van je eigen native buildconfiguratie.",
      },
    ],
  },
};
export function ServerSettingsScreen({ session }: { session: Session }) {
  const [section, setSection] = useState("general"),
    [snapshot, setSnapshot] = useState<Row | null>(null),
    [values, setValues] = useState<Row>({}),
    [secretInputs, setSecretInputs] = useState<Record<string, string>>({}),
    [clearSecrets, setClearSecrets] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [backup, setBackup] = useState<Row | null>(null),
    [backupConfig, setBackupConfig] = useState<Row>({}),
    [jobs, setJobs] = useState<Row[]>([]),
    [archives, setArchives] = useState<Row[]>([]),
    [remoteArchives, setRemoteArchives] = useState<Row[]>([]),
    [recovery, setRecovery] = useState<Row | null>(null),
    [recoveryConfirmed, setRecoveryConfirmed] = useState(false),
    [backupPassphrase, setBackupPassphrase] = useState(""),
    [restoreSecret, setRestoreSecret] = useState(""),
    [restoreArchive, setRestoreArchive] = useState<Row | null>(null),
    [restoreSource, setRestoreSource] = useState("local"),
    [restorePreview, setRestorePreview] = useState<Row | null>(null),
    [restoreConfirmation, setRestoreConfirmation] = useState(""),
    [uploadProgress, setUploadProgress] = useState<number | null>(null);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "De actie is mislukt.");
    } finally {
      setBusy(false);
    }
  }
  async function loadSettings() {
    const result = await authorizedRequest(session, "/settings");
    setSnapshot(result);
    setValues(result.values);
  }
  async function loadRemoteArchives() {
    const rows = await authorizedRequest(session, "/admin/onedrive/backups");
    setRemoteArchives(
      rows.map((row: Row) => ({
        ...row,
        source: "onedrive",
        filename: row.archiveName,
      })),
    );
  }
  async function loadBackup() {
    const status = await authorizedRequest(session, "/admin/backups/status");
    setBackup(status);
    setBackupConfig(status.config);
    setJobs(await authorizedRequest(session, "/admin/backups/jobs"));
    setArchives(await authorizedRequest(session, "/admin/backups/archives"));
  }
  useEffect(() => {
    void run(loadSettings);
    return () => {};
  }, [session.user.id, session.endpoint]);
  useEffect(() => {
    if (section === "backups") void run(loadBackup);
  }, [section]);
  async function saveSettings() {
    const patch = settingsPatch(
      snapshot?.version,
      snapshot?.values || {},
      values,
      secretInputs,
      clearSecrets,
    );
    const result = await authorizedRequest(
      session,
      "/settings",
      "PATCH",
      patch,
    );
    setSnapshot(result);
    setValues(result.values);
    setSecretInputs({});
    setClearSecrets([]);
    setNotice(
      "Instellingen opgeslagen. Geheime waarden worden niet teruggestuurd.",
    );
  }
  async function saveBackup() {
    const payload = backupSettingsPayload(
      backupConfig,
      backupPassphrase,
      recoveryConfirmed,
    );
    await authorizedRequest(session, "/admin/backups/config", "PUT", payload);
    setBackupPassphrase("");
    setRecovery(null);
    setRecoveryConfirmed(false);
    await loadBackup();
    setNotice(
      "Back-upinstellingen opgeslagen. Bewaar ook eerdere herstelsleutels zolang oude archieven bestaan.",
    );
  }
  async function downloadArchive(archive: Row) {
    await authorizedRequest(session, "/auth/me");
    const uri = FileSystem.cacheDirectory + archive.id + ".twb";
    const result = await FileSystem.downloadAsync(
      session.endpoint +
        "/admin/backups/archives/" +
        encodeURIComponent(archive.id) +
        "/download",
      uri,
      { headers: { Authorization: "Bearer " + session.token } },
    );
    if (result.status !== 200) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      throw new Error("Archief downloaden is mislukt.");
    }
    await Sharing.shareAsync(uri);
  }
  function settingField(field: SettingField) {
    if (field.kind === "boolean")
      return (
        <View key={field.key}>
          <Button
            disabled={busy}
            label={`${values[field.key] ? "✓ " : ""}${field.label}`}
            onPress={() =>
              setValues({ ...values, [field.key]: !values[field.key] })
            }
          />
          {field.help && <Text style={s.text}>{field.help}</Text>}
        </View>
      );
    if (field.kind === "secret")
      return (
        <View key={field.key} style={s.card}>
          <Text>
            {snapshot?.configured?.[field.key]
              ? "Geconfigureerd; bestaande waarde blijft behouden als je dit veld leeg laat."
              : "Nog niet geconfigureerd."}
          </Text>
          <Field
            secret
            label={field.label}
            value={secretInputs[field.key] || ""}
            onChange={(value) => {
              setSecretInputs({ ...secretInputs, [field.key]: value });
              setClearSecrets(clearSecrets.filter((key) => key !== field.key));
            }}
          />
          {snapshot?.configured?.[field.key] && (
            <Button
              label={
                clearSecrets.includes(field.key)
                  ? "Wissen bij opslaan ongedaan maken"
                  : "Bestaand geheim expliciet wissen"
              }
              onPress={() => {
                if (clearSecrets.includes(field.key))
                  setClearSecrets(
                    clearSecrets.filter((key) => key !== field.key),
                  );
                else
                  Alert.alert(
                    "Geheim wissen?",
                    `De koppeling kan hierdoor stoppen. ${field.label}`,
                    [
                      { text: "Annuleren", style: "cancel" },
                      {
                        text: "Wissen bij opslaan",
                        style: "destructive",
                        onPress: () => {
                          setSecretInputs({ ...secretInputs, [field.key]: "" });
                          setClearSecrets([...clearSecrets, field.key]);
                        },
                      },
                    ],
                  );
              }}
            />
          )}
          {field.help && <Text style={s.text}>{field.help}</Text>}
        </View>
      );
    return (
      <View key={field.key}>
        <Field
          label={field.label}
          multiline={field.kind === "origins"}
          value={
            field.kind === "origins"
              ? (values[field.key] || []).join("\n")
              : String(values[field.key] ?? "")
          }
          onChange={(value) =>
            setValues({
              ...values,
              [field.key]:
                field.kind === "origins"
                  ? value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                  : field.kind === "number"
                    ? Number(value.replace(",", "."))
                    : value,
            })
          }
        />
        {field.help && <Text style={s.text}>{field.help}</Text>}
      </View>
    );
  }
  if (session.user.role !== "admin")
    return <Text>Alleen beheerders kunnen serverinstellingen beheren.</Text>;
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.title}>Serverinstellingen en back-ups</Text>
      <Text style={s.text}>
        Deze instellingen worden op je eigen server opgeslagen. Geheime waarden
        worden versleuteld bewaard en nooit als bestaande waarde getoond.
      </Text>
      <Select
        label="Onderdeel"
        options={{
          general: "Bedrijf",
          mail: "E-mail",
          ai: "AI",
          push: "Push",
          backups: "Back-ups",
          onedrive: "OneDrive",
        }}
        value={section}
        onChange={setSection}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {!!notice && <Text style={s.text}>{notice}</Text>}
      {groups[section] && snapshot && (
        <>
          <Text style={s.title}>{groups[section].title}</Text>
          {groups[section].fields.map(settingField)}
          <Button
            disabled={busy}
            label="Instellingen opslaan"
            onPress={() => void run(saveSettings)}
          />
          <Button
            disabled={busy}
            label="Serverinstellingen opnieuw laden"
            onPress={() =>
              Alert.alert(
                "Opnieuw laden?",
                "Niet-opgeslagen wijzigingen in gewone instellingen worden vervangen. Geheime invoer blijft lokaal totdat je opslaat of dit scherm verlaat.",
                [
                  { text: "Annuleren", style: "cancel" },
                  { text: "Laden", onPress: () => void run(loadSettings) },
                ],
              )
            }
          />
        </>
      )}
      {section === "backups" && (
        <>
          {uploadProgress !== null && (
            <Text accessibilityLiveRegion="polite" style={s.text}>
              Herstelarchief uploaden: {uploadProgress}%
            </Text>
          )}
          <Text style={s.title}>Versleutelde back-ups</Text>
          <Button
            disabled={busy}
            label="Back-upstatus vernieuwen"
            onPress={() => void run(loadBackup)}
          />
          {backup && (
            <>
              <View style={s.card}>
                <Text>
                  Back-upservice:{" "}
                  {backup.helper?.available ? "Bereikbaar" : "Niet bereikbaar"}
                </Text>
                <Text>
                  Laatste contact: {backup.helper?.lastSeen || "Onbekend"}
                </Text>
                <Text>
                  Herstelsleutel:{" "}
                  {backup.config?.backupPassphraseConfigured
                    ? "Ingesteld"
                    : "Nog niet ingesteld"}
                </Text>
                <Text>
                  Laatste back-up:{" "}
                  {backup.lastBackup?.createdAt ||
                    backup.lastBackup?.completedAt ||
                    "Nog geen"}
                </Text>
              </View>
              <Button
                disabled={busy}
                label={`${backupConfig.backupEnabled ? "✓ " : ""}Dagelijkse back-up inschakelen`}
                onPress={() =>
                  setBackupConfig({
                    ...backupConfig,
                    backupEnabled: !backupConfig.backupEnabled,
                  })
                }
              />
              <Field
                label="Dagelijks uur (0–23)"
                value={String(backupConfig.backupHour ?? 2)}
                onChange={(value) =>
                  setBackupConfig({ ...backupConfig, backupHour: value })
                }
              />
              <Field
                label="Tijdzone"
                value={backupConfig.appTimezone || "Europe/Amsterdam"}
                onChange={(value) =>
                  setBackupConfig({ ...backupConfig, appTimezone: value })
                }
              />
              <Field
                label="Lokale bewaartermijn (dagen)"
                value={String(backupConfig.backupRetentionDays ?? 30)}
                onChange={(value) =>
                  setBackupConfig({
                    ...backupConfig,
                    backupRetentionDays: value,
                  })
                }
              />
              <Button
                disabled={busy}
                label={`${backupConfig.backupOneDriveEnabled ? "✓ " : ""}Na back-up ook naar OneDrive kopiëren (eerst verbinden)`}
                onPress={() =>
                  setBackupConfig({
                    ...backupConfig,
                    backupOneDriveEnabled: !backupConfig.backupOneDriveEnabled,
                  })
                }
              />
              <Text style={s.text}>
                De bewaartermijn ruimt alleen lokale archieven op; bestaande
                OneDrive-archieven blijven staan. Bewaar je herstelsleutel
                buiten deze NAS, bijvoorbeeld in je wachtwoordmanager of op
                papier. Een sleutel die alleen op de defecte NAS stond kan het
                archief niet herstellen. Bewaar oude sleutels na een wijziging.
              </Text>
              <Button
                disabled={busy}
                label="Nieuwe sterke herstelsleutel maken"
                onPress={() =>
                  void run(async () => {
                    const result = await authorizedRequest(
                      session,
                      "/admin/backups/recovery-key",
                      "POST",
                      {},
                    );
                    setRecovery(result);
                    setBackupPassphrase(result.passphrase);
                    setRecoveryConfirmed(false);
                  })
                }
              />
              {recovery && (
                <View style={s.card}>
                  <Text selectable>{recovery.recoveryText}</Text>
                  <Button
                    label="Herstelgegevens extern bewaren / delen"
                    onPress={() =>
                      void run(async () => {
                        await Share.share({
                          title: "TuinWerk herstelgegevens",
                          message: recovery.recoveryText,
                        });
                      })
                    }
                  />
                </View>
              )}
              <Field
                secret
                label="Nieuwe herstelsleutel (leeg = bestaande behouden)"
                value={backupPassphrase}
                onChange={(value) => {
                  setBackupPassphrase(value);
                  setRecovery(null);
                  setRecoveryConfirmed(false);
                }}
              />
              {!!backupPassphrase && (
                <Button
                  label={`${recoveryConfirmed ? "✓ " : ""}Ik heb deze herstelsleutel buiten de NAS bewaard`}
                  onPress={() => setRecoveryConfirmed(!recoveryConfirmed)}
                />
              )}
              <Button
                disabled={busy}
                label="Back-upconfiguratie opslaan"
                onPress={() => void run(saveBackup)}
              />
              <Button
                disabled={busy || !backup.helper?.available}
                label="Nu back-up maken"
                onPress={() =>
                  void run(async () => {
                    await authorizedRequest(session, "/admin/backups", "POST", {
                      uploadToOneDrive: !!backupConfig.backupOneDriveEnabled,
                    });
                    await loadBackup();
                    setNotice(
                      "Back-up aangevraagd. Volg de voortgang hieronder.",
                    );
                  })
                }
              />
            </>
          )}
          <Text style={s.title}>Voortgang</Text>
          {jobs.map((job) => (
            <View key={job.id} style={s.card}>
              <Text>
                {job.operation || job.kind || job.type} ·{" "}
                {job.state || job.status} · {job.createdAt}
              </Text>
              {job.remoteState && (
                <Text>OneDrive-kopie: {job.remoteState}</Text>
              )}
              {job.remoteState === "failed" && (
                <Button
                  disabled={busy}
                  label="OneDrive-kopie opnieuw proberen"
                  onPress={() =>
                    void run(async () => {
                      await authorizedRequest(
                        session,
                        "/admin/backups/jobs/" + job.id + "/retry-onedrive",
                        "POST",
                        {},
                      );
                      await loadBackup();
                    })
                  }
                />
              )}{" "}
              {job.message && <Text>{job.message}</Text>}
              {job.error && (
                <Text style={s.error}>
                  {typeof job.error === "string"
                    ? job.error
                    : "Verwerking mislukt; controleer de serverstatus."}
                </Text>
              )}
              <Button
                disabled={busy}
                label="Jobgegevens verversen"
                onPress={() =>
                  void run(async () => {
                    const result = await authorizedRequest(
                      session,
                      "/admin/backups/jobs/" + job.id,
                    );
                    setJobs(
                      jobs.map((row) => (row.id === job.id ? result : row)),
                    );
                    if (restorePreview?.id === job.id)
                      setRestorePreview(result);
                  })
                }
              />
            </View>
          ))}
          <Text style={s.title}>Archieven en herstel</Text>
          <Button
            disabled={busy}
            label="Lokaal .twb-herstelarchief uploaden"
            onPress={() =>
              void run(async () => {
                const result = await DocumentPicker.getDocumentAsync({
                  type: "*/*",
                  copyToCacheDirectory: true,
                });
                if (result.canceled) return;
                const file = result.assets[0];
                const match = /^([a-f0-9-]{36})\.twb$/i.exec(file.name);
                if (!match)
                  throw new Error(
                    "Kies het oorspronkelijke UUID.twb-back-upbestand.",
                  );
                await authorizedRequest(session, "/auth/me");
                setUploadProgress(0);
                const task = FileSystem.createUploadTask(
                  session.endpoint + "/admin/backups/archives/upload",
                  file.uri,
                  {
                    httpMethod: "POST",
                    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
                    fieldName: "file",
                    mimeType: "application/octet-stream",
                    parameters: { archiveId: match[1] },
                    headers: { Authorization: "Bearer " + session.token },
                  },
                  (progress) =>
                    setUploadProgress(
                      progress.totalBytesExpectedToSend > 0
                        ? Math.round(
                            (progress.totalBytesSent /
                              progress.totalBytesExpectedToSend) *
                              100,
                          )
                        : 0,
                    ),
                );
                let response: FileSystem.FileSystemUploadResult | null | undefined;
                try {
                  response = await task.uploadAsync();
                } finally {
                  setUploadProgress(null);
                }
                if (!response) throw new Error("Archiefupload is onderbroken.");
                let uploaded: Row;
                try {
                  uploaded = JSON.parse(response.body);
                } catch {
                  throw new Error("Uploadantwoord niet herkenbaar.");
                }
                if (response.status < 200 || response.status >= 300)
                  throw new Error(uploaded.message || "Archiefupload mislukt.");
                await loadBackup();
                setRestoreSource("local");
                setRestoreArchive({
                  id: uploaded.archiveId,
                  filename: file.name,
                });
                setRestorePreview(null);
                setRestoreSecret("");
                setRestoreConfirmation("");
                setNotice(
                  "Archief ontvangen. Voer de extern bewaarde herstelcode in om de inhoud te controleren.",
                );
              })
            }
          />
          <Select
            label="Archiefbron"
            value={restoreSource}
            onChange={(value) => {
              setRestoreSource(value);
              setRestoreArchive(null);
              setRestorePreview(null);
              if (value === "onedrive") void run(loadRemoteArchives);
            }}
            options={{ local: "Lokale back-ups", onedrive: "OneDrive" }}
          />
          {(restoreSource === "local" ? archives : remoteArchives).map(
            (archive) => (
              <View style={s.card} key={archive.id}>
                <Text>{archive.filename || archive.name || archive.id}</Text>
                <Text>
                  {archive.createdAt} ·{" "}
                  {archive.sizeBytes ||
                    archive.size ||
                    archive.manifest?.size ||
                    ""}{" "}
                  bytes
                </Text>
                {restoreSource === "local" &&
                  archive.localAvailable !== false && (
                    <Button
                      disabled={busy}
                      label="Versleuteld archief delen"
                      onPress={() => void run(() => downloadArchive(archive))}
                    />
                  )}
                <Button
                  disabled={busy}
                  label="Dit archief controleren voor herstel"
                  onPress={() => {
                    setRestoreArchive(archive);
                    setRestorePreview(null);
                    setRestoreConfirmation("");
                    setRestoreSecret("");
                  }}
                />
              </View>
            ),
          )}
          {restoreArchive && (
            <View style={s.card}>
              <Text style={s.title}>Herstelcontrole</Text>
              <Text>
                {restoreArchive.filename ||
                  restoreArchive.name ||
                  restoreArchive.id}
              </Text>
              <Field
                secret
                label="Extern bewaarde herstelsleutel van dit archief"
                value={restoreSecret}
                onChange={setRestoreSecret}
              />
              <Button
                disabled={busy}
                label="Archief ontsleutelen en controleren"
                onPress={() =>
                  void run(async () => {
                    if (!restoreSecret)
                      throw new Error(
                        "Voer de herstelsleutel van dit archief in.",
                      );
                    const result = await authorizedRequest(
                      session,
                      "/admin/backups/restore-preview",
                      "POST",
                      {
                        archiveId: restoreArchive.id,
                        source: restoreSource,
                        recoverySecret: restoreSecret,
                      },
                    );
                    setRestorePreview(result);
                    await loadBackup();
                  })
                }
              />
              {restorePreview && (
                <>
                  <Text>
                    Controle:{" "}
                    {restorePreview.state ||
                      restorePreview.status ||
                      "Aangevraagd"}
                  </Text>
                  <Button
                    disabled={busy}
                    label="Herstelcontrole verversen"
                    onPress={() =>
                      void run(async () =>
                        setRestorePreview(
                          await authorizedRequest(
                            session,
                            "/admin/backups/jobs/" + restorePreview.id,
                          ),
                        ),
                      )
                    }
                  />
                  {(restorePreview.state || restorePreview.status) ===
                    "completed" && (
                    <>
                      <Text>
                        Manifest gecontroleerd. Bestandshash:{" "}
                        {restorePreview.result?.sha256}
                      </Text>
                      <Text>
                        Herstel vervangt de huidige gegevens. Controleer het
                        archief, de doelserver en bewaar eerst een actuele
                        back-up.
                      </Text>
                      <Field
                        label={`Typ HERSTEL ${restoreArchive.id}`}
                        value={restoreConfirmation}
                        onChange={setRestoreConfirmation}
                      />
                      <Button
                        disabled={
                          busy ||
                          restoreConfirmation !== "HERSTEL " + restoreArchive.id
                        }
                        label="Gecontroleerd herstel starten"
                        onPress={() =>
                          Alert.alert(
                            "Huidige server herstellen?",
                            "Dit vervangt gegevens en kan je sessie beëindigen. Alleen doorgaan als het geselecteerde archief en de doelserver kloppen.",
                            [
                              { text: "Annuleren", style: "cancel" },
                              {
                                text: "Herstel starten",
                                style: "destructive",
                                onPress: () =>
                                  void run(async () => {
                                    await authorizedRequest(
                                      session,
                                      "/admin/backups/restore",
                                      "POST",
                                      {
                                        previewId: restorePreview.id,
                                        confirm: restoreConfirmation,
                                        recoverySecret: restoreSecret,
                                      },
                                    );
                                    setRestoreSecret("");
                                    setRestoreConfirmation("");
                                    setNotice(
                                      "Herstel aangevraagd. Wacht op de back-upservice en meld je daarna opnieuw aan.",
                                    );
                                    await loadBackup();
                                  }),
                              },
                            ],
                          )
                        }
                      />
                    </>
                  )}
                </>
              )}
            </View>
          )}
        </>
      )}
      {section === "onedrive" && (
        <OneDriveSettings
          session={session}
          onSaved={() => void run(loadSettings)}
        />
      )}
    </View>
  );
}
function OneDriveSettings({
  session,
  onSaved,
}: {
  session: Session;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [clientId, setClientId] = useState(""),
    [tenant, setTenant] = useState("consumers"),
    [folder, setFolder] = useState("TuinWerk Backups"),
    [flow, setFlow] = useState<Row | null>(null),
    [transfers, setTransfers] = useState<Row[]>([]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "OneDrive-actie mislukt.");
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    const value = await authorizedRequest(session, "/admin/onedrive/status");
    setStatus(value);
    setClientId(value.clientId || "");
    setTenant(value.tenant || "consumers");
    setFolder(value.folder || "TuinWerk Backups");
    setTransfers(await authorizedRequest(session, "/admin/onedrive/transfers"));
  }
  useEffect(() => {
    void run(load);
  }, [session.user.id, session.endpoint]);
  useEffect(() => {
    if (!flow || (flow.status && flow.status !== "pending")) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= Date.parse(flow.expiresAt)) {
        setFlow((previous) =>
          previous ? { ...previous, status: "expired" } : null,
        );
        return;
      }
      try {
        const value = await authorizedRequest(
          session,
          "/admin/onedrive/connect/" + flow.id + "/poll",
          "POST",
          {},
        );
        if (cancelled) return;
        setFlow((previous) => (previous ? { ...previous, ...value } : null));
        if (value.status === "connected") {
          await load();
          onSaved();
          return;
        }
        if (value.status !== "pending") return;
        timer = setTimeout(
          () => void poll(),
          Math.max(5, value.interval || 5) * 1000,
        );
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Aanmelding controleren is mislukt.",
          );
      }
    };
    timer = setTimeout(
      () => void poll(),
      Math.max(5, flow.interval || 5) * 1000,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow?.id]);
  async function openMicrosoft() {
    if (!flow) return;
    const url = new URL(flow.verificationUri);
    if (
      url.protocol !== "https:" ||
      ![
        "microsoft.com",
        "www.microsoft.com",
        "login.microsoftonline.com",
      ].includes(url.hostname)
    )
      throw new Error("De aanmeldlink verwijst niet naar Microsoft.");
    await Linking.openURL(url.toString());
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={s.title}>OneDrive voor back-ups</Text>
      <Text style={s.text}>
        TuinWerk vraagt alleen toegang tot de eigen appmap. Aanmelden gebeurt
        bij Microsoft; je Microsoft-wachtwoord en toegangstokens worden niet in
        deze app ingevoerd of getoond.
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      {status && (
        <View style={s.card}>
          <Text>
            {status.connected ? "Verbonden" : "Niet verbonden"}
            {status.account ? " · " + status.account : ""}
          </Text>
          <Text>Map: {status.folder}</Text>
        </View>
      )}
      <Field
        label="Microsoft Application (client) ID"
        value={clientId}
        onChange={setClientId}
      />
      <Text style={s.text}>
        Gebruik de Application-ID van je eigen Microsoft-appregistratie met
        publieke client/device-code-aanmelding en de appmapmachtiging. Dit is
        een openbare identificatie, geen geheime sleutel.
      </Text>
      <Select
        label="Accountsoort"
        value={tenant}
        onChange={setTenant}
        options={{
          consumers: "Persoonlijk Microsoft-account",
          organizations: "Werk- of schoolaccount",
          common: "Beide accountsoorten",
        }}
      />
      {!["consumers", "organizations", "common"].includes(tenant) && (
        <Field
          label="Specifieke tenant-ID"
          value={tenant}
          onChange={setTenant}
        />
      )}
      <Field
        label="Submap binnen de TuinWerk-appmap"
        value={folder}
        onChange={setFolder}
      />
      <Button
        disabled={busy}
        label="OneDrive-instellingen opslaan"
        onPress={() =>
          void run(async () => {
            const result = await authorizedRequest(
              session,
              "/admin/onedrive/config",
              "PUT",
              { clientId: clientId.trim(), tenant, folder: folder.trim() },
            );
            setStatus(result);
            setFlow(null);
            onSaved();
          })
        }
      />
      <Button
        disabled={busy || !status?.configured}
        label="Microsoft-account verbinden"
        onPress={() =>
          void run(async () => {
            const result = await authorizedRequest(
              session,
              "/admin/onedrive/connect",
              "POST",
              {},
            );
            setFlow({ ...result, status: "pending" });
          })
        }
      />
      {flow && (
        <View style={s.card}>
          <Text>Aanmeldstatus: {flow.status || "pending"}</Text>
          {flow.status === "pending" && (
            <>
              <Text>Open Microsoft en voer deze eenmalige code in:</Text>
              <Text selectable style={s.title}>
                {flow.userCode}
              </Text>
              <Text>
                Geldig tot{" "}
                {new Date(flow.expiresAt).toLocaleTimeString("nl-NL")}
              </Text>
              <Button
                disabled={busy}
                label="Microsoft-aanmelding openen"
                onPress={() => void run(openMicrosoft)}
              />
              <Button
                disabled={busy}
                label="Aanmelding nu controleren"
                onPress={() =>
                  void run(async () => {
                    const result = await authorizedRequest(
                      session,
                      "/admin/onedrive/connect/" + flow.id + "/poll",
                      "POST",
                      {},
                    );
                    setFlow({ ...flow, ...result });
                    if (result.status === "connected") {
                      await load();
                      onSaved();
                    }
                  })
                }
              />
            </>
          )}
        </View>
      )}
      {status?.connected && (
        <Button
          disabled={busy}
          label="OneDrive ontkoppelen"
          onPress={() =>
            Alert.alert(
              "OneDrive ontkoppelen?",
              "De opgeslagen servermachtiging wordt verwijderd. Bestaande back-ups in OneDrive blijven bestaan.",
              [
                { text: "Annuleren", style: "cancel" },
                {
                  text: "Ontkoppelen",
                  onPress: () =>
                    void run(async () => {
                      await authorizedRequest(
                        session,
                        "/admin/onedrive/connection",
                        "DELETE",
                      );
                      setFlow(null);
                      await load();
                      onSaved();
                    }),
                },
              ],
            )
          }
        />
      )}
      <Button
        disabled={busy}
        label="Verbindingsstatus en overdrachten vernieuwen"
        onPress={() => void run(load)}
      />
      <Text style={s.title}>Overdrachten</Text>
      {transfers.map((row) => (
        <View key={row.id} style={s.card}>
          <Text>
            {row.direction === "upload" ? "Upload" : "Download"} · {row.state}
          </Text>
          <Text>
            {row.bytesTransferred || 0} / {row.size} bytes
          </Text>
          {row.error && <Text style={s.error}>{row.error}</Text>}
        </View>
      ))}
    </View>
  );
}
