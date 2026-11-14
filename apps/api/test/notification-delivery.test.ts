import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuiet, sendEmail, sendExpoPush } from "../src/notification-delivery";
test("Quiet hours cross midnight and honor Amsterdam DST", () => {
  assert.equal(
    isQuiet(
      new Date("2026-07-01T21:00:00Z"),
      "22:00",
      "07:00",
      "Europe/Amsterdam",
    ),
    true,
  );
  assert.equal(
    isQuiet(
      new Date("2026-07-01T12:00:00Z"),
      "22:00",
      "07:00",
      "Europe/Amsterdam",
    ),
    false,
  );
  assert.equal(isQuiet(new Date(), "00:00", "00:00"), false);
});
test("SMTP sends plain text to exact intended recipient", async () => {
  let sent: any;
  await sendEmail("test@example.com", "Taak", "Lekkage", {
    sendMail: async (m) => {
      sent = m;
    },
  });
  assert.equal(sent.to, "test@example.com");
  assert.equal(sent.text, "Lekkage");
  assert.equal(sent.html, undefined);
});
test("Expo push sends data and rejects provider ticket errors", async () => {
  let payload: any;
  const request: any = async (url: string, opts: any) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    payload = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ data: [{ status: "ok", id: "mock-ticket" }] }),
    };
  };
  await sendExpoPush(
    ["ExpoPushToken[test]"],
    { id: "a", title: "Taak", body: "Melding" },
    request,
  );
  assert.equal(payload[0].data.notificationId, "a");
  await assert.rejects(
    () =>
      sendExpoPush(
        ["ExpoPushToken[test]"],
        { id: "a", title: "Taak", body: "Melding" },
        (async () => ({
          ok: true,
          json: async () => ({ data: [{ status: "error" }] }),
        })) as any,
      ),
    /geweigerd/,
  );
});
