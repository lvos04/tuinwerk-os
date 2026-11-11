import nodemailer from "nodemailer";
import { transaction } from "./db";

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
export async function sendExpoPush(
  tokens: string[],
  notification: { id: string; title: string; body: string; entity_id?: string },
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
        body: notification.body,
        sound: "default",
        data: {
          notificationId: notification.id,
          entityId: notification.entity_id,
        },
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
  return {
    tickets: data.data.flatMap((x: any, i: number) =>
      x.status === "ok" && typeof x.id === "string"
        ? [{ token: tokens[i], id: x.id }]
        : [],
    ),
    invalidTokens: data.data.flatMap((x: any, i: number) =>
      x.details?.error === "DeviceNotRegistered" ? [tokens[i]] : [],
    ),
  };
}
/** Delivery is at-least-once: crash after provider acceptance may repeat a notification. */
export async function deliverNotifications(now = new Date()) {
  for (let i = 0; i < 20; i++) {
    const found = await transaction(async (c) => {
      const row = (
        await c.query(
          `SELECT d.*,n.user_id,n.title,n.body,n.entity_id,n.critical,u.email,p.quiet_start,p.quiet_end,p.critical_override,p.email email_enabled,p.push push_enabled FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE d.state='pending' AND d.next_attempt_at<=$1 AND u.active ORDER BY d.next_attempt_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
          [now],
        )
      ).rows[0];
      if (!row) return false;
      const enabled =
        row.channel === "email" ? row.email_enabled : row.push_enabled;
      if (!enabled) {
        await c.query(
          "UPDATE notification_deliveries SET state='skipped' WHERE notification_id=$1 AND channel=$2",
          [row.notification_id, row.channel],
        );
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
          "UPDATE notification_deliveries SET next_attempt_at=$3 WHERE notification_id=$1 AND channel=$2",
          [
            row.notification_id,
            row.channel,
            new Date(now.getTime() + 15 * 60000),
          ],
        );
        return true;
      }
      try {
        if (row.channel === "email")
          await sendEmail(row.email, row.title, row.body);
        else {
          const devices = (
            await c.query(
              "SELECT id,token FROM push_devices WHERE user_id=$1 AND active",
              [row.user_id],
            )
          ).rows;
          if (!devices.length) {
            await c.query(
              "UPDATE notification_deliveries SET next_attempt_at=$3 WHERE notification_id=$1 AND channel=$2",
              [
                row.notification_id,
                row.channel,
                new Date(now.getTime() + 60 * 60000),
              ],
            );
            return true;
          }
          const result = await sendExpoPush(
            devices.map((d) => d.token),
            { ...row, id: row.notification_id },
          );
          for (const token of result.invalidTokens)
            await c.query(
              "UPDATE push_devices SET active=false WHERE token=$1",
              [token],
            );
          for (const ticket of result.tickets)
            await c.query(
              "INSERT INTO push_receipts(id,device_id,notification_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
              [
                ticket.id,
                devices.find((d) => d.token === ticket.token)!.id,
                row.notification_id,
              ],
            );
        }
        await c.query(
          "UPDATE notification_deliveries SET state='sent',sent_at=now(),attempts=attempts+1,last_error=NULL WHERE notification_id=$1 AND channel=$2",
          [row.notification_id, row.channel],
        );
      } catch {
        const attempts = row.attempts + 1;
        await c.query(
          "UPDATE notification_deliveries SET attempts=$3,state=$4,last_error='Transport mislukt; controleer configuratie en provider',next_attempt_at=$5 WHERE notification_id=$1 AND channel=$2",
          [
            row.notification_id,
            row.channel,
            attempts,
            attempts >= 8 ? "failed" : "pending",
            new Date(now.getTime() + Math.min(3600000, 60000 * 2 ** attempts)),
          ],
        );
      }
      return true;
    });
    if (!found) break;
  }
  await checkPushReceipts(now);
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
