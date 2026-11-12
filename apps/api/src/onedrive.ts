import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { query, transaction, audit, camel } from "./db";
import {
  settingsSnapshot,
  writeSetting,
  readSecret,
  writeSecret,
  deleteSecret,
  sealSecret,
  openSecret,
} from "./settings";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Files.ReadWrite.AppFolder";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const CHUNK = 10 * 320 * 1024;
const MAX_ARCHIVE = 250 * 1024 ** 3;
function timed(signal: AbortSignal | null | undefined, ms: number) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);
}
let accessCache:
  | { token: string; expiresAt: number; refreshHash: string; config: string }
  | undefined;
export type OneDriveManifest = {
  format: "tuinwerk-backup-v2";
  id: string;
  createdAt: string;
  archiveName: string;
  size: number;
  sha256: string;
  encryption: "aes-256-gcm+scrypt";
  contents: string[];
  appVersion: string;
  manifestVersion: 1;
};
type Config = { clientId: string; tenant: string; folder: string };
function id(value: string) {
  if (!UUID.test(value)) throw new BadRequestException("Ongeldig back-up-ID");
  return value;
}
function tenant(value: unknown) {
  if (
    typeof value !== "string" ||
    (!["common", "consumers", "organizations"].includes(value) &&
      !UUID.test(value))
  )
    throw new BadRequestException(
      "Kies common, consumers, organizations of een geldig tenant-ID",
    );
  return value;
}
function folder(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    /[\\/"*:<>?|\x00-\x1f]/.test(value) ||
    value === "." ||
    value === ".." ||
    /[. ]$/.test(value)
  )
    throw new BadRequestException(
      "Kies één OneDrive-mapnaam zonder slash of speciale tekens (maximaal 120)",
    );
  return value;
}
async function config(): Promise<Config> {
  const { values } = await settingsSnapshot();
  return {
    clientId: String(values.oneDriveClientId || ""),
    tenant: String(values.oneDriveTenantId || "consumers"),
    folder: String(values.oneDriveFolder || "TuinWerk Backups"),
  };
}

function assertConfig(c: Config) {
  if (!UUID.test(c.clientId))
    throw new BadRequestException(
      "Vul eerst de Microsoft Application (client) ID in",
    );
  tenant(c.tenant);
  folder(c.folder);
}
function oauthUrl(t: string, path: string) {
  return `https://login.microsoftonline.com/${tenant(t)}/oauth2/v2.0/${path}`;
}
async function json(response: Response, max = 1024 * 1024): Promise<any> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > max) {
          await reader.cancel();
          throw new ServiceUnavailableException(
            "Antwoord van OneDrive is te groot",
          );
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceUnavailableException("OneDrive gaf geen geldig antwoord");
  }
}
async function oauth(t: string, path: string, body: Record<string, string>) {
  const response = await fetch(oauthUrl(t, path), {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });
  return { response, data: await json(response) };
}
function fingerprint(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
function safeProviderError() {
  return new ServiceUnavailableException(
    "OneDrive is niet bereikbaar of de machtiging is verlopen; controleer de verbinding in instellingen",
  );
}
async function accessToken(): Promise<string> {
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))");
    await c.query("SELECT pg_advisory_xact_lock(hashtext('onedrive-token'))");
    const cfg = await config();
    assertConfig(cfg);
    const configKey = JSON.stringify(cfg);
    const [connection] = (
      await c.query(
        "SELECT client_id,tenant FROM onedrive_connection WHERE id=1",
      )
    ).rows;
    if (
      !connection ||
      connection.client_id !== cfg.clientId ||
      connection.tenant !== cfg.tenant
    ) {
      accessCache = undefined;
      throw new BadRequestException(
        "OneDrive-instellingen gewijzigd; verbind het Microsoft-account opnieuw",
      );
    }
    const current = await readSecret("oneDriveRefreshToken");
    if (!current) throw new BadRequestException("OneDrive is niet verbonden");
    if (
      accessCache &&
      accessCache.refreshHash === fingerprint(current) &&
      accessCache.config === configKey &&
      accessCache.expiresAt > Date.now() + 60000
    )
      return accessCache.token;
    const { response, data } = await oauth(cfg.tenant, "token", {
      client_id: cfg.clientId,
      grant_type: "refresh_token",
      refresh_token: current,
      scope: SCOPES,
    });
    if (!response.ok || typeof data.access_token !== "string") {
      accessCache = undefined;
      throw safeProviderError();
    }
    const next =
      typeof data.refresh_token === "string" ? data.refresh_token : current;
    if (next !== current) await writeSecret("oneDriveRefreshToken", next, c);
    accessCache = {
      token: data.access_token,
      expiresAt:
        Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
      refreshHash: fingerprint(next),
      config: configKey,
    };
    return data.access_token;
  });
}

async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Invalid Graph path");
  const token = await accessToken();
  const response = await fetch(GRAPH + path, {
    ...init,
    redirect: "manual",
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: timed(init.signal, 30000),
  });
  if (response.status === 401) accessCache = undefined;
  return response;
}
export function trustedTransferUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("Ongeldige OneDrive-overdracht URL");
  }
  const host = url.hostname.toLowerCase();
  const trusted =
    host === "api.onedrive.com" ||
    host.endsWith(".1drv.com") ||
    host.endsWith(".sharepoint.com") ||
    host.endsWith(".storage.live.com");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !trusted
  )
    throw new BadRequestException(
      "OneDrive-overdracht verwijst naar een niet-vertrouwde host",
    );
  return url;
}
function graphNext(value: unknown): string {
  if (typeof value !== "string") throw safeProviderError();
  const u = new URL(value);
  if (
    u.origin !== "https://graph.microsoft.com" ||
    !u.pathname.startsWith("/v1.0/")
  )
    throw safeProviderError();
  return u.pathname.slice("/v1.0".length) + u.search;
}
async function driveFolder(): Promise<string> {
  const cfg = await config();
  assertConfig(cfg);
  const [connection] = await query<any>(
    "SELECT * FROM onedrive_connection WHERE id=1",
  );
  if (!connection) throw new BadRequestException("OneDrive is niet verbonden");
  // Resolve by configured name every time; a folder-id cache may refer to another account after reconnect.
  const rootResponse = await graph("/me/drive/special/approot");
  if (!rootResponse.ok) throw safeProviderError();
  const root = await json(rootResponse);
  if (typeof root.id !== "string") throw safeProviderError();
  let response = await graph(
    `/me/drive/items/${encodeURIComponent(root.id)}:/${encodeURIComponent(cfg.folder)}`,
  );
  if (response.status === 404)
    response = await graph(
      `/me/drive/items/${encodeURIComponent(root.id)}/children`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cfg.folder,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      },
    );
  if (response.status === 409)
    response = await graph(
      `/me/drive/items/${encodeURIComponent(root.id)}:/${encodeURIComponent(cfg.folder)}`,
    );
  if (!response.ok) throw safeProviderError();
  const item = await json(response);
  if (!item.folder || typeof item.id !== "string")
    throw new BadRequestException("De gekozen OneDrive-naam is geen map");
  await query(
    "UPDATE onedrive_connection SET folder_id=$1,updated_at=now() WHERE id=1",
    [item.id],
  );
  return item.id;
}
export function validateManifest(value: any): OneDriveManifest {
  if (
    !value ||
    value.format !== "tuinwerk-backup-v2" ||
    value.manifestVersion !== 1 ||
    !UUID.test(value.id) ||
    value.archiveName !== `${value.id}.twb` ||
    !HASH.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > MAX_ARCHIVE ||
    value.encryption !== "aes-256-gcm+scrypt" ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.contents) ||
    value.contents.some(
      (x: any) => !["database", "uploads", "exports", "config"].includes(x),
    ) ||
    !["database", "uploads", "exports", "config"].every((x) =>
      value.contents.includes(x),
    ) ||
    typeof value.appVersion !== "string" ||
    value.appVersion.length > 100
  )
    throw new BadRequestException("Ongeldig TuinWerk-back-upmanifest");
  return {
    format: value.format,
    id: value.id,
    createdAt: value.createdAt,
    archiveName: value.archiveName,
    size: value.size,
    sha256: value.sha256.toLowerCase(),
    encryption: value.encryption,
    contents: value.contents,
    appVersion: value.appVersion,
    manifestVersion: 1,
  };
}
async function digestFile(path: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path, { signal })) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest("hex") };
}
async function transferStart(
  manifest: OneDriveManifest,
  direction: "upload" | "download",
) {
  if (direction === "upload") {
    const [previous] = await query<any>(
      "UPDATE onedrive_transfers SET state='running',error=NULL,completed_at=NULL WHERE id=(SELECT id FROM onedrive_transfers WHERE backup_id=$1 AND direction='upload' AND state IN ('running','failed') AND size=$2 AND sha256=$3 AND session_expires_at>now() ORDER BY started_at DESC LIMIT 1) RETURNING id",
      [manifest.id, manifest.size, manifest.sha256],
    );
    if (previous) return previous.id as string;
  }
  const [row] = await query<any>(
    "INSERT INTO onedrive_transfers(backup_id,direction,state,size,sha256) VALUES($1,$2,'running',$3,$4) RETURNING id",
    [manifest.id, direction, manifest.size, manifest.sha256],
  );
  return row.id as string;
}
async function transferFailure(transferId: string) {
  await query(
    "UPDATE onedrive_transfers SET state='failed',error='Overdracht mislukt; controleer verbinding en probeer opnieuw',completed_at=now() WHERE id=$1",
    [transferId],
  );
}
function retryDelay(response: Response, attempt: number) {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.max(1000, seconds * 1000);
    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp))
      return Math.max(1000, timestamp - Date.now());
  }
  return 500 * 2 ** attempt;
}
async function pause(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
/** Bounded streaming upload; preauthenticated upload URLs deliberately receive no Bearer header. */
type UploadInput = {
  archivePath: string;
  manifest: OneDriveManifest;
  operationId?: string;
  signal?: AbortSignal;
};
export async function uploadOneDriveBackup(input: UploadInput) {
  id(input.manifest.id);
  return transaction(async (c) => {
    const [lock] = (
      await c.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
        ["onedrive-upload:" + input.manifest.id],
      )
    ).rows;
    if (!lock.locked)
      throw new BadRequestException(
        "Deze back-up wordt al naar OneDrive overgedragen",
      );
    return uploadBackup(input);
  });
}
async function uploadBackup(input: UploadInput) {
  input.signal?.throwIfAborted();
  const manifest = validateManifest(input.manifest);
  const source = resolve(input.archivePath);
  const info = await stat(source);
  if (!info.isFile() || info.size !== manifest.size)
    throw new BadRequestException(
      "Back-upbestand ontbreekt of heeft een onjuiste grootte",
    );
  const digest = await digestFile(source, input.signal);
  if (digest.sha256 !== manifest.sha256)
    throw new BadRequestException("Hash van lokaal back-upbestand klopt niet");
  const transferId = await transferStart(manifest, "upload");
  try {
    const folderId = await driveFolder();
    input.signal?.throwIfAborted();
    const scope = fingerprint(JSON.stringify(await config()) + folderId);
    let uploadUrl = "",
      offset = 0;
    const [previous] = await query<any>(
      "SELECT * FROM onedrive_transfers WHERE id=$1",
      [transferId],
    );
    if (
      previous.upload_session &&
      previous.session_scope === scope &&
      new Date(previous.session_expires_at).getTime() > Date.now()
    ) {
      const candidate = trustedTransferUrl(
        openSecret(previous.upload_session, "onedrive-upload:" + transferId),
      ).toString();
      const resume = await fetch(candidate, {
        redirect: "error",
        signal: timed(input.signal, 20000),
      });
      if (resume.ok) {
        const state = await json(resume);
        const next = Number(state.nextExpectedRanges?.[0]?.split("-")[0]);
        if (
          Number.isSafeInteger(next) &&
          next >= 0 &&
          next < manifest.size &&
          next % CHUNK === 0
        ) {
          uploadUrl = candidate;
          offset = next;
        }
      } else if (![404, 410].includes(resume.status)) throw safeProviderError();
    }
    if (!uploadUrl) {
      const response = await graph(
        `/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(manifest.archiveName)}:/createUploadSession`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            item: {
              "@microsoft.graph.conflictBehavior": "replace",
              name: manifest.archiveName,
            },
          }),
          signal: input.signal,
        },
      );
      if (!response.ok) throw safeProviderError();
      const session = await json(response);
      uploadUrl = trustedTransferUrl(session.uploadUrl).toString();
      const expires = new Date(session.expirationDateTime);
      if (
        !Number.isFinite(expires.getTime()) ||
        expires.getTime() <= Date.now()
      )
        throw safeProviderError();
      await query(
        "UPDATE onedrive_transfers SET upload_session=$2,session_expires_at=$3,session_scope=$4,bytes_transferred=0 WHERE id=$1",
        [
          transferId,
          sealSecret(uploadUrl, "onedrive-upload:" + transferId),
          expires,
          scope,
        ],
      );
    }
    const file = await open(source, "r");
    let remoteId = "";
    const uploadedHash = createHash("sha256");
    if (offset > 0) {
      for await (const bytes of createReadStream(source, {
        start: 0,
        end: offset - 1,
        signal: input.signal,
      }))
        uploadedHash.update(bytes);
    }
    try {
      while (offset < manifest.size) {
        input.signal?.throwIfAborted();
        const [active] = await query<any>(
          "SELECT folder_id,client_id,tenant FROM onedrive_connection WHERE id=1",
        );
        const current = await config();
        if (
          !active ||
          active.folder_id !== folderId ||
          active.client_id !== current.clientId ||
          active.tenant !== current.tenant ||
          fingerprint(JSON.stringify(current) + folderId) !== scope
        )
          throw new BadRequestException(
            "OneDrive-verbinding is gewijzigd; overdracht gestopt",
          );
        const length = Math.min(CHUNK, manifest.size - offset);
        const bytes = Buffer.allocUnsafe(length);
        const read = await file.read(bytes, 0, length, offset);
        if (read.bytesRead !== length)
          throw new Error("Backup changed during upload");
        let accepted = false;
        for (let attempt = 0; attempt < 5 && !accepted; attempt++) {
          let reply: Response;
          try {
            reply = await fetch(uploadUrl, {
              method: "PUT",
              redirect: "error",
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(length),
                "Content-Range": `bytes ${offset}-${offset + length - 1}/${manifest.size}`,
              },
              body: bytes,
              signal: timed(input.signal, 60000),
            });
          } catch {
            input.signal?.throwIfAborted();
            if (attempt === 4) throw safeProviderError();
            await pause(500 * 2 ** attempt, input.signal);
            continue;
          }
          if (reply.status === 200 || reply.status === 201) {
            const item = await json(reply);
            if (
              typeof item.id !== "string" ||
              Number(item.size) !== manifest.size
            )
              throw safeProviderError();
            remoteId = item.id;
            offset = manifest.size;
            accepted = true;
          } else if (reply.status === 202) {
            const next = await json(reply);
            const range = next.nextExpectedRanges?.[0];
            const nextOffset =
              typeof range === "string" ? Number(range.split("-")[0]) : NaN;
            if (
              !Number.isSafeInteger(nextOffset) ||
              nextOffset !== offset + length
            )
              throw safeProviderError();
            offset = nextOffset;
            accepted = true;
          } else if (reply.status === 416) {
            const status = await fetch(uploadUrl, {
              redirect: "error",
              signal: timed(input.signal, 20000),
            });
            if (!status.ok) throw safeProviderError();
            const state = await json(status);
            const next = Number(state.nextExpectedRanges?.[0]?.split("-")[0]);
            if (
              Number.isSafeInteger(next) &&
              next === offset + length &&
              next < manifest.size
            ) {
              offset = next;
              accepted = true;
            } else throw safeProviderError();
          } else if (reply.status === 429 || reply.status >= 500) {
            if (attempt === 4) throw safeProviderError();
            await pause(retryDelay(reply, attempt), input.signal);
          } else throw safeProviderError();
        }
        if (!accepted) throw safeProviderError();
        uploadedHash.update(bytes);
        await query(
          "UPDATE onedrive_transfers SET bytes_transferred=$2 WHERE id=$1",
          [transferId, offset],
        );
      }
    } finally {
      await file.close();
    }
    if (!remoteId || uploadedHash.digest("hex") !== manifest.sha256)
      throw new BadRequestException(
        "Back-upbestand is tijdens upload gewijzigd; maak een nieuwe back-up",
      );
    const manifestResponse = await graph(
      `/me/drive/items/${encodeURIComponent(folderId)}:/${manifest.id}.manifest.json:/content`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manifest),
        signal: input.signal,
      },
    );
    if (!manifestResponse.ok) throw safeProviderError();
    const remoteManifest = await json(manifestResponse);
    await query(
      "UPDATE onedrive_transfers SET state='completed',remote_id=$2,upload_session=NULL,session_expires_at=NULL,completed_at=now() WHERE id=$1",
      [transferId, remoteId],
    );
    return {
      id: manifest.id,
      remoteId,
      manifestId: remoteManifest.id,
      size: manifest.size,
      sha256: manifest.sha256,
    };
  } catch (error) {
    await transferFailure(transferId);
    throw error;
  }
}
async function contentResponse(
  folderId: string,
  name: string,
  signal?: AbortSignal,
) {
  const response = await graph(
    `/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/content`,
    { signal },
  );
  if (
    response.status === 302 ||
    response.status === 303 ||
    response.status === 307
  ) {
    const location = response.headers.get("location");
    if (!location) throw safeProviderError();
    return fetch(trustedTransferUrl(location), {
      redirect: "error",
      signal: timed(signal, 60000),
    });
  }
  return response;
}
async function remoteManifest(folderId: string, backupId: string) {
  const response = await contentResponse(
    folderId,
    `${id(backupId)}.manifest.json`,
  );
  if (response.status === 404)
    throw new NotFoundException("OneDrive-back-up niet gevonden");
  if (!response.ok) throw safeProviderError();
  const manifest = validateManifest(await json(response, 65536));
  if (manifest.id !== backupId)
    throw new BadRequestException("Manifest-ID wijkt af");
  return manifest;
}
export async function listOneDriveBackups(): Promise<OneDriveManifest[]> {
  const folderId = await driveFolder();
  let path = `/me/drive/items/${encodeURIComponent(folderId)}/children?$select=id,name,size,file&$top=200`;
  const names: string[] = [];
  while (path) {
    const response = await graph(path);
    if (!response.ok) throw safeProviderError();
    const page = await json(response);
    if (!Array.isArray(page.value)) throw safeProviderError();
    for (const item of page.value) {
      if (
        typeof item.name === "string" &&
        /^[0-9a-f-]{36}\.manifest\.json$/i.test(item.name) &&
        Number(item.size) <= 65536
      )
        names.push(item.name.slice(0, 36));
    }
    if (names.length > 2000)
      throw new BadRequestException(
        "Meer dan 2000 back-ups; gebruik een aparte archiefmap",
      );
    path = page["@odata.nextLink"] ? graphNext(page["@odata.nextLink"]) : "";
  }
  const result: OneDriveManifest[] = [];
  for (const backupId of names) {
    try {
      result.push(await remoteManifest(folderId, backupId));
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      )
        continue;
      throw error;
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function downloadOneDriveBackup(
  backupId: string,
  destinationPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<OneDriveManifest> {
  options.signal?.throwIfAborted();
  id(backupId);
  const destination = resolve(destinationPath);
  if (basename(destination) !== `${backupId}.twb`)
    throw new BadRequestException(
      "Herstelbestand moet de back-up-ID als bestandsnaam hebben",
    );
  const folderId = await driveFolder();
  const manifest = await remoteManifest(folderId, backupId);
  const transferId = await transferStart(manifest, "download");
  const partial = destination + ".partial-" + randomUUID();
  try {
    const response = await contentResponse(
      folderId,
      manifest.archiveName,
      options.signal,
    );
    if (!response.ok || !response.body) throw safeProviderError();
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) !== manifest.size)
      throw new BadRequestException("OneDrive-bestandsgrootte wijkt af");
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    let size = 0;
    const hash = createHash("sha256");
    let nextProgress = CHUNK;
    const verify = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > manifest.size) {
          done(new Error("Archive exceeds manifest size"));
          return;
        }
        hash.update(chunk);
        if (size >= nextProgress) {
          nextProgress = size + CHUNK;
          query(
            "UPDATE onedrive_transfers SET bytes_transferred=$2 WHERE id=$1",
            [transferId, size],
          ).then(() => done(null, chunk), done);
        } else done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as any),
      verify,
      createWriteStream(partial, { flags: "wx", mode: 0o600 }),
      { signal: options.signal },
    );
    if (size !== manifest.size || hash.digest("hex") !== manifest.sha256)
      throw new BadRequestException(
        "OneDrive-back-up is onvolledig of de controlehash wijkt af",
      );
    await rename(partial, destination);
    await query(
      "UPDATE onedrive_transfers SET state='completed',bytes_transferred=$2,completed_at=now() WHERE id=$1",
      [transferId, size],
    );
    return manifest;
  } catch (error) {
    await unlink(partial).catch(() => {});
    await transferFailure(transferId);
    throw error;
  }
}

@Controller("admin/onedrive")
@UseGuards(AuthGuard, AdminGuard)
export class OneDriveController {
  @Get("status") async status() {
    const cfg = await config();
    const [connection] = await query<any>(
      "SELECT client_id,tenant,drive_type,account_name,connected_at FROM onedrive_connection WHERE id=1",
    );
    const hasToken = !!(await readSecret("oneDriveRefreshToken"));
    return {
      configured: UUID.test(cfg.clientId),
      connected:
        !!connection &&
        hasToken &&
        connection.client_id === cfg.clientId &&
        connection.tenant === cfg.tenant,
      clientId: cfg.clientId,
      tenant: cfg.tenant,
      folder: cfg.folder,
      account: connection?.account_name || null,
      driveType: connection?.drive_type || null,
      connectedAt: connection?.connected_at || null,
    };
  }
  @Put("config") async configure(@CurrentUser() user: User, @Body() body: any) {
    const next: Config = {
      clientId: body.clientId,
      tenant: tenant(body.tenant || "consumers"),
      folder: folder(body.folder || "TuinWerk Backups"),
    };
    assertConfig(next);
    await transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
      );
      const old = await config();
      if (old.clientId !== next.clientId || old.tenant !== next.tenant) {
        await deleteSecret("oneDriveRefreshToken", c);
        await c.query("DELETE FROM onedrive_connection");
        await c.query(
          "UPDATE onedrive_device_flows SET status='cancelled',device_code='' WHERE status='pending'",
        );
      } else if (old.folder !== next.folder)
        await c.query(
          "UPDATE onedrive_connection SET folder_id=NULL,updated_at=now() WHERE id=1",
        );
      await writeSetting("oneDriveClientId", next.clientId, c);
      await writeSetting("oneDriveTenantId", next.tenant, c);
      await writeSetting("oneDriveFolder", next.folder, c);
      await audit(c, user.id, "onedrive", "config", "configured", {
        tenant: next.tenant,
        folder: next.folder,
      });
    });
    accessCache = undefined;
    return this.status();
  }
  @Post("connect") async connect(@CurrentUser() user: User) {
    const cfg = await config();
    assertConfig(cfg);
    const { response, data } = await oauth(cfg.tenant, "devicecode", {
      client_id: cfg.clientId,
      scope: SCOPES,
    });
    if (
      !response.ok ||
      typeof data.device_code !== "string" ||
      typeof data.user_code !== "string" ||
      typeof data.verification_uri !== "string"
    )
      throw safeProviderError();
    const uri = new URL(data.verification_uri);
    if (
      uri.protocol !== "https:" ||
      ![
        "microsoft.com",
        "www.microsoft.com",
        "login.microsoftonline.com",
      ].includes(uri.hostname)
    )
      throw safeProviderError();
    const interval = Math.max(5, Math.min(60, Number(data.interval) || 5));
    const expiresAt = new Date(
      Date.now() +
        Math.min(1800, Math.max(60, Number(data.expires_in) || 900)) * 1000,
    );
    const flowId = randomUUID();
    const encrypted = sealSecret(data.device_code, "onedrive-device:" + flowId);
    await transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
      );
      await c.query(
        "UPDATE onedrive_device_flows SET status='cancelled',device_code='' WHERE status='pending'",
      );
      await c.query(
        "INSERT INTO onedrive_device_flows(id,created_by,device_code,client_id,tenant,interval_seconds,expires_at,next_poll_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          flowId,
          user.id,
          encrypted,
          cfg.clientId,
          cfg.tenant,
          interval,
          expiresAt,
          new Date(Date.now() + interval * 1000),
        ],
      );
      await audit(
        c,
        user.id,
        "onedrive",
        flowId,
        "device_authorization_started",
      );
    });
    return {
      id: flowId,
      userCode: data.user_code,
      verificationUri: uri.toString(),
      expiresAt: expiresAt.toISOString(),
      interval,
    };
  }
  @Post("connect/:id/poll") async poll(
    @CurrentUser() user: User,
    @Param("id") flowId: string,
  ) {
    id(flowId);
    return transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
      );
      const flow = (
        await c.query(
          "SELECT * FROM onedrive_device_flows WHERE id=$1 AND created_by=$2 FOR UPDATE",
          [flowId, user.id],
        )
      ).rows[0];
      if (!flow) throw new NotFoundException();
      if (flow.status !== "pending")
        return { status: flow.status, interval: flow.interval_seconds };
      const cfg = await config();
      if (cfg.clientId !== flow.client_id || cfg.tenant !== flow.tenant) {
        await c.query(
          "UPDATE onedrive_device_flows SET status='cancelled',device_code='' WHERE id=$1",
          [flowId],
        );
        return { status: "cancelled", interval: flow.interval_seconds };
      }
      if (new Date(flow.expires_at).getTime() <= Date.now()) {
        await c.query(
          "UPDATE onedrive_device_flows SET status='expired',device_code='' WHERE id=$1",
          [flowId],
        );
        return { status: "expired", interval: flow.interval_seconds };
      }
      if (new Date(flow.next_poll_at).getTime() > Date.now())
        return { status: "pending", interval: flow.interval_seconds };
      const { response, data } = await oauth(flow.tenant, "token", {
        client_id: flow.client_id,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: openSecret(flow.device_code, "onedrive-device:" + flowId),
      });
      if (!response.ok) {
        if (
          data.error === "authorization_pending" ||
          data.error === "slow_down"
        ) {
          const interval =
            data.error === "slow_down"
              ? Math.min(60, flow.interval_seconds + 5)
              : flow.interval_seconds;
          await c.query(
            "UPDATE onedrive_device_flows SET next_poll_at=$2,interval_seconds=$3 WHERE id=$1",
            [flowId, new Date(Date.now() + interval * 1000), interval],
          );
          return { status: "pending", interval };
        }
        const state = data.error === "expired_token" ? "expired" : "denied";
        await c.query(
          "UPDATE onedrive_device_flows SET status=$2,device_code='' WHERE id=$1",
          [flowId, state],
        );
        return { status: state, interval: flow.interval_seconds };
      }
      if (
        typeof data.access_token !== "string" ||
        typeof data.refresh_token !== "string"
      )
        throw safeProviderError();
      const driveResponse = await fetch(GRAPH + "/me/drive/special/approot", {
        redirect: "error",
        headers: { Authorization: `Bearer ${data.access_token}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!driveResponse.ok) throw safeProviderError();
      const drive = await json(driveResponse);
      if (typeof drive.id !== "string") throw safeProviderError();
      const currentConfig = await config();
      if (
        currentConfig.clientId !== cfg.clientId ||
        currentConfig.tenant !== cfg.tenant
      ) {
        await c.query(
          "UPDATE onedrive_device_flows SET status='cancelled',device_code='' WHERE id=$1",
          [flowId],
        );
        return { status: "cancelled", interval: flow.interval_seconds };
      }
      await writeSecret("oneDriveRefreshToken", data.refresh_token, c);
      accessCache = {
        token: data.access_token,
        expiresAt:
          Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
        refreshHash: fingerprint(data.refresh_token),
        config: JSON.stringify(cfg),
      };
      await c.query(
        "INSERT INTO onedrive_connection(id,drive_id,drive_type,account_name,connected_by,client_id,tenant) VALUES(1,$1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET drive_id=$1,drive_type=$2,account_name=$3,connected_by=$4,client_id=$5,tenant=$6,folder_id=NULL,connected_at=now(),updated_at=now()",
        [
          drive.parentReference?.driveId || drive.id,
          drive.parentReference?.driveType || drive.driveType || "unknown",
          drive.owner?.user?.displayName || "Microsoft OneDrive",
          user.id,
          cfg.clientId,
          cfg.tenant,
        ],
      );
      await c.query(
        "UPDATE onedrive_device_flows SET status='connected',device_code='' WHERE id=$1",
        [flowId],
      );
      await audit(c, user.id, "onedrive", flowId, "connected", {
        driveType: drive.driveType,
      });
      return { status: "connected", interval: flow.interval_seconds };
    });
  }
  @Delete("connection") async disconnect(@CurrentUser() user: User) {
    accessCache = undefined;
    await transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
      );
      await c.query("SELECT pg_advisory_xact_lock(hashtext('onedrive-token'))");
      await deleteSecret("oneDriveRefreshToken", c);
      await c.query("DELETE FROM onedrive_connection");
      await c.query(
        "UPDATE onedrive_device_flows SET status='cancelled',device_code='' WHERE status='pending'",
      );
      await audit(c, user.id, "onedrive", "connection", "disconnected");
    });
    return { connected: false };
  }
  @Get("backups") backups() {
    return listOneDriveBackups();
  }
  @Get("transfers") async transfers() {
    return (
      await query<any>(
        "SELECT id,backup_id,direction,state,bytes_transferred,size,sha256,remote_id,error,started_at,completed_at FROM onedrive_transfers ORDER BY started_at DESC LIMIT 100",
      )
    ).map(camel);
  }
}
