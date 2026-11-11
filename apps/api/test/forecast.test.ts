import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { forecastMaintenance } from "../src/recurrence";
import { pool, query } from "../src/db";

test("Forecast rejects invalid dates and a window longer than two years", async () => {
  await assert.rejects(
    forecastMaintenance("2038-02-30", "2038-12-31"),
    /kalenderdatum/,
  );
  await assert.rejects(
    forecastMaintenance("2038-01-01", "2041-01-01"),
    /twee jaar/,
  );
  await assert.rejects(
    forecastMaintenance("2038-12-31", "2038-01-01"),
    /twee jaar/,
  );
});
test(
  "Forecast projects full year without creating tasks and reuses existing task identities",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const user = (
      await query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Forecast test','unused','employee') RETURNING *",
        [randomUUID() + "@test.invalid"],
      )
    )[0];
    const rule = (
      await query(
        "INSERT INTO recurrence_rules(title,config,created_by) VALUES($1,$2,$3) RETURNING *",
        [
          "Future monthly",
          JSON.stringify({ frequency: "monthly", startDate: "2038-01-31" }),
          user.id,
        ],
      )
    )[0];
    const existing = (
      await query(
        "INSERT INTO tasks(title,created_by,updated_by,planned_at) VALUES('Existing maintenance',$1,$1,'2038-01-31T12:00:00Z') RETURNING *",
        [user.id],
      )
    )[0];
    await query(
      "INSERT INTO recurrence_occurrences(rule_id,due_date,task_id) VALUES($1,'2038-01-31',$2)",
      [rule.id, existing.id],
    );
    const completion = (
      await query(
        "INSERT INTO recurrence_rules(title,config,created_by) VALUES($1,$2,$3) RETURNING *",
        [
          "Completion projection",
          JSON.stringify({
            frequency: "monthly",
            mode: "completion",
            startDate: "2038-01-01",
          }),
          user.id,
        ],
      )
    )[0];
    const completed = (
      await query(
        "INSERT INTO tasks(title,created_by,updated_by,status,completed_at) VALUES('Finished maintenance',$1,$1,'completed','2038-02-10T18:00:00Z') RETURNING *",
        [user.id],
      )
    )[0];
    await query(
      "INSERT INTO recurrence_occurrences(rule_id,due_date,task_id) VALUES($1,'2038-02-01',$2)",
      [completion.id, completed.id],
    );
    const snapshot = async () => ({
      tasks: await query(
        "SELECT * FROM tasks WHERE created_by=$1 ORDER BY id",
        [user.id],
      ),
      occurrences: await query(
        "SELECT * FROM recurrence_occurrences WHERE rule_id=ANY($1::uuid[]) ORDER BY rule_id,due_date",
        [[rule.id, completion.id]],
      ),
    });
    const before = await snapshot();
    const forecast = await forecastMaintenance("2038-01-01", "2038-12-31");
    const months = forecast.filter((row: any) => row.ruleId === rule.id);
    assert.equal(months.length, 12);
    assert.equal(months[0].taskId, existing.id);
    assert.equal(months[0].generated, true);
    assert.equal(months[1].dueDate, "2038-02-28");
    assert.equal(months[11].dueDate, "2038-12-31");
    assert.equal(months[11].taskId, null);
    assert.equal(months[11].tentative, false);
    const tentative = forecast.filter(
      (row: any) => row.ruleId === completion.id && !row.generated,
    );
    assert.equal(tentative.length, 1);
    assert.equal(tentative[0].dueDate, "2038-03-10");
    assert.equal(tentative[0].tentative, true);
    assert.deepEqual(
      await snapshot(),
      before,
      "forecast must not create or change tasks, occurrences or history",
    );
    await query("UPDATE recurrence_rules SET active=false WHERE id=$1", [
      rule.id,
    ]);
    const paused = (
      await forecastMaintenance("2038-01-01", "2038-12-31")
    ).filter((row: any) => row.ruleId === rule.id);
    assert.equal(paused.length, 1);
    assert.equal(
      paused[0].taskId,
      existing.id,
      "paused rules retain generated work but create no forecast",
    );
  },
);
after(async () => pool.end());
