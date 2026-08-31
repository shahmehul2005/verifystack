/**
 * End-to-end: create/confirm a user, bootstrap a firm, load /engagements.
 * Prints statuses only — no tokens.
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
const email = `vs.e2e.${Date.now()}@example.com`;
const password = "VerifyStack-e2e-pass-1";

const adminHeaders = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};

const created = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({ email, password, email_confirm: true }),
});
console.log("admin_create_user", created.status);
if (!created.ok) {
  console.log("admin_create_user_body", (await created.text()).slice(0, 200));
  process.exit(1);
}

const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: pub,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password }),
});
console.log("password_grant", tokenRes.status);
if (!tokenRes.ok) {
  console.log("password_grant_body", (await tokenRes.text()).slice(0, 200));
  process.exit(1);
}
const session = await tokenRes.json();
const cookieName = `sb-${ref}-auth-token`;
const cookieValue = encodeURIComponent(
  JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type ?? "bearer",
    user: session.user,
  })
);
const cookie = `${cookieName}=${cookieValue}`;

const boot = await fetch("http://localhost:3000/api/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
  },
  body: JSON.stringify({ firmName: "E2E Verification LLP" }),
  redirect: "manual",
});
const bootJson = await boot.json().catch(() => ({}));
console.log("bootstrap", boot.status, bootJson.ok, Boolean(bootJson.organizationId));

const page = await fetch("http://localhost:3000/engagements", {
  headers: { Cookie: cookie },
  redirect: "manual",
});
const html = await page.text();
console.log("engagements", page.status);
console.log("has_create_firm", html.includes("Create my firm"));
console.log("has_new_engagement", html.includes("New engagement") || html.includes("No engagements yet"));
console.log("has_forbidden", html.includes("Forbidden"));
console.log("has_configure", html.includes("Configure Supabase"));

if (!bootJson.ok || html.includes("Create my firm") || page.status !== 200) {
  process.exit(2);
}
