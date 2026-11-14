import type { PendingOperation } from "./queue";
type Row = Record<string, any>;
const finished = new Set(["completed", "cancelled", "archived"]);
function dayKey(value: string | Date, timeZone?: string) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function tasksForToday(
  tasks: Row[],
  userId: string,
  now = new Date(),
  timeZone?: string,
) {
  const today = dayKey(now, timeZone);
  return tasks
    .filter(
      (task) =>
        !finished.has(task.status) &&
        (task.assignedTo || task.assigneeIds || []).includes(userId) &&
        (task.status === "in_progress" ||
          (!task.plannedAt && !task.deadline) ||
          (task.plannedAt && dayKey(task.plannedAt, timeZone) === today) ||
          (task.deadline && dayKey(task.deadline, timeZone) <= today)),
    )
    .sort(
      (a, b) =>
        Number(b.priority === "critical") - Number(a.priority === "critical") ||
        Number(b.status === "in_progress") -
          Number(a.status === "in_progress") ||
        String(a.deadline || "9999").localeCompare(
          String(b.deadline || "9999"),
        ),
    );
}
export function operationTaskId(
  operation: PendingOperation,
): string | undefined {
  if (typeof operation.payload.taskId === "string")
    return operation.payload.taskId;
  const match = /^\/tasks\/([^/]+)(?:\/|$)/.exec(operation.path);
  if (match) return match[1];
  if (operation.path === "/tasks" && typeof operation.payload.id === "string")
    return operation.payload.id;
  return undefined;
}
export function taskSyncState(
  taskId: string,
  queue: PendingOperation[],
  unverified = false,
) {
  const operations = queue.filter((op) => operationTaskId(op) === taskId);
  return {
    operations,
    count: operations.length,
    status: operations.some((op) => op.status === "conflict")
      ? "conflict"
      : operations.some((op) => op.status === "failed")
        ? "failed"
        : operations.length
          ? "pending"
          : unverified
            ? "unverified"
            : "confirmed",
    photos: operations.filter((op) => !!op.fileUri).length,
  } as const;
}
export function operationLabel(operation: PendingOperation) {
  if (operation.fileUri) return "Foto toevoegen";
  if (operation.path === "/inventory/movements")
    return "Onderdelenverbruik / voorraad";
  if (operation.path.endsWith("/comments")) return "Opmerking";
  if (operation.path.endsWith("/time")) return "Tijdregistratie";
  if (operation.path.endsWith("/confirm")) return "Voorraadtelling";
  if (operation.path === "/tasks") return "Nieuwe melding";
  if (operation.payload.checklist) return "Checklist";
  if (operation.payload.status) return "Taakstatus";
  if (operation.path.startsWith("/tasks/")) return "Taakgegevens";
  if (operation.path.startsWith("/schedules")) return "Planning";
  return "Lokale wijziging";
}
