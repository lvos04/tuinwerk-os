import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  ForbiddenException,
} from "@nestjs/common";
import type { Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { createHash } from "node:crypto";
import { statfs, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { query, transaction, camel, audit } from "./db";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { deliverNotifications } from "./notification-delivery";
import {
  parseCsv,
  validateXlsxArchive,
  csvEncode,
  sourceKey,
  validQuietTime,
  reportFilters,
} from "./reporting-utils";

type ImportRow = {
  line: number;
  title: string;
  description: string;
  priority: string;
  deadline: string | null;
  sourceKey: string;
  category: string;
  locationId: string | null;
  error?: string;
  duplicate?: boolean;
};
const uuid = (v: string) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    throw new BadRequestException("Ongeldige identificatie");
  return v;
};
function filters(q: Record<string, string>) {
  try {
    return reportFilters(q);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}
function pdfBuffer(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 45 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    draw(doc);
    doc.end();
  });
}

@Controller()
@UseGuards(AuthGuard)
export class ReportingController {
  @Get("reports/summary") async summary(@Query() q: Record<string, string>) {
    const f = filters(q);
    const tasks = await query<any>(
      `SELECT t.*,a.name asset_name,l.name location_name FROM tasks t LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN locations l ON l.id=t.location_id ${f.where}`,
      f.values,
    );
    const closed = tasks.filter((t) => t.completed_at);
    const byAsset: Record<string, number> = {};
    for (const t of tasks)
      if (t.category === "reparatie" || t.category === "storing")
        byAsset[t.asset_name || "Geen machine"] =
          (byAsset[t.asset_name || "Geen machine"] || 0) + 1;
    const time = await query<any>(
      `SELECT coalesce(sum(te.minutes),0) minutes FROM time_entries te JOIN tasks t ON t.id=te.task_id ${f.where}`,
      f.values,
    );
    const blocked = await query<any>(
      `SELECT coalesce(sum(extract(epoch FROM(coalesce(events.next_at,now())-events.created_at)))/3600,0) hours FROM (SELECT entity_id,action,created_at,lead(created_at) OVER(PARTITION BY entity_id ORDER BY created_at,id) next_at FROM audit_events WHERE entity_type='task' AND action LIKE 'status:%') events JOIN tasks t ON t.id::text=events.entity_id ${f.where ? f.where + " AND" : "WHERE"} events.action='status:blocked'`,
      f.values,
    );
    const parts = await query<any>(
      `SELECT t.asset_id,a.name asset_name,i.id item_id,i.name item_name,sum(-m.delta) quantity FROM inventory_movements m JOIN tasks t ON t.id=m.task_id JOIN inventory_items i ON i.id=m.item_id LEFT JOIN assets a ON a.id=t.asset_id ${f.where ? f.where + " AND" : "WHERE"} m.type='usage' GROUP BY t.asset_id,a.name,i.id,i.name ORDER BY quantity DESC`,
      f.values,
    );
    const workload: Record<string, number> = {};
    for (const task of tasks) {
      if (
        task.planned_at &&
        !["completed", "cancelled", "archived"].includes(task.status)
      ) {
        const d = new Date(task.planned_at);
        d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
        const week = d.toISOString().slice(0, 10);
        workload[week] = (workload[week] || 0) + 1;
      }
    }
    return {
      blockedHours: Number(blocked[0].hours),
      partsByAsset: parts.map(camel),
      workloadByWeek: workload,
      total: tasks.length,
      open: tasks.filter(
        (t) => !["completed", "cancelled", "archived"].includes(t.status),
      ).length,
      completed: closed.length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      overdue: tasks.filter(
        (t) =>
          t.deadline &&
          new Date(t.deadline) < new Date() &&
          !["completed", "cancelled", "archived"].includes(t.status),
      ).length,
      minutes: Number(time[0].minutes),
      meanResolutionHours: closed.length
        ? closed.reduce(
            (s, t) =>
              s +
              (new Date(t.completed_at).getTime() -
                new Date(t.created_at).getTime()) /
                3600000,
            0,
          ) / closed.length
        : null,
      faultsByAsset: byAsset,
      sampleSize: closed.length,
      definition:
        "Doorlooptijd = uren tussen aanmaak en afronding; storingen = categorie reparatie of storing. Filters gelden op aanmaakdatum van taken. Kleine aantallen geven geen betrouwbare trend.",
      filters: q,
    };
  }
  @Get("reports/export") async export(
    @Query() q: Record<string, string>,
    @Res() res: Response,
    all = false,
  ) {
    let rows: Record<string, unknown>[];
    if (q.type === "assets") {
      if (q.from || q.to || q.assigneeId)
        throw new BadRequestException(
          "Machine-export ondersteunt machine- en locatiefilters",
        );
      const values: any[] = [];
      const clauses: string[] = [];
      if (q.locationId) {
        values.push(uuid(q.locationId));
        clauses.push(`a.location_id=$${values.length}`);
      }
      if (q.assetId) {
        values.push(uuid(q.assetId));
        clauses.push(`a.id=$${values.length}`);
      }
      rows = await query<any>(
        `SELECT a.*,l.name location FROM assets a LEFT JOIN locations l ON l.id=a.location_id ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY a.name`,
        values,
      );
    } else if (q.type === "inventory") {
      if (q.from || q.to || q.assetId || q.assigneeId)
        throw new BadRequestException(
          "Voorraad is een actueel saldo; alleen locatie-filter is beschikbaar.",
        );
      const args = q.locationId ? [uuid(q.locationId)] : [];
      rows = await query<any>(
        `SELECT i.*,coalesce(sum(b.quantity),0) quantity FROM inventory_items i LEFT JOIN inventory_balances b ON b.item_id=i.id ${q.locationId ? "WHERE b.location_id=$1" : ""} GROUP BY i.id ORDER BY i.name`,
        args,
      );
    } else {
      const f = filters(q);
      const sql = `SELECT t.id,t.title,t.description,t.category,t.status,t.priority,t.deadline,t.created_at,t.completed_at,a.name asset,l.name location FROM tasks t LEFT JOIN assets a ON a.id=t.asset_id LEFT JOIN locations l ON l.id=t.location_id ${f.where} ORDER BY t.created_at DESC`;
      if (all)
        rows = await transaction(async (c) => {
          await c.query(
            "DECLARE export_rows NO SCROLL CURSOR FOR " + sql,
            f.values,
          );
          const result: any[] = [];
          while (true) {
            const batch = (await c.query("FETCH FORWARD 1000 FROM export_rows"))
              .rows;
            result.push(...batch);
            if (result.length > 100000)
              throw new BadRequestException(
                "Meer dan 100.000 regels: beperk de rapportperiode.",
              );
            if (batch.length < 1000) break;
          }
          return result;
        });
      else rows = await query<any>(sql + " LIMIT 10000", f.values);
    }
    const format = q.format || "csv",
      name = `tuinwerk-${q.type === "inventory" ? "voorraad" : q.type === "assets" ? "machines" : "taken"}-${new Date().toISOString().slice(0, 10)}`;
    if (format === "csv") {
      res
        .type("text/csv; charset=utf-8")
        .attachment(name + ".csv")
        .send(
          csvEncode(
            rows.map((r) => ({
              ...r,
              export_generated_at: new Date().toISOString(),
              export_filters: JSON.stringify(q),
            })),
          ),
        );
      return;
    }
    if (format === "xlsx") {
      const book = new ExcelJS.Workbook();
      book.creator = "TuinWerk OS";
      book.created = new Date();
      const meta = book.addWorksheet("Exportgegevens");
      meta.addRows([
        ["Gemaakt", new Date().toISOString()],
        ["Filters", JSON.stringify(q)],
        ["Limiet taken", all ? 100000 : 10000],
      ]);
      const sheet = book.addWorksheet("Gegevens");
      const keys = Object.keys(rows[0] || {});
      sheet.columns = keys.map((k) => ({ header: k, key: k, width: 24 }));
      rows.forEach((r) =>
        sheet.addRow(
          Object.fromEntries(
            Object.entries(r).map(([k, v]) => [
              k,
              v && typeof v === "object" && !(v instanceof Date)
                ? JSON.stringify(v)
                : v,
            ]),
          ),
        ),
      );
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      res
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .attachment(name + ".xlsx")
        .send(Buffer.from(await book.xlsx.writeBuffer()));
      return;
    }
    if (format === "pdf") {
      const data = await pdfBuffer((doc) => {
        doc.fontSize(20).text("TuinWerk OS — rapport");
        doc
          .fontSize(9)
          .text(new Date().toISOString())
          .text("Filters: " + JSON.stringify(q))
          .text(
            all
              ? "Achtergrondexport, maximaal 100.000 taken."
              : "Maximaal 10.000 taken; gebruik een achtergrondexport voor grotere bestanden.",
          );
        for (const r of rows) {
          doc
            .moveDown()
            .fontSize(11)
            .text(String(r.title || r.name || r.id));
          doc.fontSize(8).text(
            Object.entries(r)
              .map(([k, v]) => `${k}: ${v ?? ""}`)
              .join(" | "),
          );
        }
      });
      res
        .type("application/pdf")
        .attachment(name + ".pdf")
        .send(data);
      return;
    }
    throw new BadRequestException("Kies csv, xlsx of pdf");
  }
  @Post("reports/jobs") async requestExport(
    @CurrentUser() user: User,
    @Body() b: Record<string, string>,
  ) {
    if (
      !["csv", "xlsx", "pdf"].includes(b.format) ||
      !["tasks", "inventory", "assets"].includes(b.type)
    )
      throw new BadRequestException(
        "Kies type tasks/inventory/assets en format csv/xlsx/pdf",
      );
    filters(b);
    const [job] = await query<any>(
      "INSERT INTO export_jobs(user_id,filters) VALUES($1,$2) RETURNING id,status,created_at",
      [user.id, JSON.stringify(b)],
    );
    return camel(job);
  }
  @Get("reports/jobs") async exportJobs(@CurrentUser() user: User) {
    return (
      await query<any>(
        "SELECT id,filters,status,error,created_at,completed_at FROM export_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [user.id],
      )
    ).map(camel);
  }
  @Get("reports/jobs/:id/download") async downloadExport(
    @CurrentUser() user: User,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    uuid(id);
    const [job] = await query<any>(
      "SELECT * FROM export_jobs WHERE id=$1 AND user_id=$2 AND status='completed'",
      [id, user.id],
    );
    if (!job) throw new NotFoundException("Export niet beschikbaar");
    const format = job.filters.format;
    const path = resolve(
      process.env.EXPORT_DIR || "./exports",
      `${id}.${format}`,
    );
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw new NotFoundException(
        "Exportbestand ontbreekt; maak een nieuwe export",
      );
    }
    res
      .type(
        format === "pdf"
          ? "application/pdf"
          : format === "xlsx"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
      )
      .attachment(job.filename)
      .send(bytes);
  }
  @Get("qr/:type/:id") async qr(
    @Param("type") type: string,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const tables: Record<string, string> = {
      task: "tasks",
      asset: "assets",
      location: "locations",
      item: "inventory_items",
    };
    if (!tables[type]) throw new BadRequestException("Onbekend QR-type");
    uuid(id);
    const [row] = await query<any>(
      `SELECT * FROM ${tables[type]} WHERE id=$1`,
      [id],
    );
    if (!row) throw new NotFoundException();
    const base = process.env.APP_URL || "http://localhost:3000";
    const url = `${base.replace(/\/$/, "")}/?type=${type}&id=${id}`;
    const image = await QRCode.toBuffer(url, {
      width: 300,
      errorCorrectionLevel: "M",
    });
    const data = await pdfBuffer((doc) => {
      doc.fontSize(20).text("TuinWerk OS");
      doc.image(image, 45, 90, { width: 180 });
      doc
        .moveDown(13)
        .fontSize(16)
        .text(row.title || row.name)
        .fontSize(9)
        .text(`${type} · ${id}`)
        .text(url);
    });
    res.type("application/pdf").attachment(`label-${id}.pdf`).send(data);
  }
  @Post("imports/preview") @UseGuards(AdminGuard) async preview(
    @CurrentUser() user: User,
    @Body() b: any,
  ) {
    if (
      typeof b.filename !== "string" ||
      typeof b.content !== "string" ||
      b.content.length > 8_000_000
    )
      throw new BadRequestException("Bestand vereist, maximaal 6 MB");
    const data = Buffer.from(b.content, "base64");
    let grid: string[][];
    if (/\.csv$/i.test(b.filename)) {
      try {
        grid = parseCsv(data.toString("utf8"));
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    } else if (/\.xlsx$/i.test(b.filename)) {
      try {
        validateXlsxArchive(data);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(data as any);
        grid = [];
        book.worksheets[0]?.eachRow((r) => {
          grid.push(
            (r.values as any[])
              .slice(1)
              .map((c) =>
                c instanceof Date
                  ? c.toISOString()
                  : c == null
                    ? ""
                    : typeof c === "object"
                      ? String(c.text || c.result || "")
                      : String(c),
              ),
          );
        });
      } catch {
        throw new BadRequestException("Ongeldig Excel-bestand");
      }
    } else throw new BadRequestException("Gebruik CSV of XLSX");
    if (!grid.length || grid.length > 5001)
      throw new BadRequestException(
        "Bestand moet 1–5000 gegevensregels bevatten",
      );
    const headers = grid.shift()!.map((s) => s.trim().toLowerCase());
    const m = b.mapping || {};
    const find = (key: string, defaults: string[]) =>
      headers.findIndex((h) =>
        (m[key] ? [String(m[key]).toLowerCase()] : defaults).includes(h),
      );
    const ti = find("title", ["title", "titel", "content", "name"]),
      di = find("description", ["description", "omschrijving"]),
      pi = find("priority", ["priority", "prioriteit"]),
      dt = find("deadline", ["deadline", "due_date", "date"]),
      ex = find("externalId", ["id", "task_id", "external_id"]),
      ty = headers.indexOf("type");
    if (ti < 0)
      throw new BadRequestException(
        "Titelkolom niet gevonden; geef mapping.title op",
      );
    if (b.locationId) uuid(b.locationId);
    const seen = new Set<string>();
    const rows: ImportRow[] = [];
    for (const [index, cols] of grid.entries()) {
      if (ty >= 0 && cols[ty] && cols[ty].toLowerCase() !== "task") continue;
      const title = (cols[ti] || "").trim(),
        description = cols[di] || "",
        rawDate = cols[dt] || "";
      const deadline =
        rawDate && Number.isFinite(Date.parse(rawDate))
          ? new Date(rawDate).toISOString()
          : null;
      const priority =
        (
          {
            1: "low",
            2: "normal",
            3: "high",
            4: "critical",
            low: "low",
            normal: "normal",
            high: "high",
            critical: "critical",
          } as Record<string, string>
        )[cols[pi]] || "normal";
      const key = sourceKey(cols[ex], title, description, deadline);
      const r: ImportRow = {
        line: index + 2,
        title,
        description,
        priority,
        deadline,
        sourceKey: key,
        category: typeof b.category === "string" ? b.category : "reparatie",
        locationId: b.locationId || null,
      };
      if (!title || title.length > 300)
        r.error = "Titel ontbreekt of is langer dan 300 tekens";
      else if (rawDate && !deadline)
        r.error = "Datum niet herkenbaar; gebruik ISO-datum";
      r.duplicate = seen.has(key);
      if (!r.error) seen.add(key);
      rows.push(r);
    }
    const existing = await query<any>(
      "SELECT source_key FROM imported_records WHERE source_key=ANY($1::text[])",
      [rows.map((r) => r.sourceKey)],
    );
    const keys = new Set(existing.map((r) => r.source_key));
    rows.forEach((r) => {
      r.duplicate ||= keys.has(r.sourceKey);
    });
    const [record] = await query<any>(
      "INSERT INTO imports(user_id,filename,source_hash,original,rows) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        user.id,
        b.filename,
        createHash("sha256").update(data).digest("hex"),
        data,
        JSON.stringify(rows),
      ],
    );
    return {
      id: record.id,
      rows,
      invalid: rows.filter((r) => r.error).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    };
  }
  @Post("imports/:id/confirm") @UseGuards(AdminGuard) async confirm(
    @CurrentUser() user: User,
    @Param("id") id: string,
  ) {
    uuid(id);
    return transaction(async (c) => {
      const imp = (
        await c.query("SELECT * FROM imports WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!imp) throw new NotFoundException();
      if (imp.kind !== "tasks")
        throw new BadRequestException("Gebruik de catalogus-importbevestiging");
      if (imp.state === "completed") return imp.report;
      const report = { imported: 0, skipped: 0, invalid: 0 };
      for (const row of (imp.rows as ImportRow[]).sort((a, b) =>
        a.sourceKey.localeCompare(b.sourceKey),
      )) {
        if (row.error) {
          report.invalid++;
          continue;
        }
        if (row.duplicate) {
          report.skipped++;
          continue;
        }
        // Serialize source-key claims across different import files.
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          row.sourceKey,
        ]);
        if (
          (
            await c.query(
              "SELECT 1 FROM imported_records WHERE source_key=$1",
              [row.sourceKey],
            )
          ).rowCount
        ) {
          report.skipped++;
          continue;
        }
        const task = (
          await c.query(
            "INSERT INTO tasks(title,description,priority,deadline,category,location_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id",
            [
              row.title,
              row.description,
              row.priority,
              row.deadline,
              row.category,
              row.locationId,
              user.id,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO imported_records(source_key,task_id,import_id) VALUES($1,$2,$3)",
          [row.sourceKey, task.id, id],
        );
        report.imported++;
      }
      await c.query(
        "UPDATE imports SET state='completed',report=$2,completed_at=now() WHERE id=$1",
        [id, JSON.stringify(report)],
      );
      await audit(c, user.id, "import", id, "confirm", report);
      return report;
    });
  }
  @Get("notifications") async notifications(@CurrentUser() user: User) {
    return (
      await query<any>(
        "SELECT n.* FROM notifications n LEFT JOIN notification_preferences p ON p.user_id=n.user_id WHERE n.user_id=$1 AND coalesce(p.in_app,true) ORDER BY n.created_at DESC LIMIT 100",
        [user.id],
      )
    ).map(camel);
  }
  @Patch("notifications/:id/read") async read(
    @CurrentUser() user: User,
    @Param("id") id: string,
  ) {
    uuid(id);
    const [row] = await query<any>(
      "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *",
      [id, user.id],
    );
    if (!row) throw new NotFoundException();
    return camel(row);
  }
  @Get("notifications/preferences") async preferences(
    @CurrentUser() user: User,
  ) {
    await query(
      "INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [user.id],
    );
    return camel(
      (
        await query<any>(
          "SELECT * FROM notification_preferences WHERE user_id=$1",
          [user.id],
        )
      )[0],
    );
  }
  @Put("notifications/preferences") async savePreferences(
    @CurrentUser() user: User,
    @Body() b: any,
  ) {
    if (!validQuietTime(b.quietStart) || !validQuietTime(b.quietEnd))
      throw new BadRequestException("Stille uren moeten HH:mm zijn");
    for (const key of ["inApp", "push", "email", "criticalOverride", "weekly"])
      if (typeof b[key] !== "boolean")
        throw new BadRequestException(`${key} moet waar/onwaar zijn`);
    await query(
      "INSERT INTO notification_preferences(user_id,in_app,push,email,quiet_start,quiet_end,critical_override,weekly) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO UPDATE SET in_app=$2,push=$3,email=$4,quiet_start=$5,quiet_end=$6,critical_override=$7,weekly=$8,updated_at=now()",
      [
        user.id,
        b.inApp,
        b.push,
        b.email,
        b.quietStart,
        b.quietEnd,
        b.criticalOverride,
        b.weekly,
      ],
    );
    return this.preferences(user);
  }
  @Post("notifications/devices") async registerDevice(
    @CurrentUser() user: User,
    @Body() b: any,
  ) {
    if (
      typeof b.token !== "string" ||
      !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(b.token) ||
      !["ios", "android"].includes(b.platform)
    )
      throw new BadRequestException(
        "Geldig Expo push-token en platform vereist",
      );
    const [row] = await query<any>(
      "INSERT INTO push_devices(user_id,token,platform) VALUES($1,$2,$3) ON CONFLICT(token) DO UPDATE SET user_id=$1,platform=$3,active=true RETURNING id,platform,active",
      [user.id, b.token, b.platform],
    );
    return row;
  }
  @Get("notifications/devices") async devices(@CurrentUser() user: User) {
    return query(
      "SELECT id,platform,active,created_at FROM push_devices WHERE user_id=$1",
      [user.id],
    );
  }
  @Delete("notifications/devices/:id") async unregisterDevice(
    @CurrentUser() user: User,
    @Param("id") id: string,
  ) {
    uuid(id);
    await query(
      "UPDATE push_devices SET active=false WHERE id=$1 AND user_id=$2",
      [id, user.id],
    );
    return { ok: true };
  }
  @Get("ai/status") aiStatus() {
    return {
      enabled: process.env.AI_ENABLED === "true",
      provider: process.env.AI_BASE_URL || null,
      model: process.env.AI_MODEL || null,
      requiresConsent: true,
    };
  }
  @Post("ai/suggest") async suggest(@CurrentUser() user: User, @Body() b: any) {
    if (process.env.AI_ENABLED !== "true")
      throw new ServiceUnavailableException("AI is uitgeschakeld");
    if (b.consent !== true)
      throw new BadRequestException(
        "Bevestig eerst het delen van de ingevoerde tekst met de AI-provider",
      );
    if (typeof b.text !== "string" || !b.text.trim() || b.text.length > 4000)
      throw new BadRequestException("Voer maximaal 4000 tekens in");
    if (
      !process.env.AI_API_KEY ||
      !process.env.AI_BASE_URL ||
      !process.env.AI_MODEL
    )
      throw new ServiceUnavailableException(
        "AI-provider is niet geconfigureerd",
      );
    const url = new URL(process.env.AI_BASE_URL);
    if (url.protocol !== "https:")
      throw new ServiceUnavailableException("AI-provider vereist HTTPS");
    const cap = Number(process.env.AI_DAILY_TOKEN_BUDGET || 10000);
    if (!Number.isFinite(cap) || cap < 1)
      throw new ServiceUnavailableException("AI-budget niet geldig");
    const units = 5000;
    const inputPrice = Number(process.env.AI_INPUT_EUR_PER_MILLION || 0),
      outputPrice = Number(process.env.AI_OUTPUT_EUR_PER_MILLION || 0),
      euroCap = Number(process.env.AI_DAILY_BUDGET_EUR || 0);
    if (
      !Number.isFinite(inputPrice) ||
      inputPrice <= 0 ||
      !Number.isFinite(outputPrice) ||
      outputPrice <= 0 ||
      !Number.isFinite(euroCap) ||
      euroCap <= 0
    )
      throw new ServiceUnavailableException(
        "Configureer AI-prijzen en dagelijks eurobudget",
      );
    const reservedEur = (4500 * inputPrice + 500 * outputPrice) / 1000000;
    const id = await transaction(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('ai-budget'))");
      const spent = (
        await c.query(
          "SELECT coalesce(sum(reserved_units),0) units,coalesce(sum(reserved_eur),0) eur FROM ai_requests WHERE created_at>=date_trunc('day',now())",
        )
      ).rows[0];
      if (
        Number(spent.units) + units > cap ||
        Number(spent.eur) + reservedEur > euroCap
      )
        throw new ForbiddenException("Dagelijks AI-budget bereikt");
      const r = (
        await c.query(
          "INSERT INTO ai_requests(user_id,state,reserved_units,reserved_eur) VALUES($1,'reserved',$2,$3) RETURNING id",
          [user.id, units, reservedEur],
        )
      ).rows[0];
      await audit(c, user.id, "ai", r.id, "consent", {
        characters: b.text.length,
        provider: url.origin,
      });
      return r.id;
    });
    try {
      const response = await fetch(
        url.toString().replace(/\/$/, "") + "/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.AI_API_KEY}`,
          },
          body: JSON.stringify({
            model: process.env.AI_MODEL,
            max_tokens: 500,
            messages: [
              {
                role: "system",
                content:
                  "Je helpt met tuinbouwonderhoud. Geef alleen een beknopt Nederlandstalig voorstel met titel, omschrijving en checklist. Voer geen acties uit.",
              },
              { role: "user", content: b.text },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw new Error("provider");
      const data: any = await response.json();
      const suggestion = data.choices?.[0]?.message?.content;
      if (typeof suggestion !== "string") throw new Error("format");
      await query("UPDATE ai_requests SET state='completed' WHERE id=$1", [id]);
      return { suggestion, requiresApproval: true, applied: false };
    } catch {
      await query("UPDATE ai_requests SET state='failed' WHERE id=$1", [id]);
      throw new ServiceUnavailableException(
        "AI-provider niet beschikbaar; er zijn geen gegevens gewijzigd",
      );
    }
  }
  @Get("admin/status") @UseGuards(AdminGuard) async status() {
    const [db] = await query<any>(
      "SELECT now() server_time,pg_database_size(current_database()) database_bytes",
    );
    let storage: any = null;
    try {
      const s = await statfs(process.env.UPLOAD_DIR || "./uploads");
      storage = {
        availableBytes: s.bavail * s.bsize,
        totalBytes: s.blocks * s.bsize,
      };
    } catch {}
    const readTimestamp = async (name: string) => {
      try {
        const value = (
          await readFile(
            resolve(process.env.STATUS_DIR || "/data/status", name),
            "utf8",
          )
        ).trim();
        return Number.isFinite(Date.parse(value)) ? value : null;
      } catch {
        return null;
      }
    };
    const lastSuccess = await readTimestamp("last-backup-success"),
      lastFailure = await readTimestamp("last-backup-failure");
    let lastWorkerSuccess: string | null = null;
    try {
      const stamp = Number(
        (await readFile("/tmp/tuinwerk-worker-health", "utf8")).trim(),
      );
      if (Number.isFinite(stamp) && stamp > 0)
        lastWorkerSuccess = new Date(stamp).toISOString();
    } catch {}
    return {
      ...camel(db),
      storage,
      lastWeeklyRun:
        (
          await query<any>(
            "SELECT * FROM reporting_jobs ORDER BY completed_at DESC LIMIT 1",
          )
        )[0] || null,
      worker: {
        lastSuccess: lastWorkerSuccess,
        state: !lastWorkerSuccess
          ? "unknown"
          : Date.now() - Date.parse(lastWorkerSuccess) > 180000
            ? "stale"
            : "ok",
      },
      ai: this.aiStatus(),
      transports: {
        push:
          process.env.EXPO_PUSH_ENABLED === "true"
            ? "Expo ingeschakeld"
            : "uitgeschakeld",
        email: process.env.SMTP_HOST ? "SMTP geconfigureerd" : "uitgeschakeld",
      },
      backup: {
        state:
          lastFailure &&
          (!lastSuccess || Date.parse(lastFailure) > Date.parse(lastSuccess))
            ? "failed"
            : lastSuccess
              ? "ok"
              : process.env.AGE_RECIPIENT
                ? "pending"
                : "disabled",
        lastSuccess,
        lastFailure,
      },
    };
  }
  @Get("admin/export") @UseGuards(AdminGuard) async dataExport(
    @Res() res: Response,
  ) {
    const data = await transaction(async (c) => {
      await c.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const result: Record<string, unknown> = {
        format: "tuinwerk-data-v1",
        createdAt: new Date().toISOString(),
        note: "Bijlagenbestanden en secrets apart back-uppen; dit is een draagbare gegevens-export.",
      };
      const tables = [
        "locations",
        "assets",
        "tasks",
        "task_comments",
        "task_schedules",
        "time_entries",
        "attachments",
        "task_templates",
        "user_preferences",
        "inventory_items",
        "inventory_balances",
        "inventory_movements",
        "inventory_counts",
        "inventory_count_lines",
        "inventory_operations",
        "recurrence_rules",
        "recurrence_occurrences",
        "recurrence_occurrence_history",
        "season_templates",
        "season_activations",
        "notification_preferences",
        "notifications",
        "audit_events",
        "imports",
        "imported_records",
      ];
      for (const table of tables)
        result[table] = (await c.query(`SELECT * FROM ${table}`)).rows;
      result.users = (
        await c.query("SELECT id,email,name,role,active,created_at FROM users")
      ).rows;
      return result;
    });
    res
      .type("application/json")
      .attachment("tuinwerk-data.json")
      .send(JSON.stringify(data, null, 2));
  }
}

/** Durable weekly in-app summaries. External push/email require a configured transport. */
export async function sendWeeklySummary(
  now = new Date(),
  onlyUserId: string | null = null,
) {
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const key = `weekly:${monday.toISOString().slice(0, 10)}${onlyUserId ? ":" + onlyUserId : ""}`;
  await transaction(async (c) => {
    const claimed = await c.query(
      "INSERT INTO reporting_jobs(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key",
      [key],
    );
    if (!claimed.rowCount) return;
    const users = (
      await c.query(
        "SELECT u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.active AND coalesce(p.weekly,true) AND (coalesce(p.in_app,true) OR coalesce(p.email,false) OR coalesce(p.push,false)) AND ($1::uuid IS NULL OR u.id=$1)",
        [onlyUserId],
      )
    ).rows;
    for (const user of users) {
      const [counts] = (
        await c.query(
          "SELECT count(*) open,count(*) FILTER(WHERE deadline<now()) overdue,count(*) FILTER(WHERE priority='critical') urgent FROM tasks WHERE $1=ANY(assigned_to) AND status NOT IN ('completed','cancelled','archived')",
          [user.id],
        )
      ).rows;
      await c.query(
        "INSERT INTO notifications(user_id,kind,title,body) VALUES($1,'weekly','Jouw weekoverzicht',$2)",
        [
          user.id,
          `${counts.open} open taken, ${counts.overdue} achterstallig en ${counts.urgent} kritiek.`,
        ],
      );
    }
  });
}
export async function reportingTick(now = new Date()) {
  await sendWeeklySummary(now);
  await reminderTick(now);
  await deliverNotifications(now);
  await runExportJobs();
}

async function reminderTick(now: Date) {
  const day = now.toISOString().slice(0, 10);
  await transaction(async (c) => {
    const claimed = await c.query(
      "INSERT INTO reporting_jobs(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key",
      [`reminders:${day}`],
    );
    if (!claimed.rowCount) return;
    const tasks = (
      await c.query(
        "SELECT * FROM tasks WHERE status NOT IN ('completed','cancelled','archived') AND (deadline<$1 OR planned_at BETWEEN $1 AND $1::timestamptz+interval '1 day')",
        [now],
      )
    ).rows;
    for (const task of tasks) {
      const overdue = task.deadline && new Date(task.deadline) < now;
      for (const id of new Set<string>([...task.assigned_to, task.created_by]))
        await c.query(
          "INSERT INTO notifications(user_id,kind,title,body,entity_id,critical) SELECT u.id,$2,$3,$4,$5,$6 FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=$1 AND u.active AND (coalesce(p.in_app,true) OR coalesce(p.email,false) OR coalesce(p.push,false))",
          [
            id,
            overdue ? "overdue" : "reminder",
            overdue ? "Taak achterstallig" : "Taak binnenkort gepland",
            task.title,
            task.id,
            task.priority === "critical",
          ],
        );
    }
    const low = (
      await c.query(
        "SELECT i.id,i.name,i.minimum,coalesce(sum(b.quantity),0) quantity FROM inventory_items i LEFT JOIN inventory_balances b ON b.item_id=i.id WHERE i.active GROUP BY i.id HAVING coalesce(sum(b.quantity),0)<i.minimum",
      )
    ).rows;
    const localLow = (
      await c.query(
        "SELECT i.name,l.name location,b.quantity,b.minimum FROM inventory_balances b JOIN inventory_items i ON i.id=b.item_id JOIN locations l ON l.id=b.location_id WHERE i.active AND b.minimum IS NOT NULL AND b.quantity<b.minimum",
      )
    ).rows;
    const lowLines = [
      ...low.map((r) => `${r.name}: ${r.quantity} (minimum ${r.minimum})`),
      ...localLow.map(
        (r) =>
          `${r.name} @ ${r.location}: ${r.quantity} (locatieminimum ${r.minimum})`,
      ),
    ];
    if (lowLines.length)
      await c.query(
        "INSERT INTO notifications(user_id,kind,title,body) SELECT u.id,'low_stock','Onderdelen onder minimumvoorraad',$1 FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE u.active AND (coalesce(p.in_app,true) OR coalesce(p.email,false) OR coalesce(p.push,false))",
        [lowLines.join("\n")],
      );
  });
}

export async function runExportJobs(onlyJobId: string | null = null) {
  await transaction(async (c) => {
    const job = (
      await c.query(
        "SELECT * FROM export_jobs WHERE status='queued' AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
        [onlyJobId],
      )
    ).rows[0];
    if (!job) return;
    try {
      let bytes: Buffer = Buffer.alloc(0);
      const response: any = {
        type() {
          return this;
        },
        attachment() {
          return this;
        },
        send(value: any) {
          bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
          return this;
        },
      };
      await new ReportingController().export(job.filters, response, true);
      const dir = resolve(process.env.EXPORT_DIR || "./exports");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const filename = `${job.id}.${job.filters.format}`;
      await writeFile(resolve(dir, filename), bytes, { mode: 0o600 });
      await c.query(
        "UPDATE export_jobs SET status='completed',filename=$2,completed_at=now() WHERE id=$1",
        [job.id, filename],
      );
    } catch (e) {
      await c.query(
        "UPDATE export_jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1",
        [
          job.id,
          e instanceof BadRequestException
            ? e.message
            : "Export mislukt; controleer opslag en probeer opnieuw",
        ],
      );
    }
  });
}
