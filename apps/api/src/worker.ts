import "reflect-metadata";
import { writeFile } from "node:fs/promises";
import { backupTick, stopBackupProcessing } from "./backups";
import { startRuntimeSettings, refreshRuntimeSettings } from "./settings";
import { runMaintenance } from "./recurrence";
import { reportingTick } from "./reporting";
import { pool } from "./db";
import { processPrivacyFileCleanup } from "./account-privacy";
let running = false,
  backupRunning = false,
  stopping = false;
let timer: ReturnType<typeof setInterval> | undefined,
  backupTimer: ReturnType<typeof setInterval> | undefined,
  stopSettings: (() => void) | undefined;
async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    await refreshRuntimeSettings();
    await processPrivacyFileCleanup();
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
async function backupLoop() {
  if (backupRunning || stopping) return;
  backupRunning = true;
  try {
    await backupTick();
  } catch {
    console.error(
      JSON.stringify({
        event: "backup_tick_failed",
        message:
          "Back-upverwerking mislukt; controleer de back-upstatus in Beheer",
      }),
    );
  } finally {
    backupRunning = false;
  }
}
void startRuntimeSettings()
  .then((stop) => {
    stopSettings = stop;
    if (stopping) {
      stop();
      return;
    }
    timer = setInterval(() => void tick(), 60000);
    backupTimer = setInterval(() => void backupLoop(), 60000);
    void tick();
    void backupLoop();
  })
  .catch(() => {
    console.error(
      JSON.stringify({
        event: "worker_start_failed",
        message: "Configuratie kon niet veilig worden geladen",
      }),
    );
    process.exitCode = 1;
    void pool.end();
  });
async function stop() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (backupTimer) clearInterval(backupTimer);
  stopSettings?.();
  stopBackupProcessing();
  const deadline = Date.now() + 20000;
  while ((running || backupRunning) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (running || backupRunning) {
    console.error(
      JSON.stringify({
        event: "worker_shutdown_timeout",
        message: "Onvoltooide jobs worden na herstart opnieuw gecontroleerd",
      }),
    );
    process.exit(0);
  }
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
