import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, query } from "../src/db";
import {
  TasksController,
  LocationsController,
  SchedulesController,
  TimeController,
} from "../src/core";
import { passwordHash, User } from "../src/auth";
const enabled = !!process.env.DATABASE_URL;
after(async () => {
  await pool.end();
});
test(
  "echte database: idempotentie, versieconflict, statusregels, locatiecyclus en privéplanning",
  { skip: !enabled },
  async () => {
    const id = randomUUID(),
      other = randomUUID();
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$4,$5)",
      [
        id,
        id + "@test.invalid",
        "Test",
        passwordHash("TestPassword123!"),
        "employee",
        other,
        other + "@test.invalid",
        "Andere",
      ],
    );
    const u: User = {
        id,
        email: id + "@test.invalid",
        name: "Test",
        role: "employee",
      },
      v: User = { ...u, id: other };
    const tasks = new TasksController(),
      locations = new LocationsController(),
      schedules = new SchedulesController();
    const operationId = randomUUID();
    const body = {
      title: "Test reparatie",
      operationId,
      checklist: [{ text: "Controle", required: true, done: false }],
    };
    const a = await tasks.create(u, body),
      b = await tasks.create(u, body);
    assert.equal(a.id, b.id);
    await assert.rejects(() => tasks.create(u, { ...body, title: "Ander" }));
    await assert.rejects(() =>
      tasks.update(u, a.id, { version: 1, status: "completed" }),
    );
    const changed = await tasks.update(u, a.id, {
      version: 1,
      title: "Gewijzigd",
    });
    assert.equal(changed.version, 2);
    const done = await tasks.update(u, a.id, {
      version: 2,
      status: "completed",
      checklist: [
        { id: a.checklist[0].id, text: "Controle", required: true, done: true },
      ],
    });
    const doneAgain = await tasks.update(v, a.id, {
      version: 3,
      status: "completed",
      checklist: done.checklist,
    });
    assert.equal(doneAgain.completedAt, done.completedAt);
    assert.equal(doneAgain.checklist[0].completedBy, u.id);
    assert.equal(
      doneAgain.checklist[0].completedAt,
      done.checklist[0].completedAt,
    );
    await assert.rejects(() =>
      tasks.update(v, a.id, { version: 1, title: "Verouderd" }),
    );
    const parent = await locations.create(u, { name: "Kas" }),
      child = await locations.create(u, {
        name: "Afdeling",
        parentId: parent.id,
      });
    await assert.rejects(() =>
      locations.update(u, parent.id, { version: 1, parentId: child.id }),
    );
    const s = await schedules.create(u, {
      title: "Privé werkblok",
      startsAt: "2026-11-11T08:00:00Z",
      endsAt: "2026-11-11T09:00:00Z",
    });
    assert.equal(
      (await schedules.list(v, {})).some((x: any) => x.id === s.id),
      false,
    );
    assert.equal(
      (await schedules.list(u, {})).some((x: any) => x.id === s.id),
      true,
    );
  },
);
test(
  "dependency cycles are rejected and shared privacy stays with owner",
  { skip: !enabled },
  async () => {
    const users = await query(
      "SELECT id,email,name,role FROM users WHERE role='employee' LIMIT 2",
    );
    const u = users[0] as User,
      v = users[1] as User;
    const controller = new TasksController();
    const a = await controller.create(u, { title: "Afhankelijkheid A" }),
      b = await controller.create(u, {
        title: "Afhankelijkheid B",
        dependencies: [a.id],
      });
    await assert.rejects(() =>
      controller.update(u, a.id, { version: 1, dependencies: [b.id] }),
    );
    const scheduler = new SchedulesController();
    const s = await scheduler.create(u, {
      title: "Gedeeld",
      startsAt: "2026-11-11T08:00:00Z",
      endsAt: "2026-11-11T09:00:00Z",
      shared: true,
      participants: [v.id],
    });
    await assert.rejects(() =>
      scheduler.update(v, s.id, {
        version: 1,
        confirmShared: true,
        shared: false,
      }),
    );
  },
);

test(
  "time correction is versioned, owner-authorized and audited",
  { skip: !enabled },
  async () => {
    const users = await query(
      "SELECT id,email,name,role FROM users WHERE role='employee' LIMIT 2",
    );
    const u = users[0] as User,
      v = users[1] as User;
    const tasks = new TasksController(),
      time = new TimeController();
    const task = await tasks.create(u, { title: "Tijdcorrectie" });
    const entry = await tasks.time(u, task.id, { minutes: 30 });
    await assert.rejects(() =>
      time.correct(entry.id, v, {
        version: 1,
        minutes: 60,
        reason: "Vergissing",
      }),
    );
    const updated = await time.correct(entry.id, u, {
      version: 1,
      minutes: 45,
      reason: "Pauze gecorrigeerd",
    });
    assert.equal(Number(updated.minutes), 45);
    assert.equal(updated.version, 2);
    await assert.rejects(() =>
      time.correct(entry.id, u, {
        version: 1,
        minutes: 60,
        reason: "Oude versie",
      }),
    );
    const events = await query(
      "SELECT details FROM audit_events WHERE entity_type='time_entry' AND entity_id=$1 AND action='corrected'",
      [entry.id],
    );
    assert.equal(Number(events[0].details.before.minutes), 30);
    assert.equal(Number(events[0].details.after.minutes), 45);
  },
);
