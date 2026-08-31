/**
 * Live connectivity check. Prints counts only — never keys.
 * Usage: node scripts/probe-supabase.mjs
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

if (!url || !pub) {
  console.log("missing_public_env");
  process.exit(1);
}

console.log("url_host", new URL(url).host);
console.log("publishable_prefix", pub.slice(0, 14));
console.log("service_role_set", Boolean(secret && secret !== "your-service-role-key"));

const key = secret || pub;
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Prefer: "count=exact",
};

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  const text = await res.text();
  return { status: res.status, text, count: res.headers.get("content-range") };
}

const checks = [
  "methodology_packs?select=pack_id",
  "adeetie_clusters?select=id",
  "organizations?select=id",
  "engagements?select=id",
];

let failed = false;
for (const path of checks) {
  const table = path.split("?")[0];
  const { status, text, count } = await rest(`${path}&limit=0`);
  if (status >= 400) {
    console.log(`${table}: ERROR ${status} ${text.slice(0, 180)}`);
    failed = true;
  } else {
    console.log(`${table}: ${count ?? "ok"} (HTTP ${status})`);
  }
}

const packs = await fetch(
  `${url}/rest/v1/methodology_packs?select=pack_id,status&pack_id=in.(CCTS-CEMENT-v1,CCTS-IRON-AND-STEEL-v1,CCTS-ALUMINIUM-v1,ADEETIE-FOUNDRY-v1)`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }
);
const packText = await packs.text();
if (!packs.ok) {
  console.log("runnable_packs: ERROR", packs.status, packText.slice(0, 180));
  failed = true;
} else {
  const rows = JSON.parse(packText);
  console.log(
    "runnable_packs:",
    rows.map((p) => `${p.pack_id}:${p.status}`).join(", ") || "(none)"
  );
}

process.exit(failed ? 2 : 0);
