import { test } from "node:test";
import assert from "node:assert/strict";
import {
  taskNotificationTarget,
  taskLinkTarget,
} from "../src/notification-target";
import { drainQueue, PendingOperation, RequestError } from "../src/queue";
import { taskSyncState, tasksForToday } from "../src/work-model";
const task = "e8e617ae-e214-4235-a361-85eb0a91bf22",
  other = "f8e617ae-e214-4235-a361-85eb0a91bf22";
const session = {
  endpoint: "https://garden.example/api",
  user: { id: "user" },
};
const payload = {
  taskId: task,
  entityType: "task",
  recipientUserId: "user",
  serverOrigin: "https://garden.example",
};
test("push navigation binds task, account and exact server; mixed summaries cannot navigate", () => {
  assert.equal(taskNotificationTarget(payload, session)?.taskId, task);
  for (const overrides of [
    { recipientUserId: "another" },
    { serverOrigin: "https://garden.example.evil.test" },
    { serverOrigin: "https://garden.example/path" },
    { serverOrigin: "https://user@garden.example" },
    { taskId: "../admin" },
    { entityType: "summary" },
  ])
    assert.equal(
      taskNotificationTarget({ ...payload, ...overrides }, session),
      null,
    );
  assert.equal(
    taskLinkTarget(
      `tuinwerk://task/${task}?recipientUserId=user&serverOrigin=https%3A%2F%2Fgarden.example`,
      session,
    )?.taskId,
    task,
  );
  assert.equal(
    taskLinkTarget(`https://garden.example/task/${task}`, session),
    null,
  );
});
function op(id: string, taskId = task): PendingOperation {
  return {
    id,
    owner: "user",
    method: "PATCH",
    path: "/tasks/" + taskId,
    payload: { version: 1 },
    status: "pending",
  };
}
test("task conflict blocks its photo and edits while unrelated task synchronizes", async () => {
  const photo = {
    ...op("photo"),
    method: "POST" as const,
    path: "/attachments",
    payload: { taskId: task },
    fileUri: "file://original",
  };
  const saved: PendingOperation[] = [],
    sent: string[] = [],
    removed: string[] = [];
  await drainQueue(
    [op("conflict"), photo, op("dependent"), op("other", other)],
    "user",
    async (item) => {
      sent.push(item.id);
      if (item.id === "conflict")
        throw new RequestError(409, "version", { current: { version: 2 } });
    },
    async (item) => {
      saved.push(item);
    },
    async (item) => {
      removed.push(item.id);
    },
  );
  assert.deepEqual(sent, ["conflict", "other"]);
  assert.deepEqual(removed, ["other"]);
  assert.equal(
    saved.find((item) => item.status === "conflict")?.conflict !== undefined,
    true,
  );
  assert.equal(photo.fileUri, "file://original");
});
test("logout during send preserves unknown outcome for idempotent recovery and sends no next item", async () => {
  let active = true;
  const sent: string[] = [];
  const result = await drainQueue(
    [op("first"), op("second", other)],
    "user",
    async (item) => {
      sent.push(item.id);
      active = false;
    },
    async () => {},
    async () => assert.fail("must not discard unknown outcome"),
    { isActive: () => active },
  );
  assert.deepEqual(sent, ["first"]);
  assert.equal(result.sent, 0);
});
test("removed operation is never resurrected or sent by old queue snapshot", async () => {
  let exists = true;
  await drainQueue(
    [op("deleted")],
    "user",
    async () => assert.fail("deleted draft sent"),
    async () => {
      exists = false;
    },
    async () => assert.fail(),
    { getCurrent: async (item) => (exists ? item : null) },
  );
});
test("stock conflict blocks same balance but leaves independent balance usable", async () => {
  const stock = (id: string, locationId: string): PendingOperation => ({
    ...op(id),
    path: "/inventory/movements",
    payload: { itemId: "item", locationId },
  });
  const sent: string[] = [];
  await drainQueue(
    [stock("first", "a"), stock("same", "a"), stock("other", "b")],
    "user",
    async (item) => {
      sent.push(item.id);
      if (item.id === "first") throw new RequestError(409, "stock changed");
    },
    async () => {},
    async () => {},
  );
  assert.deepEqual(sent, ["first", "other"]);
});
test("unverified cache is never presented as server confirmed after draft removal", () => {
  assert.equal(taskSyncState(task, [], true).status, "unverified");
  assert.equal(
    taskSyncState(task, [{ ...op("conflict"), status: "conflict" }]).status,
    "conflict",
  );
});
test("my today excludes colleagues and future scheduled work but includes overdue work", () => {
  const tasks = [
    {
      id: "today",
      status: "open",
      assignedTo: ["user"],
      plannedAt: "2026-11-12T12:00:00Z",
    },
    {
      id: "future",
      status: "open",
      assignedTo: ["user"],
      plannedAt: "2026-11-13T12:00:00Z",
    },
    { id: "colleague", status: "open", assignedTo: ["other"] },
    {
      id: "overdue",
      status: "open",
      assignedTo: ["user"],
      deadline: "2026-11-10T12:00:00Z",
    },
  ];
  assert.deepEqual(
    tasksForToday(tasks, "user", new Date("2026-11-12T15:00:00Z"), "UTC")
      .map((row) => row.id)
      .sort(),
    ["overdue", "today"],
  );
});
