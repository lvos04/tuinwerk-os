import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProductivityController, occupiedMinutes } from "../src/productivity";
import { query, pool } from "../src/db";
import { User } from "../src/auth";
after(() => pool.end());
test("capacity interval union clips at day boundaries and counts overlap once", () => {
  assert.equal(
    occupiedMinutes(
      [
        [0, 120 * 60000],
        [60 * 60000, 180 * 60000],
        [180 * 60000, 240 * 60000],
      ],
      30 * 60000,
      210 * 60000,
    ),
    180,
  );
  assert.equal(occupiedMinutes([], 0, 1), 0);
});
test(
  "PostgreSQL favorites ownership/archive and capacity privacy/overlap/versions",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      adminId = randomUUID();
    for (const [id, role] of [
      [owner, "employee"],
      [other, "employee"],
      [adminId, "admin"],
    ])
      await query(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
        [id, id + "@productivity.invalid", id, "unused", role],
      );
    const u: User = { id: owner, email: "", name: "", role: "employee" },
      v: User = { ...u, id: other },
      admin: User = { ...u, id: adminId, role: "admin" };
    const api = new ProductivityController();
    const [asset] = await query(
      "INSERT INTO assets(name) VALUES('Favoriete pomp') RETURNING id",
    );
    await api.addFavorite(u, { type: "asset", id: asset.id });
    await api.addFavorite(u, { type: "asset", id: asset.id });
    assert.equal((await api.favorites(u)).length, 1);
    assert.equal((await api.favorites(v)).length, 0);
    await api.removeFavorite(v, "asset", asset.id);
    assert.equal((await api.favorites(u)).length, 1);
    await query("UPDATE assets SET status='archived' WHERE id=$1", [asset.id]);
    assert.equal((await api.favorites(u))[0].available, false);
    await assert.rejects(() =>
      api.addFavorite(v, { type: "asset", id: asset.id }),
    );
    await assert.rejects(() =>
      api.addFavorite(u, { type: "users", id: owner }),
    );
    const capacity = await api.updateOwn(u, {
      version: 0,
      weekdayMinutes: [0, 120, 120, 120, 120, 120, 0],
    });
    assert.equal(capacity.version, 1);
    await assert.rejects(() =>
      api.updateOwn(u, {
        version: 0,
        weekdayMinutes: [0, 60, 60, 60, 60, 60, 0],
      }),
    );
    await assert.rejects(() =>
      api.updateUser(v, owner, {
        version: 1,
        weekdayMinutes: [0, 60, 60, 60, 60, 60, 0],
      }),
    );
    const originalTimezone = process.env.APP_TIMEZONE;
    process.env.APP_TIMEZONE = "Europe/Amsterdam";
    try {
      for (const [start, end, shared] of [
        ["2025-02-03T08:00:00Z", "2025-02-03T10:00:00Z", true],
        ["2025-02-03T09:00:00Z", "2025-02-03T11:00:00Z", true],
        ["2025-02-03T12:00:00Z", "2025-02-03T13:00:00Z", false],
      ] as const)
        await query(
          "INSERT INTO task_schedules(user_id,title,starts_at,ends_at,shared,participants) VALUES($1,$2,$3,$4,$5,$6)",
          [
            owner,
            "Privé titel nooit in aggregaat",
            start,
            end,
            shared,
            shared ? [other] : [],
          ],
        );
      const own = (
        await api.capacity(u, {
          from: "2025-02-03",
          to: "2025-02-03",
          userId: owner,
        })
      ).days[0];
      assert.equal(own.plannedMinutes, 240);
      assert.equal(own.overloadedMinutes, 120);
      assert.equal(own.scope, "all-visible");
      const publicView = await api.capacity(v, {
        from: "2025-02-03",
        to: "2025-02-03",
        userId: owner,
      });
      assert.equal(publicView.days[0].plannedMinutes, 180);
      assert.equal(publicView.days[0].overloadedMinutes, 60);
      assert.equal(publicView.days[0].scope, "shared-only");
      assert.ok(!JSON.stringify(publicView).includes("Privé titel"));
      assert.equal(
        (
          await api.capacity(admin, {
            from: "2025-02-03",
            to: "2025-02-03",
            userId: owner,
          })
        ).days[0].plannedMinutes,
        240,
      );
      assert.equal(
        (
          await api.capacity(v, {
            from: "2025-02-03",
            to: "2025-02-03",
            userId: other,
          })
        ).days[0].plannedMinutes,
        180,
      );
      await assert.rejects(() =>
        api.capacity(u, { from: "2025-01-01", to: "2026-01-01" }),
      );
      const [maintenance] = await query(
        "INSERT INTO tasks(title,category,deadline,created_by,updated_by,assigned_to) VALUES('Onderhoud','onderhoud','2025-02-03T09:00Z',$1,$1,$2) RETURNING id",
        [owner, [owner]],
      );
      const result = await api.capacity(u, {
        from: "2025-02-03",
        to: "2025-02-03",
        userId: owner,
      });
      assert.ok(result.overdueMaintenance.taskIds.includes(maintenance.id));
      assert.equal(
        (
          await api.capacity(u, {
            from: "2025-02-04",
            to: "2025-02-04",
            userId: owner,
          })
        ).overdueMaintenance.count,
        0,
      );
    } finally {
      if (originalTimezone === undefined) delete process.env.APP_TIMEZONE;
      else process.env.APP_TIMEZONE = originalTimezone;
    }
  },
);
