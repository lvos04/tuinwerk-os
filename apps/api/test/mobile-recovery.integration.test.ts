import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool, query } from "../src/db";
import { passwordHash } from "../src/auth";
import { createApp } from "../src/main";
import {
  drainQueue,
  RequestError,
  type PendingOperation,
} from "../../mobile/src/queue";

after(() => pool.end());
// Real PostgreSQL/HTTP plus the production mobile queue protocol. Disk reloads
// stand in for process restarts; this is not a claim of device/SQLite acceptance.
test(
  "mobile queue survives lost HTTP acknowledgements, restart and competing stock edits",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "tuinwerk-queue-http-"));
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    try {
      const base = await app.getUrl();
      const actors: Array<{ id: string; token: string }> = [];
      const request = async (
        token: string | undefined,
        path: string,
        body?: any,
        method = "POST",
      ) => {
        const r = await fetch(base + "/api" + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const b: any = await r.json();
        if (!r.ok) throw new RequestError(r.status, b.message, b);
        return b;
      };
      for (let i = 0; i < 2; i++) {
        const email = randomUUID() + "@queue-http.test";
        const [user] = await query(
          "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,'employee') RETURNING id",
          [email, "Queue actor", passwordHash("SyntheticQueuePassword123!")],
        );
        const session = await request(undefined, "/auth/login", {
          email,
          password: "SyntheticQueuePassword123!",
        });
        actors.push({ id: user.id, token: session.token });
      }
      const owner = (actor: number) => base + "|" + actors[actor].id;
      const send = (actor: number) => (op: PendingOperation) =>
        request(
          actors[actor].token,
          op.path,
          { ...op.payload, operationId: op.id },
          op.method,
        );
      const taskIds = Array.from({ length: 20 }, () => randomUUID());
      let queue: PendingOperation[] = taskIds.map((id, i) => ({
        id: randomUUID(),
        owner: owner(0),
        method: "POST",
        path: "/tasks",
        payload: { id, title: "Herstelde mobiele melding " + i },
        status: "pending",
      }));
      const journal = join(folder, "queue.json");
      const persist = () =>
        writeFile(journal, JSON.stringify(queue), { mode: 0o600 });
      const update = async (op: PendingOperation) => {
        queue = queue.map((old) => (old.id === op.id ? op : old));
        await persist();
      };
      const remove = async (op: PendingOperation) => {
        queue = queue.filter((old) => old.id !== op.id);
        await persist();
      };
      await persist();
      // Account changes must not send another account's saved work.
      await drainQueue(
        queue,
        owner(1),
        async () => assert.fail("Cross-account upload"),
        update,
        remove,
      );
      assert.equal(queue.length, 20);
      const loseAcknowledgement = new Set([
        queue[0].id,
        queue[5].id,
        queue[13].id,
      ]);
      for (let attempt = 0; queue.length && attempt < 8; attempt++) {
        queue = JSON.parse(await readFile(journal, "utf8"));
        await drainQueue(
          queue,
          owner(0),
          async (op) => {
            const result = await send(0)(op);
            if (loseAcknowledgement.delete(op.id))
              throw Error("Connection lost after server commit");
            return result;
          },
          update,
          remove,
        );
      }
      assert.equal(queue.length, 0);
      const [count] = await query(
        "SELECT count(*)::int n FROM tasks WHERE id=ANY($1::uuid[])",
        [taskIds],
      );
      assert.equal(count.n, 20);
      const [location] = await query(
        "INSERT INTO locations(name) VALUES('Queue opslag') RETURNING id",
      );
      const [item] = await query(
        "INSERT INTO inventory_items(name,sku) VALUES('Queue onderdeel',$1) RETURNING id",
        [randomUUID()],
      );
      const stock = { itemId: item.id, locationId: location.id };
      await request(actors[0].token, "/inventory/movements", {
        ...stock,
        type: "receipt",
        quantity: 10,
        operationId: randomUUID(),
      });
      const a: PendingOperation = {
        id: randomUUID(),
        owner: owner(0),
        method: "POST",
        path: "/inventory/movements",
        payload: { ...stock, type: "usage", quantity: 7 },
        status: "pending",
      };
      const b: PendingOperation = {
        id: randomUUID(),
        owner: owner(1),
        method: "POST",
        path: "/inventory/movements",
        payload: { ...stock, type: "usage", quantity: 5 },
        status: "pending",
      };
      let savedB: PendingOperation | undefined;
      await drainQueue(
        [a],
        owner(0),
        async (op) => {
          await send(0)(op);
          throw Error("Lost receipt");
        },
        async () => {},
        async () => assert.fail(),
      );
      await drainQueue(
        [b],
        owner(1),
        send(1),
        async (op) => {
          savedB = op;
        },
        async () => assert.fail(),
      );
      assert.equal(savedB?.status, "conflict");
      assert.equal(
        savedB?.payload.quantity,
        5,
        "Original desired usage must survive conflict",
      );
      await drainQueue(
        [a],
        owner(0),
        send(0),
        async (op) => assert.equal(op.status, "pending"),
        async () => {},
      );
      const [balance] = await query(
        "SELECT quantity FROM inventory_balances WHERE item_id=$1 AND location_id=$2",
        [item.id, location.id],
      );
      assert.equal(
        Number(balance.quantity),
        3,
        "Retry must not consume the same seven twice",
      );
      await drainQueue(
        [savedB!],
        owner(1),
        async () => assert.fail("Conflict cannot silently retry"),
        async () => {},
        async () => {},
      );
      const resolved = {
        ...b,
        id: randomUUID(),
        payload: { ...b.payload, quantity: 3 },
      };
      await drainQueue(
        [resolved],
        owner(1),
        send(1),
        async (op) => assert.equal(op.status, "pending"),
        async () => {},
      );
      const [final] = await query(
        "SELECT quantity FROM inventory_balances WHERE item_id=$1 AND location_id=$2",
        [item.id, location.id],
      );
      assert.equal(Number(final.quantity), 0);
    } finally {
      await app.close();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
