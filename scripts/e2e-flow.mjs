/**
 * End-to-end: signup → firm → Cement engagement → upload → facts → run → sign-off.
 * Prints statuses only.
 */
import { readFileSync } from "node:fs";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv(new URL("../frontend/.env.local", import.meta.url));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const pub = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = env.SUPABASE_SERVICE_ROLE;
const ref = new URL(url).host.split(".")[0];
const app = "http://localhost:3000";
const email = `vs.flow.${Date.now()}@example.com`;
const password = "VerifyStack-e2e-pass-1";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function fail(step, extra) {
  console.log("FAIL", step, extra ?? "");
  process.exit(2);
}

const created = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
console.log("1_create_user", created.status);
if (!created.ok) fail("create_user", await created.text());

const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: pub, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
console.log("2_password_grant", tokenRes.status);
if (!tokenRes.ok) fail("password_grant", await tokenRes.text());
const session = await tokenRes.json();
const cookie = `sb-${ref}-auth-token=${encodeURIComponent(
  JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: "bearer",
    user: session.user,
  })
)}`;

async function api(path, init = {}) {
  const headers = { Cookie: cookie, ...(init.headers ?? {}) };
  return fetch(`${app}${path}`, { ...init, headers, redirect: "manual" });
}

const boot = await api("/api/bootstrap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ firmName: "E2E Flow LLP" }),
});
const bootJson = await boot.json();
console.log("3_bootstrap", boot.status, bootJson.ok);
if (!bootJson.ok) fail("bootstrap", JSON.stringify(bootJson));

const eng = await api("/api/engagements", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    packId: "CCTS-CEMENT-v1",
    clientName: "E2E Cement Works",
    plantName: "Line 1",
    complianceYear: "FY2025-26",
    geiTarget: 0.82,
  }),
});
const engJson = await eng.json();
console.log("4_engagement", eng.status, engJson.ok, engJson.engagement?.id ?? "");
if (!engJson.ok || !engJson.engagement?.id) fail("engagement", JSON.stringify(engJson));
const engagementId = engJson.engagement.id;

const upload = await api("/api/documents", {
  method: "POST",
  headers: {
    "Content-Type": "image/png",
    "x-filename": encodeURIComponent("invoice.png"),
    "x-engagement-id": engagementId,
  },
  body: PNG,
});
const uploadJson = await upload.json();
console.log("5_upload", upload.status, uploadJson.ok, uploadJson.error ?? "");
if (!uploadJson.ok) fail("upload", JSON.stringify(uploadJson));
const documentId = uploadJson.document.id;

const docsPage = await api(`/engagements/${engagementId}/documents`);
const docsHtml = await docsPage.text();
console.log("6_documents_page", docsPage.status, docsHtml.includes("invoice.png"));
if (!docsHtml.includes("invoice.png")) fail("documents_page_missing_file");

const bbox = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
const facts = [
  { field_path: "quantity", value_json: 18247, unit: "t", source_text: "18,247 MT" },
  { field_path: "calorificValue", value_json: 4200, unit: "kcal/kg", source_text: "GCV 4,200 kcal/kg" },
  { field_path: "activeEnergy", value_json: 22166.64, unit: "MWh", source_text: "22,166.64 MWh" },
  { field_path: "production", value_json: 1850000, unit: "t", source_text: "1,850,000 t" },
];
for (const f of facts) {
  const ins = await fetch(`${url}/rest/v1/facts`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      organization_id: bootJson.organizationId,
      engagement_id: engagementId,
      document_id: documentId,
      field_path: f.field_path,
      value_json: f.value_json,
      unit: f.unit,
      page: 1,
      bbox,
      source_text: f.source_text,
    }),
  });
  console.log("7_fact", f.field_path, ins.status);
  if (ins.status >= 300) fail("fact_" + f.field_path, await ins.text());
}

const run = await api("/api/runs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ engagementId }),
});
const runJson = await run.json();
console.log("8_run", run.status, runJson.ok, runJson.error ?? runJson.run?.input_hash?.slice(0, 12));
if (!runJson.ok) fail("run", JSON.stringify(runJson));

const factsPage = await api(`/engagements/${engagementId}/facts`);
const factsHtml = await factsPage.text();
console.log("9_facts_page", factsPage.status, factsHtml.includes("quantity"));

const runsPage = await api(`/engagements/${engagementId}/runs`);
const runsHtml = await runsPage.text();
console.log("10_runs_page", runsPage.status, /input.hash|GEI|tCO/i.test(runsHtml) || runsHtml.includes(runJson.run.input_hash.slice(0, 8)));

const findingsPage = await api(`/engagements/${engagementId}/findings`);
console.log("11_findings_page", findingsPage.status);

const listed = await fetch(
  `${url}/rest/v1/findings?engagement_id=eq.${engagementId}&select=id,severity,state`,
  { headers: { apikey: secret, Authorization: `Bearer ${secret}` } }
);
const findingRows = await listed.json();
const blocks = findingRows.filter((f) => f.severity === "block" && f.state !== "closed");
console.log("11b_open_blocks", blocks.length);
for (const f of blocks) {
  const closed = await api("/api/findings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      engagementId,
      findingId: f.id,
      state: "closed",
    }),
  });
  const closedJson = await closed.json();
  console.log("11c_close", f.id.slice(0, 8), closed.status, closedJson.ok);
  if (!closedJson.ok) fail("close_finding", JSON.stringify(closedJson));
}

const sign = await api("/api/signoff", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    engagementId,
    attestorName: "E2E Lead Verifier",
    statement: "Named attestation for the E2E cement run. Draft factors only.",
    role: "lead_verifier",
  }),
});
const signJson = await sign.json();
console.log("12_signoff", sign.status, signJson.ok, signJson.error ?? "");
if (!signJson.ok) fail("signoff", JSON.stringify(signJson));

const file = await api(`/api/documents/${documentId}/file`);
console.log("13_file", file.status, file.headers.get("content-type"));
if (file.status !== 200) fail("file", await file.text());

console.log("E2E_OK");
