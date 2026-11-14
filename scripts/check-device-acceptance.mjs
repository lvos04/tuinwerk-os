/** Checks record completeness and timestamp consistency; does not certify hardware execution. */
import fs from "node:fs";
const file = process.argv[2];
if (!file) throw Error("Provide a completed mobile acceptance JSON record.");
const r = JSON.parse(fs.readFileSync(file, "utf8")),
  issues = [];
const required = [
  "install_upgrade",
  "login_refresh_logout_isolation",
  "quick_report_camera_qr",
  "photo_annotation_upload_retry",
  "offline_relaunch",
  "offline_24h",
  "task_conflict_independent_sync",
  "last_part_concurrency",
  "permissions_and_biometrics",
  "push_recipient_and_navigation",
  "account_deletion",
  "export_and_restore_interface",
  "accessibility_and_large_text",
];
const date = (v) => (typeof v === "string" ? Date.parse(v) : NaN);
if (
  r.format !== "tuinwerk-mobile-acceptance-v1" ||
  !["ios", "android"].includes(r.platform) ||
  r.physicalDevice !== true
)
  issues.push("Physical iOS/Android device record required.");
for (const [name, value] of Object.entries({
  tester: r.tester,
  model: r.device?.model,
  osVersion: r.device?.osVersion,
  commit: r.build?.gitCommit,
  buildNumber: r.build?.buildNumber,
  artifactReference: r.build?.artifactReference,
  backend: r.backend?.url,
}))
  if (typeof value !== "string" || !value.trim())
    issues.push(name + " missing.");
if (!/^[a-f0-9]{40}$/i.test(r.build?.gitCommit || ""))
  issues.push("Record the full source commit.");
const start = date(r.startedAt),
  end = date(r.finishedAt),
  off = date(r.offline?.disconnectedAt),
  on = date(r.offline?.reconnectedAt);
if (
  ![start, end, off, on].every(Number.isFinite) ||
  end < start ||
  off < start ||
  on > end ||
  on - off < 86400000 ||
  end > Date.now() + 300000
)
  issues.push(
    "Consistent timestamps with at least 24 actual hours offline are required.",
  );
if (
  r.offline?.queueCountBeforeRestart !== r.offline?.queueCountAfterRestart ||
  !Number.isInteger(r.offline?.queueCountBeforeRestart) ||
  r.offline.queueCountBeforeRestart < 1
)
  issues.push("Durable queue must survive app termination.");
if (r.offline?.unresolvedConflictsAfterReview !== 0)
  issues.push("Review all conflicts explicitly.");
if (
  r.stockRace?.initial !== 1 ||
  r.stockRace?.acceptedOperations !== 1 ||
  r.stockRace?.rejectedOperations !== 1 ||
  r.stockRace?.final !== 0
)
  issues.push(
    "Last-part race must accept exactly one operation and end at zero.",
  );
for (const id of required) {
  const c = r.cases?.find((c) => c.id === id);
  if (
    c?.result !== "passed" ||
    !Array.isArray(c.evidence) ||
    !c.evidence.some((x) => typeof x === "string" && x.trim())
  )
    issues.push(id + ": passed result and evidence reference required.");
}
console.log(
  JSON.stringify(
    {
      record: file,
      consistent: issues.length === 0,
      hardwareExecutionIndependentlyVerified: false,
      issues,
    },
    null,
    2,
  ),
);
if (issues.length) process.exitCode = 1;
