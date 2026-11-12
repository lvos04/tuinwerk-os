/** Durable operations are processed in order per affected task/stock balance.
 * A business conflict blocks its dependants; connectivity/auth failures stop all. */
export type PendingOperation = {
  id: string;
  owner: string;
  method: "POST" | "PATCH";
  path: string;
  payload: Record<string, unknown>;
  status: "pending" | "conflict" | "failed";
  error?: string;
  fileUri?: string;
  mimeType?: string;
  filename?: string;
  createdAt?: string;
  lastAttemptAt?: string;
  attempts?: number;
  conflict?: unknown;
};
export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}
export function operationScopes(operation: PendingOperation): string[] {
  const scopes: string[] = [];
  const task =
    /^\/tasks\/([^/]+)(?:\/|$)/.exec(operation.path)?.[1] ||
    (operation.path === "/tasks"
      ? operation.payload.id
      : operation.payload.taskId);
  if (typeof task === "string") scopes.push("task:" + task);
  if (operation.path === "/inventory/movements") {
    for (const location of [
      operation.payload.locationId,
      operation.payload.toLocationId,
    ])
      if (typeof location === "string")
        scopes.push("stock:" + operation.payload.itemId + ":" + location);
  }
  if (operation.path.startsWith("/inventory/counts/")) scopes.push("stock:all");
  if (!scopes.length) scopes.push("path:" + operation.path);
  return scopes;
}
export type DrainControl = {
  getCurrent?: (
    operation: PendingOperation,
  ) => Promise<PendingOperation | null>;
  isActive?: () => boolean;
  onAttempt?: (operation: PendingOperation | null) => void;
};
export async function drainQueue(
  operations: PendingOperation[],
  owner: string,
  send: (operation: PendingOperation) => Promise<unknown>,
  update: (operation: PendingOperation) => Promise<void>,
  remove: (operation: PendingOperation) => Promise<void>,
  control: DrainControl = {},
): Promise<{ sent: number; blocked: boolean }> {
  let sent = 0,
    blocked = false;
  const blockedScopes = new Set<string>();
  const active = () => control.isActive?.() !== false;
  try {
    for (const snapshot of operations) {
      if (!active()) return { sent, blocked: true };
      if (snapshot.owner !== owner) continue;
      let operation = control.getCurrent
        ? await control.getCurrent(snapshot)
        : snapshot;
      if (!operation || operation.owner !== owner) continue;
      const scopes = operationScopes(operation),
        stock = scopes.some((scope) => scope.startsWith("stock:"));
      if (operation.status !== "pending") {
        blocked = true;
        scopes.forEach((scope) => blockedScopes.add(scope));
        continue;
      }
      if (
        scopes.some((scope) => blockedScopes.has(scope)) ||
        (stock && blockedScopes.has("stock:all")) ||
        (scopes.includes("stock:all") &&
          [...blockedScopes].some((scope) => scope.startsWith("stock:")))
      ) {
        blocked = true;
        scopes.forEach((scope) => blockedScopes.add(scope));
        continue;
      }
      const attempt = {
        ...operation,
        attempts: (operation.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        error: undefined,
      };
      try {
        await update(attempt);
        if (control.getCurrent && !(await control.getCurrent(attempt)))
          continue;
        if (!active()) return { sent, blocked: true };
        control.onAttempt?.(attempt);
        await send(attempt);
        if (!active()) return { sent, blocked: true };
        await remove(attempt);
        sent++;
      } catch (error) {
        if (error instanceof RequestError && error.status === 409) {
          await update({
            ...attempt,
            status: "conflict",
            error: error.message,
            conflict: error.detail,
          });
          blocked = true;
          scopes.forEach((scope) => blockedScopes.add(scope));
          continue;
        }
        if (
          error instanceof RequestError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![401, 408, 429].includes(error.status)
        ) {
          await update({ ...attempt, status: "failed", error: error.message });
          blocked = true;
          scopes.forEach((scope) => blockedScopes.add(scope));
          continue;
        }
        if (active())
          await update({
            ...attempt,
            error:
              error instanceof RequestError && error.status === 401
                ? "Aanmelden nodig. Je lokale invoer blijft bewaard."
                : "Nog geen serverbevestiging. Je invoer en foto’s blijven veilig op dit toestel.",
          });
        return { sent, blocked: true };
      } finally {
        control.onAttempt?.(null);
      }
    }
    return { sent, blocked };
  } finally {
    control.onAttempt?.(null);
  }
}
