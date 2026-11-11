/** Transport-independent, serial queue. A blocked operation stops later operations
 * so an offline photo cannot overtake its task or overwrite a conflicted edit. */
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
export async function drainQueue(
  operations: PendingOperation[],
  owner: string,
  send: (operation: PendingOperation) => Promise<unknown>,
  update: (operation: PendingOperation) => Promise<void>,
  remove: (operation: PendingOperation) => Promise<void>,
): Promise<{ sent: number; blocked: boolean }> {
  let sent = 0;
  for (const operation of operations) {
    if (operation.owner !== owner) continue;
    if (operation.status !== "pending") return { sent, blocked: true };
    try {
      await send(operation);
      await remove(operation);
      sent++;
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        await update({
          ...operation,
          status: "conflict",
          error: error.message,
        });
      } else if (
        error instanceof RequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 408, 429].includes(error.status)
      ) {
        await update({ ...operation, status: "failed", error: error.message });
      }
      // Network, authorization and server failures retain the exact operation ID.
      return { sent, blocked: true };
    }
  }
  return { sent, blocked: false };
}
