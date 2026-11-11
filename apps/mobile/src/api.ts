import { PendingOperation, RequestError } from "./queue";
import * as SecureStore from "expo-secure-store";
import { SessionGeneration } from "./session-state";
import { collectPages } from "./paging";
export type User = { id: string; name: string; email: string; role: string };
export type Session = {
  token: string;
  refreshToken?: string;
  user: User;
  endpoint: string;
};
export function normalizeEndpoint(value: string) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "Gebruik HTTPS voor je server (HTTP alleen voor lokale ontwikkeling).",
    );
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Voer alleen het serveradres in, zonder wachtwoord of parameters.",
    );
  return (
    url
      .toString()
      .replace(/\/$/, "")
      .replace(/\/api$/, "") + "/api"
  );
}
export async function request(
  endpoint: string,
  token: string | undefined,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const response = await fetch(endpoint + path, {
    signal: controller.signal,
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!response.ok)
    throw new RequestError(
      response.status,
      Array.isArray(data?.message)
        ? data.message.join(", ")
        : data?.message || `Serverfout ${response.status}`,
      data,
    );
  return data;
}
export async function sendOperation(
  session: Session,
  operation: PendingOperation,
) {
  let body: unknown = { ...operation.payload, operationId: operation.id };
  if (operation.fileUri) {
    const form = new FormData();
    Object.entries(operation.payload).forEach(([key, value]) =>
      form.append(key, String(value)),
    );
    form.append("operationId", operation.id);
    form.append("file", {
      uri: operation.fileUri,
      name: operation.filename || "foto.jpg",
      type: operation.mimeType || "image/jpeg",
    } as any);
    body = form;
  }
  return authorizedRequest(session, operation.path, operation.method, body);
}

const generation = new SessionGeneration();
const epochs = new WeakMap<Session, number>();
const identity = (session: Session) => session.endpoint + "|" + session.user.id;
let persistence: Promise<void> = Promise.resolve();
export function activateSession(session: Session) {
  epochs.set(session, generation.activate(identity(session)));
}
export async function persistSession(session: Session) {
  const epoch = epochs.get(session) ?? -1;
  persistence = persistence
    .catch(() => {})
    .then(async () => {
      if (generation.matches(identity(session), epoch))
        await SecureStore.setItemAsync("session", JSON.stringify(session));
    });
  await persistence;
}
export async function clearSession() {
  generation.invalidate();
  persistence = persistence
    .catch(() => {})
    .then(() => SecureStore.deleteItemAsync("session"));
  await persistence;
}
const refreshing = new Map<string, Promise<void>>();
/** Scoped refresh and serialized storage prevent late account resurrection. */
export async function authorizedRequest(
  session: Session,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const epoch = epochs.get(session) ?? -1,
    key = identity(session),
    refreshKey = key + "|" + epoch;
  if (!generation.matches(key, epoch))
    throw new Error("Sessie is inmiddels beëindigd.");
  try {
    const result = await request(
      session.endpoint,
      session.token,
      path,
      method,
      body,
    );
    if (!generation.matches(key, epoch))
      throw new Error("Sessie is inmiddels beëindigd.");
    return result;
  } catch (error) {
    if (
      !(error instanceof RequestError) ||
      error.status !== 401 ||
      !session.refreshToken
    )
      throw error;
    if (!generation.matches(key, epoch))
      throw new Error("Sessie is inmiddels beëindigd.");
    if (!refreshing.has(refreshKey))
      refreshing.set(
        refreshKey,
        (async () => {
          const result = await request(
            session.endpoint,
            undefined,
            "/auth/refresh",
            "POST",
            { refreshToken: session.refreshToken },
          );
          if (!generation.matches(key, epoch))
            throw new Error("Sessie is inmiddels beëindigd.");
          session.token = result.token;
          session.refreshToken = result.refreshToken;
          await persistSession(session);
        })().finally(() => {
          refreshing.delete(refreshKey);
        }),
      );
    await refreshing.get(refreshKey);
    if (!generation.matches(key, epoch))
      throw new Error("Sessie is inmiddels beëindigd.");
    const result = await request(
      session.endpoint,
      session.token,
      path,
      method,
      body,
    );
    if (!generation.matches(key, epoch))
      throw new Error("Sessie is inmiddels beëindigd.");
    return result;
  }
}

export async function allPages(
  session: Session,
  path: string,
): Promise<Record<string, any>[]> {
  return collectPages((offset, limit) =>
    authorizedRequest(
      session,
      path +
        (path.includes("?") ? "&" : "?") +
        "limit=" +
        limit +
        "&offset=" +
        offset,
    ),
  );
}
