import { IntegrationChecks } from "./IntegrationChecks";
import { ModerationScreen } from "./ModerationScreen";
import React, { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Session, authorizedRequest } from "./api";
import { ServerSettingsScreen } from "./ServerSettingsScreen";
import { AccountScreen } from "./AccountScreen";
import {
  NativeButton as Button,
  NativeField as Field,
  NativeSelect as Select,
  nativeStyles as s,
} from "./NativeWidgets";
type Row = Record<string, any>;
export function ManagementScreen({
  session,
  catalogs,
  onRefresh,
  pendingCount = 0,
  syncing = false,
  onDeleteAccount,
}: {
  session: Session;
  catalogs: Record<string, Row[]>;
  onRefresh: () => Promise<void>;
  pendingCount?: number;
  syncing?: boolean;
  onDeleteAccount?: (input: {
    password: string;
    otp?: string;
    confirmation: string;
  }) => Promise<void>;
}) {
  const [page, setPage] = useState("reports"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [asset, setAsset] = useState(""),
    [location, setLocation] = useState(""),
    [assignee, setAssignee] = useState(""),
    [reportType, setReportType] = useState("tasks"),
    [summary, setSummary] = useState<Row | null>(null),
    [jobs, setJobs] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]),
    [sessions, setSessions] = useState<Row[]>([]),
    [status, setStatus] = useState<Row | null>(null),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("employee");
  const [importFile, setImportFile] = useState<{
      uri: string;
      name: string;
    } | null>(null),
    [aiStatus, setAiStatus] = useState<Row | null>(null),
    [aiText, setAiText] = useState(""),
    [aiSuggestion, setAiSuggestion] = useState(""),
    [aiTitle, setAiTitle] = useState(""),
    [templates, setTemplates] = useState<Row[]>([]),
    [template, setTemplate] = useState<Row>({
      name: "",
      title: "",
      description: "",
      checklist: "",
    });
  const [csv, setCsv] = useState(""),
    [kind, setKind] = useState("tasks"),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Row | null>(null);
  const [mfaPassword, setMfaPassword] = useState(""),
    [otp, setOtp] = useState(""),
    [mfa, setMfa] = useState<Row | null>(null),
    [mfaSetup, setMfaSetup] = useState<Row | null>(null),
    [recovery, setRecovery] = useState<string[]>([]);
  const [catalog, setCatalog] = useState("locations"),
    [editing, setEditing] = useState<Row | null>(null),
    [form, setForm] = useState<Row>({}),
    [history, setHistory] = useState<Row | null>(null);
  const [preferences, setPreferences] = useState<Row | null>(null),
    [notificationPreferences, setNotificationPreferences] =
      useState<Row | null>(null);
  const [deletionType, setDeletionType] = useState("task"),
    [deletionId, setDeletionId] = useState(""),
    [deletionReason, setDeletionReason] = useState("");
  const choices = (key: string) => ({
    "": "Alle / geen",
    ...Object.fromEntries(
      (catalogs[key] || []).map((row) => [row.id, row.name]),
    ),
  });
  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setAiStatus(await authorizedRequest(session, "/ai/status"));
    setTemplates(await authorizedRequest(session, "/templates"));
    setSessions(await authorizedRequest(session, "/auth/sessions"));
    setPreferences(await authorizedRequest(session, "/profile/preferences"));
    setNotificationPreferences(
      await authorizedRequest(session, "/notifications/preferences"),
    );
    if (session.user.role === "admin") {
      setUsers(await authorizedRequest(session, "/users"));
      setStatus(await authorizedRequest(session, "/admin/status"));
      setMfa(await authorizedRequest(session, "/auth/mfa"));
    }
  }
  useEffect(() => {
    void run(load);
  }, [session.user.id]);
  const reportFilters = () =>
    Object.fromEntries(
      Object.entries(
        reportType === "inventory"
          ? { type: reportType, locationId: location }
          : {
              type: reportType,
              from,
              to,
              assetId: asset,
              locationId: location,
              assigneeId: assignee,
            },
      ).filter(([, v]) => v),
    );
  async function download(path: string, extension: string) {
    await authorizedRequest(session, "/auth/me");
    const uri =
      FileSystem.cacheDirectory +
      `tuinwerk-${Crypto.randomUUID()}.${extension}`;
    const result = await FileSystem.downloadAsync(
      session.endpoint + path,
      uri,
      { headers: { Authorization: "Bearer " + session.token } },
    );
    if (result.status !== 200) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      throw new Error("Bestand kon niet worden opgehaald.");
    }
    await Sharing.shareAsync(uri);
  }
  const updateField = (key: string, value: any) =>
    setForm({ ...form, [key]: value });
  const fields =
    catalog === "locations"
      ? { name: "Naam", type: "Locatietype" }
      : catalog === "assets"
        ? {
            name: "Naam",
            manufacturer: "Fabrikant",
            model: "Model",
            serialNumber: "Serienummer",
            notes: "Notities",
            installationDate: "Installatiedatum (YYYY-MM-DD)",
            warrantyDate: "Garantie/keuringsdatum (YYYY-MM-DD)",
          }
        : {
            name: "Naam",
            sku: "Artikelnummer",
            unit: "Eenheid",
            minimum: "Minimumvoorraad",
            category: "Categorie",
            description: "Omschrijving",
            supplier: "Leverancier (referentie)",
            supplierSku: "Leveranciersartikelnummer",
            price: "Prijsindicatie",
          };
  return (
    <View style={{ gap: 12 }}>
      <Select
        label="Werkruimte"
        value={page}
        onChange={setPage}
        options={{
          reports: "Rapporten",
          templates: "Taaksjablonen",
          ai: "Taakvoorstel",
          catalog: "Machines / locaties / artikelen",
          preferences: "Voorkeuren",
          account: "Mijn account en privacy",
          moderation: "Meldingen beoordelen",
          sessions: "Apparaten",
          ...(session.user.role === "admin"
            ? {
                admin: "Beheer",
                company: "Bedrijf",
                integrations: "Integraties",
                backups: "Back-ups",
                security: "Beveiliging",
                imports: "Import",
                mfa: "Tweede factor",
              }
            : {}),
        }}
      />
      {!!error && <Text style={s.error}>{error}</Text>}
      {!!message && <Text style={s.text}>{message}</Text>}
      {page === "reports" && (
        <>
          <Text style={s.title}>Rapporten en storingsstatistiek</Text>
          <Select
            label="Gegevens"
            value={reportType}
            onChange={setReportType}
            options={{ tasks: "Werkzaamheden", inventory: "Voorraad" }}
          />
          {reportType === "tasks" && (
            <>
              <Field
                label="Vanaf aanmaakdatum (YYYY-MM-DD)"
                value={from}
                onChange={setFrom}
              />
              <Field
                label="Tot en met datum (YYYY-MM-DD)"
                value={to}
                onChange={setTo}
              />
              <Select
                label="Machine"
                value={asset}
                onChange={setAsset}
                options={choices("assets")}
              />
              <Select
                label="Medewerker"
                value={assignee}
                onChange={setAssignee}
                options={choices("users")}
              />
            </>
          )}
          <Select
            label="Locatie"
            value={location}
            onChange={setLocation}
            options={choices("locations")}
          />
          {reportType === "tasks" && (
            <Button
              label="Statistieken berekenen"
              disabled={busy}
              onPress={() =>
                void run(async () =>
                  setSummary(
                    await authorizedRequest(
                      session,
                      "/reports/summary?" +
                        new URLSearchParams(reportFilters()),
                    ),
                  ),
                )
              }
            />
          )}{" "}
          {summary && (
            <View style={s.card}>
              <Text>{summary.definition}</Text>
              {Object.entries({
                Taken: summary.total,
                Open: summary.open,
                Afgerond: summary.completed,
                Geblokkeerd: summary.blocked,
                Achterstallig: summary.overdue,
                Minuten: summary.minutes,
                "Gemiddelde doorlooptijd (uur)":
                  summary.meanResolutionHours ?? "Niet beschikbaar",
                "Aantal afgeronde taken": summary.sampleSize,
              }).map(([key, value]) => (
                <Text key={key}>
                  {key}: {value}
                </Text>
              ))}
              {Object.entries(summary.faultsByAsset || {}).map(
                ([key, value]) => (
                  <Text key={key}>
                    Storingen {key}: {String(value)}
                  </Text>
                ),
              )}
            </View>
          )}
          {["pdf", "xlsx", "csv"].map((format) => (
            <Button
              key={format}
              disabled={busy}
              label={`Gefilterde ${format.toUpperCase()} delen`}
              onPress={() =>
                void run(() =>
                  download(
                    "/reports/export?" +
                      new URLSearchParams({ ...reportFilters(), format }),
                    format,
                  ),
                )
              }
            />
          ))}
          <Button
            label="Grote Excel-export in achtergrond starten"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await authorizedRequest(session, "/reports/jobs", "POST", {
                  ...reportFilters(),
                  format: "xlsx",
                });
                setJobs(await authorizedRequest(session, "/reports/jobs"));
              })
            }
          />
          <Button
            label="Exportvoortgang verversen"
            onPress={() =>
              void run(async () =>
                setJobs(await authorizedRequest(session, "/reports/jobs")),
              )
            }
          />
          {jobs.map((job) => (
            <View key={job.id} style={s.card}>
              <Text>
                {job.filters?.type} · {job.status}
              </Text>
              {!!job.error && <Text>{job.error}</Text>}
              {job.status === "completed" && (
                <Button
                  label="Export delen"
                  onPress={() =>
                    void run(() =>
                      download(
                        "/reports/jobs/" + job.id + "/download",
                        job.filters.format,
                      ),
                    )
                  }
                />
              )}
            </View>
          ))}
        </>
      )}
      {page === "catalog" && (
        <>
          <Select
            label="Catalogus"
            value={catalog}
            onChange={(value) => {
              setCatalog(value);
              setEditing(null);
              setForm({});
              setHistory(null);
            }}
            options={{
              locations: "Locaties",
              assets: "Machines",
              "inventory/items": "Artikelen",
            }}
          />
          <Button
            label="Nieuw object"
            onPress={() => {
              setEditing(null);
              setForm({});
              setHistory(null);
            }}
          />
          {(catalogs[catalog] || []).map((row) => (
            <View key={row.id} style={s.card}>
              <Button
                label={row.name}
                onPress={() => {
                  setEditing(row);
                  setForm({ ...row });
                  setHistory(null);
                }}
              />
              {catalog === "assets" && (
                <Button
                  label="Machinehistorie"
                  onPress={() =>
                    void run(async () =>
                      setHistory(
                        await authorizedRequest(
                          session,
                          "/assets/" + row.id + "/history",
                        ),
                      ),
                    )
                  }
                />
              )}
              <Button
                label="QR-label PDF delen"
                onPress={() =>
                  void run(() =>
                    download(
                      "/qr/" +
                        (catalog === "assets"
                          ? "asset"
                          : catalog === "locations"
                            ? "location"
                            : "item") +
                        "/" +
                        row.id,
                      "pdf",
                    ),
                  )
                }
              />
            </View>
          ))}
          {history && (
            <View style={s.card}>
              <Text style={s.title}>Machinehistorie</Text>
              {history.tasks?.map((row: Row) => (
                <Text key={row.id}>
                  {row.title} · {row.status} ·{" "}
                  {row.completedAt || "Nog niet afgerond"}
                </Text>
              ))}
              {history.parts?.map((row: Row) => (
                <Text key={row.id}>
                  {row.itemName}: {row.delta} · {row.createdAt}
                </Text>
              ))}
              {history.events?.map((row: Row) => (
                <Text key={row.id}>
                  {row.action} · {row.createdAt}
                </Text>
              ))}
            </View>
          )}
          <Text style={s.title}>
            {editing ? "Object bewerken" : "Object toevoegen"}
          </Text>
          {Object.entries(fields).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={String(form[key] ?? "")}
              onChange={(value) => updateField(key, value)}
            />
          ))}
          {["locations", "assets"].includes(catalog) && (
            <Select
              label="Bovenliggend object"
              options={{
                "": "Geen",
                ...Object.fromEntries(
                  (catalogs[catalog] || [])
                    .filter((row) => row.id !== editing?.id)
                    .map((row) => [row.id, row.name]),
                ),
              }}
              value={form.parentId || ""}
              onChange={(value) => updateField("parentId", value || null)}
            />
          )}{" "}
          {catalog === "assets" && (
            <Select
              label="Locatie"
              value={form.locationId || ""}
              options={choices("locations")}
              onChange={(value) => updateField("locationId", value || null)}
            />
          )}
          <Button
            disabled={busy}
            label="Object opslaan"
            onPress={() =>
              void run(async () => {
                const payload: Row = { operationId: Crypto.randomUUID() };
                for (const key of Object.keys(fields))
                  if (form[key] !== undefined && form[key] !== "")
                    payload[key] = ["minimum", "price"].includes(key)
                      ? Number(form[key])
                      : form[key];
                if (form.parentId !== undefined)
                  payload.parentId = form.parentId;
                if (form.locationId !== undefined)
                  payload.locationId = form.locationId;
                if (editing) payload.version = editing.version;
                await authorizedRequest(
                  session,
                  "/" + catalog + (editing ? "/" + editing.id : ""),
                  editing ? "PATCH" : "POST",
                  payload,
                );
                await onRefresh();
                setEditing(null);
                setForm({});
                setMessage("Object opgeslagen.");
              })
            }
          />
          {editing && (
            <Button
              label="Archiveren / deactiveren"
              onPress={() =>
                Alert.alert(
                  "Archiveren?",
                  "Historische verwijzingen blijven bewaard.",
                  [
                    { text: "Annuleren", style: "cancel" },
                    {
                      text: "Archiveren",
                      onPress: () =>
                        void run(async () => {
                          await authorizedRequest(
                            session,
                            "/" + catalog + "/" + editing.id,
                            "PATCH",
                            {
                              version: editing.version,
                              operationId: Crypto.randomUUID(),
                              ...(catalog === "assets"
                                ? { status: "archived" }
                                : { active: false }),
                            },
                          );
                          await onRefresh();
                          setEditing(null);
                          setForm({});
                        }),
                    },
                  ],
                )
              }
            />
          )}
        </>
      )}
      {page === "sessions" && (
        <>
          <Text style={s.title}>Aangemelde apparaten</Text>
          <Button
            label="Apparatenlijst vernieuwen"
            onPress={() => void run(load)}
          />
          {sessions.map((row) => (
            <View style={s.card} key={row.id}>
              <Text>
                {row.device} · gestart{" "}
                {new Date(row.createdAt).toLocaleString("nl-NL")}
              </Text>
              <Button
                label="Sessie intrekken"
                onPress={() =>
                  Alert.alert(
                    "Sessie intrekken?",
                    "Dit apparaat moet opnieuw aanmelden.",
                    [
                      { text: "Annuleren", style: "cancel" },
                      {
                        text: "Intrekken",
                        onPress: () =>
                          void run(async () => {
                            await authorizedRequest(
                              session,
                              "/auth/sessions/" + row.id,
                              "DELETE",
                            );
                            await load();
                          }),
                      },
                    ],
                  )
                }
              />
            </View>
          ))}
        </>
      )}
      {page === "preferences" && (
        <>
          <Text style={s.title}>Persoonlijke voorkeuren</Text>
          {preferences && (
            <>
              <Text>Dashboardtegels</Text>
              {["urgent", "overdue", "mine", "inventory", "planning"].map(
                (key) => (
                  <Button
                    key={key}
                    label={`${(preferences.preferences?.dashboardTiles || []).includes(key) ? "✓ " : ""}${({ urgent: "Urgent", overdue: "Achterstallig", mine: "Mijn werk", inventory: "Voorraad", planning: "Planning" } as Row)[key]}`}
                    onPress={() => {
                      const current =
                        preferences.preferences?.dashboardTiles || [];
                      setPreferences({
                        ...preferences,
                        preferences: {
                          ...preferences.preferences,
                          dashboardTiles: current.includes(key)
                            ? current.filter((value: string) => value !== key)
                            : [...current, key],
                        },
                      });
                    }}
                  />
                ),
              )}
              <Button
                label="Dashboardvoorkeuren opslaan"
                onPress={() =>
                  void run(async () => {
                    setPreferences(
                      await authorizedRequest(
                        session,
                        "/profile/preferences",
                        "PATCH",
                        {
                          version: preferences.version,
                          preferences: preferences.preferences,
                        },
                      ),
                    );
                    await onRefresh();
                  })
                }
              />
            </>
          )}
          {notificationPreferences && (
            <>
              <Text style={s.title}>Meldingen</Text>
              {Object.entries({
                inApp: "In-app",
                push: "Push",
                email: "E-mail",
                criticalOverride: "Kritieke meldingen tijdens stille uren",
                weekly: "Weekoverzicht",
              }).map(([key, label]) => (
                <Button
                  key={key}
                  label={`${notificationPreferences[key] ? "✓ " : ""}${label}`}
                  onPress={() =>
                    setNotificationPreferences({
                      ...notificationPreferences,
                      [key]: !notificationPreferences[key],
                    })
                  }
                />
              ))}
              <Field
                label="Stille uren vanaf"
                value={notificationPreferences.quietStart || "22:00"}
                onChange={(quietStart) =>
                  setNotificationPreferences({
                    ...notificationPreferences,
                    quietStart,
                  })
                }
              />
              <Field
                label="Stille uren tot"
                value={notificationPreferences.quietEnd || "07:00"}
                onChange={(quietEnd) =>
                  setNotificationPreferences({
                    ...notificationPreferences,
                    quietEnd,
                  })
                }
              />
              <Button
                label="Meldingsvoorkeuren opslaan"
                onPress={() =>
                  void run(async () =>
                    setNotificationPreferences(
                      await authorizedRequest(
                        session,
                        "/notifications/preferences",
                        "PUT",
                        notificationPreferences,
                      ),
                    ),
                  )
                }
              />
            </>
          )}
        </>
      )}
      {page === "moderation" && <ModerationScreen session={session} />}
      {page === "account" && onDeleteAccount && (
        <AccountScreen
          session={session}
          pendingCount={pendingCount}
          syncing={syncing}
          onDelete={onDeleteAccount}
        />
      )}
      {page === "integrations" && session.user.role === "admin" && (
        <IntegrationChecks session={session} />
      )}
      {["company", "integrations", "backups"].includes(page) &&
        session.user.role === "admin" && (
          <ServerSettingsScreen
            key={page}
            session={session}
            initialSection={
              page === "company"
                ? "general"
                : page === "integrations"
                  ? "mail"
                  : "backups"
            }
          />
        )}
      {page === "security" && session.user.role === "admin" && (
        <View style={s.card}>
          <Text style={s.title}>Beveiliging</Text>
          <Button
            label="Tweede factor beheren"
            onPress={() => setPage("mfa")}
          />
          <Button
            label="Aangemelde apparaten"
            onPress={() => setPage("sessions")}
          />
          <Button
            label="Mijn account en privacy"
            onPress={() => setPage("account")}
          />
        </View>
      )}
      {page === "admin" && session.user.role === "admin" && (
        <>
          <Text style={s.title}>Systeemstatus</Text>
          {status && (
            <View style={s.card}>
              <Text>Database: {status.databaseBytes} bytes</Text>
              <Text>
                Vrije opslag: {status.storage?.availableBytes ?? "Onbekend"}{" "}
                bytes
              </Text>
              <Text>Push: {status.transports?.push}</Text>
              <Text>E-mail: {status.transports?.email}</Text>
              <Text>Back-up: {status.backup?.message}</Text>
            </View>
          )}
          <Button
            label="Volledige data-export delen"
            onPress={() => void run(() => download("/admin/export", "json"))}
          />
          <Text style={s.title}>Accounts</Text>
          {users.map((user) => (
            <View key={user.id} style={s.card}>
              <Text>
                {user.name} · {user.role} ·{" "}
                {user.active ? "Actief" : "Inactief"}
              </Text>
              {user.id !== session.user.id && user.active && (
                <Button
                  label="Account deactiveren"
                  onPress={() =>
                    Alert.alert("Account deactiveren?", user.name, [
                      { text: "Annuleren", style: "cancel" },
                      {
                        text: "Deactiveren",
                        onPress: () =>
                          void run(async () => {
                            await authorizedRequest(
                              session,
                              "/users/" + user.id + "/deactivate",
                              "POST",
                              {},
                            );
                            await load();
                          }),
                      },
                    ])
                  }
                />
              )}
            </View>
          ))}
          <Field label="Naam" value={name} onChange={setName} />
          <Field label="E-mailadres" value={email} onChange={setEmail} />
          <Field
            label="Sterk wachtwoord"
            value={password}
            onChange={setPassword}
            secret
          />
          <Select
            label="Rol"
            value={role}
            onChange={setRole}
            options={{ employee: "Medewerker", admin: "Beheerder" }}
          />
          <Button
            label="Account toevoegen"
            onPress={() =>
              void run(async () => {
                await authorizedRequest(session, "/users", "POST", {
                  name,
                  email,
                  password,
                  role,
                });
                setPassword("");
                setName("");
                setEmail("");
                await load();
              })
            }
          />
          <Text style={s.title}>Definitief verwijderen</Text>
          <Text>
            Alleen reeds gearchiveerde objecten zonder beschermde historische
            verwijzingen kunnen worden verwijderd.
          </Text>
          <Select
            label="Soort"
            value={deletionType}
            onChange={setDeletionType}
            options={{
              task: "Taak",
              asset: "Machine",
              location: "Locatie",
              item: "Artikel",
            }}
          />
          <Field
            label="Exact record-ID ter bevestiging"
            value={deletionId}
            onChange={setDeletionId}
          />
          <Field
            label="Reden"
            value={deletionReason}
            onChange={setDeletionReason}
          />
          <Button
            label="Definitieve verwijdering bevestigen"
            onPress={() =>
              Alert.alert(
                "Definitief verwijderen",
                "Dit kan niet ongedaan worden gemaakt.",
                [
                  { text: "Annuleren", style: "cancel" },
                  {
                    text: "Verwijderen",
                    style: "destructive",
                    onPress: () =>
                      void run(async () => {
                        await authorizedRequest(
                          session,
                          "/admin/data/" + deletionType + "/" + deletionId,
                          "DELETE",
                          { confirm: deletionId, reason: deletionReason },
                        );
                        await onRefresh();
                        setDeletionId("");
                        setDeletionReason("");
                        setMessage("Record definitief verwijderd.");
                      }),
                  },
                ],
              )
            }
          />
        </>
      )}
      {page === "imports" && session.user.role === "admin" && (
        <>
          <Text style={s.title}>CSV-import</Text>
          <Select
            label="Gegevenssoort"
            value={kind}
            onChange={(value) => {
              setKind(value);
              setPreview(null);
              setMapping({});
            }}
            options={{
              tasks: "Taken / Todoist",
              inventory: "Artikelen",
              locations: "Locaties",
            }}
          />
          <Button
            label="CSV- of Excelbestand kiezen"
            onPress={() =>
              void run(async () => {
                const result = await DocumentPicker.getDocumentAsync({
                  type: [
                    "text/csv",
                    "text/comma-separated-values",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/octet-stream",
                  ],
                  copyToCacheDirectory: true,
                });
                if (!result.canceled) {
                  const file = result.assets[0];
                  if ((file.size || 0) > 6 * 1024 * 1024)
                    throw new Error("Bestand maximaal 6 MB.");
                  setImportFile({ uri: file.uri, name: file.name });
                  setPreview(null);
                }
              })
            }
          />
          {importFile && (
            <>
              <Text>Gekozen: {importFile.name}</Text>
              <Button
                label="Bestandsselectie wissen"
                onPress={() => setImportFile(null)}
              />
            </>
          )}
          <Field
            label="Of plak CSV-inhoud inclusief kolomkoppen"
            value={csv}
            onChange={setCsv}
            multiline
          />
          {(kind === "tasks"
            ? ["title", "description", "priority", "deadline", "externalId"]
            : kind === "inventory"
              ? ["name", "sku", "unit", "minimum", "description"]
              : ["path", "type"]
          ).map((key) => (
            <Field
              key={key}
              label={`Kolom voor ${key} (leeg = automatisch)`}
              value={mapping[key] || ""}
              onChange={(value) => setMapping({ ...mapping, [key]: value })}
            />
          ))}
          <Button
            label="Testimport en duplicaten controleren"
            onPress={() =>
              void run(async () => {
                const uri =
                  importFile?.uri ||
                  FileSystem.cacheDirectory +
                    "import-" +
                    Crypto.randomUUID() +
                    ".csv";
                if (!importFile) await FileSystem.writeAsStringAsync(uri, csv);
                try {
                  const content = await FileSystem.readAsStringAsync(uri, {
                    encoding: FileSystem.EncodingType.Base64,
                  });
                  setPreview(
                    await authorizedRequest(
                      session,
                      kind === "tasks"
                        ? "/imports/preview"
                        : "/imports/catalog/preview",
                      "POST",
                      {
                        kind,
                        filename: importFile?.name || "mobiele-import.csv",
                        content,
                        mapping,
                      },
                    ),
                  );
                } finally {
                  if (!importFile)
                    await FileSystem.deleteAsync(uri, { idempotent: true });
                }
              })
            }
          />
          {preview && (
            <View style={s.card}>
              <Text>
                {preview.rows.length} regels · {preview.invalid} ongeldig ·{" "}
                {preview.duplicates} dubbel
              </Text>
              {preview.rows.slice(0, 100).map((row: Row, index: number) => (
                <Text key={index}>
                  {row.line}: {row.title || row.name || row.path}{" "}
                  {row.error || ""} {row.duplicate ? "(dubbel)" : ""}
                </Text>
              ))}
              <Button
                label="Gecontroleerde import uitvoeren"
                onPress={() =>
                  Alert.alert(
                    "Import uitvoeren?",
                    "Geldige, niet-dubbele regels worden toegevoegd.",
                    [
                      { text: "Annuleren", style: "cancel" },
                      {
                        text: "Importeren",
                        onPress: () =>
                          void run(async () => {
                            const result = await authorizedRequest(
                              session,
                              (kind === "tasks"
                                ? "/imports/"
                                : "/imports/catalog/") +
                                preview.id +
                                "/confirm",
                              "POST",
                              {},
                            );
                            setMessage(
                              `Import: ${result.imported} toegevoegd, ${result.skipped} overgeslagen, ${result.invalid} ongeldig.`,
                            );
                            setPreview(null);
                            await onRefresh();
                          }),
                      },
                    ],
                  )
                }
              />
            </View>
          )}
        </>
      )}
      {page === "templates" && (
        <>
          <Text style={s.title}>Taaksjablonen</Text>
          {templates.map((row) => (
            <View key={row.id} style={s.card}>
              <Text style={s.title}>{row.name}</Text>
              <Text>{row.template?.title}</Text>
              <Button
                label="Sjabloon bewerken"
                onPress={() =>
                  setTemplate({
                    id: row.id,
                    version: row.version,
                    name: row.name,
                    ...row.template,
                    checklist: (row.template.checklist || [])
                      .map((line: Row) => line.text)
                      .join("\n"),
                  })
                }
              />
              <Button
                label="Nieuwe taak vanuit sjabloon"
                onPress={() =>
                  Alert.alert("Taak aanmaken?", row.name, [
                    { text: "Annuleren", style: "cancel" },
                    {
                      text: "Aanmaken",
                      onPress: () =>
                        void run(async () => {
                          await authorizedRequest(
                            session,
                            "/templates/" + row.id + "/apply",
                            "POST",
                            { operationId: Crypto.randomUUID() },
                          );
                          await onRefresh();
                          setMessage("Taak aangemaakt.");
                        }),
                    },
                  ])
                }
              />
            </View>
          ))}
          <Button
            label="Nieuw sjabloon"
            onPress={() =>
              setTemplate({
                name: "",
                title: "",
                description: "",
                checklist: "",
              })
            }
          />
          {Object.entries({
            name: "Sjabloonnaam",
            title: "Taaktitel",
            description: "Beschrijving",
            checklist: "Verplichte checklist (één regel per controle)",
          }).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={template[key] || ""}
              multiline={["description", "checklist"].includes(key)}
              onChange={(value) => setTemplate({ ...template, [key]: value })}
            />
          ))}
          <Button
            label="Sjabloon opslaan"
            onPress={() =>
              void run(async () => {
                await authorizedRequest(
                  session,
                  "/templates" + (template.id ? "/" + template.id : ""),
                  template.id ? "PATCH" : "POST",
                  {
                    operationId: Crypto.randomUUID(),
                    version: template.version,
                    name: template.name,
                    template: {
                      title: template.title,
                      description: template.description,
                      checklist: template.checklist
                        .split("\n")
                        .filter(Boolean)
                        .map((text: string) => ({
                          text,
                          required: true,
                          done: false,
                        })),
                    },
                  },
                );
                setTemplate({
                  name: "",
                  title: "",
                  description: "",
                  checklist: "",
                });
                await load();
              })
            }
          />
        </>
      )}
      {page === "ai" && (
        <>
          <Text style={s.title}>Optioneel taakvoorstel</Text>
          <Text>
            {aiStatus?.enabled
              ? "AI ingeschakeld"
              : "AI staat uit. De beheerder kan de optionele provider en budgetten op de server instellen."}
          </Text>
          {aiStatus?.enabled && (
            <>
              <Text>
                Provider: {aiStatus.providerOrigin} · model: {aiStatus.model}.
                Alleen de tekst hieronder wordt na jouw bevestiging gedeeld.
              </Text>
              <Field
                label="Tekst voor voorstel (maximaal 4000 tekens)"
                value={aiText}
                onChange={setAiText}
                multiline
              />
              <Button
                disabled={busy}
                label="Tekst controleren en met provider delen"
                onPress={() =>
                  void run(async () => {
                    const status = await authorizedRequest(
                      session,
                      "/ai/status",
                    );
                    setAiStatus(status);
                    if (
                      !status.enabled ||
                      !status.providerOrigin ||
                      !status.providerConfigId
                    )
                      throw new Error("De AI-provider is niet beschikbaar.");
                    const text = aiText;
                    Alert.alert(
                      "Externe AI-overdracht bevestigen",
                      `Provider: ${status.providerOrigin}\nModel: ${status.model}\nDoel: ${status.purpose}\nGedeeld: ${(status.sharedFields || []).join(", ")}\n\nDeze tekst wordt gedeeld:\n${text}`,
                      [
                        { text: "Annuleren", style: "cancel" },
                        {
                          text: "Versturen",
                          onPress: () =>
                            void run(async () => {
                              try {
                                const result = await authorizedRequest(
                                  session,
                                  "/ai/suggest",
                                  "POST",
                                  {
                                    text,
                                    consent: true,
                                    providerConfigId: status.providerConfigId,
                                  },
                                );
                                setAiSuggestion(result.suggestion);
                              } catch (error) {
                                setAiStatus(
                                  await authorizedRequest(
                                    session,
                                    "/ai/status",
                                  ).catch(() => null),
                                );
                                throw error;
                              }
                            }),
                        },
                      ],
                    );
                  })
                }
              />
              {aiSuggestion && (
                <>
                  <Field
                    label="Door jou gecontroleerde taaktitel"
                    value={aiTitle}
                    onChange={setAiTitle}
                  />
                  <Field
                    label="Voorstel — controleer en wijzig voor toepassen"
                    value={aiSuggestion}
                    onChange={setAiSuggestion}
                    multiline
                  />
                  <Button
                    label="Goedgekeurd voorstel als taak opslaan"
                    onPress={() =>
                      Alert.alert("Taak opslaan?", aiTitle, [
                        { text: "Annuleren", style: "cancel" },
                        {
                          text: "Opslaan",
                          onPress: () =>
                            void run(async () => {
                              await authorizedRequest(
                                session,
                                "/tasks",
                                "POST",
                                {
                                  operationId: Crypto.randomUUID(),
                                  title: aiTitle,
                                  description: aiSuggestion,
                                },
                              );
                              setAiSuggestion("");
                              setAiTitle("");
                              await onRefresh();
                              setMessage("Goedgekeurd voorstel opgeslagen.");
                            }),
                        },
                      ])
                    }
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      {page === "mfa" && session.user.role === "admin" && (
        <>
          <Text style={s.title}>Tweede factor</Text>
          <Text>
            {mfa?.enabled ? "Ingeschakeld" : "Uitgeschakeld"} ·{" "}
            {mfa?.available
              ? "Server geconfigureerd"
              : "Serverbeheer moet eerst de encryptiesleutel configureren"}
          </Text>
          <Field
            label="Huidig wachtwoord"
            value={mfaPassword}
            onChange={setMfaPassword}
            secret
          />
          <Button
            label="Authenticator instellen"
            onPress={() =>
              void run(async () =>
                setMfaSetup(
                  await authorizedRequest(session, "/auth/mfa/setup", "POST", {
                    password: mfaPassword,
                  }),
                ),
              )
            }
          />
          {mfaSetup && (
            <View style={s.card}>
              <Text selectable>
                Voeg deze geheime sleutel toe aan je authenticator:{" "}
                {mfaSetup.secret}
              </Text>
            </View>
          )}
          <Field
            label="Authenticatorcode / herstelcode"
            value={otp}
            onChange={setOtp}
          />
          <Button
            label="Tweede factor inschakelen"
            onPress={() =>
              void run(async () => {
                const result = await authorizedRequest(
                  session,
                  "/auth/mfa/enable",
                  "POST",
                  { otp },
                );
                setRecovery(result.recoveryCodes);
                setMfaSetup(null);
                setMfaPassword("");
                setOtp("");
                await load();
              })
            }
          />
          {recovery.length > 0 && (
            <View style={s.card}>
              <Text>Bewaar deze eenmalige herstelcodes veilig:</Text>
              {recovery.map((code) => (
                <Text selectable key={code}>
                  {code}
                </Text>
              ))}
            </View>
          )}
          <Button
            label="Tweede factor uitschakelen"
            onPress={() =>
              Alert.alert(
                "Tweede factor uitschakelen?",
                "Je account wordt minder sterk beschermd.",
                [
                  { text: "Annuleren", style: "cancel" },
                  {
                    text: "Uitschakelen",
                    onPress: () =>
                      void run(async () => {
                        await authorizedRequest(
                          session,
                          "/auth/mfa/disable",
                          "POST",
                          { password: mfaPassword, otp },
                        );
                        setMfaPassword("");
                        setOtp("");
                        await load();
                      }),
                  },
                ],
              )
            }
          />
        </>
      )}
    </View>
  );
}
