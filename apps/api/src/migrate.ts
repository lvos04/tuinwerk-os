import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool, transaction } from "./db";
export async function migrate() {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(824310)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = resolve(process.env.MIGRATIONS_DIR || "migrations");
    for (const name of (await readdir(dir))
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (await c.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
          .rowCount
      )
        continue;
      await c.query(await readFile(resolve(dir, name), "utf8"));
      await c.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      console.log(`Migrated ${name}`);
    }
  });
}
if (require.main === module)
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
      pool.end();
    });
