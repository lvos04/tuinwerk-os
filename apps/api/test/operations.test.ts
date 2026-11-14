import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  occurrenceDates,
  nextCompletionDate,
  validateConfig,
  runMaintenance,
  SeasonController,
  RecurrenceController,
} from "../src/recurrence";
import { bookMovement, InventoryController } from "../src/inventory";
import { pool, query } from "../src/db";

test("calendar clamps month-end and leap day without drift", () => {
  assert.deepEqual(
    occurrenceDates(
      { frequency: "monthly", startDate: "2024-01-31" },
      "2024-04-30",
    ),
    ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"],
  );
  assert.deepEqual(
    occurrenceDates(
      { frequency: "yearly", startDate: "2024-02-29" },
      "2028-03-01",
    ),
    ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"],
  );
});
test("calendar supports weekdays, nth, exclusions and DST boundaries", () => {
  assert.deepEqual(
    occurrenceDates(
      {
        frequency: "weekly",
        interval: 2,
        startDate: "2026-03-23",
        weekdays: [1, 5],
        exceptions: ["2026-03-27"],
      },
      "2026-04-10",
    ),
    ["2026-03-23", "2026-04-06", "2026-04-10"],
  );
  assert.deepEqual(
    occurrenceDates(
      {
        frequency: "monthly",
        startDate: "2026-01-01",
        nthWeekday: { nth: 2, weekday: 1 },
      },
      "2026-03-31",
    ),
    ["2026-01-12", "2026-02-09", "2026-03-09"],
  );
  assert.deepEqual(
    occurrenceDates(
      {
        frequency: "monthly",
        startDate: "2026-01-01",
        nthWeekday: { nth: -1, weekday: 5 },
      },
      "2026-02-28",
    ),
    ["2026-01-30", "2026-02-27"],
  );
  assert.equal(
    nextCompletionDate(
      { frequency: "monthly", startDate: "2026-01-01" },
      "2026-01-31",
    ),
    "2026-02-28",
  );
  assert.throws(() =>
    validateConfig({ frequency: "daily", startDate: "2026-02-30" }),
  );
});
test(
  "PostgreSQL stock, count and recurrence transactions",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const u = (
      await query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Operations test','not-a-password','employee') RETURNING *",
        [randomUUID() + "@test.invalid"],
      )
    )[0];
    const a = (
        await query("INSERT INTO locations(name) VALUES('Ops A') RETURNING *")
      )[0],
      b = (
        await query("INSERT INTO locations(name) VALUES('Ops B') RETURNING *")
      )[0];
    const item = (
      await query(
        "INSERT INTO inventory_items(sku,name) VALUES($1,'Test seal') RETURNING *",
        [randomUUID()],
      )
    )[0];
    const base = { itemId: item.id, locationId: a.id };
    const receipt = {
      ...base,
      operationId: randomUUID(),
      type: "receipt",
      quantity: 1,
    };
    const received = await bookMovement(u.id, receipt);
    assert.deepEqual(await bookMovement(u.id, receipt), received);
    await assert.rejects(
      bookMovement(u.id, { ...receipt, quantity: 2 }),
      /Operatie-ID/,
    );
    const used = await Promise.allSettled(
      [1, 2].map(() =>
        bookMovement(u.id, {
          ...base,
          operationId: randomUUID(),
          type: "usage",
          quantity: 1,
        }),
      ),
    );
    assert.equal(used.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      Number(
        (
          await query(
            "SELECT quantity FROM inventory_balances WHERE item_id=$1 AND location_id=$2",
            [item.id, a.id],
          )
        )[0].quantity,
      ),
      0,
    );
    await assert.rejects(
      bookMovement(u.id, {
        ...base,
        toLocationId: b.id,
        operationId: randomUUID(),
        type: "transfer",
        quantity: 1,
      }),
      /Onvoldoende/,
    );
    assert.equal(
      (
        await query(
          "SELECT * FROM inventory_balances WHERE item_id=$1 AND location_id=$2",
          [item.id, b.id],
        )
      ).length,
      0,
      "failed transfer rolls destination back",
    );
    await bookMovement(u.id, {
      ...base,
      operationId: randomUUID(),
      type: "receipt",
      quantity: 3,
    });
    const transfer = {
      ...base,
      toLocationId: b.id,
      operationId: randomUUID(),
      type: "transfer",
      quantity: 1,
    };
    await bookMovement(u.id, transfer);
    await bookMovement(u.id, transfer);
    assert.equal(
      Number(
        (
          await query(
            "SELECT sum(quantity) n FROM inventory_balances WHERE item_id=$1",
            [item.id],
          )
        )[0].n,
      ),
      3,
    );
    const controller = new InventoryController(),
      count = await controller.startCount(
        { name: "Test count", locationId: a.id },
        u,
      );
    const detail = await controller.count(count.id),
      line = detail.lines[0];
    await bookMovement(u.id, {
      ...base,
      operationId: randomUUID(),
      type: "receipt",
      quantity: 1,
    });
    await assert.rejects(
      controller.confirm(
        count.id,
        {
          version: count.version,
          lines: [
            {
              itemId: item.id,
              locationId: a.id,
              quantity: 4,
              expectedVersion: line.currentVersion,
            },
          ],
        },
        u,
      ),
      /tijdens/,
    );
    const fresh = await controller.count(count.id);
    const confirm = {
      version: count.version,
      lines: [
        {
          itemId: item.id,
          locationId: a.id,
          quantity: 4,
          expectedVersion: fresh.lines[0].currentVersion,
        },
      ],
    };
    await controller.confirm(count.id, confirm, u);
    await controller.confirm(count.id, confirm, u);
    assert.equal(
      Number(
        (
          await query(
            "SELECT quantity FROM inventory_balances WHERE item_id=$1 AND location_id=$2",
            [item.id, a.id],
          )
        )[0].quantity,
      ),
      4,
    );
    const child = (
      await query(
        "INSERT INTO locations(name,parent_id) VALUES($1,$2) RETURNING *",
        ["Ops nested bin", a.id],
      )
    )[0];
    await bookMovement(u.id, {
      itemId: item.id,
      locationId: child.id,
      operationId: randomUUID(),
      type: "receipt",
      quantity: 2,
    });
    const nestedCount = await controller.startCount(
      { name: "Nested scope", locationId: a.id },
      u,
    );
    const nestedDetail = await controller.count(nestedCount.id);
    assert.equal(
      nestedDetail.lines.length,
      2,
      "parent count includes nested bins",
    );
    const newItem = await controller.create(
      { sku: randomUUID(), name: "Newly found" },
      u,
    );
    const updatedCount = await controller.addCountLine(
      nestedCount.id,
      {
        version: nestedCount.version,
        itemId: newItem.id,
        locationId: child.id,
      },
      u,
    );
    assert.equal(updatedCount.version, 2);
    assert.equal(
      (await controller.count(nestedCount.id)).lines.length,
      3,
      "newly found zero-balance item can be counted",
    );
    const storeBalance = (
      await query(
        "SELECT * FROM inventory_balances WHERE item_id=$1 AND location_id=$2",
        [item.id, child.id],
      )
    )[0];
    await controller.minimum(
      item.id,
      child.id,
      { version: storeBalance.version, minimum: 5 },
      u,
    );
    const listed = await controller.items(item.sku);
    assert.equal(
      listed[0].lowStock,
      true,
      "per-location shortage is included even when global minimum is zero",
    );
    const r = (
      await query(
        "INSERT INTO recurrence_rules(title,config,created_by) VALUES($1,$2,$3) RETURNING *",
        [
          "Test maintenance",
          JSON.stringify({
            frequency: "monthly",
            startDate: "2026-01-31",
            endDate: "2026-03-31",
          }),
          u.id,
        ],
      )
    )[0];
    await Promise.all([
      runMaintenance("2026-03-31"),
      runMaintenance("2026-03-31"),
    ]);
    const occurrences = await query(
      "SELECT * FROM recurrence_occurrences WHERE rule_id=$1",
      [r.id],
    );
    assert.equal(occurrences.length, 3);
    assert.equal(new Set(occurrences.map((o) => o.task_id)).size, 3);
    const recurring = new RecurrenceController();
    await assert.rejects(
      recurring.create(
        {
          title: "Invalid checklist",
          config: { frequency: "daily", startDate: "2026-01-01" },
          taskTemplate: { checklist: [null] },
        },
        u,
      ),
      /checklist/,
    );
    const completion = await recurring.create(
      {
        title: "Completion interval",
        config: {
          frequency: "daily",
          interval: 2,
          startDate: "2026-01-01",
          mode: "completion",
          exceptions: ["2026-01-03"],
        },
      },
      u,
    );
    await runMaintenance("2026-01-10");
    let completionTasks = await query(
      "SELECT t.* FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.rule_id=$1 ORDER BY o.due_date",
      [completion.id],
    );
    assert.equal(completionTasks.length, 1);
    await query("UPDATE tasks SET status='cancelled' WHERE id=$1", [
      completionTasks[0].id,
    ]);
    await runMaintenance("2026-01-10");
    completionTasks = await query(
      "SELECT o.due_date::text,t.* FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.rule_id=$1 ORDER BY o.due_date",
      [completion.id],
    );
    assert.equal(completionTasks.length, 2);
    assert.equal(completionTasks[1].due_date, "2026-01-05");
    await runMaintenance("2026-01-10");
    assert.equal(
      (
        await query("SELECT * FROM recurrence_occurrences WHERE rule_id=$1", [
          completion.id,
        ])
      ).length,
      2,
      "an unfinished completion-based task prevents another occurrence",
    );
    await query(
      "UPDATE tasks SET status='completed',completed_at='2026-01-08T17:00:00Z' WHERE id=$1",
      [completionTasks[1].id],
    );
    await runMaintenance("2026-01-10");
    assert.equal(
      (
        await query(
          "SELECT due_date::text FROM recurrence_occurrences WHERE rule_id=$1 ORDER BY due_date DESC",
          [completion.id],
        )
      )[0].due_date,
      "2026-01-10",
    );
    const future = await recurring.create(
      {
        title: "Before template edit",
        config: {
          frequency: "daily",
          startDate: "2035-01-01",
          endDate: "2035-01-03",
        },
      },
      u,
    );
    await runMaintenance("2035-01-03");
    const futureTasks = await query(
      "SELECT t.* FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.rule_id=$1 ORDER BY o.due_date",
      [future.id],
    );
    await query(
      "UPDATE tasks SET status='completed',completed_at=now() WHERE id=$1",
      [futureTasks[0].id],
    );
    await recurring.edit(
      future.id,
      { version: future.version, title: "After template edit" },
      u,
    );
    const edited = await query(
      "SELECT t.* FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.rule_id=$1 ORDER BY o.due_date",
      [future.id],
    );
    assert.equal(edited[0].title, "Before template edit");
    assert.equal(edited[1].title, "After template edit");
    const currentFuture = (
      await query("SELECT * FROM recurrence_rules WHERE id=$1", [future.id])
    )[0];
    await assert.rejects(
      recurring.edit(
        future.id,
        {
          version: currentFuture.version,
          taskTemplate: { assigneeIds: [randomUUID()] },
        },
        u,
      ),
      /Medewerker bestaat/,
    );
    await recurring.edit(
      future.id,
      {
        version: currentFuture.version,
        config: {
          frequency: "weekly",
          startDate: "2035-01-08",
          endDate: "2035-01-15",
        },
      },
      u,
    );
    await runMaintenance("2035-01-15");
    const scheduleHistory = await recurring.occurrences(future.id);
    assert.equal(scheduleHistory.filter((o: any) => o.superseded).length, 2);
    assert.equal(
      scheduleHistory.filter(
        (o: any) => !o.superseded && o.status !== "completed",
      ).length,
      2,
    );
    assert.equal(
      scheduleHistory
        .filter((o: any) => o.superseded)
        .every((o: any) => o.status === "cancelled"),
      true,
    );
    const retired = (
      await query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Retired worker','unused','employee') RETURNING *",
        [randomUUID() + "@test.invalid"],
      )
    )[0];
    const badRule = await recurring.create(
      {
        title: "Inactive assignee rule",
        config: {
          frequency: "daily",
          startDate: "2036-01-01",
          endDate: "2036-01-01",
        },
        taskTemplate: { assigneeIds: [retired.id] },
      },
      u,
    );
    const goodRule = await recurring.create(
      {
        title: "Other rule remains functional",
        config: {
          frequency: "daily",
          startDate: "2036-01-01",
          endDate: "2036-01-01",
        },
      },
      u,
    );
    await query("UPDATE users SET active=false WHERE id=$1", [retired.id]);
    const isolated = await runMaintenance("2036-01-01");
    assert.ok(isolated.failures.some((f) => f.ruleId === badRule.id));
    assert.equal(
      (
        await query("SELECT * FROM recurrence_occurrences WHERE rule_id=$1", [
          goodRule.id,
        ])
      ).length,
      1,
    );
    await query("UPDATE recurrence_rules SET active=false WHERE id=$1", [
      badRule.id,
    ]);
    const seasons = new SeasonController();
    const season = await seasons.create(
      {
        name: "Test season",
        activities: [
          { title: "Clean", offsetDays: -2 },
          { title: "Start", offsetDays: 0 },
        ],
      },
      u,
    );
    const activation = {
      operationId: randomUUID(),
      date: "2026-04-01",
      assigneeIds: [u.id],
    };
    const activated = await seasons.activate(season.id, activation, u);
    assert.deepEqual(
      await seasons.activate(season.id, activation, u),
      activated,
    );
    assert.equal(activated.taskIds.length, 2);
    const dates = await query(
      "SELECT planned_at::date::text AS date FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY planned_at",
      [activated.taskIds],
    );
    assert.deepEqual(
      dates.map((r) => r.date),
      ["2026-03-30", "2026-04-01"],
    );
    await query(
      "UPDATE tasks SET status='completed',completed_at=now() WHERE id=$1",
      [activated.taskIds[0]],
    );
    const shifted = await seasons.shift(
      activated.id,
      { version: activated.version, date: "2026-04-11" },
      u,
    );
    assert.equal(shifted.shifted.length, 1);
    assert.equal(shifted.skipped.length, 1);
    await assert.rejects(
      seasons.shift(
        activated.id,
        { version: activated.version, date: "2026-04-12" },
        u,
      ),
      /gewijzigd/,
    );
    const shiftedDates = await query(
      "SELECT planned_at::date::text AS date FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY planned_at",
      [activated.taskIds],
    );
    assert.deepEqual(
      shiftedDates.map((r) => r.date),
      ["2026-03-30", "2026-04-11"],
    );
    const updatedSeason = await seasons.edit(
      season.id,
      {
        version: season.version,
        name: "Changed season",
        activities: [{ title: "New start", offsetDays: 1 }],
      },
      u,
    );
    assert.equal(updatedSeason.version, 2);
    assert.equal(
      (
        await query("SELECT count(*) n FROM tasks WHERE id=ANY($1::uuid[])", [
          activated.taskIds,
        ])
      )[0].n,
      "2",
    );
    const asset = (
      await query(
        "INSERT INTO assets(name) VALUES('Compatible test machine') RETURNING *",
      )
    )[0];
    const compatibleItem = await controller.create(
      {
        sku: randomUUID(),
        name: "Compatible part",
        compatibleAssetIds: [asset.id],
        supplierSku: "SUP-1",
      },
      u,
    );
    assert.deepEqual(compatibleItem.compatibleAssetIds, [asset.id]);
    assert.equal(compatibleItem.supplierSku, "SUP-1");
    await assert.rejects(
      controller.edit(
        compatibleItem.id,
        { version: compatibleItem.version, compatibleAssetIds: [randomUUID()] },
        u,
      ),
      /Onbekende compatibele/,
    );
  },
);
after(async () => {
  await pool.end();
});
