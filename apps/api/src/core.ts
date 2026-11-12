import { moderateText } from "./moderation";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { AuthGuard, CurrentUser, User, hash } from "./auth";
import { query, transaction, camel, audit } from "./db";
export function uuid(v: any, label = "ID") {
  if (
    typeof v !== "string" ||
    !v.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  )
    throw new BadRequestException(`${label} is ongeldig`);
  return v;
}
function text(v: any, label: string, max = 10000) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new BadRequestException(
      `${label} is verplicht (maximaal ${max} tekens)`,
    );
  return v.trim();
}
function date(v: any) {
  if (v !== null && (typeof v !== "string" || !Number.isFinite(Date.parse(v))))
    throw new BadRequestException("Ongeldige datum");
  return v;
}
export async function idempotent<T>(
  u: User,
  b: any,
  route: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(async (c) => {
    if (b.operationId) {
      text(b.operationId, "Operatie-ID", 200);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        u.id + ":" + b.operationId,
      ]);
      const [old] = (
        await c.query(
          "SELECT * FROM sync_operations WHERE user_id=$1 AND operation_id=$2",
          [u.id, b.operationId],
        )
      ).rows;
      if (old) {
        if (old.request_hash !== hash(JSON.stringify({ route, b })))
          throw new ConflictException(
            "Operatie-ID is al gebruikt voor andere gegevens",
          );
        if (old.response?.id) {
          let blocked = false;
          if (route.startsWith("tasks:"))
            blocked = !!(
              await c.query(
                "SELECT 1 FROM tasks WHERE id=$1 AND moderation_hidden",
                [old.response.id],
              )
            ).rowCount;
          if (route.startsWith("comment:"))
            blocked = !!(
              await c.query(
                "SELECT 1 FROM task_comments c JOIN tasks t ON t.id=c.task_id WHERE c.id=$1 AND (c.moderation_hidden OR t.moderation_hidden)",
                [old.response.id],
              )
            ).rowCount;
          if (
            route.startsWith("attachments:") ||
            route.startsWith("annotation:")
          )
            blocked = !!(
              await c.query(
                "SELECT 1 FROM attachments a LEFT JOIN tasks t ON t.id=a.task_id WHERE a.id=$1 AND (a.moderation_hidden OR coalesce(t.moderation_hidden,false))",
                [old.response.id],
              )
            ).rowCount;
          if (blocked) throw new NotFoundException("Inhoud niet beschikbaar");
        }
        return old.response;
      }
    }
    const result = await fn(c);
    if (b.operationId)
      await c.query(
        "INSERT INTO sync_operations(user_id,operation_id,request_hash,response) VALUES($1,$2,$3,$4)",
        [
          u.id,
          b.operationId,
          hash(JSON.stringify({ route, b })),
          JSON.stringify(result),
        ],
      );
    return result;
  });
}
export function validateTask(b: any) {
  const out: any = {};
  const strings = ["title", "description", "category", "blockedReason"];
  for (const k of strings)
    if (k in b) {
      if (typeof b[k] !== "string" || b[k].length > 20000)
        throw new BadRequestException(`Ongeldig veld: ${k}`);
      out[k] = b[k];
    }
  if ("title" in out) out.title = text(out.title, "Titel", 300);
  for (const k of ["locationId", "assetId"])
    if (k in b) out[k] = b[k] === null ? null : uuid(b[k], k);
  for (const k of ["availableFrom", "plannedAt", "deadline"])
    if (k in b) out[k] = date(b[k]);
  if ("priority" in b) {
    if (!["low", "normal", "high", "critical"].includes(b.priority))
      throw new BadRequestException("Ongeldige prioriteit");
    out.priority = b.priority;
  }
  if ("assignedTo" in b || "dependencies" in b)
    for (const k of ["assignedTo", "dependencies"])
      if (k in b) {
        if (!Array.isArray(b[k]) || b[k].length > 100)
          throw new BadRequestException("Ongeldige lijst");
        out[k] = [...new Set(b[k].map((x: any) => uuid(x)))];
      }
  if ("tags" in b) {
    if (
      !Array.isArray(b.tags) ||
      b.tags.some((x: any) => typeof x !== "string" || x.length > 100)
    )
      throw new BadRequestException("Ongeldige tags");
    out.tags = b.tags;
  }
  if ("estimatedMinutes" in b) {
    if (
      b.estimatedMinutes !== null &&
      (!Number.isInteger(b.estimatedMinutes) || b.estimatedMinutes < 0)
    )
      throw new BadRequestException("Ongeldige tijdsduur");
    out.estimatedMinutes = b.estimatedMinutes;
  }
  if ("checklist" in b) {
    if (!Array.isArray(b.checklist) || b.checklist.length > 200)
      throw new BadRequestException("Ongeldige checklist");
    out.checklist = b.checklist.map((x: any) => ({
      id: x.id ? text(x.id, "Checklist-ID", 100) : randomUUID(),
      text: text(x.text, "Checklisttekst", 1000),
      required: !!x.required,
      done: !!x.done,
    }));
  }
  return out;
}
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
export function statusChange(old: any, b: any) {
  const next = b.status || old.status;
  if (
    next === "completed" &&
    (b.checklist || old.checklist).some((x: any) => x.required && !x.done)
  )
    throw new BadRequestException("Verplichte checklist is nog niet afgerond");
  if (!b.status || next === old.status) return;
  if (
    ![
      "open",
      "planned",
      "in_progress",
      "blocked",
      "completed",
      "cancelled",
      "archived",
    ].includes(next)
  )
    throw new BadRequestException("Ongeldige status");
  if (old.status === "archived")
    throw new BadRequestException("Gearchiveerde taak is alleen-lezen");
  if (old.status === "completed" && next !== "archived" && next !== "open")
    throw new BadRequestException("Gebruik heropenen naar Open");
  if (old.status === "cancelled" && next !== "archived" && next !== "open")
    throw new BadRequestException("Heropen eerst de taak");
  if (
    (next === "blocked" ||
      (["completed", "cancelled"].includes(old.status) && next === "open")) &&
    !b.reason?.trim()
  )
    throw new BadRequestException("Een reden is verplicht");
  if (
    next === "completed" &&
    (b.checklist || old.checklist).some((x: any) => x.required && !x.done)
  )
    throw new BadRequestException("Verplichte checklist is nog niet afgerond");
}
async function references(c: PoolClient, b: any) {
  if (b.assignedTo?.length) {
    const { rowCount } = await c.query(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) AND active=true FOR SHARE",
      [b.assignedTo],
    );
    if (rowCount !== b.assignedTo.length)
      throw new BadRequestException("Onbekende of inactieve medewerker");
  }
  if (b.dependencies?.length) {
    const { rowCount } = await c.query(
      "SELECT id FROM tasks WHERE id=ANY($1::uuid[]) AND NOT moderation_hidden FOR SHARE",
      [b.dependencies],
    );
    if (rowCount !== b.dependencies.length)
      throw new BadRequestException("Onbekende afhankelijke taak");
  }
}
@Controller("tasks")
@UseGuards(AuthGuard)
export class TasksController {
  @Get() async list(@Query() q: any) {
    const args: any[] = [];
    const where: string[] = ["moderation_hidden=false"];
    const add = (s: string, v: any) => {
      args.push(v);
      where.push(s.replace("?", `$${args.length}`));
    };
    if (q.status) add("status=?", q.status);
    else where.push("status<>'archived'");
    if (q.priority) add("priority=?", q.priority);
    if (q.category) add("category=?", q.category);
    if (q.tag) add("?=ANY(tags)", q.tag);
    if (q.unassigned === "true") where.push("cardinality(assigned_to)=0");
    if (q.overdue === "true")
      where.push(
        "deadline<now() AND status NOT IN ('completed','cancelled','archived')",
      );
    if (q.from) add("created_at>=?", date(q.from));
    if (q.to) add("created_at<=?", date(q.to));
    if (q.assignedTo) add("?=ANY(assigned_to)", uuid(q.assignedTo));
    if (q.assetId) add("asset_id=?", uuid(q.assetId));
    if (q.locationId) add("location_id=?", uuid(q.locationId));
    if (q.q) add("(title||' '||description) ILIKE ?", "%" + q.q + "%");
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100)),
      offset = Math.max(0, Number(q.offset) || 0);
    args.push(limit, offset);
    return camel(
      await query(
        `SELECT * FROM tasks WHERE ${where.join(" AND ") || "true"} ORDER BY created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
        args,
      ),
    );
  }
  @Get(":id") async detail(@Param("id") id: string) {
    const [t] = await query(
      "SELECT * FROM tasks WHERE id=$1 AND NOT moderation_hidden",
      [uuid(id)],
    );
    if (!t) throw new NotFoundException("Taak niet gevonden");
    return camel(t);
  }
  @Post() async create(@CurrentUser() u: User, @Body() b: any) {
    const v = validateTask(b);
    await moderateText(
      [
        v.title,
        v.description,
        b.reason,
        ...(v.checklist || []).map((line: any) => line.text),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    text(v.title, "Titel", 300);
    return idempotent(u, b, "tasks:create", async (c) => {
      await references(c, v);
      const fields = {
        id: b.id ? uuid(b.id) : randomUUID(),
        ...v,
        createdBy: u.id,
        updatedBy: u.id,
      };
      const keys = Object.keys(fields);
      const values = Object.values(fields).map((v, i) =>
        keys[i] === "checklist" ? JSON.stringify(v) : v,
      );
      const [row] = (
        await c.query(
          `INSERT INTO tasks(${keys.map(snake).join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
          values,
        )
      ).rows;
      await audit(c, u.id, "task", row.id, "created");
      await notify(
        c,
        row.assigned_to,
        "task_assigned",
        "Nieuwe taak: " + row.title,
        row.id,
        row.priority === "critical",
      );
      return camel(row);
    });
  }
  @Patch(":id") async update(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    uuid(id);
    const v = validateTask(b);
    await moderateText(
      [
        v.title,
        v.description,
        b.reason,
        ...(v.checklist || []).map((line: any) => line.text),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return idempotent(u, b, "tasks:" + id, async (c) => {
      if (v.dependencies)
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext('task-dependencies'))",
        );
      const [old] = (
        await c.query(
          "SELECT * FROM tasks WHERE id=$1 AND NOT moderation_hidden FOR UPDATE",
          [id],
        )
      ).rows;
      if (!old) throw new NotFoundException("Taak niet gevonden");
      if (b.version !== old.version)
        throw new ConflictException({
          message: "Taak is gewijzigd; controleer de nieuwe versie",
          current: camel(old),
        });
      if (old.status === "archived")
        throw new BadRequestException("Gearchiveerde taak is alleen-lezen");
      statusChange(old, { ...b, ...v });
      await references(c, v);
      if (v.dependencies?.includes(id))
        throw new BadRequestException("Taak kan niet van zichzelf afhangen");
      if (v.dependencies?.length) {
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext('task-dependencies'))",
        );
        const cycles = (
          await c.query(
            "WITH RECURSIVE chain AS (SELECT id,dependencies FROM tasks WHERE id=ANY($1::uuid[]) UNION SELECT t.id,t.dependencies FROM tasks t JOIN chain c ON t.id=ANY(c.dependencies)) SELECT id FROM chain WHERE id=$2",
            [v.dependencies, id],
          )
        ).rows;
        if (cycles.length)
          throw new BadRequestException("Cirkel in taakafhankelijkheden");
      }
      if (v.checklist)
        v.checklist = v.checklist.map((x: any) => {
          const prior = old.checklist.find((p: any) => p.id === x.id);
          return {
            ...x,
            ...(x.done
              ? {
                  completedBy: prior?.done ? prior.completedBy : u.id,
                  completedAt: prior?.done
                    ? prior.completedAt
                    : new Date().toISOString(),
                }
              : {}),
          };
        });
      if (b.status) {
        v.status = b.status;
        if (b.status === "blocked") v.blockedReason = b.reason;
        if (b.status === "completed" && old.status !== "completed")
          v.completedAt = new Date().toISOString();
        else if (b.status === "open") v.completedAt = null;
      }
      v.updatedBy = u.id;
      const keys = Object.keys(v),
        values = keys.map((k) =>
          k === "checklist" ? JSON.stringify(v[k]) : v[k],
        );
      values.push(id);
      const [row] = (
        await c.query(
          `UPDATE tasks SET ${keys.map((k, i) => snake(k) + "=$" + (i + 1)).join(",")},version=version+1,updated_at=now() WHERE id=$${values.length} RETURNING *`,
          values,
        )
      ).rows;
      await audit(
        c,
        u.id,
        "task",
        id,
        b.status ? "status:" + b.status : "updated",
        { reason: b.reason, fields: keys },
      );
      await notify(
        c,
        [...old.assigned_to, ...row.assigned_to, old.created_by],
        "task_updated",
        "Taak gewijzigd: " + row.title,
        id,
        row.priority === "critical",
      );
      return camel(row);
    });
  }
  @Get(":id/history") async history(@Param("id") id: string) {
    await this.detail(id);
    return camel(
      await query(
        "SELECT * FROM audit_events WHERE entity_type='task' AND entity_id=$1 ORDER BY created_at",
        [uuid(id)],
      ),
    );
  }
  @Get(":id/comments") async comments(@Param("id") id: string) {
    await this.detail(id);
    return camel(
      await query(
        "SELECT c.*,u.name AS author FROM task_comments c JOIN users u ON u.id=c.user_id WHERE task_id=$1 AND NOT c.moderation_hidden ORDER BY created_at",
        [uuid(id)],
      ),
    );
  }
  @Post(":id/comments") async comment(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    uuid(id);
    text(b.body, "Reactie", 10000);
    await moderateText(b.body);
    return idempotent(u, b, "comment:" + id, async (c) => {
      if (
        !(
          await c.query(
            "SELECT 1 FROM tasks WHERE id=$1 AND NOT moderation_hidden FOR SHARE",
            [id],
          )
        ).rowCount
      )
        throw new NotFoundException();
      const [row] = (
        await c.query(
          "INSERT INTO task_comments(task_id,user_id,body) VALUES($1,$2,$3) RETURNING *",
          [id, u.id, b.body],
        )
      ).rows;
      await audit(c, u.id, "task", id, "commented");
      const [task] = (
        await c.query(
          "SELECT assigned_to,created_by,title FROM tasks WHERE id=$1",
          [id],
        )
      ).rows;
      await notify(
        c,
        [...task.assigned_to, task.created_by],
        "comment",
        "Reactie op " + task.title,
        id,
      );
      return camel(row);
    });
  }
  @Get(":id/time") async times(@Param("id") id: string) {
    await this.detail(id);
    return camel(
      await query(
        "SELECT t.*,u.name FROM time_entries t JOIN users u ON u.id=t.user_id WHERE task_id=$1 ORDER BY started_at DESC",
        [uuid(id)],
      ),
    );
  }
  @Post(":id/time") async time(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    uuid(id);
    await this.detail(id);
    await moderateText(b.note);
    const start = b.startedAt || new Date().toISOString();
    date(start);
    if (b.endedAt) date(b.endedAt);
    if (b.minutes != null && (!Number.isFinite(b.minutes) || b.minutes < 0))
      throw new BadRequestException("Ongeldige duur");
    const end =
      b.endedAt ||
      (b.minutes != null
        ? new Date(Date.parse(start) + b.minutes * 60000).toISOString()
        : null);
    return idempotent(u, b, "time:" + id, async (c) =>
      camel(
        (
          await c.query(
            "INSERT INTO time_entries(task_id,user_id,started_at,ended_at,minutes,note) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              id,
              u.id,
              start,
              end,
              b.minutes ??
                (end ? (Date.parse(end) - Date.parse(start)) / 60000 : null),
              b.note || "",
            ],
          )
        ).rows[0],
      ),
    );
  }
}
@Controller("time")
@UseGuards(AuthGuard)
export class TimeController {
  @Patch(":id") async correct(
    @Param("id") id: string,
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    uuid(id);
    if (typeof b.reason !== "string" || !b.reason.trim())
      throw new BadRequestException("Correctiereden verplicht");
    if (!Number.isFinite(b.minutes) || b.minutes < 0 || b.minutes > 525600)
      throw new BadRequestException("Ongeldige tijdsduur");
    return idempotent(u, b, "time-correction:" + id, async (c) => {
      const [old] = (
        await c.query("SELECT * FROM time_entries WHERE id=$1 FOR UPDATE", [id])
      ).rows;
      if (!old || (old.user_id !== u.id && u.role !== "admin"))
        throw new NotFoundException();
      if (!old.ended_at)
        throw new BadRequestException("Stop eerst de actieve timer");
      if (old.version !== b.version)
        throw new ConflictException({
          message: "Tijdregistratie gewijzigd",
          current: camel(old),
        });
      const [r] = (
        await c.query(
          "UPDATE time_entries SET minutes=$1::numeric,ended_at=started_at+($1::numeric*interval '1 minute'),note=$2,version=version+1 WHERE id=$3 RETURNING *",
          [b.minutes, b.note ?? old.note, id],
        )
      ).rows;
      await audit(c, u.id, "time_entry", id, "corrected", {
        reason: b.reason,
        before: old,
        after: r,
      });
      return camel(r);
    });
  }
  @Post(":id/stop") async stop(
    @Param("id") id: string,
    @CurrentUser() u: User,
  ) {
    return transaction(async (c) => {
      const [r] = (
        await c.query(
          "UPDATE time_entries SET ended_at=now(),minutes=extract(epoch FROM now()-started_at)/60,version=version+1 WHERE id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING *",
          [uuid(id), u.id],
        )
      ).rows;
      if (!r) throw new NotFoundException("Actieve timer niet gevonden");
      await audit(c, u.id, "time_entry", id, "stopped");
      return camel(r);
    });
  }
}
@Controller("locations")
@UseGuards(AuthGuard)
export class LocationsController {
  @Get() async list() {
    return camel(await query("SELECT * FROM locations ORDER BY name"));
  }
  @Post() async create(@CurrentUser() u: User, @Body() b: any) {
    text(b.name, "Naam", 200);
    return idempotent(u, b, "locations:create", async (c) => {
      const [r] = (
        await c.query(
          "INSERT INTO locations(name,parent_id,type,metadata) VALUES($1,$2,$3,$4) RETURNING *",
          [
            b.name,
            b.parentId ? uuid(b.parentId) : null,
            b.type || "locatie",
            JSON.stringify(b.metadata || {}),
          ],
        )
      ).rows;
      await audit(c, u.id, "location", r.id, "created");
      return camel(r);
    });
  }
  @Patch(":id") async update(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return updateCatalog("locations", u, id, b, [
      "name",
      "parentId",
      "type",
      "metadata",
      "active",
    ]);
  }
}
async function updateCatalog(
  table: string,
  u: User,
  id: string,
  b: any,
  allowed: string[],
) {
  uuid(id);
  return idempotent(u, b, table + ":" + id, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [table]);
    const [old] = (
      await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])
    ).rows;
    if (!old) throw new NotFoundException();
    if (old.version !== b.version)
      throw new ConflictException({
        message: "Gegevens gewijzigd",
        current: camel(old),
      });
    if (b.parentId) {
      uuid(b.parentId);
      const cycles = (
        await c.query(
          `WITH RECURSIVE tree AS(SELECT id,parent_id FROM ${table} WHERE id=$1 UNION SELECT x.id,x.parent_id FROM ${table} x JOIN tree t ON x.id=t.parent_id) SELECT id FROM tree WHERE id=$2`,
          [b.parentId, id],
        )
      ).rows;
      if (cycles.length)
        throw new BadRequestException("Cirkel in hiërarchie niet toegestaan");
    }
    const keys = allowed.filter((k) => k in b);
    if (!keys.length) throw new BadRequestException("Geen wijzigingen");
    if ("name" in b) text(b.name, "Naam", 200);
    if ("locationId" in b && b.locationId) uuid(b.locationId);
    if ("active" in b && typeof b.active !== "boolean")
      throw new BadRequestException("Actief moet ja/nee zijn");
    const vals = keys.map((k) =>
      k === "metadata" ? JSON.stringify(b[k]) : b[k],
    );
    vals.push(id);
    const [r] = (
      await c.query(
        `UPDATE ${table} SET ${keys.map((k, i) => snake(k) + "=$" + (i + 1)).join(",")},version=version+1,updated_at=now() WHERE id=$${vals.length} RETURNING *`,
        vals,
      )
    ).rows;
    await audit(
      c,
      u.id,
      table === "assets" ? "asset" : "location",
      id,
      "updated",
      { before: old, fields: keys },
    );
    return camel(r);
  });
}
@Controller("assets")
@UseGuards(AuthGuard)
export class AssetsController {
  @Get() async list() {
    return camel(await query("SELECT * FROM assets ORDER BY name"));
  }
  @Get(":id") async detail(@Param("id") id: string) {
    const [r] = await query("SELECT * FROM assets WHERE id=$1", [uuid(id)]);
    if (!r) throw new NotFoundException();
    return camel(r);
  }
  @Post() async create(@CurrentUser() u: User, @Body() b: any) {
    text(b.name, "Naam", 200);
    return idempotent(u, b, "assets:create", async (c) => {
      const [r] = (
        await c.query(
          "INSERT INTO assets(name,location_id,parent_id,manufacturer,model,serial_number,notes,installation_date,warranty_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            b.name,
            b.locationId ? uuid(b.locationId) : null,
            b.parentId ? uuid(b.parentId) : null,
            b.manufacturer || null,
            b.model || null,
            b.serialNumber || null,
            b.notes || "",
            b.installationDate ? date(b.installationDate) : null,
            b.warrantyDate ? date(b.warrantyDate) : null,
          ],
        )
      ).rows;
      await audit(c, u.id, "asset", r.id, "created");
      return camel(r);
    });
  }
  @Patch(":id") async update(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return updateCatalog("assets", u, id, b, [
      "name",
      "locationId",
      "parentId",
      "manufacturer",
      "model",
      "serialNumber",
      "notes",
      "status",
      "installationDate",
      "warrantyDate",
    ]);
  }
  @Get(":id/history") async history(@Param("id") id: string) {
    await this.detail(id);
    uuid(id);
    return {
      tasks: camel(
        await query(
          "SELECT * FROM tasks WHERE asset_id=$1 AND NOT moderation_hidden ORDER BY created_at DESC",
          [id],
        ),
      ),
      parts: camel(
        await query(
          "SELECT m.*,i.name AS item_name FROM inventory_movements m JOIN tasks t ON t.id=m.task_id JOIN inventory_items i ON i.id=m.item_id WHERE t.asset_id=$1 AND NOT t.moderation_hidden ORDER BY m.created_at DESC",
          [id],
        ),
      ),
      events: camel(
        await query(
          "SELECT * FROM audit_events WHERE entity_type='asset' AND entity_id=$1 ORDER BY created_at DESC",
          [id],
        ),
      ),
    };
  }
}
@Controller("schedules")
@UseGuards(AuthGuard)
export class SchedulesController {
  @Get() async list(@CurrentUser() u: User, @Query() q: any) {
    const start = q.from ? date(q.from) : "1970-01-01",
      end = q.to ? date(q.to) : "2100-01-01";
    return camel(
      await query(
        "SELECT * FROM task_schedules WHERE (shared=true OR user_id=$1 OR $2=true) AND ends_at>=$3 AND starts_at<=$4 ORDER BY starts_at LIMIT 1000",
        [u.id, u.role === "admin", start, end],
      ),
    );
  }
  @Post() async create(@CurrentUser() u: User, @Body() b: any) {
    text(b.title, "Titel", 300);
    date(b.startsAt);
    date(b.endsAt);
    if (
      !b.startsAt ||
      !b.endsAt ||
      Date.parse(b.endsAt) <= Date.parse(b.startsAt)
    )
      throw new BadRequestException("Eindtijd moet na begintijd liggen");
    if (b.shared !== undefined && typeof b.shared !== "boolean")
      throw new BadRequestException("Delen moet ja/nee zijn");
    if (
      b.participants !== undefined &&
      (!Array.isArray(b.participants) || b.participants.length > 100)
    )
      throw new BadRequestException("Ongeldige deelnemers");
    if (b.userId && b.userId !== u.id && u.role !== "admin")
      throw new BadRequestException(
        "Plan in eigen agenda en voeg deelnemers toe",
      );
    return idempotent(u, b, "schedules:create", async (c) => {
      await references(c, { assignedTo: b.participants || [] });
      const [r] = (
        await c.query(
          "INSERT INTO task_schedules(task_id,user_id,title,starts_at,ends_at,shared,participants) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            b.taskId ? uuid(b.taskId) : null,
            b.userId || u.id,
            b.title,
            b.startsAt,
            b.endsAt,
            !!b.shared,
            (b.participants || []).map((x: any) => uuid(x)),
          ],
        )
      ).rows;
      await audit(c, u.id, "schedule", r.id, "created");
      if (r.shared)
        await notify(
          c,
          [r.user_id, ...r.participants],
          "planning",
          "Nieuwe gedeelde afspraak: " + r.title,
          r.id,
        );
      return camel(r);
    });
  }
  @Patch(":id") async update(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    uuid(id);
    return idempotent(u, b, "schedules:" + id, async (c) => {
      const [old] = (
        await c.query("SELECT * FROM task_schedules WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows;
      if (!old || (!old.shared && old.user_id !== u.id && u.role !== "admin"))
        throw new NotFoundException();
      if (old.version !== b.version)
        throw new ConflictException({
          message: "Planning gewijzigd",
          current: camel(old),
        });
      if (
        old.shared &&
        (old.user_id !== u.id ||
          old.participants.some((id: string) => id !== u.id)) &&
        b.confirmShared !== true
      )
        throw new BadRequestException(
          "Bevestig de wijziging van gedeelde planning",
        );
      if (b.startsAt !== undefined) date(b.startsAt);
      if (b.endsAt !== undefined) date(b.endsAt);
      if (b.shared !== undefined && typeof b.shared !== "boolean")
        throw new BadRequestException("Delen moet ja/nee zijn");
      if (
        b.shared !== undefined &&
        b.shared !== old.shared &&
        old.user_id !== u.id &&
        u.role !== "admin"
      )
        throw new BadRequestException(
          "Alleen de eigenaar kan de zichtbaarheid wijzigen",
        );
      if (b.participants !== undefined) {
        if (!Array.isArray(b.participants) || b.participants.length > 100)
          throw new BadRequestException("Ongeldige deelnemers");
        b.participants.forEach((x: any) => uuid(x));
        await references(c, { assignedTo: [...new Set(b.participants)] });
      }
      const starts = b.startsAt || old.starts_at,
        ends = b.endsAt || old.ends_at;
      if (new Date(ends) <= new Date(starts))
        throw new BadRequestException("Ongeldig tijdsblok");
      const [r] = (
        await c.query(
          "UPDATE task_schedules SET title=$1,starts_at=$2,ends_at=$3,shared=$4,participants=$5,version=version+1,updated_at=now() WHERE id=$6 RETURNING *",
          [
            b.title === undefined ? old.title : text(b.title, "Titel", 300),
            starts,
            ends,
            b.shared === undefined ? old.shared : !!b.shared,
            b.participants || old.participants,
            id,
          ],
        )
      ).rows;
      await audit(c, u.id, "schedule", id, "updated", {
        participants: old.participants,
        owner: old.user_id,
      });
      if (old.shared || r.shared)
        await notify(
          c,
          [old.user_id, ...old.participants, ...r.participants],
          "planning",
          r.shared
            ? "Gedeelde planning gewijzigd: " + r.title
            : "Afspraak wordt niet langer gedeeld",
          id,
        );
      return camel(r);
    });
  }
}
@Controller("health")
export class HealthController {
  @Get() async health() {
    await query("SELECT 1");
    return { status: "ok", database: "ok", time: new Date().toISOString() };
  }
}

async function notify(
  c: PoolClient,
  users: string[],
  kind: string,
  title: string,
  entityId: string,
  critical = false,
) {
  for (const id of new Set(users)) {
    await c.query(
      "INSERT INTO notifications(user_id,kind,title,entity_id,critical) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=$1 AND in_app=false AND push=false AND email=false)",
      [id, kind, title, entityId, critical],
    );
  }
}
