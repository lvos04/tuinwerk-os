import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { migrate } from "../src/migrate";
import { query, pool } from "../src/db";
import { writeSetting, writeSecret } from "../src/settings";
import { ReportingController } from "../src/reporting";
import {
  IntegrationsController,
  runIntegrationTest,
} from "../src/integrations";
import {
  deliverNotifications,
  notificationData,
} from "../src/notification-delivery";
import { createApp } from "../src/main";
const owner = {
    id: randomUUID(),
    email: "owner@example.test",
    name: "Owner",
    role: "admin" as const,
  },
  other = {
    id: randomUUID(),
    email: "other@example.test",
    name: "Other",
    role: "employee" as const,
  };
const report = new ReportingController(),
  integrations = new IntegrationsController();
const t = new Date("2031-07-01T12:00:00Z");
async function notice(
  userId: string,
  title: string,
  kind = "task_updated",
  critical = false,
  at = t,
  entityId = randomUUID(),
) {
  const id = randomUUID();
  await query(
    "INSERT INTO notifications(id,user_id,kind,title,body,entity_id,critical,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, userId, kind, title, "Details " + title, entityId, critical, at],
  );
  return id;
}
async function main() {
  try {
    await migrate();
    for (const u of [owner, other])
      await query(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [u.id, u.email, u.name, "test-only", u.role],
      );
    await writeSetting("appUrl", "https://tuinwerk.example");
    await writeSetting("smtpHost", "smtp.example.test");
    await writeSetting("smtpFrom", "tuinwerk@example.test");
    await writeSetting("pushEnabled", true);
    await writeSecret("smtpPassword", "DO_NOT_EXPOSE");
    await report.savePreferences(owner, {
      inApp: true,
      email: true,
      push: false,
      quietStart: "00:00",
      quietEnd: "00:00",
      criticalOverride: false,
      weekly: true,
      digestMinutes: 5,
    });
    const initial = await integrations.status(owner);
    assert.equal(
      initial.checks.find((c) => c.key === "smtp").status,
      "untested",
    );
    assert.equal(initial.checks.find((c) => c.key === "smtp").optional, true);
    assert.equal(JSON.stringify(initial).includes("DO_NOT_EXPOSE"), false);
    let emailTargets: string[] = [];
    const email: any = async (to: string) => {
      emailTargets.push(to);
    };
    await assert.rejects(
      () => runIntegrationTest(owner, "smtp", {}, { email }),
      /expliciet/,
    );
    await assert.rejects(
      () =>
        runIntegrationTest(
          owner,
          "smtp",
          { confirm: true, to: other.email },
          { email },
        ),
      /eigen/,
    );
    assert.equal(emailTargets.length, 0);
    const result = await runIntegrationTest(
      owner,
      "smtp",
      { confirm: true },
      { email },
    );
    assert.equal(result.status, "passed");
    assert.deepEqual(emailTargets, [owner.email]);
    assert.equal(
      (await integrations.status(owner)).checks.find((c) => c.key === "smtp")
        .status,
      "passed",
    );
    await writeSetting("smtpPort", 2525);
    assert.equal(
      (await integrations.status(owner)).checks.find((c) => c.key === "smtp")
        .status,
      "untested",
    );
    const failure = await runIntegrationTest(
      owner,
      "smtp",
      { confirm: true },
      {
        email: async () => {
          throw Error("DO_NOT_EXPOSE smtp password=oops");
        },
      },
    );
    assert.equal(failure.status, "failed");
    assert.equal(JSON.stringify(failure).includes("DO_NOT_EXPOSE"), false);
    const delivered: any[] = [];
    const sender: any = async (to: string, title: string, body: string) => {
      delivered.push({ to, title, body });
    };
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await notice(owner.id, "Update " + i));
    await deliverNotifications(new Date(t.getTime() + 4 * 60000), {
      email: sender,
      skipReceiptCheck: true,
    });
    assert.equal(delivered.length, 0);
    await Promise.all([
      deliverNotifications(new Date(t.getTime() + 6 * 60000), {
        email: sender,
        skipReceiptCheck: true,
      }),
      deliverNotifications(new Date(t.getTime() + 6 * 60000), {
        email: sender,
        skipReceiptCheck: true,
      }),
    ]);
    assert.equal(delivered.length, 1);
    assert.ok(
      ids.length === 3 &&
        delivered[0].body.includes("Update 0") &&
        delivered[0].body.includes("Update 2"),
    );
    const rows = await query<any>(
      "SELECT * FROM notification_deliveries WHERE notification_id=ANY($1::uuid[])",
      [ids],
    );
    assert.ok(rows.every((r) => r.state === "sent"));
    assert.equal(new Set(rows.map((r) => r.batch_id)).size, 1);
    const [batch] = await query<any>(
      "SELECT * FROM notification_batches WHERE id=$1",
      [rows[0].batch_id],
    );
    assert.equal(batch.payload.entityType, "summary");
    assert.equal(batch.payload.recipientUserId, owner.id);
    assert.equal(batch.payload.serverOrigin, "https://tuinwerk.example");
    assert.equal(batch.payload.taskId, undefined);
    await assert.rejects(() => report.readBatch(other, batch.id));
    assert.equal((await report.readBatch(owner, batch.id)).read, 3);
    await report.savePreferences(owner, {
      inApp: true,
      email: true,
      push: false,
      quietStart: "22:00",
      quietEnd: "07:00",
      criticalOverride: true,
      weekly: true,
      digestMinutes: 5,
    });
    const night = new Date("2031-07-01T22:00:00Z");
    const quietId = await notice(owner.id, "Stil", undefined, false, night),
      urgentId = await notice(owner.id, "Kritiek", undefined, true, night);
    await deliverNotifications(night, {
      email: sender,
      skipReceiptCheck: true,
    });
    assert.equal(delivered.length, 2);
    assert.equal(
      (
        await query<any>(
          "SELECT state FROM notification_deliveries WHERE notification_id=$1",
          [quietId],
        )
      )[0].state,
      "pending",
    );
    assert.equal(
      (
        await query<any>(
          "SELECT state FROM notification_deliveries WHERE notification_id=$1",
          [urgentId],
        )
      )[0].state,
      "sent",
    );
    await query(
      "UPDATE notification_deliveries SET state='skipped' WHERE notification_id=$1",
      [quietId],
    );
    await report.savePreferences(owner, {
      inApp: true,
      email: true,
      push: false,
      quietStart: "00:00",
      quietEnd: "00:00",
      criticalOverride: false,
      weekly: true,
      digestMinutes: 5,
    });
    const hideTime = new Date("2031-07-03T12:00:00Z");
    const hiddenId = await notice(
        owner.id,
        "VERBORGEN_INHOUD",
        undefined,
        false,
        hideTime,
      ),
      visibleId = await notice(
        owner.id,
        "Zichtbare inhoud",
        undefined,
        false,
        hideTime,
      );
    let retriedBodies: string[] = [];
    await deliverNotifications(new Date(hideTime.getTime() + 6 * 60000), {
      email: async () => {
        throw Error("retry required");
      },
      skipReceiptCheck: true,
    });
    await query("UPDATE notifications SET moderation_hidden=true WHERE id=$1", [
      hiddenId,
    ]);
    await deliverNotifications(new Date(hideTime.getTime() + 10 * 60000), {
      email: async (_to, _title, body) => {
        retriedBodies.push(body);
      },
      skipReceiptCheck: true,
    });
    assert.equal(retriedBodies.length, 1);
    assert.ok(!retriedBodies[0].includes("VERBORGEN_INHOUD"));
    assert.equal(
      (
        await query<any>(
          "SELECT state FROM notification_deliveries WHERE notification_id=$1",
          [hiddenId],
        )
      )[0].state,
      "skipped",
    );
    assert.equal(
      (
        await query<any>(
          "SELECT state FROM notification_deliveries WHERE notification_id=$1",
          [visibleId],
        )
      )[0].state,
      "sent",
    );
    assert.ok(
      !(await report.notifications(owner)).some((n) => n.id === hiddenId),
    );
    await report.savePreferences(other, {
      inApp: true,
      email: false,
      push: true,
      quietStart: "00:00",
      quietEnd: "00:00",
      criticalOverride: false,
      weekly: true,
      digestMinutes: 0,
    });
    const device1 = await report.registerDevice(other, {
        token: "ExpoPushToken[good]",
        platform: "ios",
      }),
      device2 = await report.registerDevice(other, {
        token: "ExpoPushToken[retry]",
        platform: "android",
      });
    const pushId = await notice(other.id, "Push update", undefined, false, t);
    let good = 0,
      bad = 0;
    const payloads: any[] = [];
    const push: any = async (tokens: string[], n: any) => {
      payloads.push(n.data);
      if (tokens[0].includes("good")) good++;
      else {
        bad++;
        if (bad === 1) throw Error("temporary");
      }
      return {
        tickets: [{ token: tokens[0], id: randomUUID() }],
        invalidTokens: [],
      };
    };
    await deliverNotifications(t, { push, skipReceiptCheck: true });
    assert.equal(good, 1);
    assert.equal(bad, 1);
    await deliverNotifications(new Date(t.getTime() + 3 * 60000), {
      push,
      skipReceiptCheck: true,
    });
    assert.equal(good, 1);
    assert.equal(bad, 2);
    assert.equal(
      (
        await query<any>(
          "SELECT state FROM notification_deliveries WHERE notification_id=$1",
          [pushId],
        )
      )[0].state,
      "sent",
    );
    assert.equal(payloads[0].entityType, "task");
    assert.equal(payloads[0].recipientUserId, other.id);
    await query(
      "UPDATE push_devices SET active=false WHERE id=ANY($1::uuid[])",
      [[device1.id, device2.id]],
    );
    const moved = await report.registerDevice(other, {
      token: "ExpoPushToken[moved]",
      platform: "ios",
    });
    const movedTime = new Date("2031-07-04T12:00:00Z");
    await notice(
      other.id,
      "Accountgebonden privébericht",
      undefined,
      false,
      movedTime,
    );
    await deliverNotifications(movedTime, {
      push: async () => {
        throw Error("temporary");
      },
      skipReceiptCheck: true,
    });
    await report.registerDevice(owner, {
      token: "ExpoPushToken[moved]",
      platform: "ios",
    });
    let leaked = 0;
    await deliverNotifications(new Date(movedTime.getTime() + 3 * 60000), {
      push: async () => {
        leaked++;
        throw Error("must not send");
      },
      skipReceiptCheck: true,
    });
    assert.equal(leaked, 0);
    const foreign = await report.registerDevice(other, {
      token: "ExpoPushToken[foreign]",
      platform: "ios",
    });
    let sentTo: string[] = [];
    await assert.rejects(
      () =>
        runIntegrationTest(
          owner,
          "push",
          { confirm: true, deviceId: foreign.id },
          {
            push: async (tokens) => {
              sentTo.push(...tokens);
              return { tickets: [], invalidTokens: [] };
            },
          },
        ),
      /eigen/,
    );
    assert.equal(sentTo.length, 0);
    const ownDevice = await report.registerDevice(owner, {
      token: "ExpoPushToken[own]",
      platform: "ios",
    });
    const ownPush = await runIntegrationTest(
      owner,
      "push",
      { confirm: true, deviceId: ownDevice.id },
      {
        push: async (tokens, n) => {
          sentTo.push(...tokens);
          assert.equal(n.user_id, owner.id);
          return {
            tickets: [{ token: tokens[0], id: randomUUID() }],
            invalidTokens: [],
          };
        },
      },
    );
    assert.equal(ownPush.status, "passed");
    assert.deepEqual(sentTo, ["ExpoPushToken[own]"]);
    assert.equal(
      (await integrations.status(owner)).checks.find((c) => c.key === "push")
        .status,
      "passed",
    );
    assert.equal(
      notificationData({
        id: randomUUID(),
        title: "Planning",
        body: "",
        kind: "planning",
        entity_id: randomUUID(),
        user_id: owner.id,
      }).entityType,
      "schedule",
    );
    const employeeToken = randomUUID(),
      adminToken = randomUUID();
    for (const [u, token] of [
      [other, employeeToken],
      [owner, adminToken],
    ] as const)
      await query(
        "INSERT INTO sessions(user_id,token_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,now()+interval '1 hour',now()+interval '1 day')",
        [u.id, createHash("sha256").update(token).digest("hex"), randomUUID()],
      );
    const app = await createApp();
    try {
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      assert.equal(
        (await fetch(base + "/api/admin/integrations/status")).status,
        401,
      );
      assert.equal(
        (
          await fetch(base + "/api/admin/integrations/status", {
            headers: { Authorization: "Bearer " + employeeToken },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + "/api/admin/integrations/status", {
            headers: { Authorization: "Bearer " + adminToken },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(base + "/api/admin/integrations/test/smtp", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + adminToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ confirm: false }),
          })
        ).status,
        400,
      );
    } finally {
      await app.close();
    }
    console.log("INTEGRATIONS_SCENARIO_OK");
  } finally {
    await pool.end();
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
