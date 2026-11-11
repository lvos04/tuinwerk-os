import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, pool } from "../src/db";
import {
  UsersController,
  AuthController,
  passwordHash,
  User,
} from "../src/auth";
after(() => pool.end());
test(
  "account edits are admin-only, revoke security sessions and reject self deactivation",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const adminId = randomUUID(),
      employeeId = randomUUID(),
      suffix = randomUUID();
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Beheerder',$3,'admin'),($4,$5,'Medewerker',$3,'employee')",
      [
        adminId,
        `admin-${suffix}@test.invalid`,
        passwordHash("AccountPassword123!"),
        employeeId,
        `employee-${suffix}@test.invalid`,
      ],
    );
    const admin: User = {
        id: adminId,
        name: "Beheerder",
        email: `admin-${suffix}@test.invalid`,
        role: "admin",
      },
      employee: User = {
        id: employeeId,
        name: "Medewerker",
        email: `employee-${suffix}@test.invalid`,
        role: "employee",
      };
    const controller = new UsersController(),
      auth = new AuthController();
    await auth.login(
      { email: employee.email, password: "AccountPassword123!" },
      { ip: "user-test" },
    );
    assert.equal(
      (await query("SELECT * FROM sessions WHERE user_id=$1", [employeeId]))
        .length,
      1,
    );
    await assert.rejects(() =>
      controller.update(employee, adminId, { role: "employee" }),
    );
    await assert.rejects(() =>
      controller.update(admin, adminId, { active: false }),
    );
    const edited = await controller.update(admin, employeeId, {
      name: "Nieuwe naam",
      password: "ChangedPassword123!",
      role: "admin",
    });
    assert.equal(edited.name, "Nieuwe naam");
    assert.equal(edited.role, "admin");
    assert.equal(
      (await query("SELECT * FROM sessions WHERE user_id=$1", [employeeId]))
        .length,
      0,
    );
    await assert.rejects(() =>
      auth.login(
        { email: employee.email, password: "AccountPassword123!" },
        { ip: "user-test" },
      ),
    );
    assert.ok(
      (
        await auth.login(
          { email: employee.email, password: "ChangedPassword123!" },
          { ip: "user-test" },
        )
      ).token,
    );
    const audit = await query(
      "SELECT details FROM audit_events WHERE entity_type='user' AND entity_id=$1 AND action='updated'",
      [employeeId],
    );
    assert.equal(audit[0].details.passwordChanged, true);
    assert.ok(!JSON.stringify(audit[0]).includes("ChangedPassword"));
  },
);
