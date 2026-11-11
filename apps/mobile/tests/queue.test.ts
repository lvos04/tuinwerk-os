import { test } from "node:test";
import assert from "node:assert/strict";
import { drainQueue, PendingOperation, RequestError } from "../src/queue";
const operation = (id: string, owner = "u1"): PendingOperation => ({
  id,
  owner,
  method: "POST",
  path: "/tasks",
  payload: { title: id },
  status: "pending",
});
test("retry preserves operation ID and stops dependent uploads on network loss", async () => {
  const queue = [operation("task"), operation("photo")];
  const calls: string[] = [];
  await drainQueue(
    queue,
    "u1",
    async (op) => {
      calls.push(op.id);
      throw new Error("offline");
    },
    async () => {},
    async () => assert.fail(),
  );
  assert.deepEqual(calls, ["task"]);
  const removed: string[] = [];
  await drainQueue(
    queue,
    "u1",
    async (op) => {
      calls.push(op.id);
    },
    async () => {},
    async (op) => {
      removed.push(op.id);
    },
  );
  assert.deepEqual(calls, ["task", "task", "photo"]);
  assert.deepEqual(removed, ["task", "photo"]);
});
test("conflict is persisted and later edits cannot silently pass it", async () => {
  const queue = [operation("edit"), operation("next")];
  let saved: PendingOperation | undefined;
  const result = await drainQueue(
    queue,
    "u1",
    async () => {
      throw new RequestError(409, "Versie gewijzigd");
    },
    async (op) => {
      saved = op;
    },
    async () => assert.fail(),
  );
  assert.equal(saved?.status, "conflict");
  assert.equal(result.sent, 0);
  await drainQueue(
    [saved!, queue[1]],
    "u1",
    async () => assert.fail(),
    async () => {},
    async () => {},
  );
});
test("different account operations never leave device under current credentials", async () => {
  const sent: string[] = [];
  await drainQueue(
    [operation("other", "u2"), operation("mine")],
    "u1",
    async (op) => {
      sent.push(op.id);
    },
    async () => {},
    async () => {},
  );
  assert.deepEqual(sent, ["mine"]);
});
test("validation failure retains draft for manual repair", async () => {
  let saved: PendingOperation | undefined;
  await drainQueue(
    [operation("bad")],
    "u1",
    async () => {
      throw new RequestError(400, "Aantal ongeldig");
    },
    async (op) => {
      saved = op;
    },
    async () => assert.fail(),
  );
  assert.equal(saved?.status, "failed");
});
import { SessionGeneration } from "../src/session-state";
test("late refresh cannot restore logged-out or replaced account, including same user on another server", () => {
  const state = new SessionGeneration();
  state.activate("https://a|u1");
  const old = state.capture();
  state.invalidate();
  assert.equal(state.matches("https://a|u1", old), false);
  state.activate("https://b|u1");
  assert.equal(state.matches("https://a|u1", old), false);
  const current = state.capture();
  assert.equal(state.matches("https://b|u1", current), true);
  state.activate("https://b|u1");
  assert.equal(state.matches("https://b|u1", current), false);
});
import { collectPages } from "../src/paging";
import { projectTasks } from "../src/task-cache";
test("catalogue paging reaches records beyond default first 100 and completes final page", async () => {
  const rows = Array.from({ length: 1003 }, (_, id) => ({ id: String(id) }));
  const offsets: number[] = [];
  const all = await collectPages(async (offset, limit) => {
    offsets.push(offset);
    return rows.slice(offset, offset + limit);
  });
  assert.equal(all.length, 1003);
  assert.deepEqual(offsets, [0, 500, 1000]);
});
test("repeating server page fails visibly rather than silently dropping catalogue records", async () => {
  await assert.rejects(
    collectPages(async () => [{ id: "a" }, { id: "b" }], 2),
    /herhaalt een pagina/,
  );
});
test("offline create and sequential edits retain expected next versions and local draft marker", () => {
  const created = {
    ...operation("create"),
    payload: { id: "task1", title: "Pomp" },
  };
  const first = {
    ...operation("first"),
    method: "PATCH" as const,
    path: "/tasks/task1",
    payload: { version: 1, title: "Pomp kapot" },
  };
  const second = {
    ...operation("second"),
    method: "PATCH" as const,
    path: "/tasks/task1",
    payload: { version: 2, status: "in_progress" },
  };
  const [result] = projectTasks([], [created, first, second]);
  assert.equal(result.version, 3);
  assert.equal(result.title, "Pomp kapot");
  assert.equal(result.status, "in_progress");
  assert.equal(result.localDraft, true);
});
