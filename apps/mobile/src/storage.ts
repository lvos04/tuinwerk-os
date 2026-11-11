import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { PendingOperation } from "./queue";
let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!database)
    database = (async () => {
      const connection = await SQLite.openDatabaseAsync("tuinwerk.db");
      await connection.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cache (owner TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(owner,name));
      CREATE TABLE IF NOT EXISTS operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, json TEXT NOT NULL);`);
      return connection;
    })();
  return database;
}
export async function cacheRead<T>(
  owner: string,
  name: string,
  fallback: T,
): Promise<T> {
  const row = await (
    await db()
  ).getFirstAsync<{ json: string }>(
    "SELECT json FROM cache WHERE owner=? AND name=?",
    owner,
    name,
  );
  return row ? JSON.parse(row.json) : fallback;
}
export async function cacheWrite(owner: string, name: string, value: unknown) {
  await (
    await db()
  ).runAsync(
    "INSERT INTO cache(owner,name,json) VALUES(?,?,?) ON CONFLICT(owner,name) DO UPDATE SET json=excluded.json",
    owner,
    name,
    JSON.stringify(value),
  );
}
export async function queueRead(owner: string): Promise<PendingOperation[]> {
  return (
    await (
      await db()
    ).getAllAsync<{ json: string }>(
      "SELECT json FROM operations WHERE owner=? ORDER BY sequence",
      owner,
    )
  ).map((row) => JSON.parse(row.json));
}
export async function queueSave(operation: PendingOperation) {
  await (
    await db()
  ).runAsync(
    "INSERT INTO operations(id,owner,json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json WHERE operations.owner=excluded.owner",
    operation.id,
    operation.owner,
    JSON.stringify(operation),
  );
}
export async function queueReplace(
  previous: PendingOperation,
  replacement: PendingOperation,
) {
  if (previous.owner !== replacement.owner)
    throw new Error("Account van concept mag niet wijzigen.");
  await (
    await db()
  ).runAsync(
    "UPDATE operations SET id=?,json=? WHERE id=? AND owner=?",
    replacement.id,
    JSON.stringify(replacement),
    previous.id,
    previous.owner,
  );
}
export async function queueRemove(operation: PendingOperation) {
  await (
    await db()
  ).runAsync(
    "DELETE FROM operations WHERE id=? AND owner=?",
    operation.id,
    operation.owner,
  );
  if (operation.fileUri)
    await FileSystem.deleteAsync(operation.fileUri, { idempotent: true }).catch(
      () => {},
    );
}
export async function persistPhoto(uri: string, id: string): Promise<string> {
  const directory = FileSystem.documentDirectory + "pending-photos/";
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const source = await FileSystem.getInfoAsync(uri);
  if (!source.exists) throw new Error("Fotobestand niet gevonden.");
  let bytes = source.size || 0;
  for (const name of await FileSystem.readDirectoryAsync(directory)) {
    const file = await FileSystem.getInfoAsync(directory + name);
    if (file.exists) bytes += file.size || 0;
  }
  if (bytes > 250 * 1024 * 1024)
    throw new Error(
      "De lokale fotowachtrij is maximaal 250 MB. Synchroniseer voordat je meer foto’s toevoegt.",
    );
  const destination = directory + id + ".jpg";
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

export async function cacheMedia(
  owner: string,
  id: string,
  url: string,
  token: string,
): Promise<string> {
  const Crypto = await import("expo-crypto");
  const account = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner,
  );
  const directory = FileSystem.documentDirectory + "offline-media/";
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = directory + account + "-" + id;
  const existing = await FileSystem.getInfoAsync(uri);
  if (existing.exists) return uri;
  const result = await FileSystem.downloadAsync(url, uri, {
    headers: { Authorization: "Bearer " + token },
  });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new Error("Bijlage niet beschikbaar.");
  }
  const files = [];
  let bytes = 0;
  for (const name of await FileSystem.readDirectoryAsync(directory)) {
    const file = await FileSystem.getInfoAsync(directory + name);
    if (file.exists) {
      bytes += file.size || 0;
      files.push({
        uri: directory + name,
        size: file.size || 0,
        time: file.modificationTime || 0,
      });
    }
  }
  for (const file of files.sort((a, b) => a.time - b.time)) {
    if (bytes <= 250 * 1024 * 1024) break;
    if (file.uri !== uri) {
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
      bytes -= file.size;
    }
  }
  return uri;
}
