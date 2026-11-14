import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedTransferUrl, validateManifest } from "../src/onedrive";
const manifest = {
  format: "tuinwerk-backup-v2",
  manifestVersion: 1,
  id: "b6fdf85b-00b1-4cf5-ae01-515c98000000",
  archiveName: "b6fdf85b-00b1-4cf5-ae01-515c98000000.twb",
  createdAt: "2026-11-12T12:00:00Z",
  size: 100,
  sha256: "a".repeat(64),
  encryption: "aes-256-gcm+scrypt",
  contents: ["database", "uploads", "exports", "config"],
  appVersion: "0.2.0",
};
test("OneDrive transfer URLs require exact trusted HTTPS suffixes and no userinfo", () => {
  for (const valid of [
    "https://abc.up.1drv.com/upload?token=private",
    "https://tenant.sharepoint.com/file",
    "https://api.onedrive.com/rup/a",
  ])
    assert.equal(trustedTransferUrl(valid).protocol, "https:");
  for (const bad of [
    "http://abc.up.1drv.com/a",
    "https://127.0.0.1/a",
    "https://graph.microsoft.com.evil.test/a",
    "https://foo.sharepoint.com.evil.test/a",
    "https://admin:secret@abc.up.1drv.com/a",
    "https://abc.up.1drv.com:8443/a",
    "file:///etc/passwd",
  ])
    assert.throws(() => trustedTransferUrl(bad));
});
test("OneDrive manifests require owned UUID names, complete contents, size and hash", () => {
  assert.deepEqual(validateManifest(manifest), manifest);
  for (const extra of [
    { archiveName: "../../etc/passwd" },
    { id: "not-an-id" },
    { contents: ["database"] },
    { size: -1 },
    { size: 251 * 1024 ** 3 },
    { sha256: "bad" },
    { encryption: "none" },
  ])
    assert.throws(() => validateManifest({ ...manifest, ...extra }));
});
