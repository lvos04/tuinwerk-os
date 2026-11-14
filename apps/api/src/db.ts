import { Pool, PoolClient, QueryResultRow } from "pg";
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
});
export async function query<T extends QueryResultRow = any>(
  sql: string,
  params: any[] = [],
): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export function camel(row: any): any {
  if (Array.isArray(row)) return row.map(camel);
  if (row instanceof Date) return row.toISOString();
  if (row && typeof row === "object")
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        camel(v),
      ]),
    );
  return row;
}
export async function audit(
  c: PoolClient,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  details: any = {},
) {
  await c.query(
    "INSERT INTO audit_events(actor_id,entity_type,entity_id,action,details) VALUES($1,$2,$3,$4,$5)",
    [actorId, entityType, entityId, action, JSON.stringify(details)],
  );
}
