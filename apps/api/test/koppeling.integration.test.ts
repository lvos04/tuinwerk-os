import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { pool, query } from "../src/db";
import { passwordHash } from "../src/auth";
import { createApp } from "../src/main";
import { parseDatasetParams, resetKoppelingRateLimit } from "../src/koppeling";
after(() => pool.end());

test("dataset parameters are validated strictly", () => {
  assert.deepEqual(parseDatasetParams({}), {
    sinds: null,
    limiet: 100,
    cursor: null,
  });
  assert.equal(parseDatasetParams({ limiet: "500" }).limiet, 500);
  for (const q of [
    { limiet: "0" },
    { limiet: "501" },
    { limiet: "1.5" },
    { limiet: ["1", "2"] },
    { sinds: "gisteren" },
    { sinds: "2026-11-16T15:00:00" },
    { cursor: "%%%" },
  ])
    assert.throws(
      () => parseDatasetParams(q),
      (e: any) => e.getStatus() === 422,
    );
  assert.equal(
    parseDatasetParams({ sinds: "2026-11-16T15:00:00+01:00" }).sinds,
    "2026-11-16T15:00:00+01:00",
  );
});

test(
  "Bedrijfskoppeling API v1: sleutelbeheer, authenticatie, samenvatting en datasets",
  { skip: !process.env.DATABASE_URL },
  async () => {
    resetKoppelingRateLimit();
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    try {
      const base = (await app.getUrl()) + "/api";
      const suffix = randomUUID();
      const adminEmail = `koppel-admin-${suffix}@test.invalid`,
        employeeEmail = `koppel-employee-${suffix}@test.invalid`;
      const [admin] = await query(
        "INSERT INTO users(email,name,password_hash,role) VALUES($1,'Koppelbeheerder',$3,'admin'),($2,'Koppelmedewerker',$3,'employee') RETURNING id",
        [adminEmail, employeeEmail, passwordHash("KoppelPassword123!")],
      );
      const call = (
        path: string,
        token?: string,
        body?: any,
        method?: string,
      ) =>
        fetch(base + path, {
          method: method || (body ? "POST" : "GET"),
          headers: {
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      const login = async (email: string) =>
        (
          (await (
            await call("/auth/login", undefined, {
              email,
              password: "KoppelPassword123!",
            })
          ).json()) as any
        ).token as string;
      const adminToken = await login(adminEmail),
        employeeToken = await login(employeeEmail);

      // Only administrators manage keys.
      assert.equal((await call("/admin/koppelsleutels")).status, 401);
      assert.equal(
        (await call("/admin/koppelsleutels", employeeToken)).status,
        403,
      );
      assert.equal(
        (
          await call("/admin/koppelsleutels", employeeToken, {
            naam: "Stiekem",
          })
        ).status,
        403,
      );
      assert.equal(
        (await call("/admin/koppelsleutels", adminToken, { naam: " " })).status,
        400,
      );

      const created = await call("/admin/koppelsleutels", adminToken, {
        naam: "Bedrijfsdashboard",
      });
      assert.equal(created.status, 201);
      const key = (await created.json()) as any;
      assert.match(key.sleutel, /^bk_[A-Za-z0-9_-]{43}$/);
      assert.equal(key.voorvoegsel, key.sleutel.slice(0, 8));
      assert.equal(key.naam, "Bedrijfsdashboard");
      const [stored] = await query("SELECT * FROM koppelsleutels WHERE id=$1", [
        key.id,
      ]);
      assert.equal(
        stored.sleutel_hash,
        createHash("sha256").update(key.sleutel).digest("hex"),
      );
      assert.equal(stored.aangemaakt_door, admin.id);
      assert.ok(!JSON.stringify(stored).includes(key.sleutel));
      const listed = (await (
        await call("/admin/koppelsleutels", adminToken)
      ).json()) as any[];
      const mine = listed.find((k) => k.id === key.id);
      assert.equal(mine.voorvoegsel, key.voorvoegsel);
      assert.equal(mine.aangemaakt_door, "Koppelbeheerder");
      assert.ok(!("sleutel" in mine) && !("sleutel_hash" in mine));
      assert.ok(!JSON.stringify(listed).includes(key.sleutel));
      assert.ok(!JSON.stringify(listed).includes(stored.sleutel_hash));
      const [createdAudit] = await query(
        "SELECT * FROM audit_events WHERE entity_type='koppelsleutel' AND entity_id=$1 AND action='created'",
        [key.id],
      );
      assert.equal(createdAudit.actor_id, admin.id);
      assert.ok(!JSON.stringify(createdAudit).includes(key.sleutel));

      // 401 without, with unknown, and with session tokens.
      for (const token of [
        undefined,
        "bk_" + "A".repeat(43),
        "onzin",
        adminToken,
      ]) {
        const r = await call("/koppeling/v1/info", token);
        assert.equal(r.status, 401);
        assert.deepEqual(await r.json(), { fout: "ongeldige_koppelsleutel" });
      }

      const info = await call("/koppeling/v1/info", key.sleutel);
      assert.equal(info.status, 200);
      const infoBody = (await info.json()) as any;
      assert.equal(infoBody.app, "tuinwerk-os");
      assert.equal(infoBody.api_versie, "1");
      assert.equal(infoBody.naam, "TuinWerk OS");
      assert.equal(typeof infoBody.versie, "string");
      assert.ok(
        [
          "samenvatting",
          "storingen",
          "onderhoudstaken",
          "voorraad",
          "planning",
        ].every((d) => infoBody.datasets.includes(d)),
      );
      assert.ok(Number.isFinite(Date.parse(infoBody.tijd)));
      assert.ok(
        (
          await query(
            "SELECT laatst_gebruikt_op FROM koppelsleutels WHERE id=$1",
            [key.id],
          )
        )[0].laatst_gebruikt_op,
      );

      // Seed faults far in the future so `sinds` isolates them from other tests.
      const anchor = new Date(Date.now() + 100 * 365 * 86400000);
      anchor.setUTCMilliseconds(0);
      const seeded: string[] = [];
      for (let i = 0; i < 3; i++) {
        const [t] = await query(
          "INSERT INTO tasks(title,description,category,priority,created_by,updated_by,updated_at) VALUES($1,'Privénotitie van Jan 06-12345678','storing',$2,$3,$3,$4) RETURNING id",
          [
            "Koppeltest pomp " + i,
            i === 0 ? "critical" : "normal",
            admin.id,
            new Date(anchor.getTime() + i * 1000),
          ],
        );
        seeded.push(t.id);
      }
      await query(
        "INSERT INTO tasks(title,category,status,created_by,updated_by,updated_at) VALUES('Koppeltest verborgen','storing','open',$1,$1,$2)",
        [admin.id, new Date(anchor.getTime() + 5000)],
      );
      await query(
        "UPDATE tasks SET moderation_hidden=true WHERE title='Koppeltest verborgen'",
      );

      const summaryResponse = await call(
        "/koppeling/v1/samenvatting",
        key.sleutel,
      );
      assert.equal(summaryResponse.status, 200);
      const summary = (await summaryResponse.json()) as any;
      assert.equal(summary.app, "tuinwerk-os");
      assert.ok(Number.isFinite(Date.parse(summary.gegenereerd_op)));
      assert.ok(summary.kpis.length >= 4 && summary.kpis.length <= 8);
      for (const k of summary.kpis) {
        assert.deepEqual(Object.keys(k).sort(), [
          "eenheid",
          "label",
          "sleutel",
          "status",
          "toelichting",
          "waarde",
        ]);
        assert.ok(["ok", "let_op", "actie", "onbekend"].includes(k.status));
        assert.ok(k.waarde === null || typeof k.waarde === "number");
      }
      for (const m of summary.meldingen) {
        assert.ok(["info", "waarschuwing", "kritiek"].includes(m.niveau));
        assert.equal(typeof m.tekst, "string");
        assert.ok(m.sinds === null || Number.isFinite(Date.parse(m.sinds)));
      }
      const faults = summary.kpis.find(
        (k: any) => k.sleutel === "open_storingen",
      );
      const [count] = await query(
        "SELECT count(*)::integer AS n FROM tasks WHERE category IN ('reparatie','storing') AND status NOT IN ('completed','cancelled','archived') AND NOT moderation_hidden",
      );
      assert.equal(faults.waarde, count.n);
      assert.equal(faults.status, "actie");
      assert.ok(
        summary.kpis.some((k: any) => k.sleutel === "onderdelen_onder_minimum"),
      );
      assert.ok(
        summary.kpis.some((k: any) => k.sleutel === "planning_bezetting_week"),
      );

      // Dataset paging with `sinds`, `limiet` and an opaque cursor.
      const sinds = encodeURIComponent(anchor.toISOString());
      const page1 = (await (
        await call(
          `/koppeling/v1/datasets/storingen?sinds=${sinds}&limiet=2`,
          key.sleutel,
        )
      ).json()) as any;
      assert.equal(page1.app, "tuinwerk-os");
      assert.equal(page1.dataset, "storingen");
      assert.deepEqual(
        page1.items.map((x: any) => x.id),
        seeded.slice(0, 2),
      );
      assert.ok(page1.volgende_cursor);
      const page2 = (await (
        await call(
          `/koppeling/v1/datasets/storingen?sinds=${sinds}&limiet=2&cursor=${page1.volgende_cursor}`,
          key.sleutel,
        )
      ).json()) as any;
      assert.deepEqual(
        page2.items.map((x: any) => x.id),
        seeded.slice(2),
      );
      assert.equal(page2.volgende_cursor, null);
      const item = page1.items[0];
      assert.equal(item.titel, "Koppeltest pomp 0");
      assert.equal(item.prioriteit, "kritiek");
      assert.equal(item.status, "open");
      assert.equal(item.bijgewerkt_op, anchor.toISOString());
      const serialized = JSON.stringify([page1, page2]);
      assert.ok(!serialized.includes("Privénotitie"));
      assert.ok(!serialized.includes("verborgen"));
      assert.ok(!serialized.includes("@test.invalid"));
      const later = encodeURIComponent(
        new Date(anchor.getTime() + 1000).toISOString(),
      );
      const newer = (await (
        await call(
          `/koppeling/v1/datasets/storingen?sinds=${later}`,
          key.sleutel,
        )
      ).json()) as any;
      assert.deepEqual(
        newer.items.map((x: any) => x.id),
        seeded.slice(1),
      );

      for (const naam of [
        "onderhoudstaken",
        "voorraad",
        "planning",
        "samenvatting",
      ]) {
        const r = await call(
          `/koppeling/v1/datasets/${naam}?limiet=500`,
          key.sleutel,
        );
        assert.equal(r.status, 200, naam);
        const body = (await r.json()) as any;
        assert.ok(Array.isArray(body.items));
        for (const x of body.items) assert.ok(x.id, naam);
        assert.ok(!JSON.stringify(body).includes("@test.invalid"), naam);
      }
      const planning = (await (
        await call(
          "/koppeling/v1/datasets/planning?limiet=7&sinds=2026-11-16",
          key.sleutel,
        )
      ).json()) as any;
      assert.equal(planning.items.length, 7);
      assert.equal(planning.items[0].datum, "2026-11-16");
      assert.ok(planning.volgende_cursor);
      const planning2 = (await (
        await call(
          `/koppeling/v1/datasets/planning?limiet=100&cursor=${planning.volgende_cursor}`,
          key.sleutel,
        )
      ).json()) as any;
      assert.equal(planning2.items[0].datum, "2026-11-23");
      assert.equal(planning2.items.length, 21);
      assert.equal(planning2.volgende_cursor, null);

      const unknown = await call(
        "/koppeling/v1/datasets/medewerkers",
        key.sleutel,
      );
      assert.equal(unknown.status, 404);
      assert.deepEqual(await unknown.json(), { fout: "onbekende_dataset" });
      for (const qs of [
        "limiet=0",
        "limiet=501",
        "sinds=gisteren",
        "cursor=xyz",
      ])
        assert.equal(
          (await call(`/koppeling/v1/datasets/storingen?${qs}`, key.sleutel))
            .status,
          422,
          qs,
        );

      // Rate limit per key.
      resetKoppelingRateLimit();
      const statuses: number[] = [];
      for (let i = 0; i < 121; i++)
        statuses.push((await call("/koppeling/v1/info", key.sleutel)).status);
      assert.equal(statuses.filter((s) => s === 200).length, 120);
      assert.equal(statuses[120], 429);
      resetKoppelingRateLimit();

      // Revocation: employees cannot revoke, admins can; the key stops working immediately.
      assert.equal(
        (
          await call(
            "/admin/koppelsleutels/" + key.id,
            employeeToken,
            undefined,
            "DELETE",
          )
        ).status,
        403,
      );
      const revoked = await call(
        "/admin/koppelsleutels/" + key.id,
        adminToken,
        undefined,
        "DELETE",
      );
      assert.equal(revoked.status, 200);
      assert.ok(((await revoked.json()) as any).ingetrokken_op);
      const denied = await call("/koppeling/v1/samenvatting", key.sleutel);
      assert.equal(denied.status, 401);
      assert.deepEqual(await denied.json(), {
        fout: "ongeldige_koppelsleutel",
      });
      assert.equal(
        (
          await query(
            "SELECT count(*)::integer AS n FROM audit_events WHERE entity_type='koppelsleutel' AND entity_id=$1 AND action='revoked'",
            [key.id],
          )
        )[0].n,
        1,
      );
      assert.equal(
        (
          await call(
            "/admin/koppelsleutels/" + randomUUID(),
            adminToken,
            undefined,
            "DELETE",
          )
        ).status,
        404,
      );
      await query(
        "DELETE FROM tasks WHERE id=ANY($1) OR title='Koppeltest verborgen'",
        [seeded],
      );
    } finally {
      await app.close();
    }
  },
);
