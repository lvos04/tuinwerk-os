import nodemailer from "nodemailer";
import { transaction } from "./db";
import { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

export function isQuiet(
  now: Date,
  start: string,
  end: string,
  timeZone = process.env.APP_TIMEZONE || "Europe/Amsterdam",
) {
  const parts = new Intl.DateTimeFormat("nl-NL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value =
    parts.find((p) => p.type === "hour")!.value +
    ":" +
    parts.find((p) => p.type === "minute")!.value;
  return start === end
    ? false
    : start < end
      ? value >= start && value < end
      : value >= start || value < end;
}
export async function sendEmail(
  to: string,
  title: string,
  body: string,
  transport?: { sendMail: (message: any) => Promise<unknown> },
) {
  const smtp =
    transport ||
    nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: process.env.SMTP_REQUIRE_TLS !== "false",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  await smtp.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: title,
    text: body,
  });
}
export interface PushNotification {
  id: string;
  title: string;
  body: string;
  entity_id?: string;
  kind?: string;
  user_id?: string;
  batch_id?: string;
  data?: Record<string, unknown>;
}
export function notificationData(notification: PushNotification) {
  let serverOrigin = "";
  try {
    const u = new URL(process.env.APP_URL || "");
    if (["https:", "http:"].includes(u.protocol) && !u.username && !u.password)
      serverOrigin = u.origin;
  } catch {}
  const taskKinds = [
    "task_assigned",
    "task_updated",
    "comment",
    "overdue",
    "reminder",
  ];
  const taskId =
    taskKinds.includes(notification.kind || "") &&
    /^[0-9a-f-]{36}$/i.test(notification.entity_id || "")
      ? notification.entity_id
      : undefined;
  const entityType = taskId
    ? "task"
    : notification.kind === "planning"
      ? "schedule"
      : notification.kind === "low_stock"
        ? "inventory"
        : notification.kind === "weekly" || notification.kind === "digest"
          ? "summary"
          : "system";
  return {
    notificationId: notification.id,
    entityType,
    entityId: notification.entity_id,
    taskId,
    recipientUserId: notification.user_id,
    serverOrigin,
    ...(notification.batch_id ? { batchId: notification.batch_id } : {}),
  };
}
export async function sendExpoPush(
  tokens: string[],
  notification: PushNotification,
  request: typeof fetch = fetch,
) {
  if (!tokens.length)
    return {
      tickets: [] as Array<{ token: string; id: string }>,
      invalidTokens: [] as string[],
    };
  const response = await request("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        title: notification.title,
        body: notification.body.slice(0, 1800),
        sound: "default",
        data: notification.data || notificationData(notification),
      })),
    ),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Push HTTP ${response.status}`);
  const data: any = await response.json();
  if (
    !Array.isArray(data.data) ||
    data.data.length !== tokens.length ||
    data.data.some(
      (x: any) =>
        x.status !== "ok" && x.details?.error !== "DeviceNotRegistered",
    )
  )
    throw new Error("Pushprovider heeft één of meer meldingen geweigerd");
  if (data.data.some((x: any) => x.status === "ok" && typeof x.id !== "string"))
    throw new Error("Pushprovider gaf geen ontvangstbewijs");
  return {
    tickets: data.data.flatMap((x: any, i: number) =>
      x.status === "ok" ? [{ token: tokens[i], id: x.id }] : [],
    ),
    invalidTokens: data.data.flatMap((x: any, i: number) =>
      x.details?.error === "DeviceNotRegistered" ? [tokens[i]] : [],
    ),
  };
}
export type DeliveryTransports = {
  email?: typeof sendEmail;
  push?: typeof sendExpoPush;
  skipReceiptCheck?: boolean;
};
async function updateMembers(
  c: PoolClient,
  batchId: string,
  state: string,
  now: Date,
  error: string | null = null,
) {
  await c.query(
    "UPDATE notification_deliveries SET state=$2,sent_at=CASE WHEN $2='sent' THEN $3 ELSE sent_at END,last_error=$4,attempts=attempts+1 WHERE batch_id=$1 AND state<>'skipped'",
    [batchId, state, now, error],
  );
}
async function prepareBatch(c: PoolClient, now: Date) {
  await c.query(
    "UPDATE notification_deliveries d SET state='skipped' FROM notifications n WHERE d.notification_id=n.id AND n.moderation_hidden AND d.state='pending' AND d.batch_id IS NULL",
  );
  const anchor = (
    await c.query(
      `SELECT d.*,n.user_id,n.title,n.body,n.entity_id,n.kind,n.critical,n.created_at,p.digest_minutes,p.critical_override,p.quiet_start,p.quiet_end,p.email email_enabled,p.push push_enabled FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id LEFT JOIN notification_preferences p ON p.user_id=n.user_id WHERE d.state='pending' AND d.batch_id IS NULL AND d.next_attempt_at<=$1 AND u.active AND n.moderation_hidden=false ORDER BY (n.critical AND coalesce(p.critical_override,false)) DESC,n.created_at LIMIT 1`,
      [now],
    )
  ).rows[0];
  if (!anchor) return false;
  const lock = (
    await c.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked",
      ["notification-batch:" + anchor.user_id + ":" + anchor.channel],
    )
  ).rows[0];
  if (!lock.locked) return false;
  const enabled =
    anchor.channel === "email" ? anchor.email_enabled : anchor.push_enabled;
  if (!enabled) {
    await c.query(
      "UPDATE notification_deliveries d SET state='skipped' FROM notifications n WHERE d.notification_id=n.id AND n.user_id=$1 AND d.channel=$2 AND d.batch_id IS NULL AND d.state='pending'",
      [anchor.user_id, anchor.channel],
    );
    return true;
  }
  const override = anchor.critical && anchor.critical_override;
  if (
    !override &&
    isQuiet(now, anchor.quiet_start || "22:00", anchor.quiet_end || "07:00")
  ) {
    await c.query(
      "UPDATE notification_deliveries d SET next_attempt_at=$3 FROM notifications n WHERE d.notification_id=n.id AND n.user_id=$1 AND d.channel=$2 AND d.batch_id IS NULL AND d.state='pending' AND NOT n.critical",
      [anchor.user_id, anchor.channel, new Date(now.getTime() + 15 * 60000)],
    );
    await c.query(
      "UPDATE notification_deliveries SET next_attempt_at=$3 WHERE notification_id=$1 AND channel=$2",
      [
        anchor.notification_id,
        anchor.channel,
        new Date(now.getTime() + 15 * 60000),
      ],
    );
    return true;
  }
  const digest = override ? 0 : (anchor.digest_minutes ?? 5);
  const ready = new Date(anchor.created_at).getTime() + digest * 60000;
  if (ready > now.getTime()) {
    await c.query(
      "UPDATE notification_deliveries SET next_attempt_at=$3 WHERE notification_id=$1 AND channel=$2",
      [anchor.notification_id, anchor.channel, new Date(ready)],
    );
    return true;
  }
  const rows = (
    await c.query(
      `SELECT d.notification_id,n.title,n.body,n.kind,n.entity_id,n.user_id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.user_id=$1 AND d.channel=$2 AND d.state='pending' AND d.batch_id IS NULL AND n.critical=$3 AND n.moderation_hidden=false AND n.created_at<=$4 ORDER BY n.created_at,n.id FOR UPDATE OF d SKIP LOCKED LIMIT $5`,
      [
        anchor.user_id,
        anchor.channel,
        anchor.critical,
        now,
        digest === 0 ? 1 : 50,
      ],
    )
  ).rows;
  if (!rows.length) return false;
  const batchId = randomUUID();
  const uniqueTask = rows.every(
    (r) =>
      [
        "task_assigned",
        "task_updated",
        "comment",
        "overdue",
        "reminder",
      ].includes(r.kind) && r.entity_id === rows[0].entity_id,
  );
  const title =
    rows.length === 1 ? rows[0].title : `${rows.length} meldingen van TuinWerk`;
  const body =
    rows.length === 1
      ? rows[0].body
      : rows.map((r) => r.title + (r.body ? " — " + r.body : "")).join("\n");
  const payload = notificationData({
    id: rows[0].notification_id,
    title,
    body,
    user_id: anchor.user_id,
    kind:
      rows.length === 1 ? rows[0].kind : uniqueTask ? "task_updated" : "digest",
    entity_id: rows.length === 1 || uniqueTask ? rows[0].entity_id : undefined,
    batch_id: batchId,
  });
  await c.query(
    "INSERT INTO notification_batches(id,user_id,channel,title,body,payload,critical,next_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      batchId,
      anchor.user_id,
      anchor.channel,
      title,
      body,
      JSON.stringify(payload),
      anchor.critical,
      now,
    ],
  );
  await c.query(
    "UPDATE notification_deliveries SET batch_id=$3 WHERE notification_id=ANY($1::uuid[]) AND channel=$2",
    [rows.map((r) => r.notification_id), anchor.channel, batchId],
  );
  return true;
}
/** One batch has fixed membership across retries. External provider acceptance remains at-least-once after process crashes. */
export async function deliverNotifications(
  now = new Date(),
  transports: DeliveryTransports = {},
) {
  for (let i = 0; i < 40; i++) {
    const found = await transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT b.*,u.email,p.quiet_start,p.quiet_end,p.critical_override,p.email email_enabled,p.push push_enabled FROM notification_batches b JOIN users u ON u.id=b.user_id LEFT JOIN notification_preferences p ON p.user_id=b.user_id WHERE b.state='pending' AND b.next_attempt_at<=$1 AND u.active ORDER BY (b.critical AND coalesce(p.critical_override,false)) DESC,b.created_at FOR UPDATE OF b SKIP LOCKED LIMIT 1`,
          [now],
        )
      ).rows[0];
      if (!row) return prepareBatch(c, now);
      // Hold a read lock on members until provider submission finishes: moderation cannot race a stale payload.
      const members = (
        await c.query(
          "SELECT n.*,d.notification_id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE d.batch_id=$1 ORDER BY n.created_at,n.id FOR SHARE OF n",
          [row.id],
        )
      ).rows;
      const hidden = members.filter((n) => n.moderation_hidden),
        visible = members.filter((n) => !n.moderation_hidden);
      if (hidden.length)
        await c.query(
          "UPDATE notification_deliveries SET state='skipped' WHERE batch_id=$1 AND notification_id=ANY($2::uuid[])",
          [row.id, hidden.map((n) => n.id)],
        );
      if (!visible.length) {
        await c.query(
          "UPDATE notification_batches SET state='skipped' WHERE id=$1",
          [row.id],
        );
        return true;
      }
      const uniqueTask = visible.every(
        (n) =>
          [
            "task_assigned",
            "task_updated",
            "comment",
            "overdue",
            "reminder",
          ].includes(n.kind) && n.entity_id === visible[0].entity_id,
      );
      row.title =
        visible.length === 1
          ? visible[0].title
          : `${visible.length} meldingen van TuinWerk`;
      row.body =
        visible.length === 1
          ? visible[0].body
          : visible
              .map((n) => n.title + (n.body ? " — " + n.body : ""))
              .join("\n");
      row.payload = notificationData({
        id: visible[0].id,
        title: row.title,
        body: row.body,
        user_id: row.user_id,
        kind:
          visible.length === 1
            ? visible[0].kind
            : uniqueTask
              ? "task_updated"
              : "digest",
        entity_id:
          visible.length === 1 || uniqueTask ? visible[0].entity_id : undefined,
        batch_id: row.id,
      });
      await c.query(
        "UPDATE notification_batches SET title=$2,body=$3,payload=$4 WHERE id=$1",
        [row.id, row.title, row.body, JSON.stringify(row.payload)],
      );
      const enabled =
        row.channel === "email" ? row.email_enabled : row.push_enabled;
      if (!enabled) {
        await c.query(
          "UPDATE notification_batches SET state='skipped' WHERE id=$1",
          [row.id],
        );
        await updateMembers(c, row.id, "skipped", now);
        return true;
      }
      const configured =
        row.channel === "email"
          ? !!(process.env.SMTP_HOST && process.env.SMTP_FROM)
          : process.env.EXPO_PUSH_ENABLED === "true";
      if (
        !configured ||
        (!(row.critical && row.critical_override) &&
          isQuiet(now, row.quiet_start || "22:00", row.quiet_end || "07:00"))
      ) {
        await c.query(
          "UPDATE notification_batches SET next_attempt_at=$2 WHERE id=$1",
          [row.id, new Date(now.getTime() + 15 * 60000)],
        );
        return true;
      }
      let failed = false,
        noDevices = false;
      try {
        if (row.channel === "email")
          await (transports.email || sendEmail)(row.email, row.title, row.body);
        else {
          const known = (
            await c.query(
              "SELECT 1 FROM notification_batch_devices WHERE batch_id=$1 LIMIT 1",
              [row.id],
            )
          ).rows;
          if (!known.length)
            await c.query(
              "INSERT INTO notification_batch_devices(batch_id,device_id) SELECT $1,id FROM push_devices WHERE user_id=$2 AND active ON CONFLICT DO NOTHING",
              [row.id, row.user_id],
            );
          const devices = (
            await c.query(
              "SELECT bd.*,d.token,d.active,d.user_id device_user_id FROM notification_batch_devices bd JOIN push_devices d ON d.id=bd.device_id WHERE bd.batch_id=$1 AND bd.state='pending' ORDER BY bd.device_id FOR UPDATE OF bd,d",
              [row.id],
            )
          ).rows;
          const count = Number(
            (
              await c.query(
                "SELECT count(*) count FROM notification_batch_devices WHERE batch_id=$1",
                [row.id],
              )
            ).rows[0].count,
          );
          noDevices = count === 0;
          for (const device of devices) {
            if (!device.active || device.device_user_id !== row.user_id) {
              await c.query(
                "UPDATE notification_batch_devices SET state='invalid' WHERE batch_id=$1 AND device_id=$2",
                [row.id, device.device_id],
              );
              continue;
            }
            try {
              const result = await (transports.push || sendExpoPush)(
                [device.token],
                {
                  id: row.payload.notificationId,
                  title: row.title,
                  body: row.body,
                  data: row.payload,
                },
              );
              if (result.invalidTokens.length) {
                await c.query(
                  "UPDATE push_devices SET active=false WHERE id=$1",
                  [device.device_id],
                );
                await c.query(
                  "UPDATE notification_batch_devices SET state='invalid',attempts=attempts+1 WHERE batch_id=$1 AND device_id=$2",
                  [row.id, device.device_id],
                );
              } else {
                const ticket = result.tickets[0];
                if (!ticket) throw Error("Geen ontvangstbewijs");
                await c.query(
                  "INSERT INTO push_receipts(id,device_id,notification_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
                  [ticket.id, device.device_id, row.payload.notificationId],
                );
                await c.query(
                  "UPDATE notification_batch_devices SET state='sent',attempts=attempts+1,receipt_id=$3 WHERE batch_id=$1 AND device_id=$2",
                  [row.id, device.device_id, ticket.id],
                );
              }
            } catch {
              failed = true;
              await c.query(
                "UPDATE notification_batch_devices SET attempts=attempts+1,state=CASE WHEN attempts+1>=8 THEN 'failed' ELSE 'pending' END,last_error='Pushtransport mislukt' WHERE batch_id=$1 AND device_id=$2",
                [row.id, device.device_id],
              );
            }
          }
          const status = (
            await c.query(
              "SELECT count(*) FILTER(WHERE state='sent') sent,count(*) FILTER(WHERE state IN ('pending','failed')) failed FROM notification_batch_devices WHERE batch_id=$1",
              [row.id],
            )
          ).rows[0];
          if (
            Number(status.failed) > 0 ||
            (!noDevices && Number(status.sent) === 0)
          )
            failed = true;
        }
      } catch {
        failed = true;
      }
      if (noDevices) {
        await c.query(
          "UPDATE notification_batches SET next_attempt_at=$2 WHERE id=$1",
          [row.id, new Date(now.getTime() + 60 * 60000)],
        );
        return true;
      }
      if (failed) {
        const attempts = row.attempts + 1,
          state = attempts >= 8 ? "failed" : "pending",
          error =
            "Transport mislukt; controleer integratie en geregistreerde apparaten";
        await c.query(
          "UPDATE notification_batches SET attempts=$2,state=$3,last_error=$4,next_attempt_at=$5 WHERE id=$1",
          [
            row.id,
            attempts,
            state,
            error,
            new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** attempts)),
          ],
        );
        await updateMembers(c, row.id, state, now, error);
      } else {
        await c.query(
          "UPDATE notification_batches SET state='sent',sent_at=$2,attempts=attempts+1,last_error=NULL WHERE id=$1",
          [row.id, now],
        );
        await updateMembers(c, row.id, "sent", now);
      }
      return true;
    });
    if (!found) break;
  }
  if (!transports.skipReceiptCheck) await checkPushReceipts(now);
}

export async function checkPushReceipts(
  now = new Date(),
  request: typeof fetch = fetch,
) {
  if (process.env.EXPO_PUSH_ENABLED !== "true") return;
  await transaction(async (c) => {
    const rows = (
      await c.query(
        "SELECT * FROM push_receipts WHERE state='pending' AND created_at<$1::timestamptz-interval '15 minutes' AND (checked_at IS NULL OR checked_at<$1::timestamptz-interval '15 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100",
        [now],
      )
    ).rows;
    if (!rows.length) return;
    try {
      const response = await request(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({ ids: rows.map((r) => r.id) }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw Error();
      const result: any = await response.json();
      for (const row of rows) {
        const receipt = result.data?.[row.id];
        const expired =
          now.getTime() - new Date(row.created_at).getTime() > 86400000;
        const state =
          receipt?.status === "ok"
            ? "delivered"
            : receipt?.status === "error" || expired
              ? "failed"
              : "pending";
        await c.query(
          "UPDATE push_receipts SET state=$2,checked_at=$3,last_error=$4 WHERE id=$1",
          [
            row.id,
            state,
            now,
            receipt?.details?.error || (expired ? "Receipt verlopen" : null),
          ],
        );
        if (receipt?.details?.error === "DeviceNotRegistered")
          await c.query("UPDATE push_devices SET active=false WHERE id=$1", [
            row.device_id,
          ]);
      }
    } catch {
      await c.query(
        "UPDATE push_receipts SET checked_at=$2 WHERE id=ANY($1::text[])",
        [rows.map((r) => r.id), now],
      );
    }
  });
}
