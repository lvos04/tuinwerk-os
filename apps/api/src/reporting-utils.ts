import { createHash } from "node:crypto";

/** RFC 4180 parser; embedded newlines and escaped quotes are preserved. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const source = input.replace(/^\uFEFF/, "");
  const delimiter =
    source.split(/\r?\n/, 1)[0].includes(";") &&
    !source.split(/\r?\n/, 1)[0].includes(",")
      ? ";"
      : ",";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("Niet-afgesloten aanhalingstekens in CSV");
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function csvCell(value: unknown): string {
  let s =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Prevent spreadsheet formula execution, including leading tabs and spaces.
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function csvEncode(rows: Record<string, unknown>[]): string {
  const keys = Object.keys(rows[0] || {});
  return (
    "\uFEFF" +
    [
      keys.map(csvCell).join(","),
      ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(",")),
    ].join("\r\n")
  );
}
export function sourceKey(
  externalId: string | undefined,
  title: string,
  description: string,
  deadline: string | null,
) {
  const normalizedId = externalId?.trim();
  return createHash("sha256")
    .update(
      normalizedId
        ? `todoist:${normalizedId}`
        : JSON.stringify([title.trim(), description.trim(), deadline]),
    )
    .digest("hex");
}
export function validQuietTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
export function reportFilters(q: Record<string, string>) {
  const values: unknown[] = [];
  const clauses: string[] = ["t.moderation_hidden=false"];
  const add = (clause: string, v: unknown) => {
    values.push(v);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  for (const k of ["from", "to"])
    if (q[k]) {
      if (!Number.isFinite(Date.parse(q[k])))
        throw new Error("Ongeldige rapportdatum");
      if (k === "to" && /^\d{4}-\d{2}-\d{2}$/.test(q[k])) {
        const next = new Date(q[k] + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        add("t.created_at < ?::timestamptz", next.toISOString());
      } else
        add(`t.created_at ${k === "from" ? ">=" : "<="} ?::timestamptz`, q[k]);
    }
  for (const [key, col] of [
    ["assetId", "asset_id"],
    ["locationId", "location_id"],
  ] as const)
    if (q[key]) {
      if (!/^[0-9a-f-]{36}$/i.test(q[key]))
        throw new Error("Ongeldige identificatie");
      add(`t.${col} = ?::uuid`, q[key]);
    }
  if (q.assigneeId) {
    if (!/^[0-9a-f-]{36}$/i.test(q.assigneeId))
      throw new Error("Ongeldige medewerker");
    add("?::uuid = ANY(t.assigned_to)", q.assigneeId);
  }
  return {
    where: clauses.length ? "WHERE " + clauses.join(" AND ") : "",
    values,
  };
}
/** Bound XLSX decompression before handing an untrusted ZIP to the workbook parser. */
export function validateXlsxArchive(data: Buffer) {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("Ongeldig Excel-archief");
  const entries = data.readUInt16LE(end + 10),
    size = data.readUInt32LE(end + 12),
    start = data.readUInt32LE(end + 16);
  if (entries > 1000 || entries === 65535 || start + size > end)
    throw new Error("Excel-archief te groot");
  let offset = start,
    total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Ongeldig Excel-archief");
    if (data.readUInt16LE(offset + 8) & 1)
      throw new Error("Versleuteld Excel-bestand niet ondersteund");
    total += data.readUInt32LE(offset + 24);
    if (total > 50 * 1024 * 1024)
      throw new Error("Uitgepakt Excel-bestand te groot");
    offset +=
      46 +
      data.readUInt16LE(offset + 28) +
      data.readUInt16LE(offset + 30) +
      data.readUInt16LE(offset + 32);
  }
  if (offset !== start + size) throw new Error("Ongeldige Excel-directory");
}
