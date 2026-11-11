import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32,
  totp,
  verifyTotp,
  encryptSecret,
  decryptSecret,
} from "../src/totp";
test("TOTP SHA1 RFC6238 vectors and time window", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  for (const [time, code] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totp(secret, time * 1000, 8), code);
  assert.equal(verifyTotp(secret, totp(secret, 90000), 90000), 3);
  assert.equal(verifyTotp(secret, totp(secret, 90000), 180000), null);
});
test("TOTP secrets are authenticated encrypted", () => {
  process.env.TOTP_ENCRYPTION_KEY = "a".repeat(64);
  const encrypted = encryptSecret("EXAMPLESECRET");
  assert.equal(decryptSecret(encrypted), "EXAMPLESECRET");
  assert.notEqual(encrypted, encryptSecret("EXAMPLESECRET"));
  assert.throws(() => decryptSecret(encrypted.slice(0, -2) + "00"));
});
