import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AdminGuard,
  AuthGuard,
  CurrentUser,
  User,
  hash,
  requireRecentReauth,
} from "./auth";
import { audit, query, transaction } from "./db";
import { currentBackupHealth } from "./backups";
import { occupiedMinutes } from "./productivity";
import { getSetting } from "./settings";

/**
 * Bedrijfskoppeling API v1: alleen-lezen KPI's en datasets voor het Bedrijfsdashboard.
 * Authenticatie uitsluitend met koppelsleutels (Bearer bk_...), nooit met een gebruikerssessie.
 * Uitvoer bevat geen persoonsgegevens, e-mailadressen of vrije-tekstnotities.
 */
export const KOPPELING_APP = "tuinwerk-os";
export const KOPPELING_DATASETS = [
  "samenvatting",
  "storingen",
  "onderhoudstaken",
  "voorraad",
  "planning",
] as const;
const RATE_LIMIT_PER_MINUTE = 120;
const MAX_ACTIVE_KEYS = 25;
const CLOSED = ["completed", "cancelled", "archived"];
const FAULT_CATEGORIES = ["reparatie", "storing"];
const STATUS: Record<string, string> = {
  open: "open",
  planned: "gepland",
  in_progress: "in_uitvoering",
  blocked: "geblokkeerd",
  completed: "afgerond",
  cancelled: "geannuleerd",
  archived: "gearchiveerd",
};
const PRIORITY: Record<string, string> = {
  low: "laag",
  normal: "normaal",
  high: "hoog",
  critical: "kritiek",
};
const DEFAULT_CAPACITY = [0, 480, 480, 480, 480, 480, 0];
const PLANNING_WINDOW_DAYS = 28;

let cachedVersion: string | null | undefined;
function appVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    cachedVersion = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf8"),
    ).version;
  } catch {
    cachedVersion = null;
  }
  return cachedVersion ?? null;
}

export function generateKoppelsleutel() {
  const sleutel = "bk_" + randomBytes(32).toString("base64url");
  return { sleutel, voorvoegsel: sleutel.slice(0, 8), hash: hash(sleutel) };
}

const usage = new Map<string, { count: number; resetAt: number }>();
export function resetKoppelingRateLimit() {
  usage.clear();
}
function rateLimited(id: string, now = Date.now()) {
  if (usage.size > 1000)
    for (const [k, v] of usage) if (v.resetAt <= now) usage.delete(k);
  const entry = usage.get(id);
  if (!entry || entry.resetAt <= now) {
    usage.set(id, { count: 1, resetAt: now + 60000 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_PER_MINUTE;
}

/** Instelling "Bedrijfskoppeling ingeschakeld" (koppelingEnabled / KOPPELING_ENABLED), standaard uit. */
export const koppelingEnabled = () => process.env.KOPPELING_ENABLED === "true";

@Injectable()
export class KoppelingGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    if (!koppelingEnabled())
      throw new ForbiddenException({ fout: "koppeling_uitgeschakeld" });
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers.authorization;
    const match =
      typeof header === "string"
        ? /^Bearer (bk_[A-Za-z0-9_-]{32,200})$/.exec(header.trim())
        : null;
    if (!match)
      throw new UnauthorizedException({ fout: "ongeldige_koppelsleutel" });
    const [key] = await query(
      "SELECT id,laatst_gebruikt_op FROM koppelsleutels WHERE sleutel_hash=$1 AND ingetrokken_op IS NULL",
      [hash(match[1])],
    );
    if (!key)
      throw new UnauthorizedException({ fout: "ongeldige_koppelsleutel" });
    if (rateLimited(key.id))
      throw new HttpException({ fout: "te_veel_verzoeken" }, 429);
    if (
      !key.laatst_gebruikt_op ||
      Date.now() - new Date(key.laatst_gebruikt_op).getTime() > 60000
    )
      await query(
        "UPDATE koppelsleutels SET laatst_gebruikt_op=now() WHERE id=$1",
        [key.id],
      );
    req.koppelsleutel = { id: key.id };
    return true;
  }
}

type Kpi = {
  sleutel: string;
  label: string;
  waarde: number | string | null;
  eenheid: string | null;
  status: "ok" | "let_op" | "actie" | "onbekend";
  toelichting: string | null;
};
type Melding = {
  niveau: "info" | "waarschuwing" | "kritiek";
  tekst: string;
  sinds: string | null;
};
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

async function timezone() {
  try {
    const tz = String(await getSetting("appTimezone"));
    new Intl.DateTimeFormat("nl-NL", { timeZone: tz }).format();
    return tz;
  } catch {
    return process.env.APP_TIMEZONE || "Europe/Amsterdam";
  }
}

/** Aggregated capacity per calendar day; no per-employee details leave this function. */
export async function planningDays(from: string, days: number, tz: string) {
  const dates = await query(
    `SELECT d::date::text AS datum,extract(dow FROM d)::integer AS weekday,(d::date::timestamp AT TIME ZONE $3) AS starts_at,((d::date+1)::timestamp AT TIME ZONE $3) AS ends_at FROM generate_series($1::date,$1::date+($2::integer-1),interval '1 day') d`,
    [from, days, tz],
  );
  const people = await query(
    "SELECT u.id,coalesce(c.weekday_minutes,$1::integer[]) AS minutes FROM users u LEFT JOIN user_capacity c ON c.user_id=u.id WHERE u.active AND NOT u.system_account",
    [DEFAULT_CAPACITY],
  );
  const blocks = await query(
    "SELECT user_id,participants,shared,starts_at,ends_at FROM task_schedules WHERE starts_at<$2 AND ends_at>$1",
    [dates[0].starts_at, dates[dates.length - 1].ends_at],
  );
  return dates.map((day) => {
    const start = new Date(day.starts_at).getTime(),
      end = new Date(day.ends_at).getTime();
    let capaciteit = 0,
      gepland = 0,
      overbelast = 0,
      beschikbaar = 0,
      overbelastePersonen = 0;
    for (const person of people) {
      const capacity = Number(person.minutes[day.weekday]) || 0;
      const planned = occupiedMinutes(
        blocks
          .filter(
            (b) =>
              b.user_id === person.id ||
              (b.shared && b.participants.includes(person.id)),
          )
          .map(
            (b) =>
              [
                new Date(b.starts_at).getTime(),
                new Date(b.ends_at).getTime(),
              ] as [number, number],
          ),
        start,
        end,
      );
      capaciteit += capacity;
      gepland += planned;
      if (capacity > 0) beschikbaar++;
      if (planned > capacity) {
        overbelast += planned - capacity;
        overbelastePersonen++;
      }
    }
    return {
      id: day.datum,
      datum: day.datum,
      capaciteit_minuten: capaciteit,
      gepland_minuten: Math.round(gepland * 100) / 100,
      overbelast_minuten: Math.round(overbelast * 100) / 100,
      bezetting_procent:
        capaciteit > 0 ? Math.round((gepland / capaciteit) * 1000) / 10 : null,
      medewerkers_beschikbaar: beschikbaar,
      medewerkers_overbelast: overbelastePersonen,
      bijgewerkt_op: null,
    };
  });
}

async function weekStart(tz: string) {
  const [r] = await query(
    "SELECT date_trunc('week',now() AT TIME ZONE $1)::date::text AS monday,(date_trunc('week',now() AT TIME ZONE $1) AT TIME ZONE $1) AS starts_at",
    [tz],
  );
  return { monday: r.monday as string, startsAt: r.starts_at as Date };
}

export async function koppelingSamenvatting(now = new Date()) {
  const tz = await timezone();
  const week = await weekStart(tz);
  const kpis: Kpi[] = [],
    meldingen: Melding[] = [];

  const [faults] = await query(
    `SELECT count(*)::integer AS open,count(*) FILTER(WHERE priority='critical')::integer AS critical,count(*) FILTER(WHERE priority='high')::integer AS high,min(created_at) FILTER(WHERE priority='critical') AS critical_since FROM tasks WHERE category=ANY($1) AND status<>ALL($2) AND NOT moderation_hidden`,
    [FAULT_CATEGORIES, CLOSED],
  );
  kpis.push({
    sleutel: "open_storingen",
    label: "Open storingen",
    waarde: faults.open,
    eenheid: null,
    status: faults.critical ? "actie" : faults.high ? "let_op" : "ok",
    toelichting:
      faults.critical || faults.high
        ? [
            faults.critical && `${faults.critical} kritiek`,
            faults.high && `${faults.high} met hoge prioriteit`,
          ]
            .filter(Boolean)
            .join(", ")
        : faults.open
          ? "Geen met hoge of kritieke prioriteit"
          : "Geen open storingen",
  });
  if (faults.critical)
    meldingen.push({
      niveau: "kritiek",
      tekst: plural(
        faults.critical,
        "kritieke storing staat open",
        "kritieke storingen staan open",
      ),
      sinds: iso(faults.critical_since),
    });

  const [maintenance] = await query(
    `SELECT count(*)::integer AS overdue,count(*) FILTER(WHERE t.deadline<now()-interval '7 days')::integer AS week_late,min(t.deadline) AS oldest FROM tasks t WHERE t.deadline<now() AND NOT t.moderation_hidden AND t.status<>ALL($1) AND (t.category='onderhoud' OR EXISTS(SELECT 1 FROM recurrence_occurrences o WHERE o.task_id=t.id))`,
    [CLOSED],
  );
  kpis.push({
    sleutel: "achterstallig_onderhoud",
    label: "Achterstallig onderhoud",
    waarde: maintenance.overdue,
    eenheid: null,
    status: maintenance.week_late
      ? "actie"
      : maintenance.overdue
        ? "let_op"
        : "ok",
    toelichting: maintenance.overdue
      ? maintenance.week_late
        ? `${maintenance.week_late} meer dan 7 dagen over de deadline`
        : "Alle binnen 7 dagen over de deadline"
      : "Geen onderhoud over de deadline",
  });
  if (maintenance.overdue)
    meldingen.push({
      niveau: maintenance.week_late ? "kritiek" : "waarschuwing",
      tekst: plural(
        maintenance.overdue,
        "onderhoudstaak is achterstallig",
        "onderhoudstaken zijn achterstallig",
      ),
      sinds: iso(maintenance.oldest),
    });

  const [blocked] = await query(
    "SELECT count(*)::integer AS blocked FROM tasks WHERE status='blocked' AND NOT moderation_hidden",
  );
  kpis.push({
    sleutel: "geblokkeerde_taken",
    label: "Geblokkeerde taken",
    waarde: blocked.blocked,
    eenheid: null,
    status: blocked.blocked ? "let_op" : "ok",
    toelichting: blocked.blocked
      ? "Wachten op onderdelen, toegang of een andere taak"
      : null,
  });

  const days = await planningDays(week.monday, 7, tz);
  const capacity = days.reduce((s, d) => s + d.capaciteit_minuten, 0),
    planned = days.reduce((s, d) => s + d.gepland_minuten, 0),
    overloadedDays = days.filter((d) => d.medewerkers_overbelast > 0).length;
  const occupancy =
    capacity > 0 ? Math.round((planned / capacity) * 1000) / 10 : null;
  kpis.push({
    sleutel: "planning_bezetting_week",
    label: "Planning deze week",
    waarde: occupancy,
    eenheid: "%",
    status:
      occupancy === null
        ? "onbekend"
        : occupancy > 100
          ? "actie"
          : occupancy > 85 || overloadedDays
            ? "let_op"
            : "ok",
    toelichting:
      occupancy === null
        ? "Geen capaciteit ingesteld voor deze week"
        : `${Math.round(planned / 6) / 10} u gepland van ${Math.round(capacity / 6) / 10} u capaciteit` +
          (overloadedDays
            ? `; ${plural(overloadedDays, "dag", "dagen")} met overbelasting`
            : ""),
  });
  if (overloadedDays)
    meldingen.push({
      niveau: "waarschuwing",
      tekst: `Planning overbelast op ${plural(overloadedDays, "dag", "dagen")} deze week`,
      sinds: null,
    });

  const [stock] = await query(
    `SELECT count(*)::integer AS low,count(*) FILTER(WHERE b.quantity=0)::integer AS empty FROM inventory_items i CROSS JOIN LATERAL (SELECT COALESCE(sum(quantity),0) AS quantity,COALESCE(bool_or(minimum IS NOT NULL AND quantity<minimum),false) AS low FROM inventory_balances WHERE item_id=i.id) b WHERE i.active AND (b.quantity<i.minimum OR b.low)`,
  );
  kpis.push({
    sleutel: "onderdelen_onder_minimum",
    label: "Onderdelen onder bestelminimum",
    waarde: stock.low,
    eenheid: null,
    status: stock.empty ? "actie" : stock.low ? "let_op" : "ok",
    toelichting: stock.empty
      ? `${stock.empty} niet meer op voorraad`
      : stock.low
        ? "Bestellen aanbevolen"
        : "Alle onderdelen boven minimum",
  });
  if (stock.low)
    meldingen.push({
      niveau: stock.empty ? "kritiek" : "waarschuwing",
      tekst: plural(
        stock.low,
        "onderdeel onder bestelminimum",
        "onderdelen onder bestelminimum",
      ),
      sinds: null,
    });

  const [hours] = await query(
    `SELECT COALESCE(sum(COALESCE(minutes,extract(epoch FROM ended_at-started_at)/60)) FILTER(WHERE ended_at IS NOT NULL),0)::float AS minutes,count(*) FILTER(WHERE ended_at IS NULL)::integer AS running FROM time_entries WHERE started_at>=$1`,
    [week.startsAt],
  );
  kpis.push({
    sleutel: "uren_deze_week",
    label: "Geregistreerde uren deze week",
    waarde: Math.round(hours.minutes / 6) / 10,
    eenheid: "uur",
    status: "ok",
    toelichting: hours.running
      ? `${plural(hours.running, "timer loopt", "timers lopen")} nog`
      : null,
  });

  const [done] = await query(
    "SELECT count(*)::integer AS done FROM tasks WHERE completed_at>=now()-interval '7 days' AND status IN ('completed','archived') AND NOT moderation_hidden",
  );
  kpis.push({
    sleutel: "afgeronde_taken_7d",
    label: "Afgerond (7 dagen)",
    waarde: done.done,
    eenheid: null,
    status: "ok",
    toelichting: null,
  });

  try {
    const health = await currentBackupHealth(now);
    const critical = health.alerts.filter(
        (a: any) => a.severity === "critical",
      ),
      warnings = health.alerts.filter((a: any) => a.severity !== "critical");
    const ageHours = health.lastLocalSuccess
      ? Math.round(
          (now.getTime() - Date.parse(health.lastLocalSuccess)) / 360000,
        ) / 10
      : null;
    kpis.push({
      sleutel: "backup_gezondheid",
      label: "Laatste back-up",
      waarde: ageHours,
      eenheid: "uur geleden",
      status: critical.length ? "actie" : warnings.length ? "let_op" : "ok",
      toelichting: health.alerts.length
        ? health.alerts[0].title
        : "Back-ups en herstelcontrole op orde",
    });
    for (const a of health.alerts)
      meldingen.push({
        niveau:
          a.severity === "critical"
            ? "kritiek"
            : a.severity === "warning"
              ? "waarschuwing"
              : "info",
        tekst: a.title,
        sinds: null,
      });
  } catch {
    kpis.push({
      sleutel: "backup_gezondheid",
      label: "Laatste back-up",
      waarde: null,
      eenheid: "uur geleden",
      status: "onbekend",
      toelichting: "Back-upstatus kon niet worden bepaald",
    });
  }
  const order = { kritiek: 0, waarschuwing: 1, info: 2 };
  meldingen.sort((a, b) => order[a.niveau] - order[b.niveau]);
  return {
    app: KOPPELING_APP,
    gegenereerd_op: now.toISOString(),
    kpis,
    meldingen,
  };
}

type Params = {
  sinds: string | null;
  limiet: number;
  cursor: any | null;
};
const invalid = (melding: string) =>
  new UnprocessableEntityException({ fout: "ongeldige_parameter", melding });
export function parseDatasetParams(q: Record<string, any>): Params {
  let limiet = 100;
  if (q.limiet !== undefined) {
    if (typeof q.limiet !== "string" || !/^\d{1,4}$/.test(q.limiet))
      throw invalid("limiet moet een geheel getal van 1 tot en met 500 zijn");
    limiet = Number(q.limiet);
    if (limiet < 1 || limiet > 500)
      throw invalid("limiet moet een geheel getal van 1 tot en met 500 zijn");
  }
  let sinds: string | null = null;
  if (q.sinds !== undefined) {
    if (
      typeof q.sinds !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2}))?$/.test(
        q.sinds,
      ) ||
      !Number.isFinite(Date.parse(q.sinds))
    )
      throw invalid(
        "sinds moet een ISO 8601-tijd met tijdzone of een datum (JJJJ-MM-DD) zijn",
      );
    sinds = q.sinds;
  }
  let cursor: any = null;
  if (q.cursor !== undefined) {
    try {
      if (typeof q.cursor !== "string" || q.cursor.length > 500) throw 0;
      cursor = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8"));
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor))
        throw 0;
    } catch {
      throw invalid("cursor is ongeldig; gebruik volgende_cursor ongewijzigd");
    }
  }
  return { sinds, limiet, cursor };
}
const encodeCursor = (v: any) =>
  Buffer.from(JSON.stringify(v), "utf8").toString("base64url");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset pagination over (bijgewerkt_op,id); the cursor keeps database precision. */
async function keyset(
  inner: string,
  params: any[],
  p: Params,
  map: (row: any) => any,
) {
  if (
    p.cursor &&
    (typeof p.cursor.t !== "string" ||
      !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/.test(
        p.cursor.t,
      ) ||
      typeof p.cursor.id !== "string" ||
      !UUID.test(p.cursor.id))
  )
    throw invalid("cursor is ongeldig; gebruik volgende_cursor ongewijzigd");
  const n = params.length;
  const rows = await query(
    `SELECT x.*,x.bijgewerkt_op::text AS _k FROM (${inner}) x WHERE ($${n + 1}::timestamptz IS NULL OR x.bijgewerkt_op>=$${n + 1}) AND ($${n + 2}::timestamptz IS NULL OR (x.bijgewerkt_op,x.id)>($${n + 2}::timestamptz,$${n + 3}::uuid)) ORDER BY x.bijgewerkt_op,x.id LIMIT $${n + 4}`,
    [
      ...params,
      p.sinds,
      p.cursor?.t ?? null,
      p.cursor?.id ?? null,
      p.limiet + 1,
    ],
  );
  const more = rows.length > p.limiet,
    page = rows.slice(0, p.limiet);
  const last = page[page.length - 1];
  return {
    items: page.map(({ _k, ...row }) => map(row)),
    volgende_cursor:
      more && last ? encodeCursor({ t: last._k, id: last.id }) : null,
  };
}

const taskFields = (row: any) => {
  const out = {
    ...row,
    status: STATUS[row.status] ?? row.status,
    prioriteit: PRIORITY[row.prioriteit] ?? row.prioriteit,
  };
  for (const k of [
    "gemeld_op",
    "gepland_op",
    "deadline",
    "afgerond_op",
    "bijgewerkt_op",
  ])
    if (k in out) out[k] = iso(out[k]);
  return out;
};

export async function koppelingDataset(
  naam: string,
  q: Record<string, any>,
  now = new Date(),
) {
  if (!(KOPPELING_DATASETS as readonly string[]).includes(naam))
    throw new NotFoundException({ fout: "onbekende_dataset" });
  const p = parseDatasetParams(q);
  let result: { items: any[]; volgende_cursor: string | null };
  if (naam === "storingen")
    result = await keyset(
      `SELECT t.id,t.title AS titel,t.status,t.priority AS prioriteit,t.category AS categorie,t.asset_id AS machine_id,a.name AS machine,t.location_id AS locatie_id,l.name AS locatie,t.created_at AS gemeld_op,t.deadline,t.completed_at AS afgerond_op,t.updated_at AS bijgewerkt_op FROM tasks t LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN locations l ON l.id=t.location_id WHERE t.category=ANY($1) AND NOT t.moderation_hidden`,
      [FAULT_CATEGORIES],
      p,
      taskFields,
    );
  else if (naam === "onderhoudstaken")
    result = await keyset(
      `SELECT t.id,t.title AS titel,t.status,t.priority AS prioriteit,t.asset_id AS machine_id,a.name AS machine,t.location_id AS locatie_id,l.name AS locatie,o.rule_id AS herhaalregel_id,t.planned_at AS gepland_op,t.deadline,COALESCE(t.deadline<now() AND t.status<>ALL($1),false) AS achterstallig,t.estimated_minutes AS geschatte_minuten,t.completed_at AS afgerond_op,t.updated_at AS bijgewerkt_op FROM tasks t LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN locations l ON l.id=t.location_id LEFT JOIN recurrence_occurrences o ON o.task_id=t.id WHERE NOT t.moderation_hidden AND (t.category='onderhoud' OR o.task_id IS NOT NULL)`,
      [CLOSED],
      p,
      taskFields,
    );
  else if (naam === "voorraad")
    result = await keyset(
      `SELECT i.id,i.sku,i.name AS naam,i.category AS categorie,i.unit AS eenheid,b.quantity::text AS voorraad,i.minimum::text AS minimum,(i.active AND (b.quantity<i.minimum OR b.low)) AS onder_minimum,i.supplier AS leverancier,i.active AS actief,GREATEST(i.updated_at,m.last,b.updated) AS bijgewerkt_op FROM inventory_items i CROSS JOIN LATERAL (SELECT COALESCE(sum(quantity),0) AS quantity,COALESCE(bool_or(minimum IS NOT NULL AND quantity<minimum),false) AS low,max(updated_at) AS updated FROM inventory_balances WHERE item_id=i.id) b LEFT JOIN LATERAL (SELECT max(created_at) AS last FROM inventory_movements WHERE item_id=i.id) m ON true`,
      [],
      p,
      (row) => ({
        ...row,
        voorraad: String(Number(row.voorraad)),
        minimum: String(Number(row.minimum)),
        bijgewerkt_op: iso(row.bijgewerkt_op),
      }),
    );
  else if (naam === "planning") {
    const tz = await timezone();
    let base: string, offset: number;
    if (p.cursor) {
      if (
        typeof p.cursor.b !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.cursor.b) ||
        !Number.isInteger(p.cursor.o) ||
        p.cursor.o < 1 ||
        p.cursor.o >= PLANNING_WINDOW_DAYS
      )
        throw invalid(
          "cursor is ongeldig; gebruik volgende_cursor ongewijzigd",
        );
      base = p.cursor.b;
      offset = p.cursor.o;
    } else {
      base = p.sinds
        ? (
            await query(
              "SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS d",
              [p.sinds.length === 10 ? p.sinds + "T12:00:00Z" : p.sinds, tz],
            )
          )[0].d
        : (await weekStart(tz)).monday;
      offset = 0;
    }
    const days = await planningDays(base, PLANNING_WINDOW_DAYS, tz);
    const items = days.slice(offset, offset + p.limiet);
    result = {
      items,
      volgende_cursor:
        offset + p.limiet < PLANNING_WINDOW_DAYS
          ? encodeCursor({ b: base, o: offset + p.limiet })
          : null,
    };
  } else {
    const summary = await koppelingSamenvatting(now);
    result = {
      items: summary.kpis.slice(0, p.limiet).map((k) => ({
        id: k.sleutel,
        ...k,
        bijgewerkt_op: summary.gegenereerd_op,
      })),
      volgende_cursor: null,
    };
  }
  return {
    app: KOPPELING_APP,
    dataset: naam,
    gegenereerd_op: now.toISOString(),
    ...result,
  };
}

@Controller("koppeling/v1")
@UseGuards(KoppelingGuard)
export class KoppelingController {
  @Get("info") @Header("Cache-Control", "no-store") async info() {
    const company = String((await getSetting("companyName")) ?? "").trim();
    return {
      app: KOPPELING_APP,
      naam: "TuinWerk OS",
      versie: appVersion(),
      api_versie: "1",
      bedrijf: company || null,
      datasets: [...KOPPELING_DATASETS],
      tijd: new Date().toISOString(),
    };
  }
  @Get("samenvatting") @Header("Cache-Control", "no-store") samenvatting() {
    return koppelingSamenvatting();
  }
  @Get("datasets/:naam") @Header("Cache-Control", "no-store") dataset(
    @Param("naam") naam: string,
    @Query() q: Record<string, any>,
  ) {
    return koppelingDataset(naam, q);
  }
}

const keyFields =
  "k.id,k.naam,k.voorvoegsel,k.aangemaakt_op,k.aangemaakt_door AS aangemaakt_door_id,u.name AS aangemaakt_door,k.laatst_gebruikt_op,k.ingetrokken_op";
const keyOut = (r: any) => ({
  ...r,
  aangemaakt_op: iso(r.aangemaakt_op),
  laatst_gebruikt_op: iso(r.laatst_gebruikt_op),
  ingetrokken_op: iso(r.ingetrokken_op),
});

@Controller("admin/koppelsleutels")
@UseGuards(AuthGuard, AdminGuard)
export class KoppelsleutelsController {
  @Get() async list() {
    return (
      await query(
        `SELECT ${keyFields} FROM koppelsleutels k LEFT JOIN users u ON u.id=k.aangemaakt_door ORDER BY k.ingetrokken_op IS NOT NULL,k.aangemaakt_op DESC,k.id`,
      )
    ).map(keyOut);
  }
  @Post() async create(@CurrentUser() u: User, @Body() b: any) {
    requireRecentReauth(u);
    const naam = typeof b?.naam === "string" ? b.naam.trim() : "";
    if (!naam || naam.length > 100)
      throw new BadRequestException("Geef een naam van 1–100 tekens");
    const generated = generateKoppelsleutel();
    return transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('koppelsleutels'))");
      const [{ count }] = (
        await c.query(
          "SELECT count(*)::integer AS count FROM koppelsleutels WHERE ingetrokken_op IS NULL",
        )
      ).rows;
      if (count >= MAX_ACTIVE_KEYS)
        throw new BadRequestException(
          `Maximaal ${MAX_ACTIVE_KEYS} actieve koppelsleutels; trek eerst een ongebruikte sleutel in`,
        );
      const [row] = (
        await c.query(
          "INSERT INTO koppelsleutels(naam,voorvoegsel,sleutel_hash,aangemaakt_door) VALUES($1,$2,$3,$4) RETURNING id,naam,voorvoegsel,aangemaakt_op",
          [naam, generated.voorvoegsel, generated.hash, u.id],
        )
      ).rows;
      await audit(c, u.id, "koppelsleutel", row.id, "created", {
        naam,
        voorvoegsel: generated.voorvoegsel,
      });
      return {
        ...keyOut(row),
        sleutel: generated.sleutel,
        melding:
          "Kopieer deze sleutel nu en bewaar hem veilig; hij wordt niet opnieuw getoond.",
      };
    });
  }
  @Delete(":id") @HttpCode(200) async revoke(
    @CurrentUser() u: User,
    @Param("id") id: string,
  ) {
    if (!UUID.test(id))
      throw new NotFoundException("Koppelsleutel niet gevonden");
    return transaction(async (c) => {
      const [old] = (
        await c.query(
          "SELECT id,naam,voorvoegsel,ingetrokken_op FROM koppelsleutels WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows;
      if (!old) throw new NotFoundException("Koppelsleutel niet gevonden");
      if (!old.ingetrokken_op) {
        await c.query(
          "UPDATE koppelsleutels SET ingetrokken_op=now(),ingetrokken_door=$2 WHERE id=$1",
          [id, u.id],
        );
        await audit(c, u.id, "koppelsleutel", id, "revoked", {
          naam: old.naam,
          voorvoegsel: old.voorvoegsel,
        });
      }
      const [row] = (
        await c.query(
          `SELECT ${keyFields} FROM koppelsleutels k LEFT JOIN users u ON u.id=k.aangemaakt_door WHERE k.id=$1`,
          [id],
        )
      ).rows;
      return keyOut(row);
    });
  }
}
