import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { runMaintenance } from "./recurrence";
import { reportingTick } from "./reporting";
import { pool } from "./db";
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runMaintenance();
    await reportingTick();
    if (result.failures?.length)
      throw new Error(
        "Onderhoudsregels mislukt: " +
          result.failures.map((f) => f.ruleId).join(","),
      );
    await writeFile("/tmp/tuinwerk-worker-health", String(Date.now()));
    console.log(JSON.stringify({ event: "maintenance", ...result }));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "maintenance_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    running = false;
  }
}
const timer = setInterval(() => void tick(), 60000);
void tick();
async function stop() {
  clearInterval(timer);
  while (running) await new Promise((r) => setTimeout(r, 100));
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
