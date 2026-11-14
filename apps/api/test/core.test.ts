import { test } from "node:test";
import assert from "node:assert/strict";
import { statusChange, validateTask } from "../src/core";
import { passwordHash, passwordMatches } from "../src/auth";
test("afronden vereist verplichte checklist; heropenen vereist reden", () => {
  assert.throws(() =>
    statusChange(
      { status: "open", checklist: [{ required: true, done: false }] },
      { status: "completed" },
    ),
  );
  assert.throws(() =>
    statusChange({ status: "completed" }, { status: "open" }),
  );
  assert.doesNotThrow(() =>
    statusChange(
      { status: "completed" },
      { status: "open", reason: "Defect niet opgelost" },
    ),
  );
  assert.throws(() => statusChange({ status: "open" }, { status: "blocked" }));
});
test("taakvalidatie weigert ongeldige prioriteit, tijd, medewerker en titel", () => {
  for (const input of [
    { priority: "urgent" },
    { estimatedMinutes: -1 },
    { assignedTo: ["niet-id"] },
    { title: " " },
    { deadline: "morgen" },
  ])
    assert.throws(() => validateTask(input));
});
test("wachtwoorden gehasht met random salt en minimale lengte", () => {
  const a = passwordHash("EenLangWachtwoord123!"),
    b = passwordHash("EenLangWachtwoord123!");
  assert.notEqual(a, b);
  assert.equal(passwordMatches("EenLangWachtwoord123!", a), true);
  assert.equal(passwordMatches("fout", a), false);
  assert.throws(() => passwordHash("kort"));
});

test("afgeronde taak blijft checklistinvariant afdwingen zonder statusmutatie", () => {
  assert.throws(() =>
    statusChange(
      { status: "completed", checklist: [] },
      { checklist: [{ required: true, done: false }] },
    ),
  );
  assert.throws(() =>
    statusChange(
      { status: "completed", checklist: [] },
      { status: "completed", checklist: [{ required: true, done: false }] },
    ),
  );
});
