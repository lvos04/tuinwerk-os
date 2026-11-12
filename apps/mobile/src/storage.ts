import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { PendingOperation } from "./queue";
const purgedOwners = new Set<string>();
let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!database)
    database = (async () => {
      const connection = await SQLite.openDatabaseAsync("tuinwerk.db");
      await connection.execAsync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS cache (owner TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(owner,name));
      CREATE TABLE IF NOT EXISTS operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_owners (owner TEXT PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS prevent_deleted_cache BEFORE INSERT ON cache WHEN EXISTS(SELECT 1 FROM deleted_owners WHERE owner=NEW.owner) BEGIN SELECT RAISE(IGNORE); END;
      CREATE TRIGGER IF NOT EXISTS prevent_deleted_operations BEFORE INSERT ON operations WHEN EXISTS(SELECT 1 FROM deleted_owners WHERE owner=NEW.owner) BEGIN SELECT RAISE(IGNORE); END;`);
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
  if (purgedOwners.has(operation.owner)) {
    if (operation.fileUri)
      await FileSystem.deleteAsync(operation.fileUri, { idempotent: true });
    throw new Error("Account verwijderd; wijziging niet opgeslagen.");
  }
}
export async function queueGet(
  operation: PendingOperation,
): Promise<PendingOperation | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ json: string }>(
    "SELECT json FROM operations WHERE id=? AND owner=?",
    operation.id,
    operation.owner,
  );
  return row ? JSON.parse(row.json) : null;
}
/** The sync engine must never resurrect a draft deleted/replaced while awaiting IO. */
export async function queueUpdateExisting(operation: PendingOperation) {
  await (
    await db()
  ).runAsync(
    "UPDATE operations SET json=? WHERE id=? AND owner=?",
    JSON.stringify(operation),
    operation.id,
    operation.owner,
  );
}
export async function queueReplace(
  previous: PendingOperation,
  replacement: PendingOperation,
) {
  if (previous.owner !== replacement.owner)
    throw new Error("Account van concept mag niet wijzigen.");
  const result = await (
    await db()
  ).runAsync(
    "UPDATE operations SET id=?,json=? WHERE id=? AND owner=? AND json=?",
    replacement.id,
    JSON.stringify(replacement),
    previous.id,
    previous.owner,
    JSON.stringify(previous),
  );
  if (result.changes !== 1)
    throw new Error(
      "Dit concept is intussen gewijzigd of verwerkt. Open het opnieuw voordat je wijzigingen toepast.",
    );
}
export async function queueRemove(operation: PendingOperation) {
  const result = await (
    await db()
  ).runAsync(
    "DELETE FROM operations WHERE id=? AND owner=?",
    operation.id,
    operation.owner,
  );
  if (result.changes > 0 && operation.fileUri)
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
  if (purgedOwners.has(owner)) throw new Error("Account verwijderd.");
  const Crypto = await import("expo-crypto");
  const account = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner,
  );
  const directory = FileSystem.documentDirectory + "offline-media/";
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const uri = directory + account + "-" + id;
  const existing = await FileSystem.getInfoAsync(uri);
  if (purgedOwners.has(owner)) throw new Error("Account verwijderd.");
  if (existing.exists) return uri;
  const result = await FileSystem.downloadAsync(url, uri, {
    headers: { Authorization: "Bearer " + token },
  });
  if (purgedOwners.has(owner) || result.status !== 200) {
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

export async function removeOwnerData(owner: string) {
  purgedOwners.add(owner);
  const connection = await db();
  await connection.runAsync(
    "INSERT OR IGNORE INTO deleted_owners(owner) VALUES(?)",
    owner,
  );
  const operations = await queueRead(owner);
  for (const operation of operations)
    if (operation.fileUri)
      await FileSystem.deleteAsync(operation.fileUri, { idempotent: true });
  const Crypto = await import("expo-crypto");
  const prefix = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner,
  );
  const directory = FileSystem.documentDirectory + "offline-media/";
  if ((await FileSystem.getInfoAsync(directory)).exists)
    for (const name of await FileSystem.readDirectoryAsync(directory))
      if (name.startsWith(prefix + "-"))
        await FileSystem.deleteAsync(directory + name, { idempotent: true });
  await connection.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync("DELETE FROM operations WHERE owner=?", owner);
    await transaction.runAsync("DELETE FROM cache WHERE owner=?", owner);
  });
}
