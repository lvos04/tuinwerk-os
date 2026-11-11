import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, pool } from "../src/db";
import { ReportingController, sendWeeklySummary } from "../src/reporting";
import { CatalogImportController } from "../src/catalog-import";
const enabled = !!process.env.DATABASE_URL;
after(async () => {
  await pool.end();
});
test(
  "PostgreSQL import retries, concurrent dedupe, exports and weekly summaries",
  { skip: !enabled },
  async () => {
    const uid = randomUUID(),
      externalId = randomUUID();
    const user = {
      id: uid,
      email: `report-${uid}@test.local`,
      name: "Reporting test",
      role: "admin" as const,
    };
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [uid, user.email, user.name, "test-only", "admin"],
    );
    const api = new ReportingController();
    const catalog = new CatalogImportController();
    const ids: string[] = [];
    const sku = "report-" + randomUUID();
    const rootLocation = "Import " + randomUUID();
    try {
      const input = {
        filename: "todoist.csv",
        content: Buffer.from(
          `TYPE,CONTENT,DESCRIPTION,ID\ntask,,Test,${externalId}\ntask,Import test,Test,${externalId}\n`,
        ).toString("base64"),
      };
      const first = await api.preview(user, input);
      const second = await api.preview(user, input);
      ids.push(first.id, second.id);
      assert.equal(first.invalid, 1);
      assert.equal(first.rows[1].duplicate, false);
      const result = await Promise.all([
        api.confirm(user, first.id),
        api.confirm(user, second.id),
      ]);
      assert.equal(
        result.reduce((n, r) => n + r.imported, 0),
        1,
      );
      assert.deepEqual(await api.confirm(user, first.id), result[0]);
      const tasks = await query<any>(
        "SELECT * FROM tasks WHERE created_by=$1",
        [uid],
      );
      assert.equal(tasks.length, 1);
      await query("UPDATE tasks SET assigned_to=$1 WHERE id=$2", [
        [uid],
        tasks[0].id,
      ]);
      await api.savePreferences(user, {
        inApp: true,
        push: false,
        email: false,
        quietStart: "22:00",
        quietEnd: "07:00",
        criticalOverride: false,
        weekly: true,
      });
      const farFuture = new Date("2097-03-04T10:00:00Z");
      await sendWeeklySummary(farFuture, uid);
      await sendWeeklySummary(farFuture, uid);
      assert.equal(
        (await api.notifications(user)).filter((n: any) => n.kind === "weekly")
          .length,
        1,
      );
      let output: Buffer | string | undefined;
      const res: any = {
        type() {
          return this;
        },
        attachment() {
          return this;
        },
        send(v: any) {
          output = v;
          return this;
        },
      };
      const summary = await api.summary({ assigneeId: uid });
      assert.equal(summary.total, 1);
      assert.equal(summary.blockedHours, 0);
      assert.deepEqual(summary.partsByAsset, []);
      await api.export({ format: "xlsx", assigneeId: uid }, res);
      assert.ok(Buffer.isBuffer(output));
      assert.equal((output as Buffer).subarray(0, 2).toString(), "PK");
      await api.export({ format: "pdf", assigneeId: uid }, res);
      assert.equal((output as Buffer).subarray(0, 4).toString(), "%PDF");
      await api.qr("task", tasks[0].id, res);
      assert.equal((output as Buffer).subarray(0, 4).toString(), "%PDF");
      const inventory = await catalog.preview(user, {
        kind: "inventory",
        filename: "stock.csv",
        content: Buffer.from(
          "sku,name,minimum\n" + sku + ",Pakking,2\ninvalid,,wat",
        ).toString("base64"),
      });
      ids.push(inventory.id);
      assert.equal(inventory.invalid, 1);
      const imported = await catalog.confirm(user, inventory.id);
      assert.deepEqual(imported, { imported: 1, skipped: 0, invalid: 1 });
      assert.deepEqual(await catalog.confirm(user, inventory.id), imported);
      const loc = await catalog.preview(user, {
        kind: "locations",
        filename: "locations.csv",
        content: Buffer.from("path\n" + rootLocation + "/Kap 1").toString(
          "base64",
        ),
      });
      ids.push(loc.id);
      assert.equal((await catalog.confirm(user, loc.id)).imported, 1);
      await assert.rejects(() => api.confirm(user, loc.id), /catalogus/);
      await api.registerDevice(user, {
        token: "ExpoPushToken[" + uid + "]",
        platform: "android",
      });
      assert.equal((await api.devices(user)).length, 1);
      await api.savePreferences(user, {
        inApp: true,
        push: true,
        email: true,
        quietStart: "22:00",
        quietEnd: "07:00",
        criticalOverride: false,
        weekly: true,
      });
      await query(
        "INSERT INTO notifications(user_id,kind,title) VALUES($1,'test','Transport test')",
        [uid],
      );
      const queued = await query<any>(
        "SELECT d.* FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.user_id=$1",
        [uid],
      );
      assert.equal(queued.length, 2);
      const prior = process.env.AI_ENABLED;
      delete process.env.AI_ENABLED;
      await assert.rejects(
        () => api.suggest(user, { text: "Test", consent: true }),
        /uitgeschakeld/,
      );
      if (prior === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = prior;
    } finally {
      await query("DELETE FROM push_devices WHERE user_id=$1", [uid]);
      await query("DELETE FROM inventory_items WHERE sku=$1", [sku]);
      await query(
        "DELETE FROM locations WHERE parent_id IN(SELECT id FROM locations WHERE name=$1)",
        [rootLocation],
      );
      await query("DELETE FROM locations WHERE name=$1", [rootLocation]);
      await query("DELETE FROM notifications WHERE user_id=$1", [uid]);
      await query("DELETE FROM notification_preferences WHERE user_id=$1", [
        uid,
      ]);
      await query(
        "DELETE FROM imported_records WHERE import_id=ANY($1::uuid[])",
        [ids],
      );
      await query("DELETE FROM imports WHERE user_id=$1", [uid]);
      await query("DELETE FROM audit_events WHERE actor_id=$1", [uid]);
      await query("DELETE FROM tasks WHERE created_by=$1", [uid]);
      await query("DELETE FROM users WHERE id=$1", [uid]);
      await query(
        "DELETE FROM reporting_jobs WHERE key LIKE 'weekly:2097-%' AND key LIKE '%' || $1",
        [uid],
      );
    }
  },
);
