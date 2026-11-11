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
import { createHash } from "node:crypto";
import { PoolClient } from "pg";
import { AuthGuard, CurrentUser, User } from "./auth";
import { audit, camel, query, transaction } from "./db";
import { validId } from "./inventory";
import { validateTask } from "./core";

export interface RecurrenceConfig {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "dates";
  interval?: number;
  startDate: string;
  endDate?: string;
  weekdays?: number[];
  nthWeekday?: { nth: number; weekday: number };
  dates?: string[];
  exceptions?: string[];
  mode?: "calendar" | "completion";
}
export function dateOnly(s: any): string {
  if (
    typeof s !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s
  )
    throw new BadRequestException(
      "Gebruik een bestaande kalenderdatum (YYYY-MM-DD)",
    );
  return s;
}
const date = (s: string) => new Date(s + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(s: string, n: number) {
  const d = date(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function addMonths(s: string, n: number) {
  const d = date(s),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const max = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, max));
  return iso(d);
}
export function validateConfig(config: any): RecurrenceConfig {
  if (
    !config ||
    !["daily", "weekly", "monthly", "yearly", "dates"].includes(
      config.frequency,
    )
  )
    throw new BadRequestException("Onbekende herhaalfrequentie");
  const c = { ...config };
  dateOnly(c.startDate);
  if (c.endDate) {
    dateOnly(c.endDate);
    if (c.endDate < c.startDate)
      throw new BadRequestException("Einddatum ligt voor startdatum");
  }
  c.interval = c.interval ?? 1;
  if (!Number.isInteger(c.interval) || c.interval < 1 || c.interval > 1000)
    throw new BadRequestException("Interval moet tussen 1 en 1000 liggen");
  if (c.mode && !["calendar", "completion"].includes(c.mode))
    throw new BadRequestException("Onbekende herhaalmodus");
  for (const field of ["dates", "exceptions"])
    if (c[field] !== undefined) {
      if (!Array.isArray(c[field]) || c[field].length > 1000)
        throw new BadRequestException("Ongeldige datumlijst");
      c[field].forEach(dateOnly);
    }
  if (c.frequency === "dates" && !c.dates?.length)
    throw new BadRequestException("Kies kalenderdata");
  if (
    c.weekdays !== undefined &&
    (!Array.isArray(c.weekdays) ||
      !c.weekdays.length ||
      c.weekdays.some((n: any) => !Number.isInteger(n) || n < 0 || n > 6))
  )
    throw new BadRequestException("Weekdagen zijn 0 (zondag) t/m 6");
  if (
    c.nthWeekday &&
    (!Number.isInteger(c.nthWeekday.nth) ||
      ![1, 2, 3, 4, 5, -1].includes(c.nthWeekday.nth) ||
      !Number.isInteger(c.nthWeekday.weekday) ||
      c.nthWeekday.weekday < 0 ||
      c.nthWeekday.weekday > 6)
  )
    throw new BadRequestException("Ongeldige N-de weekdag");
  if (
    c.mode === "completion" &&
    (c.frequency === "dates" || c.nthWeekday || c.weekdays)
  )
    throw new BadRequestException(
      "Uitvoeringsinterval ondersteunt dagen, weken, maanden of jaren zonder kalenderselecties",
    );
  return c;
}
/** Date-only calendar arithmetic intentionally does not use local midnight: DST cannot shift a maintenance day. */
export function occurrenceDates(
  raw: RecurrenceConfig,
  through: string,
): string[] {
  const c = validateConfig(raw);
  dateOnly(through);
  const end = c.endDate && c.endDate < through ? c.endDate : through;
  if (end < c.startDate) return [];
  const start = date(c.startDate),
    last = date(end);
  if ((last.getTime() - start.getTime()) / 86400000 > 366 * 100)
    throw new BadRequestException(
      "Herhaalperiode mag maximaal honderd jaar zijn",
    );
  const exceptions = new Set(c.exceptions || []),
    result: string[] = [];
  if (c.frequency === "dates")
    return [...new Set(c.dates || [])]
      .filter((s) => s >= c.startDate && s <= end && !exceptions.has(s))
      .sort();
  for (let d = new Date(start); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const s = iso(d);
    if (exceptions.has(s)) continue;
    const days = Math.round((d.getTime() - start.getTime()) / 86400000),
      months =
        (d.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        d.getUTCMonth() -
        start.getUTCMonth(),
      n = c.interval!;
    let matches = false;
    if (c.frequency === "daily") matches = days % n === 0;
    if (c.frequency === "weekly") {
      const mondayOffset = (start.getUTCDay() + 6) % 7;
      matches =
        Math.floor((days + mondayOffset) / 7) % n === 0 &&
        (c.weekdays || [start.getUTCDay()]).includes(d.getUTCDay());
    }
    if (c.frequency === "monthly" || c.frequency === "yearly") {
      const period = c.frequency === "yearly" ? n * 12 : n;
      if (months % period === 0) {
        if (c.nthWeekday) {
          const nth = c.nthWeekday;
          matches =
            d.getUTCDay() === nth.weekday &&
            (nth.nth === -1
              ? new Date(d.getTime() + 7 * 86400000).getUTCMonth() !==
                d.getUTCMonth()
              : Math.floor((d.getUTCDate() - 1) / 7) + 1 === nth.nth);
        } else matches = s === addMonths(c.startDate, months);
      }
    }
    if (matches) result.push(s);
  }
  return result;
}
export function nextCompletionDate(
  c: RecurrenceConfig,
  completed: string,
): string {
  const n = c.interval ?? 1;
  return c.frequency === "monthly"
    ? addMonths(completed, n)
    : c.frequency === "yearly"
      ? addMonths(completed, n * 12)
      : addDays(completed, c.frequency === "weekly" ? n * 7 : n);
}
function taskTemplate(t: any) {
  if (!t || typeof t !== "object" || Array.isArray(t))
    throw new BadRequestException("Ongeldig taaksjabloon");
  for (const k of ["assetId", "locationId"]) if (t[k]) validId(t[k]);
  const assigned = t.assigneeIds ?? t.assignedTo ?? [];
  if (!Array.isArray(assigned) || assigned.length > 100)
    throw new BadRequestException("Ongeldige medewerkers");
  assigned.forEach((v: any) => validId(v));
  if (t.priority && !["low", "normal", "high", "critical"].includes(t.priority))
    throw new BadRequestException("Ongeldige prioriteit");
  if (
    t.checklist !== undefined &&
    (!Array.isArray(t.checklist) ||
      t.checklist.some(
        (x: any) =>
          x === null || !(typeof x === "string" || typeof x === "object"),
      ))
  )
    throw new BadRequestException("Ongeldige checklistregels");
  const checklist =
    t.checklist === undefined
      ? []
      : validateTask({
          checklist:
            t.checklist.map?.((x: any) =>
              typeof x === "string" ? { text: x, required: true } : x,
            ) ?? t.checklist,
        }).checklist;
  return { ...t, checklist, assigneeIds: assigned };
}
async function validateReferences(c: PoolClient, t: any) {
  for (const id of t.assigneeIds || []) {
    if (
      !(await c.query("SELECT id FROM users WHERE id=$1 AND active", [id])).rows
        .length
    )
      throw new BadRequestException(
        "Medewerker bestaat niet of is gedeactiveerd",
      );
  }
  for (const [key, table] of [
    ["assetId", "assets"],
    ["locationId", "locations"],
  ])
    if (
      t[key] &&
      !(await c.query("SELECT id FROM " + table + " WHERE id=$1", [t[key]]))
        .rows.length
    )
      throw new BadRequestException("Machine of locatie bestaat niet");
}
async function createTask(
  c: PoolClient,
  title: string,
  description: string,
  day: string,
  t: any,
  actor: string,
) {
  for (const id of t.assigneeIds || []) {
    if (
      !(await c.query("SELECT id FROM users WHERE id=$1 AND active", [id])).rows
        .length
    )
      throw new BadRequestException(
        "Medewerker bestaat niet of is gedeactiveerd",
      );
  }
  const task = (
    await c.query(
      `INSERT INTO tasks(title,description,category,priority,location_id,asset_id,created_by,updated_by,assigned_to,checklist,planned_at,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$10) RETURNING *`,
      [
        title,
        description,
        t.category || "onderhoud",
        t.priority || "normal",
        t.locationId || null,
        t.assetId || null,
        actor,
        t.assigneeIds || [],
        JSON.stringify(
          (t.checklist || []).map((x: any, i: number) =>
            typeof x === "string"
              ? { id: String(i), text: x, required: true, done: false }
              : { ...x, done: false, completedAt: null, completedBy: null },
          ),
        ),
        day + "T12:00:00Z",
      ],
    )
  ).rows[0];
  await audit(c, actor, "task", task.id, "maintenance_generated", {
    date: day,
  });
  return task;
}
export async function runMaintenance(through?: string) {
  const horizon = Number(process.env.RECURRENCE_LOOKAHEAD_DAYS || 28);
  if (!Number.isInteger(horizon) || horizon < 0 || horizon > 366)
    throw new Error("RECURRENCE_LOOKAHEAD_DAYS moet tussen 0 en 366 liggen");
  const end = through
    ? dateOnly(through)
    : addDays(new Date().toISOString().slice(0, 10), horizon);
  let generated = 0;
  const failures: Array<{ ruleId: string; message: string }> = [];
  const rules = await query(
    "SELECT id FROM recurrence_rules WHERE active ORDER BY created_at",
  );
  for (const row of rules) {
    try {
      generated += await transaction(async (c) => {
        const rule = (
          await c.query(
            "SELECT * FROM recurrence_rules WHERE id=$1 AND active FOR UPDATE",
            [row.id],
          )
        ).rows[0];
        if (!rule) return 0;
        const config = validateConfig(rule.config);
        const existing = (
          await c.query(
            "SELECT o.due_date::text,t.status,t.completed_at FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.rule_id=$1 ORDER BY o.due_date",
            [rule.id],
          )
        ).rows;
        let days: string[];
        if (config.mode === "completion") {
          if (
            existing.some(
              (o: any) =>
                !["completed", "cancelled", "archived"].includes(o.status),
            )
          )
            return 0;
          const completed = existing
            .filter((o: any) => o.completed_at)
            .sort(
              (a: any, b: any) =>
                new Date(a.completed_at).getTime() -
                new Date(b.completed_at).getTime(),
            )
            .at(-1);
          let next = completed
            ? nextCompletionDate(
                config,
                new Date(completed.completed_at).toISOString().slice(0, 10),
              )
            : config.startDate;
          const seenDates = new Set(existing.map((o: any) => o.due_date));
          const excluded = new Set(config.exceptions || []);
          while (next <= end && (seenDates.has(next) || excluded.has(next)))
            next = nextCompletionDate(config, next);
          days =
            next <= end && (!config.endDate || next <= config.endDate)
              ? [next]
              : [];
        } else days = occurrenceDates(config, end);
        const seen = new Set(existing.map((o: any) => o.due_date));
        let count = 0;
        for (const day of days.filter((d) => !seen.has(d)).slice(0, 1000)) {
          const task = await createTask(
            c,
            rule.title,
            rule.description,
            day,
            taskTemplate(rule.task_template),
            rule.created_by,
          );
          await c.query(
            "INSERT INTO recurrence_occurrences(rule_id,due_date,task_id) VALUES($1,$2,$3)",
            [rule.id, day, task.id],
          );
          count++;
        }
        return count;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Onbekende herhaalfout";
      failures.push({ ruleId: row.id, message });
      console.error(
        JSON.stringify({
          level: "error",
          module: "recurrence",
          ruleId: row.id,
          message,
        }),
      );
    }
  }
  return { generated, failures };
}

export async function forecastMaintenance(from: string, to: string) {
  dateOnly(from);
  dateOnly(to);
  const days = (date(to).getTime() - date(from).getTime()) / 86400000;
  if (days < 0 || days > 731)
    throw new BadRequestException("Kies een periode van maximaal twee jaar");
  return transaction(async (c) => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rules = (
      await c.query("SELECT * FROM recurrence_rules ORDER BY created_at")
    ).rows;
    const forecast: any[] = [];
    for (const rule of rules) {
      const config = validateConfig(rule.config);
      const existing = (
        await c.query(
          "SELECT o.due_date::text AS due_date,t.* FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.rule_id=$1 ORDER BY o.due_date",
          [rule.id],
        )
      ).rows;
      const seen = new Map(existing.map((row: any) => [row.due_date, row]));
      const candidates = new Set<string>(
        existing
          .filter((row: any) => row.due_date >= from && row.due_date <= to)
          .map((row: any) => row.due_date),
      );
      if (rule.active && config.mode !== "completion") {
        for (const day of occurrenceDates(config, to))
          if (day >= from) candidates.add(day);
      } else if (
        rule.active &&
        !existing.some(
          (row: any) =>
            !["completed", "cancelled", "archived"].includes(row.status),
        )
      ) {
        const completed = existing
          .filter((row: any) => row.completed_at)
          .sort(
            (a: any, b: any) =>
              new Date(a.completed_at).getTime() -
              new Date(b.completed_at).getTime(),
          )
          .at(-1);
        let next = completed
          ? nextCompletionDate(
              config,
              new Date(completed.completed_at).toISOString().slice(0, 10),
            )
          : config.startDate;
        const exceptions = new Set(config.exceptions || []);
        while (next <= to && (seen.has(next) || exceptions.has(next)))
          next = nextCompletionDate(config, next);
        if (
          next >= from &&
          next <= to &&
          (!config.endDate || next <= config.endDate)
        )
          candidates.add(next);
      }
      for (const day of candidates) {
        const task: any = seen.get(day);
        const template = rule.task_template;
        forecast.push({
          id: rule.id + ":" + day,
          ruleId: rule.id,
          title: task?.title ?? rule.title,
          description: task?.description ?? rule.description,
          dueDate: day,
          plannedAt: task?.planned_at ?? day + "T12:00:00Z",
          taskId: task?.id ?? null,
          status: task?.status ?? "forecast",
          assetId: task?.asset_id ?? template.assetId ?? null,
          locationId: task?.location_id ?? template.locationId ?? null,
          assignedTo:
            task?.assigned_to ??
            template.assigneeIds ??
            template.assignedTo ??
            [],
          mode: config.mode ?? "calendar",
          generated: !!task,
          tentative: !task && config.mode === "completion",
        });
      }
      if (forecast.length > 20000)
        throw new BadRequestException(
          "Meer dan 20.000 verwachte beurten; kies een kortere periode",
        );
    }
    return camel(
      forecast.sort(
        (a, b) =>
          a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
      ),
    );
  });
}

@Controller("recurrences")
@UseGuards(AuthGuard)
export class RecurrenceController {
  @Get("forecast") forecast(
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return forecastMaintenance(from, to);
  }
  @Get() async list() {
    return camel(
      await query(
        "SELECT r.*,(SELECT count(*) FROM recurrence_occurrences o WHERE o.rule_id=r.id) AS occurrence_count FROM recurrence_rules r ORDER BY r.created_at DESC LIMIT 500",
      ),
    );
  }
  @Post() async create(@Body() b: any, @CurrentUser() u: User) {
    if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 250)
      throw new BadRequestException("Titel is verplicht");
    const config = validateConfig(b.config),
      t = taskTemplate(b.taskTemplate || {});
    return transaction(async (c) => {
      await validateReferences(c, t);
      const row = (
        await c.query(
          "INSERT INTO recurrence_rules(title,description,config,task_template,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            b.title,
            b.description || "",
            JSON.stringify(config),
            JSON.stringify(t),
            u.id,
          ],
        )
      ).rows[0];
      await audit(c, u.id, "recurrence", row.id, "created");
      return camel(row);
    });
  }
  @Patch(":id") async edit(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    if (b.active !== undefined && typeof b.active !== "boolean")
      throw new BadRequestException("Actief moet ja/nee zijn");
    return transaction(async (c) => {
      const old = (
        await c.query("SELECT * FROM recurrence_rules WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException();
      if (old.version !== b.version)
        throw new ConflictException({
          message: "Herhaalregel is gewijzigd",
          current: camel(old),
        });
      const title = b.title ?? old.title;
      if (typeof title !== "string" || !title.trim() || title.length > 250)
        throw new BadRequestException("Titel is verplicht");
      const row = (
        await c.query(
          "UPDATE recurrence_rules SET title=$2,description=$3,config=$4,task_template=$5,active=$6,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            id,
            title,
            b.description ?? old.description,
            JSON.stringify(validateConfig(b.config ?? old.config)),
            JSON.stringify(taskTemplate(b.taskTemplate ?? old.task_template)),
            b.active ?? old.active,
          ],
        )
      ).rows[0];
      const future = (
        await c.query(
          "SELECT t.* FROM tasks t JOIN recurrence_occurrences o ON o.task_id=t.id WHERE o.rule_id=$1 AND o.due_date>CURRENT_DATE AND t.status IN ('open','planned') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.checklist) x WHERE x->>'done'='true') FOR UPDATE OF t",
          [id],
        )
      ).rows;
      const template = taskTemplate(row.task_template);
      await validateReferences(c, template);
      const scheduleChanged =
        b.config !== undefined &&
        JSON.stringify(validateConfig(old.config)) !==
          JSON.stringify(validateConfig(b.config));
      for (const task of future) {
        if (scheduleChanged) {
          await c.query(
            "INSERT INTO recurrence_occurrence_history(rule_id,due_date,task_id) SELECT rule_id,due_date,task_id FROM recurrence_occurrences WHERE task_id=$1",
            [task.id],
          );
          await c.query(
            "UPDATE tasks SET status='cancelled',updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1",
            [task.id, u.id],
          );
          await c.query("DELETE FROM recurrence_occurrences WHERE task_id=$1", [
            task.id,
          ]);
          await audit(c, u.id, "task", task.id, "maintenance_superseded", {
            ruleId: id,
            reason: "Herhaalregel gewijzigd",
          });
          continue;
        }
        await c.query(
          "UPDATE tasks SET title=$2,description=$3,category=$4,priority=$5,location_id=$6,asset_id=$7,assigned_to=$8,checklist=$9,updated_by=$10,updated_at=now(),version=version+1 WHERE id=$1",
          [
            task.id,
            row.title,
            row.description,
            template.category || "onderhoud",
            template.priority || "normal",
            template.locationId || null,
            template.assetId || null,
            template.assigneeIds,
            JSON.stringify(
              template.checklist.map((x: any) => ({ ...x, done: false })),
            ),
            u.id,
          ],
        );
        await audit(c, u.id, "task", task.id, "maintenance_template_updated", {
          ruleId: id,
        });
      }
      await audit(c, u.id, "recurrence", id, "updated", {
        policy: "future_unstarted_occurrences",
        updatedTasks: future.map((t: any) => t.id),
      });
      return camel(row);
    });
  }
  @Get(":id/occurrences") async occurrences(@Param("id") id: string) {
    validId(id);
    return camel(
      await query(
        "SELECT o.rule_id,o.due_date,o.task_id,t.title,t.status,t.completed_at,false AS superseded FROM recurrence_occurrences o JOIN tasks t ON t.id=o.task_id WHERE rule_id=$1 UNION ALL SELECT o.rule_id,o.due_date,o.task_id,t.title,t.status,t.completed_at,true AS superseded FROM recurrence_occurrence_history o JOIN tasks t ON t.id=o.task_id WHERE rule_id=$1 ORDER BY due_date",
        [id],
      ),
    );
  }
  @Post("generate") generate() {
    return runMaintenance();
  }
}
@Controller("seasons")
@UseGuards(AuthGuard)
export class SeasonController {
  @Get() async list() {
    return camel(
      await query("SELECT * FROM season_templates ORDER BY name LIMIT 500"),
    );
  }
  @Post() async create(@Body() b: any, @CurrentUser() u: User) {
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 250 ||
      !Array.isArray(b.activities) ||
      !b.activities.length ||
      b.activities.length > 500
    )
      throw new BadRequestException("Naam en activiteiten zijn verplicht");
    const activities = b.activities.map((a: any) => {
      if (
        typeof a.title !== "string" ||
        !a.title.trim() ||
        a.title.length > 250 ||
        !Number.isInteger(a.offsetDays) ||
        Math.abs(a.offsetDays) > 3660
      )
        throw new BadRequestException(
          "Activiteit heeft titel en geldig aantal relatieve dagen nodig",
        );
      return taskTemplate(a);
    });
    return transaction(async (c) => {
      for (const a of activities) await validateReferences(c, a);
      const row = (
        await c.query(
          "INSERT INTO season_templates(name,activities,created_by) VALUES($1,$2,$3) RETURNING *",
          [b.name, JSON.stringify(activities), u.id],
        )
      ).rows[0];
      await audit(c, u.id, "season", row.id, "created");
      return camel(row);
    });
  }
  @Patch(":id") async edit(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 250 ||
      !Array.isArray(b.activities) ||
      !b.activities.length ||
      b.activities.length > 500
    )
      throw new BadRequestException("Naam en activiteiten zijn verplicht");
    const activities = b.activities.map((a: any) => {
      if (
        typeof a.title !== "string" ||
        !a.title.trim() ||
        a.title.length > 250 ||
        !Number.isInteger(a.offsetDays) ||
        Math.abs(a.offsetDays) > 3660
      )
        throw new BadRequestException("Ongeldige activiteit");
      return taskTemplate(a);
    });
    return transaction(async (c) => {
      for (const a of activities) await validateReferences(c, a);
      const old = (
        await c.query("SELECT * FROM season_templates WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException();
      if (old.version !== b.version)
        throw new ConflictException({
          message: "Seizoenssjabloon is gewijzigd",
          current: camel(old),
        });
      const result = (
        await c.query(
          "UPDATE season_templates SET name=$2,activities=$3,version=version+1 WHERE id=$1 RETURNING *",
          [id, b.name, JSON.stringify(activities)],
        )
      ).rows[0];
      await audit(c, u.id, "season", id, "updated", {
        policy: "new_activations_only",
      });
      return camel(result);
    });
  }
  @Get("activations") async activations() {
    return camel(
      await query(
        "SELECT a.*,t.name FROM season_activations a JOIN season_templates t ON t.id=a.template_id ORDER BY a.created_at DESC LIMIT 500",
      ),
    );
  }
  @Post("activations/:id/shift") async shift(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    dateOnly(b.date);
    const assigned =
      b.assigneeIds === undefined
        ? undefined
        : taskTemplate({ assigneeIds: b.assigneeIds }).assigneeIds;
    return transaction(async (c) => {
      if (assigned) await validateReferences(c, { assigneeIds: assigned });
      const activation = (
        await c.query(
          "SELECT *,anchor_date::text AS day FROM season_activations WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!activation) throw new NotFoundException();
      if (activation.version !== b.version)
        throw new ConflictException({
          message: "Seizoensplanning is gewijzigd",
          current: camel(activation),
        });
      const difference = Math.round(
        (date(b.date).getTime() - date(activation.day).getTime()) / 86400000,
      );
      const tasks = (
        await c.query(
          "SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [activation.task_ids],
        )
      ).rows;
      const shifted: string[] = [],
        skipped: string[] = [];
      for (const task of tasks) {
        if (
          !["open", "planned"].includes(task.status) ||
          task.checklist.some((x: any) => x.done)
        ) {
          skipped.push(task.id);
          continue;
        }
        await c.query(
          "UPDATE tasks SET planned_at=planned_at+($2*interval '1 day'),deadline=deadline+($2*interval '1 day'),assigned_to=$3,updated_by=$4,updated_at=now(),version=version+1 WHERE id=$1",
          [task.id, difference, assigned ?? task.assigned_to, u.id],
        );
        await audit(c, u.id, "task", task.id, "season_shifted", {
          activationId: id,
          days: difference,
        });
        shifted.push(task.id);
      }
      const result = (
        await c.query(
          "UPDATE season_activations SET anchor_date=$2,version=version+1 WHERE id=$1 RETURNING *",
          [id, b.date],
        )
      ).rows[0];
      await audit(c, u.id, "season", activation.template_id, "shifted", {
        activationId: id,
        days: difference,
        shifted,
        skipped,
      });
      return { ...camel(result), shifted, skipped };
    });
  }
  @Post(":id/activate") async activate(
    @Param("id") id: string,
    @Body() b: any,
    @CurrentUser() u: User,
  ) {
    validId(id);
    validId(b.operationId);
    dateOnly(b.date);
    if (b.assigneeIds) taskTemplate({ assigneeIds: b.assigneeIds });
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          id,
          date: b.date,
          assigneeIds: b.assigneeIds || null,
        }),
      )
      .digest("hex");
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        u.id + b.operationId,
      ]);
      const old = (
        await c.query(
          "SELECT * FROM season_activations WHERE created_by=$1 AND operation_id=$2",
          [u.id, b.operationId],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash)
          throw new ConflictException("Operatie-ID is al gebruikt");
        return camel(old);
      }
      const template = (
        await c.query("SELECT * FROM season_templates WHERE id=$1 FOR SHARE", [
          id,
        ])
      ).rows[0];
      if (!template) throw new NotFoundException();
      const taskIds = [];
      for (const a of template.activities) {
        const task = await createTask(
          c,
          a.title,
          a.description || "",
          addDays(b.date, a.offsetDays),
          { ...a, assigneeIds: b.assigneeIds ?? a.assigneeIds },
          u.id,
        );
        taskIds.push(task.id);
      }
      const result = (
        await c.query(
          "INSERT INTO season_activations(template_id,operation_id,created_by,anchor_date,task_ids,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            id,
            b.operationId,
            u.id,
            b.date,
            JSON.stringify(taskIds),
            requestHash,
          ],
        )
      ).rows[0];
      await audit(c, u.id, "season", id, "activated", {
        activationId: result.id,
        taskIds,
      });
      return camel(result);
    });
  }
}
