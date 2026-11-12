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
  "isolated database: real account removal, MFA, shared anonymity and retryable file cleanup",
  { skip: !process.env.DATABASE_URL, timeout: 60000 },
  async () => {
    const dbName = "privacy_test_" + randomBytes(6).toString("hex"),
      admin = new Pool({ connectionString: process.env.DATABASE_URL }),
      directory = await mkdtemp(join(tmpdir(), "tuinwerk-privacy-"));
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = "/" + dbName;
    try {
      await admin.query(`CREATE DATABASE ${dbName}`);
      const result = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", resolve("test/account-privacy-scenario.ts")],
        {
          env: {
            ...process.env,
            DATABASE_URL: url.toString(),
            SETTINGS_DIR: join(directory, "config"),
            UPLOAD_DIR: join(directory, "uploads"),
            EXPORT_DIR: join(directory, "exports"),
          },
          maxBuffer: 1000000,
        },
      );
      assert.match(result.stdout, /ACCOUNT_PRIVACY_OK/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
