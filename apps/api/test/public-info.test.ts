import "reflect-metadata";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/main";
import { pool } from "../src/db";
after(() => pool.end());
test(
  "public privacy metadata is anonymously accessible and strictly allowlisted",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const app = await createApp();
    await app.listen(0, "127.0.0.1");
    try {
      const response = await fetch((await app.getUrl()) + "/api/public/info");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body: any = await response.json();
      assert.deepEqual(
        Object.keys(body).sort(),
        [
          "companyName",
          "privacyContactEmail",
          "privacyRetentionDescription",
          "ready",
          "supportEmail",
          "updatedAt",
        ].sort(),
      );
      assert.equal(typeof body.companyName, "string");
      assert.equal(
        body.ready,
        !!(
          body.supportEmail &&
          body.privacyContactEmail &&
          body.privacyRetentionDescription
        ),
      );
    } finally {
      await app.close();
    }
  },
);
