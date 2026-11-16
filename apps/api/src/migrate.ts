import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pool, transaction } from "./db";

/**
 * Volgorde-regel: migraties worden uitgevoerd in oplopende volgorde van de
 * volledige bestandsnaam (codepunt-sortering), en geregistreerd op bestandsnaam.
 * Daardoor draait `008_operations_extensions.sql` altijd vóór
 * `008_reporting_jobs.sql`. Deze twee historische bestanden houden hun naam,
 * omdat bestaande installaties ze onder die naam hebben geregistreerd;
 * hernummeren zou ze opnieuw laten uitvoeren. Nieuwe migraties krijgen een uniek
 * volgnummer (zie HISTORICAL_DUPLICATE_PREFIXES en de test hierop).
 */
export const HISTORICAL_DUPLICATE_PREFIXES = new Set(["008"]);

/** SHA-256 over de inhoud met genormaliseerde regeleinden (CRLF → LF). */
export function migrationChecksum(sql: string) {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

export function migrationOrder(names: string[]) {
  return names.filter((x) => x.endsWith(".sql")).sort();
}

/** `warn` (standaard) of `strict` via MIGRATION_CHECKSUM_MODE. */
export function checksumMode(): "warn" | "strict" {
  return process.env.MIGRATION_CHECKSUM_MODE === "strict" ? "strict" : "warn";
}

export async function migrate() {
  const mismatches: string[] = [];
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(824310)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    await c.query(
      "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
    );
    const dir = resolve(process.env.MIGRATIONS_DIR || "migrations");
    const applied = new Map<string, string | null>(
      (await c.query("SELECT name,checksum FROM schema_migrations")).rows.map(
        (r: any) => [r.name, r.checksum],
      ),
    );
    for (const name of migrationOrder(await readdir(dir))) {
      const sql = await readFile(resolve(dir, name), "utf8");
      const checksum = migrationChecksum(sql);
      if (applied.has(name)) {
        const stored = applied.get(name);
        if (!stored)
          // Eerder toegepast zonder checksum: registreer de huidige inhoud.
          await c.query(
            "UPDATE schema_migrations SET checksum=$2 WHERE name=$1",
            [name, checksum],
          );
        else if (stored !== checksum) mismatches.push(name);
        continue;
      }
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      console.log(`Migrated ${name}`);
    }
    if (mismatches.length && checksumMode() === "strict")
      throw new Error(
        "Toegepaste migraties zijn gewijzigd (checksum wijkt af): " +
          mismatches.join(", "),
      );
  });
  if (mismatches.length)
    console.warn(
      JSON.stringify({
        level: "warning",
        event: "migration_checksum_mismatch",
        message:
          "Inhoud van al toegepaste migraties wijkt af van de geregistreerde checksum; wijzig toegepaste migraties niet, maar voeg een nieuwe migratie toe",
        migrations: mismatches,
      }),
    );
  return { mismatches };
}
if (require.main === module)
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
      pool.end();
    });
