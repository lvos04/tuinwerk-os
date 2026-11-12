import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TasksController } from "../src/core";
import { WorkspaceController } from "../src/workspace";
import { AttachmentsController } from "../src/attachments";
import { ProductivityController } from "../src/productivity";
import { query, pool } from "../src/db";
import { User } from "../src/auth";
after(() => pool.end());
test(
  "hidden task/comment/media cannot be read through normal routes, search or idempotency replay",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const id = randomUUID(),
      u: User = {
        id,
        email: id + "@visibility.invalid",
        name: "Test",
        role: "employee",
      };
    await query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,'Test','unused','employee')",
      [id, u.email],
    );
    const tasks = new TasksController(),
      workspace = new WorkspaceController(),
      attachments = new AttachmentsController();
    const operationId = randomUUID(),
      title = "Visibility " + randomUUID(),
      payload = {
        title,
        category: "onderhoud",
        deadline: "2025-02-03T12:00:00Z",
        assignedTo: [id],
        operationId,
      };
    const task = await tasks.create(u, payload);
    const comment = await tasks.comment(u, task.id, {
      body: "Review comment",
      operationId: randomUUID(),
    });
    await query("UPDATE task_comments SET moderation_hidden=true WHERE id=$1", [
      comment.id,
    ]);
    assert.equal((await tasks.comments(task.id)).length, 0);
    const fileId = randomUUID();
    await query(
      "INSERT INTO attachments(id,task_id,uploaded_by,name,storage_name,mime_type,size,hash) VALUES($1,$2,$3,'test.jpg',$4,'image/jpeg',3,'hash')",
      [fileId, task.id, id, randomUUID()],
    );
    assert.equal((await attachments.list({ taskId: task.id })).length, 1);
    await query("UPDATE tasks SET moderation_hidden=true WHERE id=$1", [
      task.id,
    ]);
    await assert.rejects(() => tasks.detail(task.id));
    await assert.rejects(() => tasks.comments(task.id));
    await assert.rejects(() => tasks.history(task.id));
    await assert.rejects(() => tasks.create(u, payload));
    await assert.rejects(() =>
      tasks.update(u, task.id, { version: 1, title: "Changed" }),
    );
    await assert.rejects(() =>
      tasks.comment(u, task.id, { body: "Not allowed" }),
    );
    assert.equal((await tasks.list({ q: title })).length, 0);
    assert.equal((await workspace.search(title)).length, 0);
    assert.equal((await attachments.list({ taskId: task.id })).length, 0);
    await assert.rejects(() => attachments.file(fileId, {} as any));
    const capacity = await new ProductivityController().capacity(u, {
      from: "2025-02-03",
      to: "2025-02-03",
      userId: id,
    });
    assert.equal(capacity.overdueMaintenance.count, 0);
  },
);
