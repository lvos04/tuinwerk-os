import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, pool } from "../src/db";
import { passwordHash } from "../src/auth";
import { createApp } from "../src/main";
import { containsProhibitedText } from "../src/moderation";
after(() => pool.end());
test("Phrase filter normalizes case, invisible characters and rich-text tags", () => {
  assert.equal(containsProhibitedText("KＡＮKERHOER", ["kankerhoer"]), true);
  assert.equal(
    containsProhibitedText("ka\u200bnkerhoer", ["kankerhoer"]),
    true,
  );
  assert.equal(
    containsProhibitedText("<b>kill</b>  yourself", ["kill yourself"]),
    true,
  );
  assert.equal(
    containsProhibitedText("Pomp reinigen en vervangen", ["kill yourself"]),
    false,
  );
});
test(
  "Private moderation: scoped reports, filtered posting, immediate quarantine and revoked abusive accounts",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      users: Record<string, any> = {},
      tokens: Record<string, string> = {};
    const oldSettings = (
      await query("SELECT * FROM moderation_settings WHERE id=1")
    )[0];
    const phrase = "testblocked-" + randomUUID();
    const call = (path: string, who?: string, body?: any, method?: string) =>
      fetch(base + "/api" + path, {
        method: method || (body ? "POST" : "GET"),
        headers: {
          ...(who ? { Authorization: "Bearer " + tokens[who] } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    try {
      for (const who of ["admin", "author", "reporter"]) {
        const email = randomUUID() + "@moderation.test";
        users[who] = (
          await query(
            "INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *",
            [
              email,
              who,
              passwordHash("Moderation test password!"),
              who === "admin" ? "admin" : "employee",
            ],
          )
        )[0];
        tokens[who] = (
          (await (
            await call("/auth/login", undefined, {
              email,
              password: "Moderation test password!",
            })
          ).json()) as any
        ).token;
      }
      assert.equal((await call("/moderation/reports")).status, 401);
      assert.equal((await call("/moderation/settings", "author")).status, 403);
      const setting = (await (
        await call("/moderation/settings", "admin")
      ).json()) as any;
      assert.equal(
        (
          await call(
            "/moderation/settings",
            "admin",
            { version: setting.version, prohibitedPhrases: [phrase] },
            "PUT",
          )
        ).status,
        200,
      );
      assert.equal(
        (await call("/tasks", "author", { title: "Title " + phrase })).status,
        400,
      );
      assert.equal(
        (
          await call("/moderation/reports", "author", {
            targetType: "__proto__",
            targetId: randomUUID(),
            reason: "Invalid target test",
          })
        ).status,
        400,
      );
      const rule = (await (
        await call("/recurrences", "author", {
          title: "Allowed rule",
          config: { frequency: "daily", startDate: "2030-01-01" },
          taskTemplate: { title: "Allowed generated task" },
        })
      ).json()) as any;
      assert.ok(rule.id);
      assert.equal(
        (
          await call(
            "/recurrences/" + rule.id,
            "author",
            {
              version: rule.version,
              taskTemplate: { title: phrase },
            },
            "PATCH",
          )
        ).status,
        400,
        "template edits cannot bypass task text policy",
      );
      assert.equal(
        (
          await call("/seasons", "author", {
            name: "Season",
            activities: [{ title: phrase, offsetDays: 0 }],
          })
        ).status,
        400,
        "season templates apply the same policy",
      );
      const task = (await (
        await call("/tasks", "author", {
          title: "Moderation task " + randomUUID(),
          operationId: randomUUID(),
        })
      ).json()) as any;
      assert.equal(
        (
          await call("/tasks/" + task.id + "/comments", "author", {
            body: phrase,
          })
        ).status,
        400,
      );
      const comment = (await (
        await call("/tasks/" + task.id + "/comments", "author", {
          body: "Reported comment example",
        })
      ).json()) as any;
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array([255, 216, 255, 224, 0, 0])]),
        "review.jpg",
      );
      form.append("taskId", task.id);
      form.append("operationId", randomUUID());
      const upload = await fetch(base + "/api/attachments", {
        method: "POST",
        headers: { Authorization: "Bearer " + tokens.author },
        body: form,
      });
      assert.equal(upload.status, 201);
      const attachment = (await upload.json()) as any;
      const attachmentReport = (await (
        await call("/moderation/reports", "reporter", {
          targetType: "attachment",
          targetId: attachment.id,
          reason: "Deze bijlage moet worden beoordeeld",
        })
      ).json()) as any;
      const repeated = (await (
        await call("/moderation/reports", "reporter", {
          targetType: "attachment",
          targetId: attachment.id,
          reason: "Deze bijlage moet worden beoordeeld",
        })
      ).json()) as any;
      assert.equal(repeated.id, attachmentReport.id);
      const ownReports = (await (
        await call("/moderation/reports", "reporter")
      ).json()) as any[];
      assert.ok(ownReports.some((row) => row.id === attachmentReport.id));
      assert.ok(
        ownReports.every(
          (row) => !("snapshot" in row) && !("reporterName" in row),
        ),
      );
      const authorReports = (await (
        await call("/moderation/reports", "author")
      ).json()) as any[];
      assert.ok(!authorReports.some((row) => row.id === attachmentReport.id));
      assert.equal(
        (
          await call(
            "/moderation/reports/" + attachmentReport.id + "/resolve",
            "author",
            {
              version: attachmentReport.version,
              action: "hide",
              note: "Unauthorised hide attempt",
            },
          )
        ).status,
        403,
      );
      const hidden = await call(
        "/moderation/reports/" + attachmentReport.id + "/resolve",
        "admin",
        {
          version: attachmentReport.version,
          action: "hide",
          note: "Quarantaine na beoordeling",
        },
      );
      assert.equal(hidden.status, 201);
      assert.equal(
        (await call("/attachments/" + attachment.id + "/file", "author"))
          .status,
        404,
      );
      assert.equal(
        (await call("/attachments/" + attachment.id + "/file", "admin")).status,
        404,
        "ordinary admin downloads cannot bypass quarantine",
      );
      const media = (await (
        await call("/attachments?taskId=" + task.id, "reporter")
      ).json()) as any[];
      assert.ok(!media.some((row) => row.id === attachment.id));
      const commentReport = (await (
        await call("/moderation/reports", "reporter", {
          targetType: "comment",
          targetId: comment.id,
          reason: "Reactie bevat ongewenste inhoud",
        })
      ).json()) as any;
      assert.equal(
        (
          await call(
            "/moderation/reports/" + commentReport.id + "/resolve",
            "admin",
            {
              version: commentReport.version,
              action: "hide",
              note: "Reactie verborgen na beoordeling",
            },
          )
        ).status,
        201,
      );
      const comments = (await (
        await call("/tasks/" + task.id + "/comments", "reporter")
      ).json()) as any[];
      assert.ok(!comments.some((row) => row.id === comment.id));
      const taskReport = (await (
        await call("/moderation/reports", "reporter", {
          targetType: "task",
          targetId: task.id,
          reason: "Taakinhoud moet worden beoordeeld",
        })
      ).json()) as any;
      assert.equal(
        (
          await call(
            "/moderation/reports/" + taskReport.id + "/resolve",
            "admin",
            {
              version: taskReport.version,
              action: "hide",
              note: "Taak verborgen na beoordeling",
            },
          )
        ).status,
        201,
      );
      assert.equal((await call("/tasks/" + task.id, "reporter")).status, 404);
      assert.equal(
        (await call("/tasks/" + task.id + "/comments", "reporter")).status,
        404,
      );
      const exported = await (
        await call("/reports/export?format=csv", "reporter")
      ).text();
      assert.equal(
        exported.includes(task.title),
        false,
        "exports cannot reveal quarantined task",
      );
      const queue = (await (
        await call("/moderation/reports", "admin")
      ).json()) as any[];
      const review = queue.find((row) => row.id === taskReport.id);
      assert.equal(review.targetAuthorId, users.author.id);
      assert.equal(review.snapshot.label, task.title);
      assert.equal(
        (
          await call(
            "/moderation/users/" + users.admin.id + "/block",
            "admin",
            { reason: "Self blocking must be rejected" },
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await call(
            "/moderation/users/" + users.author.id + "/block",
            "reporter",
            { reason: "Only administrators can block" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await call(
            "/moderation/users/" + users.author.id + "/block",
            "admin",
            { reason: "Account blocked after repeated abuse" },
          )
        ).status,
        201,
      );
      assert.equal(
        (await call("/auth/me", "author")).status,
        401,
        "block revokes sessions immediately",
      );
    } finally {
      await query(
        "UPDATE moderation_settings SET prohibited_phrases=$1,version=version+1 WHERE id=1",
        [JSON.stringify(oldSettings.prohibited_phrases)],
      );
      await app.close();
    }
  },
);
