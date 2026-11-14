/** Opt-in fictional review data for an isolated backend; never use production. */
import { createHash, randomUUID } from "node:crypto";
if (process.env.REVIEW_FIXTURE_CONFIRM !== "ISOLATED_TEST_SERVER")
  throw Error(
    "Confirm an isolated test server with REVIEW_FIXTURE_CONFIRM=ISOLATED_TEST_SERVER.",
  );
const endpoint = new URL(process.env.REVIEW_BACKEND_URL || "");
if (endpoint.protocol !== "https:")
  throw Error("Review backend must have public HTTPS.");
const base = endpoint.origin + "/api";
let token;
async function api(path, body, method = "GET") {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error("Review setup failed at " + path + " (HTTP " + r.status + ").");
  return data;
}
function operationId(label) {
  const b = createHash("sha256").update(label).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = b.toString("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-" +
    h.slice(12, 16) +
    "-" +
    h.slice(16, 20) +
    "-" +
    h.slice(20)
  );
}
const owner = await api(
  "/auth/login",
  {
    email: process.env.REVIEW_OWNER_EMAIL,
    password: process.env.REVIEW_OWNER_PASSWORD,
  },
  "POST",
);
if (owner.user.role !== "admin")
  throw Error("Fixture owner must be a review-server administrator.");
token = owner.token;
const publicInfo = await api("/public/info");
if (publicInfo.ready !== true)
  throw Error(
    "Configure real support/privacy contact details in the isolated server first.",
  );
let users = await api("/users");
async function reviewer(email, password, role) {
  if (!email || !password || password.length < 12)
    throw Error(
      "Separate reviewer account and strong password required in environment.",
    );
  if (email === owner.user.email)
    throw Error("Reviewer account must differ from fixture-owner account.");
  let user = users.find((u) => u.email === email);
  if (user && user.role !== role)
    throw Error(
      "Existing reviewer account has a different role; review manually.",
    );
  if (!user) {
    user = await api(
      "/users",
      {
        email,
        password,
        name:
          role === "admin"
            ? "Store-review beheerder"
            : "Store-review medewerker",
        role,
      },
      "POST",
    );
    users.push(user);
  }
  await api("/auth/login", { email, password }, "POST");
  return user;
}
const employee = await reviewer(
  process.env.REVIEWER_EMAIL,
  process.env.REVIEWER_PASSWORD,
  "employee",
);
if (process.env.REVIEWER_ADMIN_EMAIL || process.env.REVIEWER_ADMIN_PASSWORD)
  await reviewer(
    process.env.REVIEWER_ADMIN_EMAIL,
    process.env.REVIEWER_ADMIN_PASSWORD,
    "admin",
  );
const locations = await api("/locations");
let location = locations.find((l) => l.name === "[REVIEW] Demokas");
if (!location)
  location = await api(
    "/locations",
    { name: "[REVIEW] Demokas", type: "voorbeeldlocatie" },
    "POST",
  );
const assets = await api("/assets");
let asset = assets.find((a) => a.name === "[REVIEW] Demopomp");
if (!asset)
  asset = await api(
    "/assets",
    {
      name: "[REVIEW] Demopomp",
      locationId: location.id,
      manufacturer: "Fictief voorbeeld",
      model: "DEMO-01",
      notes: "Uitsluitend fictieve app-reviewgegevens.",
    },
    "POST",
  );
let items = await api("/inventory/items?q=REVIEW-PACKING");
let item = items.find((i) => i.sku === "REVIEW-PACKING-001");
if (!item)
  item = await api(
    "/inventory/items",
    {
      sku: "REVIEW-PACKING-001",
      name: "[REVIEW] Voorbeeldpakking",
      unit: "stuk",
      minimum: 3,
    },
    "POST",
  );
await api(
  "/inventory/movements",
  {
    operationId: operationId("review-receipt:" + item.id),
    itemId: item.id,
    locationId: location.id,
    type: "receipt",
    quantity: 5,
    reason: "Fictieve beginvoorraad voor store-review",
  },
  "POST",
);
for (const [index, title] of [
  "Controleer demopomp",
  "Vervang voorbeeldpakking",
  "Inspecteer fictieve leiding",
].entries()) {
  await api(
    "/tasks",
    {
      operationId: operationId("review-task:" + owner.user.id + ":" + index),
      title: "[REVIEW] " + title,
      description:
        "Dit is een fictieve werkopdracht voor de app-review. Er staan geen echte bedrijfsgegevens in deze testinstallatie.",
      locationId: location.id,
      assetId: asset.id,
      assignedTo: [employee.id],
      priority: index === 1 ? "high" : "normal",
      checklist: [
        {
          id: operationId("review-check:" + owner.user.id + ":" + index),
          text: "Controleer de voorbeeldsituatie",
          required: true,
          done: false,
        },
      ],
    },
    "POST",
  );
}
console.log(
  JSON.stringify({
    fixture: "fictional-store-review",
    server: base,
    employeeReady: true,
    optionalAdminReady: !!process.env.REVIEWER_ADMIN_EMAIL,
    credentialsPrinted: false,
    instruction:
      "Provide reviewer credentials only in private App Store Connect/Play Console review fields.",
  }),
);
