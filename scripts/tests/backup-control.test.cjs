const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  encrypt,
  decrypt,
  validateRequest,
  hash,
} = require("../../deploy/custom-app/backup-control.cjs");
test("encrypted archives roundtrip, reject wrong recovery secret and tampering without leaving plaintext", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "twbackup-"));
  try {
    const original = path.join(dir, "original"),
      archive = path.join(dir, "data.twb"),
      restored = path.join(dir, "restored");
    await fs.writeFile(original, crypto.randomBytes(1024 * 1024));
    await encrypt(original, archive, "a recovery secret kept elsewhere");
    assert.notEqual(await hash(original), await hash(archive));
    await decrypt(archive, restored, "a recovery secret kept elsewhere");
    assert.equal(await hash(original), await hash(restored));
    const rejected = path.join(dir, "rejected");
    await assert.rejects(
      decrypt(archive, rejected, "a different recovery secret"),
    );
    await assert.rejects(fs.stat(rejected));
    const bytes = await fs.readFile(archive);
    bytes[100] ^= 1;
    await fs.writeFile(archive, bytes);
    await assert.rejects(
      decrypt(archive, rejected, "a recovery secret kept elsewhere"),
    );
    await assert.rejects(fs.stat(rejected));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("root helper rejects commands, traversal, missing confirmation and weak recovery codes", () => {
  const r = {
    id: crypto.randomUUID(),
    requestedBy: crypto.randomUUID(),
    archive: crypto.randomUUID() + ".twb",
    operation: "backup",
    recoverySecret: "long recovery phrase",
  };
  assert.equal(validateRequest(r), r);
  for (const change of [
    { operation: "shell" },
    { archive: "../settings.key" },
    { recoverySecret: "short" },
    { operation: "restore" },
    { retentionDays: 0 },
  ])
    assert.throws(() => validateRequest({ ...r, ...change }));
});

test("durable atomic status remains group-readable under restrictive runtime umask", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "twstatus-"));
  const previous = process.umask(0o077);
  try {
    const file = path.join(dir, "result.json");
    await require("../../deploy/custom-app/backup-control.cjs").atomic(file, {
      state: "completed",
    });
    assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
    assert.equal(
      JSON.parse(await fs.readFile(file, "utf8")).state,
      "completed",
    );
    assert.deepEqual(await fs.readdir(dir), ["result.json"]);
  } finally {
    process.umask(previous);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
