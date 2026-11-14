import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { AuthGuard, AdminGuard, CurrentUser, User } from "./auth";
import { query, transaction, audit } from "./db";
import { parseCsv, validateXlsxArchive } from "./reporting-utils";

@Controller("imports/catalog")
@UseGuards(AuthGuard, AdminGuard)
export class CatalogImportController {
  @Post("preview") async preview(@CurrentUser() user: User, @Body() b: any) {
    if (!["inventory", "locations"].includes(b.kind))
      throw new BadRequestException("Kies inventory of locations");
    if (
      typeof b.filename !== "string" ||
      typeof b.content !== "string" ||
      b.content.length > 8_000_000
    )
      throw new BadRequestException("CSV/XLSX vereist, maximaal 6 MB");
    const data = Buffer.from(b.content, "base64");
    let grid: string[][] = [];
    try {
      if (/\.csv$/i.test(b.filename)) grid = parseCsv(data.toString("utf8"));
      else if (/\.xlsx$/i.test(b.filename)) {
        validateXlsxArchive(data);
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(data as any);
        book.worksheets[0]?.eachRow((r) =>
          grid.push(
            (r.values as any[])
              .slice(1)
              .map((c) =>
                c == null
                  ? ""
                  : typeof c === "object"
                    ? String(c.text || c.result || "")
                    : String(c),
              ),
          ),
        );
      } else throw Error();
    } catch {
      throw new BadRequestException("Ongeldig CSV/XLSX-bestand");
    }
    if (!grid.length || grid.length > 5001)
      throw new BadRequestException("Maximaal 5000 rijen");
    const header = grid.shift()!.map((x) => x.trim().toLowerCase()),
      mapping = b.mapping || {};
    const aliases: Record<string, string[]> = {
      name: ["name", "naam", "artikel"],
      sku: ["sku", "artikelnummer"],
      unit: ["unit", "eenheid"],
      minimum: ["minimum", "minimumvoorraad"],
      description: ["description", "omschrijving"],
      path: ["path", "pad", "locatiepad"],
      type: ["type"],
    };
    const cell = (row: string[], key: string) => {
      const i = header.findIndex((h) =>
        (mapping[key]
          ? [String(mapping[key]).toLowerCase()]
          : aliases[key]
        ).includes(h),
      );
      return (row[i] || "").trim();
    };
    const seen = new Set<string>();
    const existing =
      b.kind === "inventory"
        ? new Set(
            (await query<any>("SELECT sku FROM inventory_items")).map(
              (r) => r.sku,
            ),
          )
        : new Set<string>();
    const rows = grid.map((r, line) => {
      const value: any =
        b.kind === "inventory"
          ? {
              name: cell(r, "name"),
              sku: cell(r, "sku"),
              unit: cell(r, "unit") || "stuk",
              minimum: Number(cell(r, "minimum").replace(",", ".")) || 0,
              description: cell(r, "description"),
            }
          : {
              path: cell(r, "path") || cell(r, "name"),
              type: cell(r, "type") || "locatie",
            };
      let error: string | undefined;
      if (b.kind === "inventory") {
        if (
          !value.name ||
          !value.sku ||
          value.name.length > 200 ||
          value.sku.length > 100
        )
          error =
            "Naam en artikelnummer zijn verplicht (maximaal 200/100 tekens)";
        const raw = cell(r, "minimum");
        if (
          raw &&
          (!Number.isFinite(Number(raw.replace(",", "."))) ||
            Number(raw.replace(",", ".")) < 0)
        )
          error = "Minimumvoorraad moet een niet-negatief getal zijn";
        if (value.unit.length > 30) error = "Eenheid maximaal 30 tekens";
      } else if (
        !value.path ||
        value.path
          .split("/")
          .some((s: string) => !s.trim() || s.trim().length > 200) ||
        value.path.split("/").length > 50
      )
        error = "Gebruik een pad met geldige namen, bijvoorbeeld Kas 1 / Kap 2";
      const key =
        b.kind === "inventory"
          ? value.sku
          : value.path
              .split("/")
              .map((s: string) => s.trim())
              .join("/");
      const duplicate = seen.has(key) || existing.has(key);
      if (!error) seen.add(key);
      return { line: line + 2, ...value, error, duplicate };
    });
    const [imp] = await query<any>(
      "INSERT INTO imports(user_id,filename,source_hash,original,rows,kind) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [
        user.id,
        b.filename,
        createHash("sha256").update(data).digest("hex"),
        data,
        JSON.stringify(rows),
        b.kind,
      ],
    );
    return {
      id: imp.id,
      kind: b.kind,
      rows,
      invalid: rows.filter((r) => r.error).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    };
  }
  @Post(":id/confirm") async confirm(
    @CurrentUser() user: User,
    @Param("id") id: string,
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new BadRequestException("Ongeldig import-ID");
    return transaction(async (c) => {
      const imp = (
        await c.query("SELECT * FROM imports WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!imp || imp.kind === "tasks") throw new NotFoundException();
      if (imp.state === "completed") return imp.report;
      // Align location imports with ordinary catalog updates; prevents duplicate paths between imports.
      await c.query("SELECT pg_advisory_xact_lock(hashtext('locations'))");
      const report = { imported: 0, skipped: 0, invalid: 0 };
      for (const row of imp.rows) {
        if (row.error) {
          report.invalid++;
          continue;
        }
        if (row.duplicate) {
          report.skipped++;
          continue;
        }
        if (imp.kind === "inventory") {
          const result = await c.query(
            "INSERT INTO inventory_items(sku,name,unit,minimum,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT(sku) DO NOTHING RETURNING id",
            [row.sku, row.name, row.unit, row.minimum, row.description],
          );
          if (result.rowCount) report.imported++;
          else report.skipped++;
        } else {
          let parent: string | null = null,
            created = false;
          for (const name of row.path.split("/").map((s: string) => s.trim())) {
            let match: any = (
              await c.query(
                "SELECT id,active FROM locations WHERE name=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid",
                [name, parent],
              )
            ).rows[0];
            if (match && !match.active)
              throw new BadRequestException(
                "Locatiepad bevat een gedeactiveerde locatie; kies een ander pad of activeer de locatie eerst",
              );
            if (!match) {
              match = (
                await c.query(
                  "INSERT INTO locations(name,parent_id,type) VALUES($1,$2,$3) RETURNING id",
                  [name, parent, row.type],
                )
              ).rows[0];
              created = true;
            }
            parent = match.id;
          }
          if (created) report.imported++;
          else report.skipped++;
        }
      }
      await c.query(
        "UPDATE imports SET state='completed',report=$2,completed_at=now() WHERE id=$1",
        [id, JSON.stringify(report)],
      );
      await audit(c, user.id, "import", id, "confirm:" + imp.kind, report);
      return report;
    });
  }
}
