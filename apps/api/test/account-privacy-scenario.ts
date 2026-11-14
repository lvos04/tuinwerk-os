import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { migrate } from "../src/migrate";
import { query, pool } from "../src/db";
import {
  AuthController,
  UsersController,
  passwordHash,
  hash,
  User,
} from "../src/auth";
import {
  AccountPrivacyController,
  processPrivacyFileCleanup,
} from "../src/account-privacy";
import { base32, encryptSecret, totp } from "../src/totp";
import { writeSecret, readSecret } from "../src/settings";
import { createApp } from "../src/main";
async function main() {
  await migrate();
  const id = randomUUID(),
    adminId = randomUUID(),
    taskId = randomUUID(),
    location = randomUUID(),
    item = randomUUID(),
    file = randomUUID(),
    blockedFile = randomUUID(),
    exportId = randomUUID(),
    importId = randomUUID(),
    batchId = randomUUID(),
    notificationId = randomUUID(),
    jobId = randomUUID();
  const email = "personal-account@example.invalid",
    password = "PersonalPassword123!";
  await query(
    "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Private Person',$3,'admin')",
    [id, email, passwordHash(password)],
  );
  const u: User = { id, email, name: "Private Person", role: "admin" };
  const privacy = new AccountPrivacyController(),
    auth = new AuthController();
  assert.equal((await privacy.privacy(u)).canDelete, false);
  await assert.rejects(() =>
    privacy.remove(u, {
      password: "bad",
      confirmation: "VERWIJDER MIJN ACCOUNT",
    }),
  );
  await assert.rejects(
    () =>
      privacy.remove(u, { password, confirmation: "VERWIJDER MIJN ACCOUNT" }),
    /laatste actieve beheerder/,
  );
  await assert.rejects(() =>
    privacy.remove(u, { password, confirmation: "wrong" }),
  );
  await query(
    "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'successor@example.invalid','Opvolger',$2,'admin')",
    [adminId, passwordHash("SuccessorPassword123!")],
  );
  const login = await auth.login({ email, password }, { ip: "privacy" });
  assert.equal((await privacy.privacy(u)).canDelete, true);
  await query("INSERT INTO locations(id,name) VALUES($1,'Magazijn')", [
    location,
  ]);
  await query(
    "INSERT INTO tasks(id,title,description,created_by,updated_by,assigned_to,checklist) VALUES($1,$2,'Gedeelde technische beschrijving',$3,$3,$4,$5)",
    [
      taskId,
      "Reparatie " + email,
      id,
      [id, adminId],
      JSON.stringify([
        { id: "check", text: "Inspecteren", done: true, completedBy: id },
      ]),
    ],
  );
  await query(
    "INSERT INTO task_comments(task_id,user_id,body) VALUES($1,$2,'persoonlijke reactie'),($1,$3,$4)",
    [taskId, id, adminId, "collega " + email],
  );
  await query(
    "INSERT INTO task_schedules(task_id,user_id,title,starts_at,ends_at,shared,participants) VALUES($1,$2,'privé afspraak',now(),now()+interval '1 hour',false,'{}'),($1,$2,'gedeelde afspraak',now(),now()+interval '1 hour',true,$3)",
    [taskId, id, [id, adminId]],
  );
  await query(
    "INSERT INTO time_entries(task_id,user_id,started_at,ended_at,minutes,note) VALUES($1,$2,now()-interval '30 minutes',now(),30,'privé notitie')",
    [taskId, id],
  );
  await mkdir(process.env.UPLOAD_DIR!, { recursive: true });
  await writeFile(resolve(process.env.UPLOAD_DIR!, file), "photo");
  await mkdir(resolve(process.env.UPLOAD_DIR!, blockedFile));
  for (const filename of [file, blockedFile])
    await query(
      "INSERT INTO attachments(task_id,uploaded_by,name,storage_name,mime_type,size,hash) VALUES($1,$2,'photo.jpg',$3,'image/jpeg',5,'hash')",
      [taskId, id, filename],
    );
  await mkdir(process.env.EXPORT_DIR!, { recursive: true });
  await writeFile(
    resolve(process.env.EXPORT_DIR!, exportId + ".csv"),
    "personal export",
  );
  await query(
    "INSERT INTO export_jobs(id,user_id,filters,status,filename) VALUES($1,$2,'{}','completed',$3)",
    [exportId, id, exportId + ".csv"],
  );
  await query(
    "INSERT INTO imports(id,user_id,filename,source_hash,original,rows) VALUES($1,$2,'personal.csv','hash',$3,'[]')",
    [importId, id, Buffer.from(email)],
  );
  await query(
    "INSERT INTO imported_records(source_key,task_id,import_id) VALUES($1,$2,$3)",
    [id, taskId, importId],
  );
  await query(
    "INSERT INTO inventory_items(id,sku,name) VALUES($1,$2,'Pakking')",
    [item, id],
  );
  await query(
    "INSERT INTO inventory_movements(operation_id,item_id,location_id,type,delta,quantity_after,reason,task_id,created_by) VALUES($1,$2,$3,'receipt',1,1,'persoonlijke mutatienotitie',$4,$5)",
    [randomUUID(), item, location, taskId, id],
  );
  await query(
    "INSERT INTO inventory_counts(name,created_by) VALUES('Telling',$1)",
    [id],
  );
  await query(
    "INSERT INTO recurrence_rules(title,config,task_template,created_by) VALUES('Onderhoud','{}',$1,$2)",
    [JSON.stringify({ assignedTo: [id, adminId] }), id],
  );
  await query(
    "INSERT INTO task_templates(name,template,created_by) VALUES('Sjabloon',$1,$2)",
    [JSON.stringify({ title: "Werk", assignedTo: [id] }), id],
  );
  const [season] = await query(
    "INSERT INTO season_templates(name,activities,created_by) VALUES('Seizoen','[]',$1) RETURNING id",
    [id],
  );
  await query(
    "INSERT INTO season_activations(template_id,operation_id,created_by,anchor_date,task_ids,request_hash) VALUES($1,$2,$3,current_date,'[]','hash')",
    [season.id, randomUUID(), id],
  );
  await query(
    "INSERT INTO notifications(id,user_id,kind,title,body) VALUES($1,$2,'task','persoonlijke melding','tekst')",
    [notificationId, id],
  );
  await query(
    "INSERT INTO notification_batches(id,user_id,channel,title,body,payload) VALUES($1,$2,'email','Titel','Body','{}')",
    [batchId, id],
  );
  await query(
    "INSERT INTO notification_deliveries(notification_id,channel,batch_id) VALUES($1,'email',$2)",
    [notificationId, batchId],
  );
  await query(
    "INSERT INTO push_devices(user_id,token,platform) VALUES($1,'ExponentPushToken[private]','ios')",
    [id],
  );
  await query(
    "INSERT INTO user_preferences(user_id,preferences) VALUES($1,'{}')",
    [id],
  );
  await query("INSERT INTO user_capacity(user_id) VALUES($1)", [id]);
  await query(
    "INSERT INTO user_favorites(user_id,type,target_id,saved_name) VALUES($1,'location',$2,'Magazijn')",
    [id, location],
  );
  await query("INSERT INTO notification_preferences(user_id) VALUES($1)", [id]);
  await query(
    "INSERT INTO ai_requests(user_id,state,reserved_units) VALUES($1,'completed',5)",
    [id],
  );
  await query(
    "INSERT INTO integration_tests(user_id,kind,status,message,config_fingerprint) VALUES($1,'smtp','passed','Test','hash')",
    [id],
  );
  await query(
    "INSERT INTO sync_operations(user_id,operation_id,request_hash,response) VALUES($1,'op','hash','{}')",
    [id],
  );
  await query(
    "INSERT INTO inventory_operations(user_id,operation_id,request_hash,result) VALUES($1,$2,'hash','{}')",
    [id, randomUUID()],
  );
  await query(
    "INSERT INTO backup_jobs(id,operation,state,requested_by) VALUES($1,'backup','completed',$2)",
    [jobId, id],
  );
  await query(
    "INSERT INTO backup_restore_checks(job_id,archive_id,source,requested_by,notes) VALUES($1,$2,'local',$3,'persoonlijke controlenotitie')",
    [jobId, randomUUID(), id],
  );
  await query(
    "INSERT INTO backup_check_reminders(reminder_key,user_id) VALUES('test',$1)",
    [id],
  );
  await query(
    "INSERT INTO onedrive_connection(id,client_id,tenant,drive_id,drive_type,connected_by) VALUES(1,'client','consumers','drive','personal',$1)",
    [id],
  );
  await writeSecret("oneDriveRefreshToken", "personal-refresh");
  await query(
    "INSERT INTO onedrive_device_flows(created_by,device_code,client_id,tenant,interval_seconds,expires_at,next_poll_at) VALUES($1,'private-device','client','consumers',5,now()+interval '5 minutes',now())",
    [id],
  );
  await query("UPDATE system_settings SET updated_by=$1", [id]);
  await query(
    "INSERT INTO audit_events(actor_id,entity_type,entity_id,action,details) VALUES($1::uuid,'user',$1::text,'updated',$2),($1::uuid,'task',$3,'created',$2),($4,'task',$3,'updated',$2)",
    [
      id,
      JSON.stringify({ userId: id, email, name: "Private Person" }),
      taskId,
      adminId,
    ],
  );
  await query(
    "INSERT INTO moderation_reports(reporter_id,target_type,target_id,target_author_id,reason,snapshot) VALUES($1,'task',$2,$1,'Eigen melding met persoonlijke toelichting',$3),($4,'task',$2,$1,$5,$3)",
    [
      id,
      taskId,
      JSON.stringify({ email, name: "Private Person" }),
      adminId,
      "Melding over " + email,
    ],
  );
  const app = await createApp();
  await app.listen(0, "127.0.0.1");
  try {
    const base = await app.getUrl();
    const denied = await fetch(base + "/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        confirmation: "VERWIJDER MIJN ACCOUNT",
      }),
    });
    assert.equal(denied.status, 401);
    const response = await fetch(base + "/api/auth/account", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + login.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password,
        confirmation: "VERWIJDER MIJN ACCOUNT",
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result: any = await response.json();
    assert.equal(result.deleted, true);
    assert.equal(result.fileCleanupPending, true);
    assert.equal(
      (await query("SELECT * FROM users WHERE id=$1", [id])).length,
      0,
    );
    assert.equal(
      (
        await fetch(base + "/api/auth/me", {
          headers: { Authorization: "Bearer " + login.token },
        })
      ).status,
      401,
    );
    await assert.rejects(() =>
      auth.refresh({ refreshToken: login.refreshToken }),
    );
    await assert.rejects(() =>
      auth.login({ email, password }, { ip: "privacy" }),
    );
    await assert.rejects(() => stat(resolve(process.env.UPLOAD_DIR!, file)));
    await assert.rejects(() =>
      stat(resolve(process.env.EXPORT_DIR!, exportId + ".csv")),
    );
    assert.equal(
      (await query("SELECT * FROM task_comments WHERE user_id=$1", [id]))
        .length,
      0,
    );
    assert.equal(
      (await query("SELECT * FROM attachments WHERE task_id=$1", [taskId]))
        .length,
      0,
    );
    assert.equal(
      (await query("SELECT * FROM task_schedules WHERE NOT shared")).length,
      0,
    );
    const [anonymous] = await query("SELECT * FROM users WHERE system_account");
    assert.equal(anonymous.active, false);
    assert.equal(anonymous.password_hash, "!");
    assert.ok(
      !(await new UsersController().list()).some(
        (row: any) => row.id === anonymous.id,
      ),
    );
    await assert.rejects(() =>
      new UsersController().update(
        { id: adminId, role: "admin", email: "", name: "" },
        anonymous.id,
        { active: true },
      ),
    );
    const [task] = await query("SELECT * FROM tasks WHERE id=$1", [taskId]);
    assert.equal(task.created_by, anonymous.id);
    assert.deepEqual(task.assigned_to, [adminId]);
    assert.equal(task.checklist[0].completedBy, anonymous.id);
    assert.ok(!task.title.includes(email));
    assert.equal(
      (
        await query("SELECT note FROM time_entries WHERE task_id=$1", [taskId])
      )[0].note,
      "",
    );
    assert.equal(
      (
        await query("SELECT reason FROM inventory_movements WHERE task_id=$1", [
          taskId,
        ])
      )[0].reason,
      "",
    );
    assert.equal(await readSecret("oneDriveRefreshToken"), undefined);
    assert.equal(
      (
        await query("SELECT * FROM moderation_reports WHERE reporter_id=$1", [
          id,
        ])
      ).length,
      0,
    );
    const reports = await query("SELECT * FROM moderation_reports");
    assert.ok(!JSON.stringify(reports).includes(email));
    assert.ok(reports.every((row) => row.target_author_id === null));
    assert.ok(reports.every((row) => JSON.stringify(row.snapshot) === "{}"));
    assert.equal((await query("SELECT * FROM onedrive_connection")).length, 0);
    assert.ok(
      !JSON.stringify(await query("SELECT * FROM audit_events")).includes(
        email,
      ),
    );
    assert.ok(
      !JSON.stringify(await query("SELECT * FROM audit_events")).includes(id),
    );
    await rm(resolve(process.env.UPLOAD_DIR!, blockedFile), {
      recursive: true,
    });
    await writeFile(resolve(process.env.UPLOAD_DIR!, blockedFile), "retry");
    await query("UPDATE privacy_file_cleanup SET next_attempt_at=now()");
    assert.equal((await processPrivacyFileCleanup()).pending, 0);
    await assert.rejects(() =>
      stat(resolve(process.env.UPLOAD_DIR!, blockedFile)),
    );
    // A separate MFA account proves no password-only bypass and reuses the same shared anonymous actor.
    const mfaId = randomUUID(),
      secret = base32(Buffer.from("12345678901234567890"));
    await query(
      "INSERT INTO users(id,email,name,password_hash,role,mfa_enabled,mfa_secret,mfa_last_step,mfa_recovery_hashes) VALUES($1,'mfa-delete@example.invalid','MFA account',$2,'employee',true,$3,$4,$5)",
      [
        mfaId,
        passwordHash(password),
        encryptSecret(secret),
        Math.floor(Date.now() / 30000) + 1,
        [hash("one-time-recovery")],
      ],
    );
    const mfaUser: User = {
      id: mfaId,
      email: "mfa-delete@example.invalid",
      name: "MFA account",
      role: "employee",
    };
    await assert.rejects(() =>
      privacy.remove(mfaUser, {
        password,
        confirmation: "VERWIJDER MIJN ACCOUNT",
      }),
    );
    await assert.rejects(() =>
      privacy.remove(mfaUser, {
        password,
        otp: totp(secret),
        confirmation: "VERWIJDER MIJN ACCOUNT",
      }),
    );
    await privacy.remove(mfaUser, {
      password,
      otp: "one-time-recovery",
      confirmation: "VERWIJDER MIJN ACCOUNT",
    });
    assert.equal(
      (await query("SELECT * FROM users WHERE id=$1", [mfaId])).length,
      0,
    );
    assert.equal(
      (await query("SELECT * FROM users WHERE system_account")).length,
      1,
    );
    console.log("ACCOUNT_PRIVACY_OK");
  } finally {
    await app.close();
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
