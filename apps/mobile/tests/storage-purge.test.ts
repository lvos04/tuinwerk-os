import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
// Execute the real SQLite schema in a separate SQLite engine; Expo native I/O remains a device acceptance check.
test("durable account tombstone prevents late inserts/upserts after purge without affecting another owner", () => {
  const source = readFileSync(
    new URL("../src/storage.ts", import.meta.url),
    "utf8",
  );
  const schema = source.match(/connection\.execAsync\(`([\s\S]*?)`\)/)?.[1];
  assert.ok(schema);
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import sqlite3,sys
c=sqlite3.connect(':memory:')
c.executescript(sys.stdin.read())
c.execute("INSERT INTO cache VALUES('deleted','tasks','old')")
c.execute("INSERT INTO deleted_owners VALUES('deleted')")
c.execute("INSERT INTO cache VALUES('deleted','tasks','late') ON CONFLICT(owner,name) DO UPDATE SET json=excluded.json")
assert c.execute("SELECT json FROM cache").fetchone()[0]=='old'
c.execute("DELETE FROM cache WHERE owner='deleted'")
c.execute("INSERT INTO cache VALUES('deleted','tasks','late')")
c.execute("INSERT INTO operations(id,owner,json) VALUES('op','deleted','{}')")
assert c.execute('SELECT count(*) FROM cache').fetchone()[0]==0
assert c.execute('SELECT count(*) FROM operations').fetchone()[0]==0
c.execute("INSERT INTO cache VALUES('another','tasks','allowed')")
assert c.execute('SELECT json FROM cache').fetchone()[0]=='allowed'
`,
    ],
    { input: schema, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
