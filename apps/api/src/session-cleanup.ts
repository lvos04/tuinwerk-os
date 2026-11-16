import { query } from "./db";
let lastSessionCleanup = 0;
export function resetSessionCleanup() {
  lastSessionCleanup = 0;
}
const SESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Dagelijks: sessies waarvan ook het vernieuwingstoken verlopen is, verwijderen. */
export async function cleanupSessions(now = Date.now()) {
  if (now - lastSessionCleanup < SESSION_CLEANUP_INTERVAL_MS) return null;
  const rows = await query(
    "DELETE FROM sessions WHERE refresh_expires_at<now() RETURNING id",
  );
  lastSessionCleanup = now;
  if (rows.length)
    console.log(
      JSON.stringify({ event: "sessions_cleanup", removed: rows.length }),
    );
  return rows.length;
}
