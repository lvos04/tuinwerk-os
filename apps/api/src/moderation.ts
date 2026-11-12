import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { audit, camel, query, transaction } from "./db";
const tables: Record<string, { table: string; author: string; field: string }> =
  {
    task: { table: "tasks", author: "created_by", field: "title" },
    comment: { table: "task_comments", author: "user_id", field: "body" },
    attachment: { table: "attachments", author: "uploaded_by", field: "name" },
  };
function id(value: any) {
  if (
    typeof value !== "string" ||
    !/^([a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(
      value,
    )
  )
    throw new BadRequestException("Ongeldige identificatie");
  return value;
}
function reason(value: any, label = "Reden") {
  if (
    typeof value !== "string" ||
    value.trim().length < 10 ||
    value.length > 2000
  )
    throw new BadRequestException(label + " moet 10–2000 tekens bevatten");
  return value.trim();
}
export function normalizeModerationText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/<[^>]*>/g, "")
    .toLocaleLowerCase("nl-NL")
    .replace(/\s+/g, " ")
    .trim();
}
export function containsProhibitedText(value: string, phrases: string[]) {
  const normalized = normalizeModerationText(value);
  return phrases.some((phrase) =>
    normalized.includes(normalizeModerationText(phrase)),
  );
}
/** Configurable phrase filtering, not an image classifier or a guarantee of complete abuse detection. */
export async function moderateText(value: unknown) {
  if (typeof value !== "string" || !value) return;
  const settings = (
    await query("SELECT prohibited_phrases FROM moderation_settings WHERE id=1")
  )[0];
  if (settings && containsProhibitedText(value, settings.prohibited_phrases))
    throw new BadRequestException(
      "Deze tekst bevat inhoud die in deze werkruimte niet is toegestaan. Pas de tekst aan of neem contact op met de beheerder.",
    );
}
@Controller("moderation")
@UseGuards(AuthGuard)
export class ModerationController {
  @Post("reports") async report(@CurrentUser() u: User, @Body() b: any) {
    const target =
      typeof b.targetType === "string" && Object.hasOwn(tables, b.targetType)
        ? tables[b.targetType]
        : undefined;
    if (!target) throw new BadRequestException("Kies taak, reactie of bijlage");
    id(b.targetId);
    const text = reason(b.reason);
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "moderation-report:" + u.id,
      ]);
      const previous = (
        await c.query(
          "SELECT id,target_type,target_id,reason,status,version,created_at FROM moderation_reports WHERE reporter_id=$1 AND target_type=$2 AND target_id=$3 AND status='open'",
          [u.id, b.targetType, b.targetId],
        )
      ).rows[0];
      if (previous) return camel(previous);
      if (
        Number(
          (
            await c.query(
              "SELECT count(*) count FROM moderation_reports WHERE reporter_id=$1 AND created_at>now()-interval '1 hour'",
              [u.id],
            )
          ).rows[0].count,
        ) >= 30
      )
        throw new BadRequestException(
          "Je hebt al veel meldingen ingediend. Neem voor dringende zaken contact op met de beheerder.",
        );
      const row = (
        await c.query(
          `SELECT * FROM ${target.table} WHERE id=$1 AND NOT moderation_hidden FOR SHARE`,
          [b.targetId],
        )
      ).rows[0];
      if (!row) throw new NotFoundException("Inhoud is niet beschikbaar");
      if (row.task_id) {
        const parent = (
          await c.query("SELECT moderation_hidden FROM tasks WHERE id=$1", [
            row.task_id,
          ])
        ).rows[0];
        if (parent?.moderation_hidden)
          throw new NotFoundException("Inhoud is niet beschikbaar");
      }
      const snapshot = {
        label: String(row[target.field] || "").slice(0, 10000),
        ...(b.targetType === "task"
          ? { description: String(row.description || "").slice(0, 10000) }
          : {}),
        ...(row.task_id ? { taskId: row.task_id } : {}),
      };
      const result = (
        await c.query(
          "INSERT INTO moderation_reports(reporter_id,target_type,target_id,target_author_id,reason,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,target_type,target_id,reason,status,version,created_at",
          [
            u.id,
            b.targetType,
            b.targetId,
            row[target.author],
            text,
            JSON.stringify(snapshot),
          ],
        )
      ).rows[0];
      await audit(c, u.id, "moderation_report", result.id, "reported", {
        targetType: b.targetType,
        targetId: b.targetId,
      });
      await c.query(
        "INSERT INTO notifications(user_id,kind,title,body,entity_id) SELECT id,'moderation','Nieuwe inhoudsmelding','Een medewerker heeft inhoud gemeld. Beoordeel de melding in Beheer → Moderatie.',$1 FROM users WHERE active AND role='admin'",
        [result.id],
      );
      return camel(result);
    });
  }
  @Get("reports") async reports(@CurrentUser() u: User) {
    if (u.role === "admin")
      return camel(
        await query(
          "SELECT r.*,u.name AS reporter_name,a.name AS target_author_name,a.active AS target_author_active FROM moderation_reports r LEFT JOIN users u ON u.id=r.reporter_id LEFT JOIN users a ON a.id=r.target_author_id ORDER BY (r.status='open') DESC,r.created_at DESC LIMIT 500",
        ),
      );
    return camel(
      await query(
        "SELECT id,target_type,target_id,reason,status,version,created_at,resolved_at,resolution_note FROM moderation_reports WHERE reporter_id=$1 ORDER BY created_at DESC LIMIT 100",
        [u.id],
      ),
    );
  }
  @Get("settings") @UseGuards(AdminGuard) async settings() {
    return camel(
      (
        await query(
          "SELECT version,prohibited_phrases,updated_at FROM moderation_settings WHERE id=1",
        )
      )[0],
    );
  }
  @Put("settings") @UseGuards(AdminGuard) async configure(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    if (
      !Number.isInteger(b.version) ||
      !Array.isArray(b.prohibitedPhrases) ||
      b.prohibitedPhrases.length > 200 ||
      b.prohibitedPhrases.some(
        (p: any) =>
          typeof p !== "string" || p.trim().length < 3 || p.length > 100,
      )
    )
      throw new BadRequestException(
        "Geef maximaal 200 woorden/zinnen van 3–100 tekens op",
      );
    const phrases = [
      ...new Set(
        b.prohibitedPhrases.map((p: string) => normalizeModerationText(p)),
      ),
    ];
    return transaction(async (c) => {
      const result = (
        await c.query(
          "UPDATE moderation_settings SET prohibited_phrases=$1,version=version+1,updated_by=$2,updated_at=now() WHERE id=1 AND version=$3 RETURNING version,prohibited_phrases,updated_at",
          [JSON.stringify(phrases), u.id, b.version],
        )
      ).rows[0];
      if (!result)
        throw new ConflictException(
          "Filterinstellingen gewijzigd; laad opnieuw",
        );
      await audit(c, u.id, "moderation", "settings", "filter_updated", {
        phraseCount: phrases.length,
      });
      return camel(result);
    });
  }
  @Post("reports/:id/resolve") @UseGuards(AdminGuard) async resolve(
    @CurrentUser() u: User,
    @Param("id") reportId: string,
    @Body() b: any,
  ) {
    id(reportId);
    if (!["dismiss", "hide", "restore"].includes(b.action))
      throw new BadRequestException("Kies sluiten, verbergen of herstellen");
    const note = reason(b.note, "Beoordeling");
    return transaction(async (c) => {
      const report = (
        await c.query(
          "SELECT * FROM moderation_reports WHERE id=$1 FOR UPDATE",
          [reportId],
        )
      ).rows[0];
      if (!report) throw new NotFoundException();
      if (report.version !== b.version)
        throw new ConflictException("Melding is gewijzigd; laad opnieuw");
      const target = tables[report.target_type];
      if (b.action !== "dismiss") {
        const hidden = b.action === "hide";
        const targetRow = (
          await c.query(
            `UPDATE ${target.table} SET moderation_hidden=$2${report.target_type === "task" ? ",version=version+1,updated_at=now()" : ""} WHERE id=$1 RETURNING id`,
            [report.target_id, hidden],
          )
        ).rows[0];
        if (!targetRow)
          throw new NotFoundException(
            "De oorspronkelijke inhoud bestaat niet meer",
          );
        if (report.target_type === "task")
          await c.query(
            "UPDATE notifications SET moderation_hidden=$2 WHERE entity_id=$1",
            [report.target_id, hidden],
          );
      }
      const status = {
        dismiss: "dismissed",
        hide: "hidden",
        restore: "restored",
      }[b.action as "dismiss" | "hide" | "restore"];
      const result = (
        await c.query(
          "UPDATE moderation_reports SET status=$2,resolution_note=$3,resolved_by=$4,resolved_at=now(),version=version+1 WHERE id=$1 RETURNING *",
          [reportId, status, note, u.id],
        )
      ).rows[0];
      await audit(
        c,
        u.id,
        "moderation_report",
        reportId,
        "resolved:" + b.action,
        { targetType: report.target_type, targetId: report.target_id, note },
      );
      if (report.reporter_id)
        await c.query(
          "INSERT INTO notifications(user_id,kind,title,body,entity_id) VALUES($1,'moderation','Je inhoudsmelding is beoordeeld','Bekijk de status en toelichting bij je meldingen.',$2)",
          [report.reporter_id, reportId],
        );
      return camel(result);
    });
  }
  @Post("users/:id/block") @UseGuards(AdminGuard) async block(
    @CurrentUser() u: User,
    @Param("id") userId: string,
    @Body() b: any,
  ) {
    id(userId);
    const explanation = reason(b.reason);
    if (userId === u.id)
      throw new BadRequestException(
        "Je kunt je eigen account hier niet blokkeren",
      );
    return transaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('user-administration'))",
      );
      const actor = (
        await c.query(
          "SELECT id FROM users WHERE id=$1 AND active AND role='admin'",
          [u.id],
        )
      ).rows[0];
      if (!actor)
        throw new BadRequestException("Beheerderssessie is niet meer geldig");
      const target = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [userId])
      ).rows[0];
      if (!target) throw new NotFoundException();
      if (target.role === "admin" && target.active) {
        const count = Number(
          (
            await c.query(
              "SELECT count(*) count FROM users WHERE active AND role='admin'",
            )
          ).rows[0].count,
        );
        if (count <= 1)
          throw new BadRequestException(
            "De laatste beheerder moet actief blijven",
          );
      }
      await c.query("UPDATE users SET active=false WHERE id=$1", [userId]);
      await c.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
      await audit(c, u.id, "user", userId, "moderation_blocked", {
        reason: explanation,
      });
      return { id: userId, active: false };
    });
  }
}
