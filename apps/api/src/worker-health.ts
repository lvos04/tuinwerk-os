/**
 * Bestand waarin de worker na elke geslaagde onderhoudsronde een tijdstempel
 * schrijft. Instelbaar met WORKER_HEALTH_FILE; standaard het bestaande pad, zodat
 * de container-healthcheck (deploy/custom-app/health.cjs) blijft werken.
 */
export const DEFAULT_WORKER_HEALTH_FILE = "/tmp/tuinwerk-worker-health";
export function workerHealthFile() {
  return process.env.WORKER_HEALTH_FILE || DEFAULT_WORKER_HEALTH_FILE;
}
