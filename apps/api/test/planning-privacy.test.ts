import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, pool } from "../src/db";
import { SchedulesController } from "../src/core";
import { User } from "../src/auth";
after(() => pool.end());
test(
  "shared to private notification does not reveal new private title and confirmation is strict",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const owner = randomUUID(),
      participant = randomUUID();
    for (const id of [owner, participant])
      await query(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Planner','unused','employee')",
        [id, id + "@planning.invalid"],
      );
    const u: User = { id: owner, email: "", name: "", role: "employee" },
      v: User = { ...u, id: participant },
      controller = new SchedulesController();
    const block = await controller.create(u, {
      title: "Gezamenlijk werk",
      startsAt: "2026-12-01T08:00:00Z",
      endsAt: "2026-12-01T09:00:00Z",
      shared: true,
      participants: [participant],
    });
    await assert.rejects(() =>
      controller.update(v, block.id, {
        version: 1,
        title: "Anders",
        confirmShared: "false",
      }),
    );
    await assert.rejects(() =>
      controller.update(u, block.id, {
        version: 1,
        shared: false,
        title: "Geheim medisch bezoek",
      }),
    );
    await controller.update(u, block.id, {
      version: 1,
      shared: false,
      title: "Geheim medisch bezoek",
      confirmShared: true,
    });
    const notifications = await query(
      "SELECT title,body FROM notifications WHERE user_id=$1 AND entity_id=$2",
      [participant, block.id],
    );
    assert.ok(
      notifications.some(
        (n) => n.title === "Afspraak wordt niet langer gedeeld",
      ),
    );
    assert.ok(!JSON.stringify(notifications).includes("Geheim medisch bezoek"));
    assert.equal(
      (await controller.list(v, { from: "2026-12-01", to: "2026-12-02" })).some(
        (row: any) => row.id === block.id,
      ),
      false,
    );
  },
);
