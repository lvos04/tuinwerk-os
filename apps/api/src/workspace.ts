import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { query, camel, audit, transaction } from "./db";
import { idempotent, uuid, validateTask, TasksController } from "./core";
@Controller()
@UseGuards(AuthGuard)
export class WorkspaceController {
  @Get("search") async search(@Query("q") q: string) {
    if (typeof q !== "string" || q.trim().length < 2 || q.length > 200)
      throw new BadRequestException("Zoekterm moet 2–200 tekens bevatten");
    return camel(
      await query(
        `SELECT 'task' AS type,id,title AS name,location_id FROM tasks WHERE status<>'archived' AND (title ILIKE $1 OR description ILIKE $1 OR EXISTS(SELECT 1 FROM task_comments c WHERE c.task_id=tasks.id AND c.body ILIKE $1)) UNION ALL SELECT 'asset',id,name,location_id FROM assets WHERE name ILIKE $1 OR serial_number ILIKE $1 UNION ALL SELECT 'location',id,name,parent_id FROM locations WHERE active AND name ILIKE $1 UNION ALL SELECT 'item',id,name,NULL::uuid FROM inventory_items WHERE active AND (name ILIKE $1 OR sku ILIKE $1) LIMIT 100`,
        ["%" + q.trim() + "%"],
      ),
    );
  }
  @Get("templates") async templates() {
    return camel(
      await query(
        "SELECT * FROM task_templates WHERE active ORDER BY name LIMIT 500",
      ),
    );
  }
  @Post("templates") async create(@CurrentUser() u: User, @Body() b: any) {
    if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 200)
      throw new BadRequestException("Naam verplicht");
    const template = validateTask(b.template || {});
    if (!template.title)
      throw new BadRequestException("Sjabloon vereist een titel");
    return idempotent(u, b, "templates:create", async (c) => {
      const [r] = (
        await c.query(
          "INSERT INTO task_templates(name,template,created_by) VALUES($1,$2,$3) RETURNING *",
          [b.name, JSON.stringify(template), u.id],
        )
      ).rows;
      await audit(c, u.id, "template", r.id, "created");
      return camel(r);
    });
  }
  @Patch("templates/:id") async edit(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    uuid(id);
    return idempotent(u, b, "templates:" + id, async (c) => {
      const [old] = (
        await c.query("SELECT * FROM task_templates WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows;
      if (!old) throw new NotFoundException();
      if (old.version !== b.version)
        throw new ConflictException({
          message: "Sjabloon gewijzigd",
          current: camel(old),
        });
      const name = b.name ?? old.name;
      if (typeof name !== "string" || !name.trim() || name.length > 200)
        throw new BadRequestException("Naam verplicht");
      const template = validateTask(b.template ?? old.template);
      if (!template.title) throw new BadRequestException("Titel verplicht");
      if (b.active !== undefined && typeof b.active !== "boolean")
        throw new BadRequestException("Actief moet ja/nee zijn");
      const [r] = (
        await c.query(
          "UPDATE task_templates SET name=$1,template=$2,active=$3,version=version+1,updated_at=now() WHERE id=$4 RETURNING *",
          [name, JSON.stringify(template), b.active ?? old.active, id],
        )
      ).rows;
      await audit(c, u.id, "template", id, "updated");
      return camel(r);
    });
  }
  @Post("templates/:id/apply") async apply(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    const [r] = await query(
      "SELECT * FROM task_templates WHERE id=$1 AND active",
      [uuid(id)],
    );
    if (!r) throw new NotFoundException();
    return new TasksController().create(u, {
      ...r.template,
      ...(b.overrides || {}),
      operationId: b.operationId,
    });
  }
  @Get("profile/preferences") async preferences(@CurrentUser() u: User) {
    await query(
      "INSERT INTO user_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [u.id],
    );
    return camel(
      (
        await query("SELECT * FROM user_preferences WHERE user_id=$1", [u.id])
      )[0],
    );
  }
  @Patch("profile/preferences") async updatePreferences(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    if (
      !b.preferences ||
      typeof b.preferences !== "object" ||
      Array.isArray(b.preferences) ||
      JSON.stringify(b.preferences).length > 50000
    )
      throw new BadRequestException("Ongeldige voorkeuren");
    const [r] = await query(
      "UPDATE user_preferences SET preferences=$1,version=version+1,updated_at=now() WHERE user_id=$2 AND version=$3 RETURNING *",
      [JSON.stringify(b.preferences), u.id, b.version],
    );
    if (!r)
      throw new ConflictException({
        message: "Voorkeuren gewijzigd; laad opnieuw",
        current: await this.preferences(u),
      });
    return camel(r);
  }
  @Delete("admin/data/:type/:id") @UseGuards(AdminGuard) async remove(
    @CurrentUser() u: User,
    @Param("type") type: string,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    uuid(id);
    if (b.confirm !== id || typeof b.reason !== "string" || !b.reason.trim())
      throw new BadRequestException("Bevestig met record-ID en reden");
    const tables: Record<string, { table: string; condition: string }> = {
      task: { table: "tasks", condition: "status='archived'" },
      asset: { table: "assets", condition: "status='archived'" },
      location: { table: "locations", condition: "active=false" },
      item: { table: "inventory_items", condition: "active=false" },
    };
    if (!tables[type]) throw new BadRequestException("Onbekend gegevenstype");
    const { table, condition } = tables[type];
    return transaction(async (c) => {
      const [r] = (
        await c.query(
          `SELECT * FROM ${table} WHERE id=$1 AND ${condition} FOR UPDATE`,
          [id],
        )
      ).rows;
      if (!r) throw new BadRequestException("Archiveer het record eerst");
      if (
        type === "task" &&
        (await c.query("SELECT 1 FROM tasks WHERE $1=ANY(dependencies)", [id]))
          .rowCount
      )
        throw new ConflictException(
          "Taak is een afhankelijkheid; historische verwijzingen blijven behouden",
        );
      try {
        await c.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
      } catch (e: any) {
        if (e.code === "23503")
          throw new ConflictException(
            "Record wordt nog gebruikt; historische verwijzingen blijven behouden",
          );
        throw e;
      }
      await audit(c, u.id, type, id, "permanently_deleted", {
        reason: b.reason,
        record: r,
      });
      return { ok: true };
    });
  }
}
