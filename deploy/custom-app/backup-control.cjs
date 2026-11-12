"use strict";
const fs = require("node:fs"),
  f = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { pipeline } = require("node:stream/promises");
const exec = promisify(execFile),
  scrypt = promisify(crypto.scrypt);
const ROOT = process.env.DATA_DIR || "/data",
  CONTROL = process.env.BACKUP_CONTROL_DIR || path.join(ROOT, "control"),
  BACKUPS = process.env.BACKUP_DIR || path.join(ROOT, "backups");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAGIC = Buffer.from("TWBK0002"),
  HEADER = 52,
  TAG = 16;
const DB =
  process.env.DATABASE_URL || "postgresql://tuinwerk@127.0.0.1:5432/tuinwerk";
function validateRequest(r) {
  if (
    !r ||
    !UUID.test(r.id) ||
    !UUID.test(r.requestedBy) ||
    !["backup", "restore_preview", "restore"].includes(r.operation) ||
    typeof r.recoverySecret !== "string" ||
    r.recoverySecret.length < 16 ||
    r.recoverySecret.length > 1024
  )
    throw Error("Ongeldige back-upopdracht");
  if (
    typeof r.archive !== "string" ||
    !UUID.test(r.archive.slice(0, -4)) ||
    !r.archive.endsWith(".twb")
  )
    throw Error("Ongeldig archief");
  if (
    r.operation === "restore" &&
    (!UUID.test(r.previewId) || !/^[a-f0-9]{64}$/.test(r.expectedSha256 || ""))
  )
    throw Error("Controleer eerst het herstelarchief");
  if (
    r.archiveSource !== undefined &&
    !["local", "upload", "onedrive"].includes(r.archiveSource)
  )
    throw Error("Ongeldige archiefbron");
  if (r.operation !== "backup" && !r.archiveSource)
    throw Error("Kies een archiefbron");
  if (
    r.retentionDays !== undefined &&
    (!Number.isInteger(r.retentionDays) ||
      r.retentionDays < 1 ||
      r.retentionDays > 3650)
  )
    throw Error("Ongeldige bewaartermijn");
  return r;
}
async function regular(file, max = Infinity) {
  const s = await f.lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > max)
    throw Error("Ongeldig bestand");
  return s;
}
async function readJson(file, max = 32768) {
  await regular(file, max);
  const h = await f.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    return JSON.parse(await h.readFile("utf8"));
  } finally {
    await h.close();
  }
}
async function syncPath(file) {
  const handle = await f.open(file, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function atomic(file, value) {
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  await f.writeFile(tmp, JSON.stringify(value), { mode: 0o640, flag: "wx" });
  await f.chown(tmp, 0, 1000).catch(() => {});
  await f.chmod(tmp, 0o640);
  await syncPath(tmp);
  await f.rename(tmp, file);
  await syncPath(path.dirname(file));
}
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function encrypt(input, output, secret) {
  const salt = crypto.randomBytes(32),
    iv = crypto.randomBytes(12),
    header = Buffer.concat([MAGIC, salt, iv]),
    key = await scrypt(secret, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  await f.writeFile(output, header, { mode: 0o600, flag: "wx" });
  try {
    await pipeline(
      fs.createReadStream(input),
      cipher,
      fs.createWriteStream(output, { flags: "a" }),
    );
    await f.appendFile(output, cipher.getAuthTag());
  } catch (e) {
    await f.rm(output, { force: true });
    throw e;
  } finally {
    key.fill(0);
  }
}
async function decrypt(input, output, secret) {
  const size = (await regular(input)).size;
  if (size < HEADER + TAG) throw Error("Ongeldig archief");
  const h = await f.open(
      input,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    ),
    header = Buffer.alloc(HEADER),
    tag = Buffer.alloc(TAG);
  try {
    await h.read(header, 0, HEADER, 0);
    await h.read(tag, 0, TAG, size - TAG);
  } finally {
    await h.close();
  }
  if (!header.subarray(0, 8).equals(MAGIC))
    throw Error("Niet-ondersteund back-upformaat");
  const key = await scrypt(secret, header.subarray(8, 40), 32),
    decipher = crypto.createDecipheriv("aes-256-gcm", key, header.subarray(40));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(input, { start: HEADER, end: size - TAG - 1 }),
      decipher,
      fs.createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
  } catch {
    await f.rm(output, { force: true });
    throw Error("Herstelcode onjuist of archief beschadigd");
  } finally {
    key.fill(0);
  }
}
async function run(command, args, options = {}) {
  return exec(command, args, { maxBuffer: 1024 * 1024, ...options });
}
async function commandToFile(command, args, file) {
  const out = fs.createWriteStream(file, { flags: "wx", mode: 0o600 }),
    child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let error = "";
  child.stderr.on("data", (c) => {
    if (error.length < 2000) error += c;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error("Back-updatabase kon niet worden gelezen")),
    );
  });
  await Promise.all([pipeline(child.stdout, out), done]);
}
async function supervisor(action) {
  await run("supervisorctl", [
    "-c",
    "/opt/tuinwerk/supervisord.conf",
    action,
    "api",
    "worker",
    "web",
  ]);
}
async function snapshot(dir) {
  await commandToFile("pg_dump", [DB, "-Fc"], path.join(dir, "database.dump"));
  await run("tar", [
    "-C",
    ROOT,
    "--exclude=config/backup.lock",
    "-cf",
    path.join(dir, "files.tar"),
    "uploads",
    "exports",
    "config",
  ]);
  await run("sync", ["-f", ROOT]);
}

async function unpack(archive, secret, work) {
  const tar = path.join(work, "archive.tar");
  await decrypt(archive, tar, secret);
  await run("python3", ["/opt/tuinwerk/extract-safe.py", "outer", tar, work]);
  const m = await readJson(path.join(work, "manifest.json"));
  if (
    m.format !== "tuinwerk-backup-v2" ||
    !UUID.test(m.id) ||
    m.id !== path.basename(archive, ".twb") ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    !Array.isArray(m.contents) ||
    !["database", "uploads", "exports", "config"].every((x) =>
      m.contents.includes(x),
    )
  )
    throw Error("Archief is geen volledige TuinWerk-back-up");
  if (
    (await hash(path.join(work, "database.dump"))) !== m.databaseSha256 ||
    (await hash(path.join(work, "files.tar"))) !== m.filesSha256
  )
    throw Error("Controlesom van back-up klopt niet");
  await run("python3", [
    "/opt/tuinwerk/extract-safe.py",
    "files-v2",
    path.join(work, "files.tar"),
    "--check",
  ]);
  return m;
}
function publicManifest(m, archive, size, sha256) {
  return {
    format: "tuinwerk-backup-v2",
    id: m.id,
    createdAt: m.createdAt,
    archiveName: archive,
    size,
    sha256,
    encryption: "aes-256-gcm+scrypt",
    contents: ["database", "uploads", "exports", "config"],
    appVersion:
      typeof m.appVersion === "string" ? m.appVersion.slice(0, 100) : "unknown",
    manifestVersion: 1,
  };
}
async function inputArchive(name, source) {
  const file = path.join(
    source === "local" ? BACKUPS : path.join(CONTROL, "uploads"),
    name,
  );
  try {
    await regular(file);
    return file;
  } catch {
    throw Error("Archief niet gevonden bij de gekozen bron");
  }
}
async function restoreSnapshot(dir) {
  await run("runuser", [
    "-u",
    "postgres",
    "--",
    "dropdb",
    "--force",
    "--if-exists",
    "tuinwerk",
  ]);
  await run("runuser", [
    "-u",
    "postgres",
    "--",
    "createdb",
    "-O",
    "tuinwerk",
    "tuinwerk",
  ]);
  await run("pg_restore", [
    "--dbname=" + DB,
    "--no-owner",
    "--exit-on-error",
    path.join(dir, "database.dump"),
  ]);
  for (const name of ["uploads", "exports", "config"])
    await f.rm(path.join(ROOT, name), { recursive: true, force: true });
  await run("python3", [
    "/opt/tuinwerk/extract-safe.py",
    "files",
    path.join(dir, "files.tar"),
    ROOT,
  ]);
  await run("chown", [
    "-R",
    "node:node",
    path.join(ROOT, "uploads"),
    path.join(ROOT, "exports"),
    path.join(ROOT, "config"),
  ]);
  await run("chmod", ["700", path.join(ROOT, "config")]);
  await run("runuser", [
    "-u",
    "node",
    "--",
    "node",
    "/app/api/dist/migrate.js",
  ]);
  await run("sync", ["-f", ROOT]);
}

async function processJob(requestFile) {
  let r,
    work,
    paused = false,
    needsOperator = false,
    journal;
  try {
    r = validateRequest(await readJson(requestFile));
    if (path.basename(requestFile) !== r.id + ".json")
      throw Error("Ongeldige opdrachtidentiteit");
    journal = path.join(CONTROL, "processing", r.id + ".journal");
    try {
      const old = await readJson(journal);
      if (typeof old.work !== "string" || !/^work-[a-zA-Z0-9]+$/.test(old.work))
        throw Error("Invalid journal");
      const prior = path.join(CONTROL, old.work);
      if (old.phase === "restoring") {
        try {
          await restoreSnapshot(path.join(prior, "rollback"));
          await supervisor("start");
        } catch {
          needsOperator = true;
          work = prior;
          throw Error("Herstel vereist beheerderinterventie");
        }
        await f.rm(prior, { recursive: true, force: true });
        throw Error(
          "Herstel onderbroken; oorspronkelijke gegevens automatisch teruggezet",
        );
      }
      if (old.phase === "restored") {
        await supervisor("start");
        await atomic(path.join(CONTROL, "results", r.id + ".json"), {
          id: r.id,
          operation: r.operation,
          requestedBy: r.requestedBy,
          state: "completed",
          completedAt: new Date().toISOString(),
          ...old.output,
          restored: true,
        });
        await f.rm(prior, { recursive: true, force: true });
        return;
      }
      await supervisor("start").catch(() => {});
      await f.rm(prior, { recursive: true, force: true });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await atomic(path.join(CONTROL, "status", r.id + ".json"), {
      id: r.id,
      state: "running",
      startedAt: new Date().toISOString(),
    });
    work = await f.mkdtemp(path.join(CONTROL, "work-"));
    await f.chmod(work, 0o700);
    await atomic(journal, { work: path.basename(work), phase: "preparing" });
    let output;
    if (r.operation === "backup") {
      const name = r.archive,
        target = path.join(BACKUPS, name);
      let existing;
      try {
        existing = await regular(target);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (existing) {
        const sum = await hash(target);
        const m = await unpack(target, r.recoverySecret, work);
        output = {
          archive: name,
          sha256: sum,
          size: existing.size,
          manifest: publicManifest(m, name, existing.size, sum),
        };
      } else {
        paused = true;
        await supervisor("stop");
        await snapshot(work);
        await supervisor("start");
        paused = false;
        const m = {
          format: "tuinwerk-backup-v2",
          id: r.archive.slice(0, -4),
          createdAt: new Date().toISOString(),
          contents: ["database", "uploads", "exports", "config"],
          appVersion: process.env.APP_VERSION || "0.1.0",
          manifestVersion: 1,
          databaseSha256: await hash(path.join(work, "database.dump")),
          filesSha256: await hash(path.join(work, "files.tar")),
        };
        await f.writeFile(path.join(work, "manifest.json"), JSON.stringify(m), {
          mode: 0o600,
        });
        await run("tar", [
          "-C",
          work,
          "-cf",
          path.join(work, "plain.tar"),
          "manifest.json",
          "database.dump",
          "files.tar",
        ]);
        const partial = path.join(BACKUPS, "." + r.id + ".partial");
        await f.rm(partial, { force: true });
        await encrypt(path.join(work, "plain.tar"), partial, r.recoverySecret);
        await f.chown(partial, 0, 1000);
        await f.chmod(partial, 0o640);
        await syncPath(partial);
        await f.rename(partial, target);
        await syncPath(BACKUPS);
        const size = (await regular(target)).size,
          sum = await hash(target);
        output = {
          archive: name,
          sha256: sum,
          size,
          manifest: publicManifest(m, name, size, sum),
        };
      }
      await f.writeFile(
        path.join(ROOT, "status", "last-backup-success"),
        new Date().toISOString(),
        { mode: 0o644 },
      );
      await f.chmod(path.join(ROOT, "status", "last-backup-success"), 0o644);
      if (r.retentionDays) {
        const cutoff = Date.now() - r.retentionDays * 86400000;
        for (const name of await f.readdir(BACKUPS)) {
          if (
            name === r.archive ||
            !UUID.test(name.slice(0, -4)) ||
            !name.endsWith(".twb")
          )
            continue;
          const file = path.join(BACKUPS, name);
          try {
            const stat = await regular(file);
            if (stat.mtimeMs < cutoff) await f.unlink(file);
          } catch {}
        }
      }
    } else {
      const archive = await inputArchive(r.archive, r.archiveSource),
        sum = await hash(archive),
        size = (await regular(archive)).size,
        m = await unpack(archive, r.recoverySecret, work);
      output = {
        archive: r.archive,
        archiveSource: r.archiveSource,
        sha256: sum,
        size,
        manifest: publicManifest(m, r.archive, size, sum),
      };
      if (r.operation === "restore_preview") {
        output.previewId = r.id;
      } else {
        const preview = await readJson(
          path.join(CONTROL, "results", r.previewId + ".json"),
        );
        if (
          preview.operation !== "restore_preview" ||
          preview.state !== "completed" ||
          preview.requestedBy !== r.requestedBy ||
          preview.archive !== r.archive ||
          preview.archiveSource !== r.archiveSource ||
          preview.sha256 !== sum ||
          r.expectedSha256 !== sum ||
          !Number.isFinite(Date.parse(preview.completedAt)) ||
          Date.now() - Date.parse(preview.completedAt) > 3600000
        )
          throw Error("Herstelcontrole verlopen of archief gewijzigd");
        const rollback = path.join(work, "rollback");
        await f.mkdir(rollback, { mode: 0o700 });
        paused = true;
        await supervisor("stop");
        await snapshot(rollback);
        await atomic(journal, {
          work: path.basename(work),
          phase: "restoring",
        });
        await atomic(path.join(CONTROL, "status", r.id + ".json"), {
          id: r.id,
          state: "running",
          phase: "restoring",
          startedAt: new Date().toISOString(),
        });
        try {
          await restoreSnapshot(work);
        } catch {
          try {
            await restoreSnapshot(rollback);
            await supervisor("start");
            paused = false;
          } catch {
            needsOperator = true;
          }
          throw Error(
            needsOperator
              ? "Herstel en automatisch terugzetten mislukt; beheerderherstel vereist"
              : "Herstel mislukt; oorspronkelijke gegevens zijn automatisch teruggezet",
          );
        }
        await atomic(journal, {
          work: path.basename(work),
          phase: "restored",
          output,
        });
        await supervisor("start");
        paused = false;
        output.restored = true;
      }
    }
    await atomic(path.join(CONTROL, "results", r.id + ".json"), {
      id: r.id,
      operation: r.operation,
      requestedBy: r.requestedBy,
      state: "completed",
      createdAt: r.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...output,
    });
  } catch (error) {
    if (r)
      await atomic(path.join(CONTROL, "results", r.id + ".json"), {
        id: r.id,
        operation: r.operation,
        requestedBy: r.requestedBy,
        state: "failed",
        completedAt: new Date().toISOString(),
        error: needsOperator
          ? "Herstel vereist beheerderinterventie"
          : error.message?.includes("Herstel")
            ? error.message
            : "Back-upbewerking mislukt; controleer opslagruimte en herstelcode",
        needsOperator,
      });
    else console.error(JSON.stringify({ event: "backup_request_rejected" }));
  } finally {
    if (paused && !needsOperator) await supervisor("start").catch(() => {});
    if (work && !needsOperator)
      await f.rm(work, { recursive: true, force: true });
    if (r)
      await f.rm(path.join(CONTROL, "status", r.id + ".json"), { force: true });
    if (journal && !needsOperator) await f.rm(journal, { force: true });
    await f.rm(requestFile, { force: true });
  }
}
async function main() {
  let stopping = false;
  const pulse = setInterval(
    () =>
      atomic(path.join(CONTROL, "heartbeat.json"), {
        lastSeen: new Date().toISOString(),
      }).catch(() => {}),
    10000,
  );
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  while (!stopping) {
    await atomic(path.join(CONTROL, "heartbeat.json"), {
      lastSeen: new Date().toISOString(),
    });
    for (const name of await f.readdir(path.join(CONTROL, "requests"))) {
      if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
      const target = path.join(CONTROL, "processing", name);
      try {
        try {
          await regular(target);
          await f.rm(path.join(CONTROL, "requests", name));
          continue;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        await f.rename(path.join(CONTROL, "requests", name), target);
      } catch {}
    }
    for (const name of await f.readdir(path.join(CONTROL, "processing"))) {
      if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
      const file = path.join(CONTROL, "processing", name);
      try {
        await regular(path.join(CONTROL, "results", name));
        await f.rm(file, { force: true });
        continue;
      } catch (e) {
        if (e.code !== "ENOENT") continue;
      }
      await new Promise((resolve) => {
        const child = spawn(
          "flock",
          [
            "-n",
            "-E",
            "75",
            path.join(CONTROL, "backup.lock"),
            process.execPath,
            __filename,
            "--job",
            file,
          ],
          { stdio: "inherit" },
        );
        child.once("error", resolve);
        child.once("exit", resolve);
      });
      if (stopping) break;
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  clearInterval(pulse);
}
module.exports = { encrypt, decrypt, validateRequest, hash, atomic };
if (require.main === module) {
  (process.argv[2] === "--job" ? processJob(process.argv[3]) : main()).catch(
    () => {
      console.error("Backup helper failed");
      process.exitCode = 1;
    },
  );
}
