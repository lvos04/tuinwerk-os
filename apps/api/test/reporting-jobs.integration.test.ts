import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query, pool } from "../src/db";
import { ReportingController, runExportJobs } from "../src/reporting";
import { checkPushReceipts } from "../src/notification-delivery";
after(async () => pool.end());
test(
  "Large export, owner-only download, receipt cleanup and atomic AI eurobudget",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const uid = randomUUID(),
      user = {
        id: uid,
        email: `jobs-${uid}@test.local`,
        name: "Jobs test",
        role: "employee" as const,
      };
    const api = new ReportingController();
    const dir = await mkdtemp(join(tmpdir(), "tuinwerk-export-"));
    const envKeys = [
      "EXPORT_DIR",
      "EXPO_PUSH_ENABLED",
      "AI_ENABLED",
      "AI_API_KEY",
      "AI_BASE_URL",
      "AI_MODEL",
      "AI_DAILY_TOKEN_BUDGET",
      "AI_DAILY_BUDGET_EUR",
      "AI_INPUT_EUR_PER_MILLION",
      "AI_OUTPUT_EUR_PER_MILLION",
    ];
    const previous = Object.fromEntries(
      envKeys.map((k) => [k, process.env[k]]),
    );
    const originalFetch = global.fetch;
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [uid, user.email, user.name, "test-only", user.role],
    );
    try {
      process.env.EXPORT_DIR = dir;
      await query(
        "INSERT INTO tasks(title,created_by,updated_by,assigned_to) SELECT 'Export taak '||i,$1,$1,ARRAY[$1::uuid] FROM generate_series(1,10001) i",
        [uid],
      );
      const job = await api.requestExport(user, {
        format: "csv",
        type: "tasks",
        assigneeId: uid,
      });
      await runExportJobs(job.id);
      const status = (await api.exportJobs(user)).find(
        (r: any) => r.id === job.id,
      );
      assert.equal(status.status, "completed");
      let bytes: Buffer | undefined;
      const res: any = {
        type() {
          return this;
        },
        attachment() {
          return this;
        },
        send(v: any) {
          bytes = v;
        },
      };
      await api.downloadExport(user, job.id, res);
      assert.equal(bytes!.toString().split("\r\n").length, 10002);
      await assert.rejects(
        () => api.downloadExport({ ...user, id: randomUUID() }, job.id, res),
        /niet beschikbaar/,
      );
      const device = await api.registerDevice(user, {
        token: `ExpoPushToken[${uid}]`,
        platform: "ios",
      });
      const [notification] = await query<any>(
        "INSERT INTO notifications(user_id,kind,title) VALUES($1,'test','Test') RETURNING id",
        [uid],
      );
      const receiptId = randomUUID();
      await query(
        "INSERT INTO push_receipts(id,device_id,notification_id,created_at) VALUES($1,$2,$3,now()-interval '20 minutes')",
        [receiptId, device.id, notification.id],
      );
      process.env.EXPO_PUSH_ENABLED = "true";
      await checkPushReceipts(new Date(), (async () => ({
        ok: true,
        json: async () => ({
          data: {
            [receiptId]: {
              status: "error",
              details: { error: "DeviceNotRegistered" },
            },
          },
        }),
      })) as any);
      assert.equal((await api.devices(user))[0].active, false);
      Object.assign(process.env, {
        AI_ENABLED: "true",
        AI_API_KEY: "test-only",
        AI_BASE_URL: "https://example.test/v1",
        AI_MODEL: "mock",
        AI_DAILY_TOKEN_BUDGET: "10000",
        AI_DAILY_BUDGET_EUR: "0.005",
        AI_INPUT_EUR_PER_MILLION: "1",
        AI_OUTPUT_EUR_PER_MILLION: "1",
      });
      let calls = 0;
      global.fetch = (async () => {
        calls++;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Voorstel" } }],
          }),
        };
      }) as any;
      const disclosed = api.aiStatus();
      assert.equal(disclosed.providerOrigin, "https://example.test");
      assert.deepEqual(disclosed.sharedFields, ["ingevoerde tekst"]);
      await assert.rejects(
        () => api.suggest(user, { text: "Pomp lekt", consent: true }),
        /opnieuw toestemming/,
      );
      process.env.AI_BASE_URL = "https://changed.example.test/v1";
      await assert.rejects(
        () =>
          api.suggest(user, {
            text: "Pomp lekt",
            consent: true,
            providerConfigId: disclosed.providerConfigId,
          }),
        /opnieuw toestemming/,
      );
      assert.equal(calls, 0);
      process.env.AI_BASE_URL = "https://example.test/v1";
      const results = await Promise.allSettled([
        api.suggest(user, {
          text: "Pomp lekt",
          consent: true,
          providerConfigId: api.aiStatus().providerConfigId,
        }),
        api.suggest(user, {
          text: "Pomp lekt",
          consent: true,
          providerConfigId: api.aiStatus().providerConfigId,
        }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(calls, 1);
      assert.match(
        (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
          .reason.message,
        /budget/,
      );
    } finally {
      global.fetch = originalFetch;
      for (const k of envKeys) {
        if (previous[k] === undefined) delete process.env[k];
        else process.env[k] = previous[k];
      }
      await query("DELETE FROM export_jobs WHERE user_id=$1", [uid]);
      await query("DELETE FROM notifications WHERE user_id=$1", [uid]);
      await query("DELETE FROM push_devices WHERE user_id=$1", [uid]);
      await query("DELETE FROM ai_requests WHERE user_id=$1", [uid]);
      await query("DELETE FROM audit_events WHERE actor_id=$1", [uid]);
      await query("DELETE FROM tasks WHERE created_by=$1", [uid]);
      await query("DELETE FROM users WHERE id=$1", [uid]);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
