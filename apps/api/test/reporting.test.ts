import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  validateXlsxArchive,
  csvCell,
  csvEncode,
  sourceKey,
  validQuietTime,
  reportFilters,
} from "../src/reporting-utils";
test("CSV parses quoted commas newlines BOM and escaped quotes", () => {
  assert.deepEqual(
    parseCsv('\uFEFFtitle,description\r\n"Pomp, 2","regel 1\nregel ""2"""'),
    [
      ["title", "description"],
      ["Pomp, 2", 'regel 1\nregel "2"'],
    ],
  );
});
test("CSV rejects incomplete quote and supports Dutch delimiter", () => {
  assert.throws(() => parseCsv('title\n"bad'), /aanhaling/);
  assert.deepEqual(parseCsv("titel;omschrijving\nPomp;Lek"), [
    ["titel", "omschrijving"],
    ["Pomp", "Lek"],
  ]);
});
test("CSV protects formula injection and escapes data", () => {
  for (const value of [
    "=CMD()",
    "+1",
    "-2",
    "@SUM(A1)",
    '  =HYPERLINK("bad")',
    "\tfoo",
  ])
    assert.ok(csvCell(value).startsWith("\"'"));
  assert.match(csvEncode([{ title: 'a"b' }]), /a""b/);
});
test("Import deduplicates external identity regardless edited contents", () => {
  assert.equal(
    sourceKey("id1", "Old", "", null),
    sourceKey("id1", "New", "changed", null),
  );
  assert.notEqual(
    sourceKey(undefined, "Old", "", null),
    sourceKey(undefined, "New", "", null),
  );
});
test("Quiet hours reject malformed times", () => {
  assert.ok(validQuietTime("23:59"));
  for (const bad of ["24:00", "9:00", "22:60", null])
    assert.equal(validQuietTime(bad), false);
});
test("Report filter values are parameterized; invalid dates and UUIDs fail", () => {
  const f = reportFilters({
    from: "2026-01-01",
    assigneeId: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(f.values.length, 2);
  assert.match(f.where, /\$1/);
  assert.match(f.where, /\$2/);
  assert.throws(() => reportFilters({ from: "not-a-date" }));
  assert.throws(() => reportFilters({ assetId: "'; DROP TABLE tasks" }));
});
test("End date includes the complete day and source IDs normalize whitespace", () => {
  const f = reportFilters({ to: "2026-11-11" });
  assert.match(f.where, /created_at </);
  assert.equal(f.values[0], "2026-11-12T00:00:00.000Z");
  assert.equal(
    sourceKey(" 123 ", "X", "", null),
    sourceKey("123", "Y", "", null),
  );
});

test("XLSX rejects invalid and oversized decompression metadata", () => {
  assert.throws(() => validateXlsxArchive(Buffer.from("not a zip")));
  const zip = Buffer.alloc(68);
  zip.writeUInt32LE(0x02014b50, 0);
  zip.writeUInt32LE(60 * 1024 * 1024, 24);
  zip.writeUInt32LE(0x06054b50, 46);
  zip.writeUInt16LE(1, 56);
  zip.writeUInt32LE(46, 58);
  assert.throws(() => validateXlsxArchive(zip), /te groot/);
});
