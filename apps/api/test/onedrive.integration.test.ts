import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test(
  "isolated OneDrive OAuth, encrypted state, resumable streaming backup and verified restore",
  { skip: !process.env.DATABASE_URL, timeout: 90000 },
  async () => {
    const dbName = "onedrive_test_" + randomBytes(6).toString("hex"),
      admin = new Pool({ connectionString: process.env.DATABASE_URL });
    const directory = await mkdtemp(join(tmpdir(), "tuinwerk-onedrive-"));
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = "/" + dbName;
    try {
      await admin.query(`CREATE DATABASE ${dbName}`);
      const result = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", resolve("test/onedrive-scenario.ts")],
        {
          env: {
            ...process.env,
            DATABASE_URL: url.toString(),
            SETTINGS_DIR: directory,
            ONEDRIVE_TEST_DIR: directory,
          },
          maxBuffer: 1000000,
        },
      );
      assert.match(result.stdout, /ONEDRIVE_SCENARIO_OK/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
