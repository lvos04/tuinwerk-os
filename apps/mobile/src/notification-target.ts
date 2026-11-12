const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Identity = { endpoint: string; user: { id: string } };
export type TaskTarget = {
  taskId: string;
  notificationId?: string;
  batchId?: string;
};
export function taskNotificationTarget(
  data: unknown,
  session: Identity,
): TaskTarget | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (
    value.entityType !== "task" ||
    typeof value.taskId !== "string" ||
    !UUID.test(value.taskId) ||
    value.recipientUserId !== session.user.id ||
    typeof value.serverOrigin !== "string"
  )
    return null;
  try {
    const origin = new URL(value.serverOrigin),
      server = new URL(session.endpoint);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      origin.origin !== server.origin
    )
      return null;
  } catch {
    return null;
  }
  return {
    taskId: value.taskId,
    ...(typeof value.batchId === "string" && UUID.test(value.batchId)
      ? { batchId: value.batchId }
      : {}),
    ...(typeof value.notificationId === "string" &&
    UUID.test(value.notificationId)
      ? { notificationId: value.notificationId }
      : {}),
  };
}
/** Custom scheme links must carry the same account/server binding as push data. */
export function taskLinkTarget(
  url: string,
  session: Identity,
): TaskTarget | null {
  try {
    const link = new URL(url);
    if (link.protocol !== "tuinwerk:" || link.hostname !== "task") return null;
    return taskNotificationTarget(
      {
        entityType: "task",
        taskId: link.pathname.replace(/^\//, ""),
        recipientUserId: link.searchParams.get("recipientUserId"),
        serverOrigin: link.searchParams.get("serverOrigin"),
        notificationId: link.searchParams.get("notificationId"),
      },
      session,
    );
  } catch {
    return null;
  }
}
