import { ReportContent } from "./src/ModerationScreen";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { PhotoAnnotator } from "./src/PhotoAnnotator";
import { ManagementScreen } from "./src/ManagementScreen";
import { MaintenanceScreen } from "./src/MaintenanceScreen";
import { ConflictEditor } from "./src/ConflictEditor";
import { projectTasks } from "./src/task-cache";
import { TaskWorkPanel } from "./src/TaskWorkPanel";
import { FavoritesPanel } from "./src/FavoritesPanel";
import {
  tasksForToday,
  taskSyncState,
  operationLabel,
  operationTaskId,
} from "./src/work-model";
import {
  taskNotificationTarget,
  taskLinkTarget,
} from "./src/notification-target";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { CameraView, useCameraPermissions } from "expo-camera";
import NetInfo from "@react-native-community/netinfo";
import {
  cacheMedia,
  cacheRead,
  cacheWrite,
  persistPhoto,
  queueRead,
  queueGet,
  queueUpdateExisting,
  removeOwnerData,
  queueRemove,
  queueReplace,
  queueSave,
} from "./src/storage";
import { drainQueue, PendingOperation, RequestError } from "./src/queue";
import {
  allPages,
  activateSession,
  clearSession,
  persistSession,
  authorizedRequest,
  normalizeEndpoint,
  request,
  sendOperation,
  Session,
} from "./src/api";

type Row = Record<string, any>;
const statuses: Record<string, string> = {
  open: "Open",
  planned: "Gepland",
  in_progress: "Bezig",
  blocked: "Geblokkeerd",
  completed: "Afgerond",
  cancelled: "Geannuleerd",
  archived: "Gearchiveerd",
};
const priorities: Record<string, string> = {
  low: "Laag",
  normal: "Normaal",
  high: "Hoog",
  critical: "⚠ Kritiek",
};
const catalogs = [
  "tasks",
  "locations",
  "assets",
  "inventory/items",
  "inventory/balances",
  "schedules",
  "users",
  "notifications",
  "recurrences",
  "templates",
  "profile/favorites",
];
const ownerKey = (session: Session) => `${session.endpoint}|${session.user.id}`;
function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        secondary && styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  multiline = false,
  secure = false,
  keyboard = "default",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  secure?: boolean;
  keyboard?: "default" | "email-address" | "decimal-pad";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        secureTextEntry={secure}
        keyboardType={keyboard}
        autoCapitalize={
          secure || keyboard === "email-address" ? "none" : "sentences"
        }
        style={[
          styles.input,
          multiline && { minHeight: 90, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}
function Choices({
  values,
  value,
  onChange,
}: {
  values: Record<string, string>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {Object.entries(values).map(([id, label]) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          accessibilityState={{ selected: value === id }}
          onPress={() => onChange(id)}
          style={[styles.chip, value === id && styles.chosen]}
        >
          <Text style={value === id ? styles.chosenText : styles.chipText}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [locked, setLocked] = useState(false),
    [biometric, setBiometric] = useState(false);
  const [endpoint, setEndpoint] = useState("https://"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [otp, setOtp] = useState("");
  const [online, setOnline] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState("Home"),
    [data, setData] = useState<Record<string, Row[]>>({}),
    [queue, setQueue] = useState<PendingOperation[]>([]),
    [search, setSearch] = useState("");
  const [advancedTask, setAdvancedTask] = useState(false),
    [category, setCategory] = useState("reparatie"),
    [deadline, setDeadline] = useState(""),
    [plannedAt, setPlannedAt] = useState(""),
    [availableFrom, setAvailableFrom] = useState(""),
    [estimated, setEstimated] = useState(""),
    [tags, setTags] = useState(""),
    [checklistText, setChecklistText] = useState(""),
    [dependencies, setDependencies] = useState<string[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [showTaskDetails, setShowTaskDetails] = useState(false),
    [showTeamSummary, setShowTeamSummary] = useState(false),
    [isSyncing, setIsSyncing] = useState(false),
    [syncingOperation, setSyncingOperation] = useState<string | null>(null),
    [lastSynced, setLastSynced] = useState<string | null>(null),
    [navigationIntent, setNavigationIntent] = useState<{
      id: string;
      data?: unknown;
      url?: string;
    } | null>(null);
  const [selected, setSelected] = useState<Row | null>(null),
    [create, setCreate] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [priority, setPriority] = useState("normal"),
    [locationId, setLocationId] = useState(""),
    [assetId, setAssetId] = useState(""),
    [photo, setPhoto] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [comment, setComment] = useState("");
  const [forecast, setForecast] = useState<Row[]>([]);
  const [dashboardPreferences, setDashboardPreferences] = useState<Row | null>(
      null,
    ),
    [taskView, setTaskView] = useState("all");
  const [extraPage, setExtraPage] = useState(""),
    [zoomImage, setZoomImage] = useState<string | null>(null),
    [zoom, setZoom] = useState(1),
    [conflictCurrent, setConflictCurrent] = useState<Row | null>(null);
  const [details, setDetails] = useState<Record<string, Row[]>>({}),
    [timer, setTimer] = useState<Row | null>(null);
  const [annotating, setAnnotating] = useState(false),
    [annotated, setAnnotated] = useState<string | null>(null),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [pushProject, setPushProject] = useState(""),
    [quietStart, setQuietStart] = useState("22:00"),
    [quietEnd, setQuietEnd] = useState("07:00");
  const [scan, setScan] = useState(false),
    [permission, askPermission] = useCameraPermissions();
  const [assignees, setAssignees] = useState<string[]>([]),
    [partTaskId, setPartTaskId] = useState(""),
    [count, setCount] = useState<Row | null>(null),
    [countName, setCountName] = useState(""),
    [countValues, setCountValues] = useState<Record<string, string>>({});
  const [itemId, setItemId] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [movementType, setMovementType] = useState("usage"),
    [destination, setDestination] = useState("");
  const [minutes, setMinutes] = useState("30"),
    [scheduleTitle, setScheduleTitle] = useState(""),
    [scheduleStart, setScheduleStart] = useState(""),
    [scheduleEnd, setScheduleEnd] = useState(""),
    [shared, setShared] = useState("false");
  const [editOp, setEditOp] = useState<PendingOperation | null>(null),
    [editJson, setEditJson] = useState("");
  const queueEditing = useRef(false);
  const syncing = useRef(false),
    current = useRef<Session | null>(null),
    biometricRef = useRef(false);
  current.current = session;
  biometricRef.current = biometric;
  const displayError = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  async function guard(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      displayError(e);
    } finally {
      setBusy(false);
    }
  }
  async function loadCache(active: Session) {
    const owner = ownerKey(active),
      cached: Record<string, Row[]> = {};
    for (const name of catalogs)
      cached[name] = await cacheRead(owner, name, []);
    const pending = await queueRead(owner),
      savedTimer = await cacheRead(owner, "timer", null);
    const confirmed = await cacheRead<Row[]>(
      owner,
      "tasks:confirmed",
      (cached.tasks || []).filter((task) => !task.localDraft),
    );
    cached.tasks = projectTasks(confirmed, pending);
    if (current.current && ownerKey(current.current) === owner) {
      setData(cached);
      setQueue(pending);
      setTimer(savedTimer);
      setDashboardPreferences(await cacheRead(owner, "preferences", null));
      setLastSynced(await cacheRead(owner, "lastSynced", null));
    }
  }
  async function refresh(active: Session) {
    const values: Record<string, Row[]> = {};
    for (const name of catalogs) {
      try {
        const result = [
          "tasks",
          "inventory/items",
          "inventory/balances",
        ].includes(name)
          ? await allPages(active, "/" + name)
          : await authorizedRequest(active, "/" + name);
        let rows = Array.isArray(result) ? result : result?.items || [];
        if (name === "tasks") {
          await cacheWrite(ownerKey(active), "tasks:confirmed", rows);
          rows = projectTasks(rows, await queueRead(ownerKey(active)));
        }
        values[name] = rows;
        await cacheWrite(ownerKey(active), name, rows);
      } catch (e) {
        if (name === "tasks") throw e;
      }
    }
    try {
      const profile = await authorizedRequest(active, "/profile/preferences");
      await cacheWrite(ownerKey(active), "preferences", profile.preferences);
      if (current.current && ownerKey(current.current) === ownerKey(active))
        setDashboardPreferences(profile.preferences);
    } catch {}
    if (current.current && ownerKey(current.current) === ownerKey(active)) {
      values.tasks = projectTasks(
        await cacheRead<Row[]>(ownerKey(active), "tasks:confirmed", []),
        await queueRead(ownerKey(active)),
      );
      if (current.current !== active) return;
      setData((previous) => ({ ...previous, ...values }));
      setSelected((previous) =>
        previous
          ? (values.tasks || []).find((row) => row.id === previous.id) ||
            previous
          : null,
      );
      setQueue(await queueRead(ownerKey(active)));
    }
  }
  async function sync(active = session) {
    if (!active || syncing.current || queueEditing.current) return;
    syncing.current = true;
    setIsSyncing(true);
    setError("");
    try {
      const operations = await queueRead(ownerKey(active));
      const result = await drainQueue(
        operations,
        ownerKey(active),
        (op) => sendOperation(active, op),
        queueUpdateExisting,
        queueRemove,
        {
          getCurrent: queueGet,
          isActive: () => current.current === active,
          onAttempt: (operation) => setSyncingOperation(operation?.id || null),
        },
      );
      const pending = await queueRead(ownerKey(active));
      if (!current.current || ownerKey(current.current) !== ownerKey(active))
        return;
      setQueue(pending);
      await refresh(active);
      if (current.current !== active) return;
      const stamp = new Date().toISOString();
      await cacheWrite(ownerKey(active), "lastSynced", stamp);
      setLastSynced(stamp);
      if (result.sent)
        setNotice(`${result.sent} wijziging(en) bevestigd door de server.`);
    } catch (e) {
      displayError(e);
    } finally {
      syncing.current = false;
      setIsSyncing(false);
      setSyncingOperation(null);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync("session");
        const bio = await SecureStore.getItemAsync("biometric");
        setBiometric(bio === "true");
        if (saved) {
          const active = JSON.parse(saved);
          activateSession(active);
          current.current = active;
          setSession(active);
          setLocked(bio === "true");
          await loadCache(active);
        }
        const url = await SecureStore.getItemAsync("endpoint");
        if (url) setEndpoint(url);
      } catch (e) {
        displayError(e);
      } finally {
        setReady(true);
      }
    })();
    const unsubscribe = NetInfo.addEventListener((state) => {
      const available =
        !!state.isConnected && state.isInternetReachable !== false;
      setOnline(available);
      if (available && current.current) void sync(current.current);
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && biometricRef.current) setLocked(true);
      if (state === "active" && current.current) void sync(current.current);
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
  async function login() {
    await guard(async () => {
      const url = normalizeEndpoint(endpoint);
      const result = await request(url, undefined, "/auth/login", "POST", {
        email,
        password,
        otp,
      });
      const active = {
        token: result.token,
        refreshToken: result.refreshToken,
        user: result.user,
        endpoint: url,
      };
      activateSession(active);
      await persistSession(active);
      await SecureStore.setItemAsync("endpoint", url);
      current.current = active;
      setSession(active);
      setPassword("");
      setOtp("");
      await loadCache(active);
      await sync(active);
    });
  }
  async function enqueue(
    path: string,
    payload: Row,
    method: "POST" | "PATCH" = "POST",
    fileUri?: string,
  ) {
    if (!session || current.current !== session)
      throw new Error("Meld je opnieuw aan.");
    if (queueEditing.current)
      throw new Error(
        "Wacht totdat de huidige account- of conceptactie klaar is.",
      );
    if ((await queueRead(ownerKey(session))).length >= 500)
      throw new Error(
        "Maximaal 500 wachtende wijzigingen. Synchroniseer eerst.",
      );
    const outstanding = await queueRead(ownerKey(session));
    if (
      outstanding.some(
        (operation) =>
          operation.path === path && operation.status !== "pending",
      )
    )
      throw new Error(
        "Los eerst het bestaande conflict voor deze taak op onder Meer → Synchronisatie.",
      );
    const operation: PendingOperation = {
      id: Crypto.randomUUID(),
      owner: ownerKey(session),
      method,
      path,
      payload,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    if (fileUri) {
      operation.fileUri = await persistPhoto(fileUri, operation.id);
      operation.mimeType = "image/jpeg";
      operation.filename = "foto.jpg";
    }
    await queueSave(operation);
    const pending = await queueRead(ownerKey(session));
    if (current.current !== session) return;
    setQueue(pending);
    if (path === "/tasks" || /^\/tasks\/[^/]+$/.test(path)) {
      const cached = await cacheRead<Row[]>(
        ownerKey(session),
        "tasks:confirmed",
        (data.tasks || []).filter((task) => !task.localDraft),
      );
      const projected = projectTasks(
        cached,
        await queueRead(ownerKey(session)),
      );
      await cacheWrite(ownerKey(session), "tasks", projected);
      if (current.current !== session) return;
      setData((previous) => ({ ...previous, tasks: projected }));
      setSelected((previous) =>
        previous
          ? projected.find((row) => row.id === previous.id) || previous
          : null,
      );
    }
    setNotice("Lokaal veilig opgeslagen. Wacht op serverbevestiging.");
  }
  async function pickPhoto(camera: boolean) {
    await guard(async () => {
      if (camera) {
        const access = await ImagePicker.requestCameraPermissionsAsync();
        if (!access.granted)
          throw new Error(
            "Geen cameratoegang. Kies een bestaande foto via de fotoknop of ga zonder foto verder. Je kunt cameratoegang later in de telefooninstellingen toestaan.",
          );
      }
      // The system photo picker grants access only to the selected image.
      // It does not require broad photo-library permission.
      const result = await (
        camera
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync
      )({ mediaTypes: ["images"], quality: 0.75, allowsEditing: false });
      if (!result.canceled) {
        setPhoto(result.assets[0].uri);
        setAnnotated(null);
      }
    });
  }
  function beginTask(context: { assetId?: string; locationId?: string } = {}) {
    setAssetId(context.assetId || "");
    setLocationId(context.locationId || "");
    setPriority("normal");
    setCategory("reparatie");
    setDeadline("");
    setPlannedAt("");
    setAvailableFrom("");
    setEstimated("");
    setTags("");
    setChecklistText("");
    setDependencies([]);
    setAdvancedTask(false);
    setEditing(null);
    setTitle("");
    setDescription("");
    setAssignees([]);
    setPhoto(null);
    setAnnotated(null);
    setCreate(true);
  }
  async function saveTask() {
    await guard(async () => {
      if (!title.trim()) throw new Error("Vul een titel in.");
      const id = editing?.id || Crypto.randomUUID();
      const payload = {
        title: title.trim(),
        description,
        priority,
        category,
        assignedTo: assignees,
        locationId: locationId || null,
        assetId: assetId || null,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        plannedAt: plannedAt ? new Date(plannedAt).toISOString() : null,
        availableFrom: availableFrom
          ? new Date(availableFrom).toISOString()
          : null,
        estimatedMinutes: estimated ? Number(estimated) : null,
        tags: tags
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        dependencies,
        checklist: checklistText
          .split("\n")
          .map((text) => text.trim())
          .filter(Boolean)
          .map(
            (text) =>
              editing?.checklist?.find((item: Row) => item.text === text) || {
                text,
                required: true,
                done: false,
              },
          ),
      };
      if (editing)
        await enqueue(
          "/tasks/" + id,
          { ...payload, version: editing.version },
          "PATCH",
        );
      else await enqueue("/tasks", { id, ...payload });
      setCreate(false);
      setEditing(null);
      setSelected({
        ...payload,
        id,
        version: editing ? editing.version + 1 : 1,
        status: editing?.status || "open",
        localDraft: true,
      });
      if (photo)
        await enqueue(
          "/attachments",
          { taskId: id, phase: "before" },
          "POST",
          photo,
        );
      if (annotated)
        await enqueue(
          "/attachments",
          { taskId: id, phase: "before" },
          "POST",
          annotated,
        );
      setCreate(false);
      setEditing(null);
      setSelected(null);
      setTitle("");
      setDescription("");
      setPhoto(null);
      setAnnotated(null);
      await sync();
    });
  }
  async function changeStatus(status: string, providedReason = reason) {
    await guard(async () => {
      if (!selected) return;
      if (
        (status === "blocked" || selected.status === "completed") &&
        !providedReason.trim()
      )
        throw new Error("Vul een reden voor blokkeren of heropenen in.");
      await enqueue(
        "/tasks/" + selected.id,
        { version: selected.version, status, reason: providedReason },
        "PATCH",
      );
      setReason("");
      await sync();
    });
  }
  async function deleteOwnAccount(input: {
    password: string;
    otp?: string;
    confirmation: string;
  }) {
    const active = current.current;
    if (!active) throw new Error("Meld je opnieuw aan.");
    if (syncing.current || queueEditing.current)
      throw new Error("Wacht totdat de synchronisatie klaar is.");
    queueEditing.current = true;
    try {
      const result = await authorizedRequest(
        active,
        "/auth/account",
        "DELETE",
        input,
      );
      if (!result.deleted) throw new Error("Verwijdering niet bevestigd.");
      current.current = null;
      setSession(null);
      await clearSession();
      setData({});
      setQueue([]);
      setSelected(null);
      setTimer(null);
      setNavigationIntent(null);
      setDetails({});
      setPhoto(null);
      setAnnotated(null);
      setEditOp(null);
      setEditJson("");
      setConflictCurrent(null);
      setDashboardPreferences(null);
      setForecast([]);
      setEmail("");
      try {
        await removeOwnerData(ownerKey(active));
      } catch {
        setError(
          "Je account is verwijderd, maar lokale bestanden konden niet volledig worden gewist. Verwijder de appgegevens via de toestelinstellingen.",
        );
        return;
      }
      await Notifications.clearLastNotificationResponseAsync().catch(() => {});
      setNotice(
        result.message ||
          "Je account en lokale accountgegevens zijn verwijderd.",
      );
    } finally {
      queueEditing.current = false;
    }
  }
  async function openPublicPage(path: "/privacy" | "/support") {
    await guard(async () => {
      const url = session?.endpoint || normalizeEndpoint(endpoint);
      await Linking.openURL(url.replace(/\/api$/, "") + path);
    });
  }
  async function logout() {
    const execute = async () => {
      current.current = null;
      setSession(null);
      setSelected(null);
      setData({});
      setQueue([]);
      setLocked(false);
      await clearSession();
      try {
        if (session && online)
          await request(
            session.endpoint,
            session.token,
            "/auth/logout",
            "POST",
            {},
          );
      } catch {}
      setSession(null);
      setSelected(null);
      setData({});
      setQueue([]);
      setLocked(false);
    };
    Alert.alert(
      "Uitloggen",
      queue.length
        ? "Je lokale concepten blijven op dit toestel bewaard voor dit account."
        : "Deze sessie beëindigen?",
      [
        { text: "Annuleren", style: "cancel" },
        { text: "Uitloggen", onPress: () => void execute() },
      ],
    );
  }
  async function unlock() {
    await guard(async () => {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "TuinWerk ontgrendelen",
      });
      if (result.success) setLocked(false);
      else throw new Error("Ontgrendelen geannuleerd.");
    });
  }
  async function exportReport(format: "pdf" | "xlsx" | "csv", type = "tasks") {
    if (!session) return;
    await guard(async () => {
      await authorizedRequest(session, "/auth/me");
      const filename =
        FileSystem.cacheDirectory + `tuinwerk-${type}-${Date.now()}.${format}`;
      const download = await FileSystem.downloadAsync(
        session.endpoint + `/reports/export?format=${format}&type=${type}`,
        filename,
        { headers: { Authorization: `Bearer ${session.token}` } },
      );
      if (download.status !== 200) {
        await FileSystem.deleteAsync(filename, { idempotent: true });
        throw new Error("Export kon niet worden opgehaald.");
      }
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(filename, {
          mimeType:
            format === "pdf"
              ? "application/pdf"
              : format === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "text/csv",
        });
      else
        throw new Error("Bestanden delen is op dit toestel niet beschikbaar.");
    });
  }
  async function registerPush() {
    if (!session) return;
    await guard(async () => {
      if (!pushProject.trim())
        throw new Error("Voer de EAS-project-ID van je eigen build in.");
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("default", {
          name: "Werkmeldingen",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      const permission = await Notifications.requestPermissionsAsync();
      if (permission.status !== "granted")
        throw new Error("Meldingentoestemming is niet verleend.");
      const result = await Notifications.getExpoPushTokenAsync({
        projectId: pushProject.trim(),
      });
      await authorizedRequest(session, "/notifications/devices", "POST", {
        token: result.data,
        platform: Platform.OS,
      });
      await authorizedRequest(session, "/notifications/preferences", "PUT", {
        inApp: true,
        push: true,
        email: false,
        quietStart,
        quietEnd,
        criticalOverride: false,
        weekly: true,
      });
      setNotice(
        "Dit toestel is geregistreerd. De beheerder moet push op de server inschakelen en signing configureren.",
      );
    });
  }
  useEffect(() => {
    if (!selected || !session) return;
    const taskId = selected.id,
      active = session;
    let cancelled = false;
    (async () => {
      const cached = await cacheRead<Record<string, Row[]>>(
        ownerKey(active),
        "detail:" + taskId,
        {},
      );
      if (!cancelled && current.current === active) setDetails(cached);
      if (!online) return;
      const loaded: Record<string, Row[]> = {};
      for (const [name, path] of Object.entries({
        comments: "/tasks/" + taskId + "/comments",
        history: "/tasks/" + taskId + "/history",
        time: "/tasks/" + taskId + "/time",
        attachments: "/attachments?taskId=" + taskId,
      })) {
        try {
          loaded[name] = await authorizedRequest(active, path);
          if (name === "attachments") {
            for (const attachment of loaded[name]) {
              if (attachment.mimeType?.startsWith("image/")) {
                try {
                  attachment.localUri = await cacheMedia(
                    ownerKey(active),
                    attachment.id,
                    active.endpoint + "/attachments/" + attachment.id + "/file",
                    active.token,
                  );
                } catch {}
              }
            }
          }
        } catch {}
      }
      await cacheWrite(ownerKey(active), "detail:" + taskId, loaded);
      if (!cancelled && current.current === active) setDetails(loaded);
    })().catch(displayError);
    return () => {
      cancelled = true;
    };
  }, [selected?.id, session?.user.id]);
  async function timerAction(action: "start" | "pause" | "stop") {
    if (!session || !selected) return;
    await guard(async () => {
      const now = Date.now();
      let next: Row | null = timer;
      if (action === "start") {
        if (timer && timer.taskId !== selected.id)
          throw new Error("Stop eerst de timer van de andere taak.");
        next = {
          taskId: selected.id,
          startedAt: timer?.startedAt || new Date(now).toISOString(),
          elapsedMs: timer?.elapsedMs || 0,
          runningSince: now,
        };
      } else if (timer) {
        const elapsed =
          timer.elapsedMs + (timer.runningSince ? now - timer.runningSince : 0);
        if (action === "pause")
          next = { ...timer, elapsedMs: elapsed, runningSince: null };
        else {
          await enqueue("/tasks/" + timer.taskId + "/time", {
            startedAt: timer.startedAt,
            minutes: elapsed / 60000,
          });
          next = null;
        }
      }
      setTimer(next);
      await cacheWrite(ownerKey(session), "timer", next);
      if (action === "stop") await sync();
    });
  }
  useEffect(() => {
    if (!session || tab !== "Meer" || !/^\d{4}$/.test(year)) return;
    const active = session;
    let cancelled = false;
    (async () => {
      const key = "forecast:" + year;
      const cached = await cacheRead<Row[]>(ownerKey(active), key, []);
      if (!cancelled) setForecast(cached);
      if (online) {
        const rows = await authorizedRequest(
          active,
          "/recurrences/forecast?from=" + year + "-01-01&to=" + year + "-12-31",
        );
        await cacheWrite(ownerKey(active), key, rows);
        if (!cancelled) setForecast(rows);
      }
    })().catch((error) => {
      if (!cancelled) displayError(error);
    });
    return () => {
      cancelled = true;
    };
  }, [year, session?.user.id, session?.endpoint, tab, online]);
  async function mutateQueue(action: () => Promise<void>) {
    if (!session) return;
    if (syncing.current || queueEditing.current)
      throw new Error(
        "Wacht tot de huidige synchronisatie klaar is. Je concept blijft bewaard.",
      );
    queueEditing.current = true;
    try {
      await action();
      const owner = ownerKey(session),
        pending = await queueRead(owner),
        confirmed = await cacheRead<Row[]>(owner, "tasks:confirmed", []),
        projected = projectTasks(confirmed, pending);
      await cacheWrite(owner, "tasks", projected);
      if (current.current === session) {
        setQueue(pending);
        setData((previous) => ({ ...previous, tasks: projected }));
        setSelected((previous) =>
          previous
            ? projected.find((task) => task.id === previous.id) || null
            : null,
        );
      }
    } finally {
      queueEditing.current = false;
    }
  }
  function openSyncForTask(taskId: string) {
    const operation =
      queue.find(
        (op) => operationTaskId(op) === taskId && op.status !== "pending",
      ) || queue.find((op) => operationTaskId(op) === taskId);
    setTab("Meer");
    setExtraPage("");
    setSelected(null);
    setCreate(false);
    if (operation) {
      setEditOp(operation);
      setConflictCurrent((operation.conflict as Row)?.current || null);
      setEditJson(JSON.stringify(operation.payload));
    }
  }
  async function toggleFavorite(type: string, id: string, remove: boolean) {
    await guard(async () => {
      if (!session || !online)
        throw new Error("Verbind met de server om favorieten te wijzigen.");
      await authorizedRequest(
        session,
        remove ? "/profile/favorites/" + type + "/" + id : "/profile/favorites",
        remove ? "DELETE" : "PUT",
        remove ? undefined : { type, id },
      );
      const rows = await authorizedRequest(session, "/profile/favorites");
      await cacheWrite(ownerKey(session), "profile/favorites", rows);
      setData((previous) => ({ ...previous, "profile/favorites": rows }));
    });
  }
  function useFavorite(favorite: Row) {
    if (favorite.available === false) return;
    if (favorite.type === "asset") {
      const asset = (data.assets || []).find((row) => row.id === favorite.id);
      beginTask({ assetId: favorite.id, locationId: asset?.locationId });
    } else if (favorite.type === "location")
      beginTask({ locationId: favorite.id });
    else {
      const record = (data.templates || []).find(
        (row) => row.id === favorite.id,
      );
      if (!record) {
        setError(
          "Dit sjabloon is nog niet lokaal beschikbaar. Synchroniseer eerst.",
        );
        return;
      }
      const template = record.template || {};
      beginTask({ assetId: template.assetId, locationId: template.locationId });
      setTitle(template.title || record.name);
      setDescription(template.description || "");
      setPriority(template.priority || "normal");
      setCategory(template.category || "reparatie");
      setAssignees(template.assignedTo || []);
      setTags((template.tags || []).join(", "));
      setEstimated(
        template.estimatedMinutes == null
          ? ""
          : String(template.estimatedMinutes),
      );
      setChecklistText(
        (template.checklist || []).map((line: Row) => line.text).join("\n"),
      );
      setDependencies(template.dependencies || []);
    }
  }
  useEffect(() => {
    const receive = (response: Notifications.NotificationResponse) =>
      setNavigationIntent({
        id: response.notification.request.identifier,
        data: response.notification.request.content.data,
      });
    const subscription =
      Notifications.addNotificationResponseReceivedListener(receive);
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) receive(response);
      })
      .catch(() => {});
    Linking.getInitialURL()
      .then((url) => {
        if (url) setNavigationIntent({ id: url, url });
      })
      .catch(() => {});
    const links = Linking.addEventListener("url", ({ url }) =>
      setNavigationIntent({ id: url, url }),
    );
    return () => {
      subscription.remove();
      links.remove();
    };
  }, []);
  useEffect(() => {
    if (!session || locked || !navigationIntent) return;
    const active = session,
      intent = navigationIntent;
    let cancelled = false;
    const target = intent.url
      ? taskLinkTarget(intent.url, active)
      : taskNotificationTarget(intent.data, active);
    if (!target) {
      setNavigationIntent(null);
      if (!intent.url)
        void Notifications.clearLastNotificationResponseAsync().catch(() => {});
      return;
    }
    (async () => {
      const cached = await cacheRead<Row[]>(
        ownerKey(active),
        "tasks:confirmed",
        [],
      );
      let task = cached.find((row) => row.id === target.taskId);
      if (online) {
        try {
          task = await authorizedRequest(active, "/tasks/" + target.taskId);
          const confirmed = await cacheRead<Row[]>(
            ownerKey(active),
            "tasks:confirmed",
            [],
          );
          await cacheWrite(ownerKey(active), "tasks:confirmed", [
            task,
            ...confirmed.filter((row) => row.id !== target.taskId),
          ]);
        } catch (error) {
          if (
            !task ||
            (error instanceof RequestError &&
              [401, 403, 404].includes(error.status))
          )
            throw error;
        }
      }
      if (cancelled || current.current !== active) return;
      if (!task) {
        setNotice(
          "Deze taak staat nog niet op dit toestel. Verbind en open de melding opnieuw.",
        );
        setNavigationIntent(null);
        return;
      }
      setSelected(projectTasks([task], await queueRead(ownerKey(active)))[0]);
      setShowTaskDetails(false);
      setTab("Taken");
      setCreate(false);
      setPhoto(null);
      setAnnotated(null);
      setNavigationIntent(null);
      if ((target.batchId || target.notificationId) && online)
        await authorizedRequest(
          active,
          target.batchId
            ? "/notifications/batches/" + target.batchId + "/read"
            : "/notifications/" + target.notificationId + "/read",
          "PATCH",
          {},
        );
      if (!intent.url) await Notifications.clearLastNotificationResponseAsync();
    })().catch((error) => {
      if (!cancelled && current.current === active) {
        displayError(error);
        setNavigationIntent(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigationIntent?.id, session, locked, online]);
  const filtered = (name: string) =>
    (data[name] || []).filter((row) =>
      JSON.stringify(row).toLowerCase().includes(search.toLowerCase()),
    );
  const tiles: string[] = Array.isArray(dashboardPreferences?.dashboardTiles)
    ? dashboardPreferences.dashboardTiles
    : ["mine", "urgent", "overdue", "inventory", "planning"];
  const tasks = data.tasks || [];
  const activeTasks = tasks.filter(
    (t) => !["completed", "archived", "cancelled"].includes(t.status),
  );
  const locationValues = Object.fromEntries(
    (data.locations || [])
      .filter((row) => row.active !== false)
      .map((row) => [row.id, row.name]),
  );
  const taskCard = (task: Row) => (
    <Pressable
      accessibilityRole="button"
      key={task.id}
      onPress={() => {
        setSelected(task);
        setShowTaskDetails(false);
        setReason("");
        setPhoto(null);
      }}
      style={styles.card}
    >
      <Text style={styles.meta}>
        {priorities[task.priority]} · {statuses[task.status]}
        {taskSyncState(task.id, queue, !!task.localDraft).status === "conflict"
          ? " · ! Conflict, invoer bewaard"
          : taskSyncState(task.id, queue, !!task.localDraft).status === "failed"
            ? " · ! Corrigeren"
            : taskSyncState(task.id, queue, !!task.localDraft).count
              ? ` · ◷ ${taskSyncState(task.id, queue, !!task.localDraft).count} wachtend`
              : task.localDraft
                ? " · ◷ Serverstatus ophalen"
                : " · ✓ Bevestigd"}
      </Text>
      <Text style={styles.cardTitle}>{task.title}</Text>
      <Text style={styles.muted}>
        {locationValues[task.locationId] || "Geen locatie"}
        {task.deadline
          ? " · " + new Date(task.deadline).toLocaleDateString("nl-NL")
          : ""}
      </Text>
    </Pressable>
  );
  if (!ready)
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text>Je werk wordt geladen…</Text>
      </SafeAreaView>
    );
  if (!session)
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.brand}>TuinWerk OS</Text>
            <Text style={styles.title}>Goed werk begint hier.</Text>
            <Text style={styles.muted}>
              Taken, onderhoud en onderdelen voor je team.
            </Text>
            <Field
              label="Serveradres (HTTPS)"
              value={endpoint}
              onChange={setEndpoint}
            />
            <Field
              label="E-mailadres"
              value={email}
              onChange={setEmail}
              keyboard="email-address"
            />
            <Field
              label="Wachtwoord"
              value={password}
              onChange={setPassword}
              secure
            />
            <Field
              label="Tweede factor / herstelcode (indien ingeschakeld)"
              value={otp}
              onChange={setOtp}
            />
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <Button
              label={busy ? "Aanmelden…" : "Aanmelden"}
              disabled={busy}
              onPress={() => void login()}
            />
            <Button
              secondary
              label="Privacybeleid"
              onPress={() => void openPublicPage("/privacy")}
            />
            <Button
              secondary
              label="Ondersteuning"
              onPress={() => void openPublicPage("/support")}
            />
            <Text style={styles.muted}>
              Gebruik het adres van je eigen TuinWerk-server. Buiten het bedrijf
              kan een VPN nodig zijn.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  if (locked)
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>TuinWerk vergrendeld</Text>
        <Button label="Ontgrendelen" onPress={() => void unlock()} />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Button secondary label="Uitloggen" onPress={() => void logout()} />
      </SafeAreaView>
    );
  if (scan)
    return (
      <SafeAreaView style={styles.screen}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data: code }) => {
              setScan(false);
              try {
                const url = new URL(code);
                if (url.origin !== new URL(session.endpoint).origin)
                  throw new Error("QR-code hoort bij een andere server.");
                const id =
                  url.searchParams.get("id") ||
                  url.pathname.split("/").filter(Boolean).pop();
                const asset = (data.assets || []).find(
                  (row) => row.id === id || row.qrToken === id,
                );
                const location = (data.locations || []).find(
                  (row) => row.id === id || row.qrToken === id,
                );
                const item = (data["inventory/items"] || []).find(
                  (row) => row.id === id || row.qrToken === id,
                );
                if (asset) {
                  beginTask({
                    assetId: asset.id,
                    locationId: asset.locationId,
                  });
                } else if (location) {
                  beginTask({ locationId: location.id });
                } else if (item) {
                  setItemId(item.id);
                  setTab("Voorraad");
                } else {
                  setNotice(
                    "Code gescand. Dit object staat niet in je lokale catalogus; synchroniseer en probeer opnieuw.",
                  );
                }
              } catch {
                setError("Geen ondersteunde TuinWerk-code.");
              }
            }}
          />
        ) : (
          <Button
            label="Camera toestaan"
            onPress={() => void askPermission()}
          />
        )}
        <Button label="Scanner sluiten" onPress={() => setScan(false)} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>TuinWerk OS</Text>
          <Text style={styles.muted}>{session.user.name}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void guard(() => sync())}
        >
          <Text style={styles.sync}>
            {isSyncing ? "↻ Synchroniseren" : online ? "● Online" : "○ Offline"}{" "}
            · {queue.length} wachtend
          </Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {!!notice && (
            <Pressable onPress={() => setNotice("")}>
              <Text style={styles.notice}>{notice}</Text>
            </Pressable>
          )}
          {create ? (
            <View>
              <Text style={styles.title}>
                {editing ? "Taak bewerken" : "Nieuwe melding"}
              </Text>
              <Field
                label="Wat moet er gebeuren?"
                value={title}
                onChange={setTitle}
              />
              <Field
                label="Beschrijving (dicteer via je toetsenbord)"
                value={description}
                onChange={setDescription}
                multiline
              />
              <Button
                secondary
                label={
                  advancedTask
                    ? "Extra taakvelden sluiten"
                    : "Planning, checklist en extra velden"
                }
                onPress={() => setAdvancedTask(!advancedTask)}
              />
              {advancedTask && (
                <>
                  <Field
                    label="Categorie"
                    value={category}
                    onChange={setCategory}
                  />
                  <Field
                    label="Deadline (bijv. 2026-11-12T17:00)"
                    value={deadline}
                    onChange={setDeadline}
                  />
                  <Field
                    label="Gepland (datum/tijd)"
                    value={plannedAt}
                    onChange={setPlannedAt}
                  />
                  <Field
                    label="Beschikbaar vanaf (datum/tijd)"
                    value={availableFrom}
                    onChange={setAvailableFrom}
                  />
                  <Field
                    label="Geschatte minuten"
                    value={estimated}
                    onChange={setEstimated}
                    keyboard="decimal-pad"
                  />
                  <Field
                    label="Tags (gescheiden door komma)"
                    value={tags}
                    onChange={setTags}
                  />
                  <Field
                    label="Verplichte checklist (één controle per regel)"
                    value={checklistText}
                    onChange={setChecklistText}
                    multiline
                  />
                  <Text style={styles.label}>Afhankelijk van</Text>
                  {tasks
                    .filter(
                      (task) =>
                        task.id !== editing?.id &&
                        !["archived", "cancelled"].includes(task.status),
                    )
                    .map((task) => (
                      <Button
                        secondary
                        key={task.id}
                        label={`${dependencies.includes(task.id) ? "✓ " : ""}${task.title}`}
                        onPress={() =>
                          setDependencies(
                            dependencies.includes(task.id)
                              ? dependencies.filter((id) => id !== task.id)
                              : [...dependencies, task.id],
                          )
                        }
                      />
                    ))}
                </>
              )}
              <Text style={styles.label}>Prioriteit</Text>
              <Choices
                values={priorities}
                value={priority}
                onChange={setPriority}
              />
              <Text style={styles.label}>Toewijzen aan</Text>
              <View style={styles.chips}>
                {(data.users || []).map((user) => (
                  <Button
                    secondary
                    key={user.id}
                    label={`${assignees.includes(user.id) ? "✓ " : ""}${user.name}`}
                    onPress={() =>
                      setAssignees(
                        assignees.includes(user.id)
                          ? assignees.filter((id) => id !== user.id)
                          : [...assignees, user.id],
                      )
                    }
                  />
                ))}
              </View>
              <Text style={styles.label}>Locatie</Text>
              <Choices
                values={{ "": "Geen locatie", ...locationValues }}
                value={locationId}
                onChange={setLocationId}
              />
              <Text style={styles.label}>Machine</Text>
              <Choices
                values={{
                  "": "Geen machine",
                  ...Object.fromEntries(
                    (data.assets || []).map((row) => [row.id, row.name]),
                  ),
                }}
                value={assetId}
                onChange={setAssetId}
              />
              <Button label="Foto maken" onPress={() => void pickPhoto(true)} />
              <Button
                secondary
                label="Foto kiezen"
                onPress={() => void pickPhoto(false)}
              />
              {photo && (
                <>
                  <Image
                    source={{ uri: annotated || photo }}
                    style={styles.photo}
                  />
                  <Button
                    secondary
                    label="Foto annoteren"
                    onPress={() => setAnnotating(true)}
                  />
                </>
              )}
              {annotating && photo && (
                <PhotoAnnotator
                  uri={photo}
                  onCancel={() => setAnnotating(false)}
                  onSave={(uri) => {
                    setAnnotated(uri);
                    setAnnotating(false);
                  }}
                />
              )}
              <Button
                disabled={busy}
                label={
                  editing
                    ? "Wijzigingen veilig opslaan"
                    : "Melding veilig opslaan"
                }
                onPress={() => void saveTask()}
              />
              <Button
                secondary
                label="Terug"
                onPress={() => {
                  setCreate(false);
                  setEditing(null);
                }}
              />
            </View>
          ) : selected ? (
            <View>
              <Button
                secondary
                label="← Terug naar taken"
                onPress={() => setSelected(null)}
              />
              <Text style={styles.meta}>
                {priorities[selected.priority]} · {statuses[selected.status]}
              </Text>
              <Text style={styles.title}>{selected.title}</Text>
              <Text>{selected.description}</Text>
              <ReportContent
                session={session}
                targetType="task"
                targetId={selected.id}
              />
              <TaskWorkPanel
                key={selected.id}
                task={selected}
                catalogs={data}
                queue={queue}
                busy={busy}
                online={online}
                timer={timer}
                photo={photo}
                annotated={annotated}
                onPhoto={(camera) => void pickPhoto(camera)}
                onAnnotation={setAnnotated}
                onSavePhoto={(phase) =>
                  void guard(async () => {
                    if (!photo) return;
                    await enqueue(
                      "/attachments",
                      { taskId: selected.id, phase },
                      "POST",
                      photo,
                    );
                    if (annotated)
                      await enqueue(
                        "/attachments",
                        { taskId: selected.id, phase },
                        "POST",
                        annotated,
                      );
                    setPhoto(null);
                    setAnnotated(null);
                    await sync();
                  })
                }
                onStatus={(status, reason) => void changeStatus(status, reason)}
                onChecklist={(checklist) =>
                  void guard(async () => {
                    await enqueue(
                      "/tasks/" + selected.id,
                      { version: selected.version, checklist },
                      "PATCH",
                    );
                    await sync();
                  })
                }
                onTimer={(action) => void timerAction(action)}
                onTime={(minutes) =>
                  void guard(async () => {
                    await enqueue("/tasks/" + selected.id + "/time", {
                      minutes,
                    });
                    await sync();
                  })
                }
                onPart={(payload) =>
                  void guard(async () => {
                    await enqueue("/inventory/movements", payload);
                    await sync();
                  })
                }
                onResolve={() => openSyncForTask(selected.id)}
                onSync={() => void sync()}
              />
              <Button
                secondary
                label={
                  showTaskDetails
                    ? "Uitgebreide gegevens sluiten"
                    : "Taakgegevens, reacties en historie"
                }
                onPress={() => setShowTaskDetails(!showTaskDetails)}
              />
              {showTaskDetails && (
                <>
                  <Button
                    secondary
                    label="Taakgegevens bewerken"
                    onPress={() => {
                      setEditing(selected);
                      setTitle(selected.title);
                      setDescription(selected.description || "");
                      setPriority(selected.priority);
                      setCategory(selected.category || "");
                      setDeadline(selected.deadline || "");
                      setPlannedAt(selected.plannedAt || "");
                      setAvailableFrom(selected.availableFrom || "");
                      setEstimated(
                        selected.estimatedMinutes == null
                          ? ""
                          : String(selected.estimatedMinutes),
                      );
                      setTags((selected.tags || []).join(", "));
                      setChecklistText(
                        (selected.checklist || [])
                          .map((item: Row) => item.text)
                          .join("\n"),
                      );
                      setDependencies(selected.dependencies || []);
                      setLocationId(selected.locationId || "");
                      setAssetId(selected.assetId || "");
                      setAssignees(selected.assignedTo || []);
                      setPhoto(null);
                      setAnnotated(null);
                      setCreate(true);
                    }}
                  />
                  <Text style={styles.label}>Status wijzigen</Text>
                  <Field
                    label="Reden (verplicht bij blokkeren / heropenen)"
                    value={reason}
                    onChange={setReason}
                  />
                  <Choices
                    values={statuses}
                    value={selected.status}
                    onChange={(status) => {
                      if (
                        ["completed", "cancelled", "archived"].includes(status)
                      )
                        Alert.alert(
                          "Status bevestigen",
                          `Taak op ${statuses[status]} zetten?`,
                          [
                            { text: "Annuleren", style: "cancel" },
                            {
                              text: "Bevestigen",
                              onPress: () => void changeStatus(status),
                            },
                          ],
                        );
                      else void changeStatus(status);
                    }}
                  />
                  {(selected.checklist || []).map(
                    (line: Row, index: number) => (
                      <Button
                        secondary
                        key={line.id || index}
                        label={`${line.done ? "☑" : "☐"} ${line.title || line.text}`}
                        onPress={() =>
                          void guard(async () => {
                            const checklist = selected.checklist.map(
                              (item: Row, i: number) =>
                                i === index
                                  ? { ...item, done: !item.done }
                                  : item,
                            );
                            await enqueue(
                              "/tasks/" + selected.id,
                              { version: selected.version, checklist },
                              "PATCH",
                            );
                            setSelected(null);
                            await sync();
                          })
                        }
                      />
                    ),
                  )}
                  <Text style={styles.label}>Betrokken medewerkers</Text>
                  {(data.users || []).map((user) => (
                    <Button
                      secondary
                      key={user.id}
                      label={`${(selected.assignedTo || []).includes(user.id) ? "✓ " : ""}${user.name}`}
                      onPress={() =>
                        void guard(async () => {
                          const assignedTo = (
                            selected.assignedTo || []
                          ).includes(user.id)
                            ? selected.assignedTo.filter(
                                (id: string) => id !== user.id,
                              )
                            : [...(selected.assignedTo || []), user.id];
                          await enqueue(
                            "/tasks/" + selected.id,
                            { version: selected.version, assignedTo },
                            "PATCH",
                          );
                          setSelected(null);
                          await sync();
                        })
                      }
                    />
                  ))}
                  <Button
                    secondary
                    label="Onderdeelverbruik voor deze taak"
                    onPress={() => {
                      setPartTaskId(selected.id);
                      setSelected(null);
                      setTab("Voorraad");
                    }}
                  />
                  <Field
                    label="Opmerking"
                    value={comment}
                    onChange={setComment}
                    multiline
                  />
                  <Button
                    label="Opmerking plaatsen"
                    onPress={() =>
                      void guard(async () => {
                        if (!comment.trim())
                          throw new Error("Vul een opmerking in.");
                        await enqueue("/tasks/" + selected.id + "/comments", {
                          body: comment,
                        });
                        setComment("");
                        await sync();
                      })
                    }
                  />
                  <Text style={styles.section}>Timer</Text>
                  {timer && (
                    <Text style={styles.notice}>
                      {timer.taskId === selected.id
                        ? "Deze taak"
                        : "Andere taak"}{" "}
                      · {timer.runningSince ? "Timer loopt" : "Gepauzeerd"}
                    </Text>
                  )}
                  <Button
                    secondary
                    label={
                      timer?.runningSince
                        ? "Timer loopt"
                        : "Start / hervat timer"
                    }
                    disabled={!!timer?.runningSince}
                    onPress={() => void timerAction("start")}
                  />
                  {timer?.taskId === selected.id && (
                    <>
                      <Button
                        secondary
                        label="Pauze"
                        onPress={() => void timerAction("pause")}
                      />
                      <Button
                        secondary
                        label="Stop en registreer"
                        onPress={() => void timerAction("stop")}
                      />
                    </>
                  )}
                  <Field
                    label="Bestede minuten"
                    value={minutes}
                    onChange={setMinutes}
                    keyboard="decimal-pad"
                  />
                  <Button
                    secondary
                    label="Tijd registreren"
                    onPress={() =>
                      void guard(async () => {
                        const duration = Number(minutes);
                        if (!Number.isFinite(duration) || duration <= 0)
                          throw new Error(
                            "Voer een positief aantal minuten in.",
                          );
                        await enqueue("/tasks/" + selected.id + "/time", {
                          minutes: duration,
                        });
                        await sync();
                      })
                    }
                  />
                  <Text style={styles.section}>Reacties</Text>
                  {(details.comments || []).map((row) => (
                    <View style={styles.card} key={row.id}>
                      <Text style={styles.meta}>
                        {row.author} ·{" "}
                        {new Date(row.createdAt).toLocaleString("nl-NL")}
                      </Text>
                      <Text>{row.body}</Text>
                      <ReportContent
                        session={session}
                        targetType="comment"
                        targetId={row.id}
                      />
                    </View>
                  ))}
                  <Text style={styles.section}>Geschiedenis</Text>
                  {(details.history || [])
                    .slice(-20)
                    .reverse()
                    .map((row) => (
                      <Text key={row.id} style={styles.listItem}>
                        {row.action} ·{" "}
                        {new Date(row.createdAt).toLocaleString("nl-NL")}
                      </Text>
                    ))}
                  <Text style={styles.section}>Bijlagen</Text>
                  {(details.attachments || []).map((row) => (
                    <View style={styles.card} key={row.id}>
                      <Text>
                        {row.name ||
                          row.originalName ||
                          row.filename ||
                          "Bijlage"}{" "}
                        · {row.phase}
                      </Text>
                      <ReportContent
                        session={session}
                        targetType="attachment"
                        targetId={row.id}
                      />
                      {(row.mimeType || row.mime || "").startsWith(
                        "image/",
                      ) && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Foto vergroten"
                          onPress={() => {
                            setZoomImage(
                              row.localUri ||
                                session.endpoint +
                                  "/attachments/" +
                                  row.id +
                                  "/file",
                            );
                            setZoom(1);
                          }}
                        >
                          <Image
                            style={styles.photo}
                            source={{
                              uri:
                                row.localUri ||
                                session.endpoint +
                                  "/attachments/" +
                                  row.id +
                                  "/file",
                              headers: {
                                Authorization: "Bearer " + session.token,
                              },
                            }}
                          />
                        </Pressable>
                      )}
                    </View>
                  ))}
                  <Button
                    secondary
                    label="Reparatiefoto maken"
                    onPress={() => void pickPhoto(true)}
                  />
                  {photo && (
                    <>
                      <Image
                        source={{ uri: annotated || photo }}
                        style={styles.photo}
                      />
                      <Button
                        secondary
                        label="Foto annoteren"
                        onPress={() => setAnnotating(true)}
                      />
                      {annotating && (
                        <PhotoAnnotator
                          uri={photo}
                          onCancel={() => setAnnotating(false)}
                          onSave={(uri) => {
                            setAnnotated(uri);
                            setAnnotating(false);
                          }}
                        />
                      )}
                      <Button
                        label="Eindfoto toevoegen"
                        onPress={() =>
                          void guard(async () => {
                            await enqueue(
                              "/attachments",
                              { taskId: selected.id, phase: "after" },
                              "POST",
                              photo,
                            );
                            if (annotated)
                              await enqueue(
                                "/attachments",
                                { taskId: selected.id, phase: "after" },
                                "POST",
                                annotated,
                              );
                            setAnnotated(null);
                            setPhoto(null);
                            await sync();
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}
            </View>
          ) : (
            <>
              {tab === "Home" && (
                <>
                  <Text style={styles.eyebrow}>VANDAAG AAN DE SLAG</Text>
                  <Text style={styles.title}>
                    Goedendag, {session.user.name.split(" ")[0]}.
                  </Text>
                  <Button
                    label={`Mijn taken vandaag · ${tasksForToday(tasks, session.user.id).length}`}
                    onPress={() => {
                      setTab("Taken");
                      setTaskView("today");
                      setSearch("");
                    }}
                  />
                  <Button
                    label="＋ Storing melden"
                    onPress={() => beginTask()}
                  />
                  <Button
                    label="▣ QR-code scannen"
                    onPress={() => setScan(true)}
                  />
                  <Text style={styles.muted}>
                    {isSyncing
                      ? "Je wijzigingen worden verstuurd."
                      : queue.length
                        ? `${queue.length} lokale wijzigingen; ${queue.filter((op) => op.status !== "pending").length} hebben je aandacht nodig.`
                        : "Alle lokale wijzigingen zijn bevestigd."}
                    {lastSynced
                      ? " Laatste contact: " +
                        new Date(lastSynced).toLocaleTimeString("nl-NL")
                      : ""}
                  </Text>
                  {queue.some((op) => op.status !== "pending") && (
                    <Button
                      secondary
                      label="Conflicten en bewaarde concepten oplossen"
                      onPress={() => {
                        setTab("Meer");
                        setExtraPage("");
                      }}
                    />
                  )}
                  <Text style={styles.section}>Mijn taken vandaag</Text>
                  {tasksForToday(tasks, session.user.id)
                    .slice(0, 8)
                    .map(taskCard)}
                  {!tasksForToday(tasks, session.user.id).length && (
                    <Text style={styles.muted}>
                      Geen taken voor vandaag. Een storing melden of scannen kan
                      altijd.
                    </Text>
                  )}
                  <FavoritesPanel
                    favorites={data["profile/favorites"] || []}
                    catalogs={data}
                    busy={busy}
                    online={online}
                    onUse={useFavorite}
                    onToggle={(type, id, remove) =>
                      void toggleFavorite(type, id, remove)
                    }
                  />
                  <Button
                    secondary
                    label={
                      showTeamSummary
                        ? "Teamoverzicht sluiten"
                        : "Teamoverzicht en overige tegels"
                    }
                    onPress={() => setShowTeamSummary(!showTeamSummary)}
                  />
                  {showTeamSummary && (
                    <>
                      {tiles.includes("mine") && (
                        <>
                          <Text style={styles.section}>Mijn werk</Text>
                          {activeTasks
                            .filter((t) =>
                              (t.assigneeIds || t.assignedTo || []).includes(
                                session.user.id,
                              ),
                            )
                            .slice(0, 20)
                            .map(taskCard)}
                        </>
                      )}
                      {tiles.includes("urgent") && (
                        <>
                          <Text style={styles.section}>Urgent in het team</Text>
                          {activeTasks
                            .filter((t) =>
                              ["critical", "high"].includes(t.priority),
                            )
                            .slice(0, 10)
                            .map(taskCard)}
                        </>
                      )}
                      {tiles.includes("overdue") && (
                        <>
                          <Text style={styles.section}>Achterstallig</Text>
                          {activeTasks
                            .filter(
                              (task) =>
                                task.deadline &&
                                new Date(task.deadline) < new Date(),
                            )
                            .slice(0, 10)
                            .map(taskCard)}
                        </>
                      )}
                      {tiles.includes("inventory") && (
                        <>
                          <Text style={styles.section}>Lage voorraad</Text>
                          {(data["inventory/items"] || [])
                            .filter(
                              (item) =>
                                item.lowStock ||
                                (data["inventory/balances"] || [])
                                  .filter(
                                    (balance) => balance.itemId === item.id,
                                  )
                                  .reduce(
                                    (sum, balance) =>
                                      sum + Number(balance.quantity),
                                    0,
                                  ) < Number(item.minimum),
                            )
                            .slice(0, 10)
                            .map((item) => (
                              <Text key={item.id} style={styles.listItem}>
                                {item.name} · onder minimum {item.minimum}
                              </Text>
                            ))}
                        </>
                      )}
                      {tiles.includes("planning") && (
                        <>
                          <Text style={styles.section}>Komende afspraken</Text>
                          {(data.schedules || [])
                            .filter((row) => new Date(row.endsAt) > new Date())
                            .slice(0, 5)
                            .map((row) => (
                              <Text key={row.id} style={styles.listItem}>
                                {row.title} ·{" "}
                                {new Date(row.startsAt).toLocaleString("nl-NL")}
                              </Text>
                            ))}
                        </>
                      )}
                      {!tasks.length && (
                        <Text style={styles.muted}>
                          Nog geen taken beschikbaar. Maak een melding of
                          synchroniseer.
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}
              {tab === "Taken" && (
                <>
                  <Text style={styles.title}>Taken</Text>
                  <Field
                    label="Zoeken"
                    value={search}
                    onChange={(value) => {
                      setSearch(value);
                      void cacheWrite(ownerKey(session), "taskSearch", value);
                    }}
                  />
                  <Choices
                    values={{
                      all: "Alle",
                      today: "Vandaag",
                      mine: "Mijn taken",
                      unassigned: "Niet toegewezen",
                      overdue: "Achterstallig",
                      blocked: "Geblokkeerd",
                      completed: "Afgerond",
                    }}
                    value={taskView}
                    onChange={(value) => {
                      setTaskView(value);
                      void cacheWrite(ownerKey(session), "taskView", value);
                    }}
                  />
                  <Button label="＋ Nieuwe taak" onPress={() => beginTask()} />
                  {filtered("tasks")
                    .filter(
                      (task) =>
                        taskView === "all" ||
                        (taskView === "today" &&
                          tasksForToday(tasks, session.user.id).some(
                            (row) => row.id === task.id,
                          )) ||
                        (taskView === "mine" &&
                          (task.assignedTo || []).includes(session.user.id)) ||
                        (taskView === "unassigned" &&
                          !(task.assignedTo || []).length) ||
                        (taskView === "overdue" &&
                          task.deadline &&
                          new Date(task.deadline) < new Date() &&
                          !["completed", "cancelled", "archived"].includes(
                            task.status,
                          )) ||
                        task.status === taskView,
                    )
                    .map(taskCard)}
                </>
              )}
              {tab === "Planning" && (
                <>
                  <Text style={styles.title}>Planning</Text>
                  <Text style={styles.muted}>
                    Je persoonlijke blokken en gedeelde teamafspraken. Een
                    werkblok verandert geen taakdeadline.
                  </Text>
                  {filtered("schedules").map((row) => (
                    <View key={row.id} style={styles.card}>
                      <Text style={styles.cardTitle}>
                        {row.title || "Werkblok"}
                      </Text>
                      <Text>
                        {new Date(row.startsAt || row.startAt).toLocaleString(
                          "nl-NL",
                        )}{" "}
                        –{" "}
                        {new Date(row.endsAt || row.endAt).toLocaleTimeString(
                          "nl-NL",
                        )}
                      </Text>
                      <Text style={styles.meta}>
                        {row.shared ? "Teamafspraak" : "Persoonlijk"}
                      </Text>
                    </View>
                  ))}
                  <Text style={styles.section}>Werkblok toevoegen</Text>
                  <Field
                    label="Omschrijving"
                    value={scheduleTitle}
                    onChange={setScheduleTitle}
                  />
                  <Field
                    label="Begint (bijv. 2026-11-12T08:00)"
                    value={scheduleStart}
                    onChange={setScheduleStart}
                  />
                  <Field
                    label="Eindigt (bijv. 2026-11-12T09:00)"
                    value={scheduleEnd}
                    onChange={setScheduleEnd}
                  />
                  <Choices
                    values={{ false: "Privé", true: "Gedeeld" }}
                    value={shared}
                    onChange={setShared}
                  />
                  <Button
                    label="Werkblok opslaan"
                    onPress={() =>
                      void guard(async () => {
                        const start = new Date(scheduleStart),
                          end = new Date(scheduleEnd);
                        if (
                          !scheduleTitle ||
                          isNaN(+start) ||
                          isNaN(+end) ||
                          end <= start
                        )
                          throw new Error(
                            "Vul een titel en geldige begin- en eindtijd in.",
                          );
                        await enqueue("/schedules", {
                          title: scheduleTitle,
                          startsAt: start.toISOString(),
                          endsAt: end.toISOString(),
                          shared: shared === "true",
                        });
                        setScheduleTitle("");
                        await sync();
                      })
                    }
                  />
                </>
              )}
              {tab === "Voorraad" && (
                <>
                  <Text style={styles.title}>Onderdelen</Text>
                  <Field
                    label="Zoeken op naam of artikelnummer"
                    value={search}
                    onChange={setSearch}
                  />
                  <Button
                    secondary
                    label="Artikel scannen"
                    onPress={() => setScan(true)}
                  />
                  {filtered("inventory/items").map((row) => (
                    <Pressable
                      key={row.id}
                      onPress={() => setItemId(row.id)}
                      style={[
                        styles.card,
                        itemId === row.id && styles.selectedCard,
                      ]}
                    >
                      <Text style={styles.cardTitle}>{row.name}</Text>
                      <Text style={styles.meta}>
                        {row.sku || row.articleNumber} · {row.unit}
                      </Text>
                      {(data["inventory/balances"] || [])
                        .filter((b) => b.itemId === row.id)
                        .map((b) => (
                          <Text key={b.locationId}>
                            {locationValues[b.locationId] || b.locationId}:{" "}
                            {b.quantity}
                          </Text>
                        ))}
                    </Pressable>
                  ))}
                  {itemId && (
                    <>
                      <Text style={styles.section}>Voorraadmutatie</Text>
                      {!!partTaskId && (
                        <Text style={styles.notice}>
                          Gekoppeld aan taak:{" "}
                          {tasks.find((task) => task.id === partTaskId)
                            ?.title || partTaskId}
                        </Text>
                      )}
                      <Text style={styles.muted}>
                        Offline is dit een concept. De server controleert het
                        beschikbare saldo bij synchroniseren.
                      </Text>
                      <Choices
                        values={{
                          usage: "Verbruik",
                          receipt: "Aanvulling",
                          transfer: "Verplaatsing",
                          correction: "Correctie",
                        }}
                        value={movementType}
                        onChange={setMovementType}
                      />
                      <Text style={styles.label}>Opslaglocatie</Text>
                      <Choices
                        values={locationValues}
                        value={locationId}
                        onChange={setLocationId}
                      />
                      {movementType === "transfer" && (
                        <>
                          <Text style={styles.label}>Naar locatie</Text>
                          <Choices
                            values={locationValues}
                            value={destination}
                            onChange={setDestination}
                          />
                        </>
                      )}
                      <Field
                        label="Aantal"
                        value={quantity}
                        onChange={setQuantity}
                        keyboard="decimal-pad"
                      />
                      <Field
                        label="Reden / notitie"
                        value={reason}
                        onChange={setReason}
                      />
                      <Button
                        label="Mutatie als concept opslaan"
                        onPress={() =>
                          void guard(async () => {
                            const amount = Number(quantity);
                            if (
                              !locationId ||
                              !Number.isFinite(amount) ||
                              amount === 0
                            )
                              throw new Error(
                                "Kies een locatie en een geldig aantal.",
                              );
                            await enqueue("/inventory/movements", {
                              itemId,
                              locationId,
                              type: movementType,
                              quantity: amount,
                              reason,
                              ...(partTaskId ? { taskId: partTaskId } : {}),
                              ...(movementType === "transfer"
                                ? { toLocationId: destination }
                                : {}),
                            });
                            await sync();
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}
              {tab === "Voorraad" && (
                <>
                  <Text style={styles.section}>Inventarisatie</Text>
                  <Field
                    label="Naam nieuwe telronde"
                    value={countName}
                    onChange={setCountName}
                  />
                  <Button
                    secondary
                    label="Telronde starten (online)"
                    onPress={() =>
                      void guard(async () => {
                        if (!countName.trim())
                          throw new Error("Geef de telronde een naam.");
                        const result = await authorizedRequest(
                          session,
                          "/inventory/counts",
                          "POST",
                          {
                            name: countName,
                            ...(locationId ? { locationId } : {}),
                          },
                        );
                        const detail = await authorizedRequest(
                          session,
                          "/inventory/counts/" + result.id,
                        );
                        setCount(detail);
                        setCountValues({});
                        await cacheWrite(
                          ownerKey(session),
                          "activeCount",
                          detail,
                        );
                      })
                    }
                  />
                  <Button
                    secondary
                    label="Opgeslagen telling openen"
                    onPress={() =>
                      void guard(async () => {
                        const cached = await cacheRead<Row | null>(
                          ownerKey(session),
                          "activeCount",
                          null,
                        );
                        if (!cached)
                          throw new Error("Er is geen opgeslagen telling.");
                        setCount(cached);
                        setCountValues(
                          await cacheRead(
                            ownerKey(session),
                            "countValues:" + cached.id,
                            {},
                          ),
                        );
                      })
                    }
                  />
                  {count && (
                    <View style={styles.card}>
                      <Text style={styles.cardTitle}>{count.name}</Text>
                      {count.lines?.map((line: Row) => {
                        const key = line.itemId + ":" + line.locationId;
                        return (
                          <View key={key}>
                            <Text>
                              {line.name} · {line.locationName} · geregistreerd{" "}
                              {line.currentQuantity}
                            </Text>
                            <Field
                              label="Werkelijk geteld"
                              keyboard="decimal-pad"
                              value={countValues[key] ?? ""}
                              onChange={(value) => {
                                const next = { ...countValues, [key]: value };
                                setCountValues(next);
                                void cacheWrite(
                                  ownerKey(session),
                                  "countValues:" + count.id,
                                  next,
                                );
                              }}
                            />
                          </View>
                        );
                      })}
                      <Button
                        label="Verschillen controleren en bevestigen"
                        onPress={() => {
                          try {
                            const lines = count.lines.map((line: Row) => {
                              const value =
                                countValues[
                                  line.itemId + ":" + line.locationId
                                ];
                              if (
                                value === undefined ||
                                value === "" ||
                                !Number.isFinite(Number(value)) ||
                                Number(value) < 0
                              )
                                throw new Error(
                                  "Vul iedere telregel met een geldig aantal in.",
                                );
                              return {
                                itemId: line.itemId,
                                locationId: line.locationId,
                                quantity: Number(value),
                                expectedVersion: line.currentVersion,
                              };
                            });
                            const summary = count.lines
                              .map(
                                (line: Row, index: number) =>
                                  `${line.name}: ${line.currentQuantity} → ${lines[index].quantity}`,
                              )
                              .join("\n");
                            Alert.alert("Telling bevestigen", summary, [
                              { text: "Annuleren", style: "cancel" },
                              {
                                text: "Bevestigen",
                                onPress: () =>
                                  void guard(async () => {
                                    await enqueue(
                                      "/inventory/counts/" +
                                        count.id +
                                        "/confirm",
                                      { version: count.version, lines },
                                    );
                                    setCount(null);
                                    await sync();
                                  }),
                              },
                            ]);
                          } catch (error) {
                            displayError(error);
                          }
                        }}
                      />
                    </View>
                  )}
                </>
              )}
              {tab === "Meer" && extraPage === "maintenance" && (
                <>
                  <Button
                    secondary
                    label="← Terug naar Meer"
                    onPress={() => setExtraPage("")}
                  />
                  <MaintenanceScreen session={session} onError={displayError} />
                </>
              )}
              {tab === "Meer" && extraPage === "management" && (
                <>
                  <Button
                    secondary
                    label="← Terug naar Meer"
                    onPress={() => setExtraPage("")}
                  />
                  <ManagementScreen
                    session={session}
                    catalogs={data}
                    onRefresh={() => refresh(session)}
                    pendingCount={queue.length}
                    syncing={isSyncing}
                    onDeleteAccount={deleteOwnAccount}
                  />
                </>
              )}
              {tab === "Meer" && !extraPage && (
                <>
                  <Text style={styles.title}>Je werkplek</Text>
                  <Button
                    label="Rapporten, catalogus en beheer"
                    onPress={() => setExtraPage("management")}
                  />
                  <Button
                    secondary
                    label="Onderhoud en seizoensplanning"
                    onPress={() => setExtraPage("maintenance")}
                  />
                  <Text style={styles.section}>Machines</Text>
                  {(data.assets || []).map((row) => (
                    <Pressable
                      key={row.id}
                      style={styles.card}
                      onPress={() => {
                        beginTask({
                          assetId: row.id,
                          locationId: row.locationId,
                        });
                      }}
                    >
                      <Text style={styles.cardTitle}>{row.name}</Text>
                      <Text>
                        {row.manufacturer} {row.model}
                      </Text>
                      <Text style={styles.meta}>
                        {locationValues[row.locationId]} · Tik voor melding
                      </Text>
                    </Pressable>
                  ))}
                  <Text style={styles.section}>Locaties</Text>
                  {(data.locations || []).map((row) => (
                    <Text key={row.id} style={styles.listItem}>
                      {row.parentId
                        ? `${locationValues[row.parentId] || ""} / `
                        : ""}
                      {row.name}
                    </Text>
                  ))}
                  <Text style={styles.section}>Meldingen</Text>
                  {(data.notifications || []).slice(0, 15).map((row) => (
                    <View style={styles.card} key={row.id}>
                      <Text style={styles.cardTitle}>{row.title}</Text>
                      <Text>{row.body || row.message}</Text>
                    </View>
                  ))}
                  <Text style={styles.section}>Synchronisatie</Text>
                  <Button
                    label="Nu synchroniseren"
                    onPress={() => void guard(() => sync())}
                  />
                  {queue.map((op) => (
                    <View style={styles.card} key={op.id}>
                      <Text style={styles.cardTitle}>
                        {operationLabel(op)}
                        {operationTaskId(op)
                          ? " · " +
                            (tasks.find(
                              (task) => task.id === operationTaskId(op),
                            )?.title || "Taak")
                          : ""}
                      </Text>
                      <Text style={styles.meta}>
                        {syncingOperation === op.id
                          ? "↻ Wordt verstuurd"
                          : op.status === "pending"
                            ? "◷ Lokaal bewaard; wacht op server"
                            : op.status === "conflict"
                              ? "Conflict — keuze nodig"
                              : "Invoer corrigeren"}
                      </Text>
                      {!!op.lastAttemptAt && (
                        <Text style={styles.muted}>
                          Laatste poging:{" "}
                          {new Date(op.lastAttemptAt).toLocaleString("nl-NL")} ·{" "}
                          {op.attempts || 0} poging(en)
                        </Text>
                      )}
                      {!!op.error && (
                        <Text style={styles.error}>{op.error}</Text>
                      )}
                      {op.fileUri && (
                        <Image
                          source={{ uri: op.fileUri }}
                          style={styles.photo}
                        />
                      )}
                      <Button
                        secondary
                        disabled={isSyncing}
                        label="Concept bekijken / corrigeren"
                        onPress={() => {
                          setEditOp(op);
                          setConflictCurrent(
                            (op.conflict as Row)?.current || null,
                          );
                          setEditJson(JSON.stringify(op.payload, null, 2));
                        }}
                      />
                      <Button
                        secondary
                        disabled={isSyncing}
                        label="Concept verwijderen"
                        onPress={() =>
                          Alert.alert(
                            "Concept verwijderen?",
                            "Deze lokale wijziging en eventuele foto worden verwijderd. Controleer ook afhankelijke concepten.",
                            [
                              { text: "Annuleren", style: "cancel" },
                              {
                                text: "Verwijderen",
                                style: "destructive",
                                onPress: () =>
                                  void guard(async () => {
                                    await mutateQueue(() => queueRemove(op));
                                    if (editOp?.id === op.id) setEditOp(null);
                                  }),
                              },
                            ],
                          )
                        }
                      />
                    </View>
                  ))}
                  {editOp && (
                    <View style={styles.card}>
                      <Text style={styles.section}>
                        Conflict / concept herstellen
                      </Text>
                      <Text style={styles.muted}>
                        Bekijk bij een versieconflict eerst de actuele
                        servertaak. Neem de actuele versie pas over als je jouw
                        wijzigingen opnieuw bewust wilt toepassen. Voorraad:
                        corrigeer aantal of opslaglocatie.
                      </Text>
                      <Button
                        secondary
                        label="Actuele servergegevens tonen"
                        onPress={() =>
                          void guard(async () => {
                            const path = editOp.path.endsWith("/confirm")
                              ? editOp.path.slice(0, -8)
                              : editOp.path === "/inventory/movements"
                                ? "/inventory/balances?itemId=" +
                                  editOp.payload.itemId
                                : editOp.path;
                            const value = await authorizedRequest(
                              session,
                              path,
                            );
                            setConflictCurrent(
                              Array.isArray(value)
                                ? { balances: value }
                                : value,
                            );
                          })
                        }
                      />
                      <ConflictEditor
                        key={editOp.id}
                        payload={JSON.parse(editJson)}
                        current={conflictCurrent}
                        catalogs={data}
                        onChange={(value) => setEditJson(JSON.stringify(value))}
                      />
                      <Button
                        disabled={isSyncing}
                        label="Bewust opnieuw aanbieden"
                        onPress={() =>
                          void guard(async () => {
                            const payload = JSON.parse(editJson);
                            if (
                              !payload ||
                              typeof payload !== "object" ||
                              Array.isArray(payload)
                            )
                              throw new Error("Gebruik een JSON-object.");
                            const changed =
                              JSON.stringify(payload) !==
                              JSON.stringify(editOp.payload);
                            if (changed && editOp.status === "pending")
                              throw new Error(
                                "De uitkomst van dit concept is nog onbekend. Synchroniseer eerst het oorspronkelijke concept voordat je het wijzigt.",
                              );
                            const apply = async () => {
                              const amended = {
                                ...editOp,
                                id: changed ? Crypto.randomUUID() : editOp.id,
                                payload,
                                status: "pending" as const,
                                error: undefined,
                              };
                              await mutateQueue(() =>
                                queueReplace(editOp, amended),
                              );
                              setEditOp(null);
                              setQueue(await queueRead(ownerKey(session)));
                              await sync();
                            };
                            if (changed)
                              Alert.alert(
                                "Nieuwe operatie bevestigen",
                                "Controleer eerst de actuele servergegevens en mutatiegeschiedenis. Een eerdere poging kan al verwerkt zijn. Alleen bevestigen als deze aangepaste wijziging nog moet worden uitgevoerd.",
                                [
                                  { text: "Annuleren", style: "cancel" },
                                  {
                                    text: "Gecontroleerd, uitvoeren",
                                    onPress: () => void guard(apply),
                                  },
                                ],
                              );
                            else await apply();
                          })
                        }
                      />
                      <Button
                        secondary
                        label="Sluiten"
                        onPress={() => setEditOp(null)}
                      />
                    </View>
                  )}
                  <Text style={styles.section}>Jaarplanning</Text>
                  <Field label="Jaar" value={year} onChange={setYear} />
                  <Button
                    secondary
                    label="Jaarprognose laden / verversen"
                    onPress={() =>
                      void guard(async () => {
                        if (!/^\d{4}$/.test(year))
                          throw new Error("Voer een jaar met vier cijfers in.");
                        const key = "forecast:" + year;
                        setForecast(
                          await cacheRead(ownerKey(session), key, []),
                        );
                        if (online) {
                          const rows = await authorizedRequest(
                            session,
                            "/recurrences/forecast?from=" +
                              year +
                              "-01-01&to=" +
                              year +
                              "-12-31",
                          );
                          await cacheWrite(ownerKey(session), key, rows);
                          setForecast(rows);
                        }
                      })
                    }
                  />
                  {Array.from({ length: 12 }, (_, month) => {
                    const monthTasks = tasks.filter((task) => {
                      const date = new Date(
                        task.plannedAt || task.deadline || "",
                      );
                      return (
                        date.getFullYear() === Number(year) &&
                        date.getMonth() === month
                      );
                    });
                    return (
                      <View key={month} style={styles.card}>
                        <Text style={styles.cardTitle}>
                          {new Date(
                            Number(year) || 2026,
                            month,
                            1,
                          ).toLocaleDateString("nl-NL", { month: "long" })}{" "}
                          · {monthTasks.length} taken
                        </Text>
                        {monthTasks.map(taskCard)}
                        {forecast
                          .filter(
                            (row) =>
                              !row.taskId &&
                              new Date(row.plannedAt).getFullYear() ===
                                Number(year) &&
                              new Date(row.plannedAt).getMonth() === month,
                          )
                          .map((row) => (
                            <View key={row.id} style={styles.card}>
                              <Text style={styles.meta}>
                                {row.tentative
                                  ? "Voorlopig uitvoeringsinterval"
                                  : "Prognose uit herhaalregel"}{" "}
                                · nog geen werkopdracht
                              </Text>
                              <Text style={styles.cardTitle}>{row.title}</Text>
                              <Text>
                                {new Date(row.plannedAt).toLocaleDateString(
                                  "nl-NL",
                                )}
                              </Text>
                            </View>
                          ))}
                      </View>
                    );
                  })}
                  <Text style={styles.muted}>
                    De jaarlijst combineert bevestigde taken met gecachete
                    prognoses uit herhaalregels. Een prognose is nog geen
                    werkopdracht; uitvoeringsintervallen blijven voorlopig tot
                    afronding.
                  </Text>
                  <Text style={styles.section}>Rapporten delen</Text>
                  <Button
                    secondary
                    label="Taken als PDF"
                    onPress={() => void exportReport("pdf")}
                  />
                  <Button
                    secondary
                    label="Taken als Excel"
                    onPress={() => void exportReport("xlsx")}
                  />
                  <Button
                    secondary
                    label="Voorraad als Excel"
                    onPress={() => void exportReport("xlsx", "inventory")}
                  />
                  <Button
                    secondary
                    label="Taken als CSV"
                    onPress={() => void exportReport("csv")}
                  />
                  <Text style={styles.section}>Pushmeldingen</Text>
                  <Text style={styles.muted}>
                    Push vereist een eigen development- of productiebuild met
                    APNs/FCM-configuratie. Expo Go ondersteunt dit niet
                    volledig.
                  </Text>
                  <Field
                    label="EAS-project-ID (UUID uit Expo-projectinstellingen)"
                    value={pushProject}
                    onChange={setPushProject}
                  />
                  <Field
                    label="Stille uren vanaf (HH:MM)"
                    value={quietStart}
                    onChange={setQuietStart}
                  />
                  <Field
                    label="Stille uren tot (HH:MM)"
                    value={quietEnd}
                    onChange={setQuietEnd}
                  />
                  <Button
                    secondary
                    label="Push op dit toestel activeren"
                    onPress={() => void registerPush()}
                  />
                  <Text style={styles.section}>Beveiliging</Text>
                  <Button
                    secondary
                    label={
                      biometric
                        ? "Biometrische vergrendeling uitschakelen"
                        : "Biometrische vergrendeling inschakelen"
                    }
                    onPress={() =>
                      void guard(async () => {
                        if (!biometric) {
                          if (
                            !(await LocalAuthentication.hasHardwareAsync()) ||
                            !(await LocalAuthentication.isEnrolledAsync())
                          )
                            throw new Error(
                              "Stel eerst biometrie op dit toestel in.",
                            );
                          const result =
                            await LocalAuthentication.authenticateAsync({
                              promptMessage: "Bevestig vergrendeling",
                            });
                          if (!result.success) return;
                        }
                        await SecureStore.setItemAsync(
                          "biometric",
                          String(!biometric),
                        );
                        setBiometric(!biometric);
                      })
                    }
                  />
                  {biometric && (
                    <Button
                      secondary
                      label="Nu vergrendelen"
                      onPress={() => setLocked(true)}
                    />
                  )}
                  <Button
                    secondary
                    label="Webomgeving openen"
                    onPress={() =>
                      void Linking.openURL(
                        session.endpoint.replace(/\/api$/, ""),
                      )
                    }
                  />
                  <Text style={styles.muted}>
                    Rapporten, jaarplanning en beheer zijn ook beschikbaar in de
                    webomgeving. Dicteer tekst met de microfoon van je
                    systeemtoetsenbord; beschikbaarheid hangt van het toestel en
                    toetsenbord af.
                  </Text>
                  <Button
                    secondary
                    label="Uitloggen"
                    onPress={() => void logout()}
                  />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={!!zoomImage} onRequestClose={() => setZoomImage(null)}>
        <SafeAreaView style={styles.screen}>
          <Button label="Foto sluiten" onPress={() => setZoomImage(null)} />
          <View style={styles.chips}>
            <Button
              secondary
              label="Vergroten +"
              onPress={() => setZoom(Math.min(4, zoom + 0.5))}
            />
            <Button
              secondary
              label="Verkleinen −"
              onPress={() => setZoom(Math.max(1, zoom - 0.5))}
            />
          </View>
          <ScrollView horizontal>
            <ScrollView minimumZoomScale={1} maximumZoomScale={4}>
              <Image
                source={{
                  uri: zoomImage || "",
                  headers: { Authorization: "Bearer " + session.token },
                }}
                style={{
                  width: 350 * zoom,
                  height: 600 * zoom,
                  resizeMode: "contain",
                }}
              />
            </ScrollView>
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <View style={styles.navigation}>
        {["Home", "Taken", "Planning", "Voorraad", "Meer"].map((name) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
            key={name}
            style={styles.navItem}
            onPress={() => {
              setTab(name);
              setSelected(null);
              setCreate(false);
              setEditing(null);
              setSearch("");
              if (name === "Taken") {
                void cacheRead<string>(
                  ownerKey(session),
                  "taskSearch",
                  "",
                ).then(setSearch);
                void cacheRead<string>(
                  ownerKey(session),
                  "taskView",
                  "all",
                ).then(setTaskView);
              }
            }}
          >
            <Text style={[styles.navText, tab === name && styles.navActive]}>
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f0" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 20,
  },
  header: {
    padding: 18,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#dce2d6",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: { fontSize: 22, fontWeight: "800", color: "#204c35" },
  title: {
    fontSize: 29,
    fontWeight: "800",
    color: "#183c2b",
    marginVertical: 16,
  },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  muted: { color: "#586458", lineHeight: 21 },
  meta: { fontSize: 12, color: "#496345", fontWeight: "600", marginBottom: 8 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#587148",
  },
  section: {
    fontSize: 21,
    fontWeight: "700",
    color: "#1e432e",
    marginTop: 20,
    marginBottom: 8,
  },
  label: { fontWeight: "600", fontSize: 14, color: "#2d4935", marginBottom: 6 },
  field: { marginVertical: 5 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#bdcbb7",
    borderRadius: 10,
    minHeight: 48,
    padding: 12,
    fontSize: 16,
    color: "#183c2b",
  },
  button: {
    backgroundColor: "#285b3d",
    borderRadius: 10,
    padding: 15,
    minHeight: 48,
    alignItems: "center",
    marginVertical: 4,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondary: { backgroundColor: "#e7eddf" },
  secondaryText: { color: "#234d33" },
  disabled: { opacity: 0.5 },
  error: {
    backgroundColor: "#fce8e2",
    padding: 12,
    borderRadius: 8,
    color: "#872c1e",
    lineHeight: 21,
  },
  notice: {
    backgroundColor: "#e4eedb",
    color: "#2a4c28",
    padding: 12,
    borderRadius: 8,
    lineHeight: 21,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 17,
    borderWidth: 1,
    borderColor: "#e0e6db",
    marginVertical: 3,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#203f2e",
    marginBottom: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chip: {
    borderWidth: 1,
    borderColor: "#bfcdb7",
    padding: 12,
    borderRadius: 8,
    minHeight: 44,
    backgroundColor: "#fff",
  },
  chipText: { color: "#2d4935" },
  chosen: { backgroundColor: "#285b3d", borderColor: "#285b3d" },
  chosenText: { color: "#fff" },
  photo: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    resizeMode: "contain",
  },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: "#e7eddf", padding: 14, borderRadius: 12 },
  number: { fontSize: 30, fontWeight: "800", color: "#234d33" },
  navigation: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#dce2d6",
  },
  navItem: {
    flex: 1,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  navText: { fontSize: 12, fontWeight: "600", color: "#677364" },
  navActive: { color: "#1a512e", fontWeight: "900" },
  sync: { fontSize: 12, color: "#356043" },
  selectedCard: { borderColor: "#285b3d", borderWidth: 2 },
  listItem: {
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    color: "#314d36",
  },
});
