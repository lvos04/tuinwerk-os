import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { AuthGuard, CurrentUser, User, passwordMatches, hash } from "./auth";
import { decryptSecret, verifyTotp } from "./totp";
import { query, transaction } from "./db";
const confirmation = "VERWIJDER MIJN ACCOUNT";
const attempts = new Map<string, { count: number; until: number }>();
export const privacyDescription = {
  removed: [
    "Je account, e-mailadres, wachtwoord, tweede factor, sessies en apparaattokens.",
    "Persoonlijke voorkeuren, favorieten, beschikbaarheid, privéplanning, eigen reacties en persoonlijke tijdnotities.",
    "Door jou geüploade bijlagen, persoonlijke exports en opgeslagen importbronbestanden.",
  ],
  retained: [
    "Gedeelde taken, onderhouds- en voorraadregistraties blijven nodig voor de bedrijfsadministratie; persoonsverwijzingen worden vervangen door één algemene anonieme medewerker.",
    "Vrij ingevoerde gedeelde bedrijfsinhoud kan nog namen of andere persoonsgegevens bevatten. De software kan deze niet betrouwbaar automatisch herkennen.",
    "Bestaande versleutelde back-ups en reeds gedownloade bestanden veranderen niet door deze actie. Back-ups blijven volgens het ingestelde bewaarbeleid bestaan; herstel van een oudere back-up kan oude persoonsgegevens terugbrengen.",
  ],
  fileCleanup:
    "Bestandstoegang verdwijnt direct. Fysieke bestandsverwijdering wordt bij een opslagfout automatisch opnieuw geprobeerd.",
  lastAdministrator:
    "Ben je de laatste actieve beheerder, maak dan eerst een andere beheerder aan of draag de rol over.",
};
/** Only trusted, server-generated base names are accepted; queue persists until unlink succeeds. */
export async function processPrivacyFileCleanup(limit = 100) {
  let removed = 0;
  for (let i = 0; i < limit; i++) {
    const result = await transaction(async (c) => {
      const [row] = (
        await c.query(
          "SELECT * FROM privacy_file_cleanup WHERE next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows;
      if (!row) return false;
      const root = resolve(
        row.kind === "upload"
          ? process.env.UPLOAD_DIR || "uploads"
          : process.env.EXPORT_DIR || "exports",
      );
      try {
        if (
          row.filename !== basename(row.filename) ||
          !row.filename ||
          row.filename === "." ||
          row.filename === ".."
        )
          throw new Error("unsafe");
        await unlink(resolve(root, row.filename)).catch((e: any) => {
          if (e.code !== "ENOENT") throw e;
        });
        await c.query("DELETE FROM privacy_file_cleanup WHERE id=$1", [row.id]);
        removed++;
      } catch {
        await c.query(
          "UPDATE privacy_file_cleanup SET attempts=attempts+1,last_error='Bestandsverwijdering mislukt; wordt opnieuw geprobeerd',next_attempt_at=now()+interval '1 minute' WHERE id=$1",
          [row.id],
        );
      }
      return true;
    });
    if (!result) break;
  }
  return {
    removed,
    pending: Number(
      (await query("SELECT count(*) AS count FROM privacy_file_cleanup"))[0]
        .count,
    ),
  };
}
@Controller("auth")
@UseGuards(AuthGuard)
export class AccountPrivacyController {
  @Get("privacy") @Header("Cache-Control", "no-store") async privacy(
    @CurrentUser() u: User,
  ) {
    const [user] = await query(
      "SELECT mfa_enabled,role FROM users WHERE id=$1 AND active AND NOT system_account",
      [u.id],
    );
    if (!user) throw new UnauthorizedException();
    const count = Number(
      (
        await query(
          "SELECT count(*) AS count FROM users WHERE active AND role='admin'",
        )
      )[0].count,
    );
    return {
      confirmation,
      ...privacyDescription,
      mfaRequired: user.mfa_enabled,
      canDelete: !(user.role === "admin" && count <= 1),
    };
  }
  @Delete("account") @Header("Cache-Control", "no-store") async remove(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    if (b.confirmation !== confirmation)
      throw new BadRequestException(
        "Bevestig expliciet met VERWIJDER MIJN ACCOUNT",
      );
    if (typeof b.password !== "string" || b.password.length > 256)
      throw new BadRequestException("Geldig wachtwoord vereist");
    const now = Date.now(),
      old = attempts.get(u.id);
    if (old && old.until > now && old.count >= 5)
      throw new ForbiddenException("Te veel pogingen; probeer over 15 minuten");
    attempts.set(u.id, {
      count: (old && old.until > now ? old.count : 0) + 1,
      until: now + 900000,
    });
    const cleanupIds: number[] = await transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('user-administration'))",
      );
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('onedrive-control'))",
      );
      await c.query("SELECT pg_advisory_xact_lock(hashtext('onedrive-token'))");
      const [user] = (
        await c.query(
          "SELECT * FROM users WHERE id=$1 AND active AND NOT system_account FOR UPDATE",
          [u.id],
        )
      ).rows;
      if (!user || !passwordMatches(b.password, user.password_hash))
        throw new UnauthorizedException(
          "Wachtwoord onjuist of account niet beschikbaar",
        );
      if (user.mfa_enabled) {
        const recovery =
          typeof b.otp === "string" &&
          user.mfa_recovery_hashes.includes(hash(b.otp));
        const step = recovery
          ? null
          : verifyTotp(decryptSecret(user.mfa_secret), b.otp);
        if (!recovery && (step === null || step <= Number(user.mfa_last_step)))
          throw new UnauthorizedException({
            message: "Tweede factor vereist, onjuist of al gebruikt",
            mfaRequired: true,
          });
      }
      if (
        user.role === "admin" &&
        Number(
          (
            await c.query(
              "SELECT count(*) AS count FROM users WHERE active AND role='admin'",
            )
          ).rows[0].count,
        ) <= 1
      )
        throw new ConflictException(
          "Je bent de laatste actieve beheerder. Maak eerst een andere beheerder aan of draag de beheerdersrol over.",
        );
      let [anonymous] = (
        await c.query("SELECT id FROM users WHERE system_account")
      ).rows;
      if (!anonymous)
        [anonymous] = (
          await c.query(
            "INSERT INTO users(id,email,name,password_hash,role,active,system_account) VALUES($1,$2,'Verwijderde medewerker','!','employee',false,true) RETURNING id",
            [randomUUID(), randomUUID() + "@system.invalid"],
          )
        ).rows;
      const anon = anonymous.id;
      const jobs: number[] = [];
      for (const [kind, table, column] of [
        ["upload", "attachments", "storage_name"],
        ["export", "export_jobs", "filename"],
      ] as const) {
        const owner = table === "attachments" ? "uploaded_by" : "user_id";
        for (const row of (
          await c.query(
            `SELECT ${column} AS filename FROM ${table} WHERE ${owner}=$1 AND ${column} IS NOT NULL FOR UPDATE`,
            [u.id],
          )
        ).rows) {
          const [job] = (
            await c.query(
              "INSERT INTO privacy_file_cleanup(kind,filename) VALUES($1,$2) ON CONFLICT(kind,filename) DO UPDATE SET next_attempt_at=now() RETURNING id",
              [kind, row.filename],
            )
          ).rows;
          jobs.push(Number(job.id));
        }
      }
      await c.query("DELETE FROM attachments WHERE uploaded_by=$1", [u.id]);
      await c.query("DELETE FROM export_jobs WHERE user_id=$1", [u.id]);
      await c.query(
        "DELETE FROM imported_records WHERE import_id IN(SELECT id FROM imports WHERE user_id=$1)",
        [u.id],
      );
      await c.query("DELETE FROM imports WHERE user_id=$1", [u.id]);
      await c.query("DELETE FROM notifications WHERE user_id=$1", [u.id]);
      await c.query("DELETE FROM notification_batches WHERE user_id=$1", [
        u.id,
      ]);
      for (const table of [
        "sessions",
        "push_devices",
        "notification_preferences",
        "task_comments",
        "sync_operations",
        "inventory_operations",
        "user_preferences",
        "user_favorites",
        "user_capacity",
        "ai_requests",
        "integration_tests",
        "backup_check_reminders",
      ])
        await c.query(`DELETE FROM ${table} WHERE user_id=$1`, [u.id]);
      await c.query(
        "DELETE FROM task_schedules WHERE user_id=$1 AND NOT shared",
        [u.id],
      );
      await c.query(
        "UPDATE task_schedules SET user_id=CASE WHEN user_id=$1 THEN $2 ELSE user_id END,participants=array_remove(participants,$1),title=CASE WHEN user_id=$1 THEN 'Gedeeld werkblok' ELSE title END,version=version+1 WHERE user_id=$1 OR $1=ANY(participants)",
        [u.id, anon],
      );
      await c.query(
        "UPDATE time_entries SET user_id=$2,note='',ended_at=coalesce(ended_at,now()),minutes=coalesce(minutes,extract(epoch FROM now()-started_at)/60),version=version+1 WHERE user_id=$1",
        [u.id, anon],
      );
      await c.query(
        "UPDATE tasks SET created_by=CASE WHEN created_by=$1 THEN $2 ELSE created_by END,updated_by=CASE WHEN updated_by=$1 THEN $2 ELSE updated_by END,assigned_to=array_remove(assigned_to,$1),version=version+1,updated_at=now() WHERE created_by=$1 OR updated_by=$1 OR $1=ANY(assigned_to)",
        [u.id, anon],
      );
      await c.query(
        "UPDATE inventory_movements SET created_by=$2,reason='' WHERE created_by=$1",
        [u.id, anon],
      );
      for (const table of [
        "inventory_counts",
        "recurrence_rules",
        "season_templates",
        "season_activations",
        "task_templates",
      ])
        await c.query(`UPDATE ${table} SET created_by=$2 WHERE created_by=$1`, [
          u.id,
          anon,
        ]);
      await c.query(
        "UPDATE system_settings SET updated_by=NULL WHERE updated_by=$1",
        [u.id],
      );
      const linked = (
        await c.query(
          "SELECT 1 FROM onedrive_connection WHERE connected_by=$1",
          [u.id],
        )
      ).rowCount;
      if (linked) {
        await c.query("DELETE FROM onedrive_connection WHERE connected_by=$1", [
          u.id,
        ]);
        await c.query(
          "UPDATE system_settings SET secrets=jsonb_set(secrets,'{oneDriveRefreshToken}','null'::jsonb),version=version+1 WHERE id=1",
        );
      }
      await c.query("DELETE FROM onedrive_device_flows WHERE created_by=$1", [
        u.id,
      ]);
      await c.query(
        "UPDATE backup_jobs SET requested_by=$2 WHERE requested_by=$1",
        [u.id, anon],
      );
      await c.query(
        "UPDATE backup_restore_checks SET requested_by=CASE WHEN requested_by=$1 THEN $2 ELSE requested_by END,recorded_by=CASE WHEN recorded_by=$1 THEN NULL ELSE recorded_by END,notes='',task_reference=CASE WHEN recorded_by=$1 THEN '[persoonlijke notitie verwijderd]' ELSE task_reference END,file_reference=CASE WHEN recorded_by=$1 THEN '[persoonlijke notitie verwijderd]' ELSE file_reference END WHERE requested_by=$1 OR recorded_by=$1",
        [u.id, anon],
      );
      await c.query(
        "DELETE FROM audit_events WHERE (entity_type IN ('user','capacity') AND entity_id=$1)",
        [u.id],
      );
      await c.query(
        "UPDATE audit_events SET actor_id=$2,details='{}'::jsonb WHERE actor_id=$1",
        [u.id, anon],
      );
      const jsonColumns = [
        ["tasks", "checklist"],
        ["task_templates", "template"],
        ["recurrence_rules", "task_template"],
        ["season_templates", "activities"],
        ["audit_events", "details"],
        ["notification_batches", "payload"],
        ["backup_jobs", "result"],
        ["backup_jobs", "preparation"],
        ["backup_archives", "manifest"],
        ["locations", "metadata"],
        ["attachments", "annotation"],
      ];
      for (const [table, column] of jsonColumns) {
        if (column === "body") continue;
        await c.query(
          `UPDATE ${table} SET ${column}=privacy_scrub_json(${column},$1,$2,$3,$4) WHERE ${column}::text LIKE $5 OR ${column}::text LIKE $6`,
          [
            u.id,
            user.email,
            user.name,
            anon,
            "%" + u.id + "%",
            "%" + user.email + "%",
          ],
        );
      }
      // Remove exact account identifiers from freely entered shared texts without guessing which ordinary names denote people.
      for (const [table, columns] of [
        ["tasks", ["title", "description", "blocked_reason"]],
        ["task_comments", ["body"]],
        ["assets", ["notes"]],
        ["notifications", ["title", "body"]],
        ["notification_batches", ["title", "body"]],
      ] as Array<[string, string[]]>)
        for (const column of columns)
          await c.query(
            `UPDATE ${table} SET ${column}=replace(replace(${column},$1,$2),$3,'[e-mailadres verwijderd]') WHERE ${column} LIKE $4 OR ${column} LIKE $5`,
            [u.id, anon, user.email, "%" + u.id + "%", "%" + user.email + "%"],
          );
      await c.query("DELETE FROM moderation_reports WHERE reporter_id=$1", [
        u.id,
      ]);
      await c.query(
        "UPDATE moderation_reports SET snapshot='{}'::jsonb,resolution_note=NULL,target_author_id=NULL WHERE target_author_id=$1",
        [u.id],
      );
      await c.query(
        "UPDATE moderation_reports SET resolution_note=NULL,resolved_by=NULL WHERE resolved_by=$1",
        [u.id],
      );
      await c.query(
        "UPDATE moderation_reports SET reason=replace(replace(reason,$1,$2),$3,'[e-mailadres verwijderd]') WHERE strpos(reason,$1)>0 OR strpos(reason,$3)>0",
        [u.id, anon, user.email],
      );
      await c.query("DELETE FROM users WHERE id=$1", [u.id]);
      await c.query(
        "INSERT INTO audit_events(actor_id,entity_type,entity_id,action,details) VALUES($1,'account','anonymous','deleted',$2)",
        [
          anon,
          JSON.stringify({ accountRemoved: true, queuedFiles: jobs.length }),
        ],
      );
      return jobs;
    });
    attempts.delete(u.id);
    try {
      await processPrivacyFileCleanup();
    } catch {}
    const pending = cleanupIds.length
      ? Number(
          (
            await query(
              "SELECT count(*) AS count FROM privacy_file_cleanup WHERE id=ANY($1::bigint[])",
              [cleanupIds],
            )
          )[0].count,
        )
      : 0;
    return {
      deleted: true,
      sharedRecordsAnonymized: true,
      fileCleanupPending: pending > 0,
      message:
        "Je account is verwijderd. Gedeelde bedrijfsregistraties blijven zonder accountkoppeling bewaard. Bestaande back-ups en gedownloade kopieën worden niet met terugwerkende kracht gewijzigd.",
      retained: privacyDescription.retained,
    };
  }
}
