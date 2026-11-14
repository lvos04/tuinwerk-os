import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { query, transaction, camel, audit } from "./db";
import { uuid } from "./core";
import { dateOnly } from "./recurrence";
const defaults = [0, 480, 480, 480, 480, 480, 0];
const targets: Record<string, { table: string; active: string }> = {
  asset: { table: "assets", active: "status<>'archived'" },
  location: { table: "locations", active: "active" },
  template: { table: "task_templates", active: "active" },
};
function favoriteType(type: any) {
  if (typeof type !== "string" || !Object.hasOwn(targets, type))
    throw new BadRequestException("Kies machine, locatie of taaksjabloon");
  return targets[type];
}
/** Merge clipped half-open intervals; overlaps and shared duplicates count once. */
export function occupiedMinutes(
  intervals: Array<[number, number]>,
  start: number,
  end: number,
) {
  const clipped = intervals
    .map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    left = 0,
    right = 0,
    active = false;
  for (const [a, b] of clipped) {
    if (!active) {
      left = a;
      right = b;
      active = true;
    } else if (a <= right) right = Math.max(right, b);
    else {
      total += right - left;
      left = a;
      right = b;
    }
  }
  if (active) total += right - left;
  return Math.round((total / 60000) * 100) / 100;
}
@Controller()
@UseGuards(AuthGuard)
export class ProductivityController {
  @Get("profile/favorites") async favorites(@CurrentUser() u: User) {
    return query(
      `SELECT f.type,f.target_id AS id,COALESCE(a.name,l.name,t.name,f.saved_name) AS name,CASE f.type WHEN 'asset' THEN a.id IS NOT NULL AND a.status<>'archived' WHEN 'location' THEN l.id IS NOT NULL AND l.active ELSE t.id IS NOT NULL AND t.active END AS available FROM user_favorites f LEFT JOIN assets a ON f.type='asset' AND a.id=f.target_id LEFT JOIN locations l ON f.type='location' AND l.id=f.target_id LEFT JOIN task_templates t ON f.type='template' AND t.id=f.target_id WHERE f.user_id=$1 ORDER BY f.created_at,f.target_id`,
      [u.id],
    );
  }
  @Put("profile/favorites") async addFavorite(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    const target = favoriteType(b.type);
    uuid(b.id);
    return transaction(async (c) => {
      const [row] = (
        await c.query(
          `SELECT name FROM ${target.table} WHERE id=$1 AND ${target.active} FOR SHARE`,
          [b.id],
        )
      ).rows;
      if (!row)
        throw new NotFoundException(
          "Dit object bestaat niet of is gearchiveerd",
        );
      await c.query(
        "INSERT INTO user_favorites(user_id,type,target_id,saved_name) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,type,target_id) DO NOTHING",
        [u.id, b.type, b.id, row.name],
      );
      return { type: b.type, id: b.id, name: row.name, available: true };
    });
  }
  @Delete("profile/favorites/:type/:id") async removeFavorite(
    @CurrentUser() u: User,
    @Param("type") type: string,
    @Param("id") id: string,
  ) {
    favoriteType(type);
    uuid(id);
    await query(
      "DELETE FROM user_favorites WHERE user_id=$1 AND type=$2 AND target_id=$3",
      [u.id, type, id],
    );
    return { ok: true };
  }
  @Get("profile/capacity") async ownCapacity(@CurrentUser() u: User) {
    const [r] = await query("SELECT * FROM user_capacity WHERE user_id=$1", [
      u.id,
    ]);
    return r
      ? camel(r)
      : { userId: u.id, weekdayMinutes: defaults, version: 0 };
  }
  @Patch("profile/capacity") async updateOwn(
    @CurrentUser() u: User,
    @Body() b: any,
  ) {
    return this.saveCapacity(u, u.id, b);
  }
  @Patch("users/:id/capacity") @UseGuards(AdminGuard) async updateUser(
    @CurrentUser() u: User,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    if (u.role !== "admin") throw new ForbiddenException();
    return this.saveCapacity(u, uuid(id), b);
  }
  @Get("users/:id/capacity") @UseGuards(AdminGuard) async userCapacity(
    @CurrentUser() u: User,
    @Param("id") id: string,
  ) {
    if (u.role !== "admin") throw new ForbiddenException();
    uuid(id);
    const [person] = await query("SELECT id FROM users WHERE id=$1", [id]);
    if (!person) throw new NotFoundException();
    return this.ownCapacity({ ...u, id });
  }
  private async saveCapacity(u: User, id: string, b: any) {
    if (
      !Number.isInteger(b.version) ||
      !Array.isArray(b.weekdayMinutes) ||
      b.weekdayMinutes.length !== 7 ||
      b.weekdayMinutes.some(
        (n: any) => !Number.isInteger(n) || n < 0 || n > 1440,
      )
    )
      throw new BadRequestException(
        "Geef een versie en zeven dagcapaciteiten van 0–1440 minuten (zondag t/m zaterdag)",
      );
    return transaction(async (c) => {
      const [person] = (
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id])
      ).rows;
      if (!person) throw new NotFoundException();
      const [old] = (
        await c.query("SELECT * FROM user_capacity WHERE user_id=$1", [id])
      ).rows;
      if ((old?.version ?? 0) !== b.version)
        throw new ConflictException({
          message: "Capaciteit is gewijzigd; laad opnieuw",
          current: old
            ? camel(old)
            : { userId: id, weekdayMinutes: defaults, version: 0 },
        });
      const [r] = (
        await c.query(
          "INSERT INTO user_capacity(user_id,weekday_minutes) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET weekday_minutes=$2,version=user_capacity.version+1,updated_at=now() RETURNING *",
          [id, b.weekdayMinutes],
        )
      ).rows;
      await audit(c, u.id, "capacity", id, "updated", {
        weekdayMinutes: b.weekdayMinutes,
      });
      return camel(r);
    });
  }
  @Get("planning/capacity") async capacity(
    @CurrentUser() u: User,
    @Query() q: any,
  ) {
    const from = dateOnly(q.from),
      to = dateOnly(q.to);
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 92)
      throw new BadRequestException("Kies maximaal 93 dagen");
    if (q.userId) uuid(q.userId);
    const timezone = process.env.APP_TIMEZONE || "Europe/Amsterdam";
    const dates = await query(
      `SELECT d::date::text AS date,extract(dow FROM d)::integer AS weekday,(d::date::timestamp AT TIME ZONE $3) AS starts_at,((d::date+1)::timestamp AT TIME ZONE $3) AS ends_at FROM generate_series($1::date,$2::date,interval '1 day') d`,
      [from, to, timezone],
    );
    const people = await query(
      "SELECT u.id,u.name,coalesce(c.weekday_minutes,$2::integer[]) AS minutes FROM users u LEFT JOIN user_capacity c ON c.user_id=u.id WHERE u.active AND ($1::uuid IS NULL OR u.id=$1) ORDER BY u.name",
      [q.userId || null, defaults],
    );
    const start = dates[0].starts_at,
      end = dates[dates.length - 1].ends_at;
    const blocks = await query(
      "SELECT user_id,participants,shared,starts_at,ends_at FROM task_schedules WHERE starts_at<$2 AND ends_at>$1 AND (shared OR user_id=$3 OR $4)",
      [start, end, u.id, u.role === "admin"],
    );
    const days = people.flatMap((person) =>
      dates.map((day) => {
        const intervals = blocks
          .filter(
            (block) =>
              block.user_id === person.id ||
              (block.shared && block.participants.includes(person.id)),
          )
          .map(
            (block) =>
              [
                new Date(block.starts_at).getTime(),
                new Date(block.ends_at).getTime(),
              ] as [number, number],
          );
        const plannedMinutes = occupiedMinutes(
            intervals,
            new Date(day.starts_at).getTime(),
            new Date(day.ends_at).getTime(),
          ),
          capacityMinutes = person.minutes[day.weekday];
        return {
          userId: person.id,
          name: person.name,
          date: day.date,
          capacityMinutes,
          plannedMinutes,
          overloadedMinutes: Math.max(0, plannedMinutes - capacityMinutes),
          privateMinutesHidden: person.id !== u.id && u.role !== "admin",
          scope:
            person.id !== u.id && u.role !== "admin"
              ? "shared-only"
              : "all-visible",
        };
      }),
    );
    const overdue = await query(
      `SELECT t.id FROM tasks t WHERE t.deadline>=$1 AND t.deadline<$2 AND t.deadline<now() AND NOT t.moderation_hidden AND t.status NOT IN ('completed','cancelled','archived') AND (t.category='onderhoud' OR EXISTS(SELECT 1 FROM recurrence_occurrences o WHERE o.task_id=t.id)) AND ($3::uuid IS NULL OR $3=ANY(t.assigned_to)) ORDER BY t.deadline,t.id`,
      [start, end, q.userId || null],
    );
    return {
      timezone,
      from,
      to,
      definition:
        "Geplande minuten zijn de samengevoegde tijdsblokken per medewerker per kalenderdag; overlappende blokken tellen eenmaal. Gedeelde deelnemers tellen mee. Privéblokken zijn alleen voor eigenaar en beheerder zichtbaar. Taakschattingen zonder tijdsblok tellen niet mee. Capaciteit is de ingestelde beschikbaarheid per weekdag; 0 betekent niet beschikbaar.",
      days,
      overdueMaintenance: {
        count: overdue.length,
        taskIds: overdue.map((t) => t.id),
        definition:
          "Niet afgerond onderhoud met deadline binnen het gekozen venster én vóór dit moment; categorie onderhoud of gekoppeld aan een herhaalregel.",
      },
    };
  }
}
