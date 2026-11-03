# Security

VerifyStack holds confidential plant evidence for competing verification firms. This document
describes how that data is protected, what is not yet in place, and how to report a problem.

## Reporting a vulnerability

Do not open a public issue. Email the founders at **security@[verifystack.me]** with steps to
reproduce, the affected route or file, and the impact you observed.

Only the `main` branch and the current production deployment are supported.

## Data we handle

| Data                     | Where                                    | Notes                                                    |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| Evidence files           | Supabase Storage, private `evidence` bucket | Bills, invoices, lab certificates, production logs. May contain personal data. |
| Extracted fields, facts  | Postgres, per organisation               | Values with page, bounding box and verbatim source text. |
| Runs, findings, sign-offs| Postgres, per organisation               | Hash-chained runs; named signatures.                     |
| Accounts                 | Supabase Auth                            | Email and password hash, or Google identity.             |
| Audit log                | Postgres `audit_events`                  | Append-only.                                             |

## Controls

**Tenant isolation.** Every tenant table carries `organization_id` with Row Level Security on
`is_org_member()`. Route handlers resolve the session's organisation and filter every query by
it; most use the service-role client, so that filter is the effective boundary on those paths
([ADR 0008](docs/decisions/0008-tenant-isolation.md)).

**Server-only writes.** The anon key is public and a signed-in user holds their own session JWT,
so they can call PostgREST directly. From migration 0012, signed-in users may only `select`
their organisation's rows; insert, update and delete are revoked on every tenant table,
memberships, organisations, factor tables and the audit log. Every write goes through a route
handler, which is where capabilities, maker–checker, the status machine and the steward check
are enforced.

**Authorisation.** Four roles with a single capability map (`backend/lib/auth/capabilities.ts`)
checked by nav, pages and routes. Sign-off needs two different people in two different roles,
and is refused while a `block` finding is open. An engagement reaches `submitted` only by
completing both sign-offs; the status endpoint refuses it and refuses skipped steps. Only
platform stewards can change reference factors.

**Evidence.** Files are SHA-256 hashed and stored under their hash in a private bucket. The
upload route identifies the type from the file's leading bytes, not the client's
`Content-Type`, and accepts only PDF, PNG, JPEG and WebP up to 50 MB; truncated bodies are
refused. Filenames are stripped of paths and control characters. There are no client storage
policies. Reads go through `/api/documents/[id]/file`, which checks capability and organisation,
returns `Cache-Control: private` and `X-Content-Type-Options: nosniff`, and serves anything
outside the four types as a download.

**Integrity.** `audit_events`, `calculation_runs`, `signoffs`, `facts` and
`factor_verifications` are append-only: a trigger refuses update and delete for every role,
including the service role. Audit events are written only by the server through
`append_audit_event_as()`, which records the acting user. Calculation runs record engine
version, pack version and input hash, and are chained to the previous run. A trigger stops an
engagement being rebound to another pack.

**Authentication.** Supabase Auth. Self-serve signup sends an email confirmation link before the
account can sign in. Invites are HMAC-SHA256 signed tokens bound to one email, one organisation
and one role, valid for 14 days, signed with `INVITE_SIGNING_SECRET`. An invite never changes
the password of a confirmed account: the invitee must enter their existing password.
`AUTH_OPEN_SIGNUP=false` makes the product invite-only; `AUTH_SIGNUP_ALLOWED_DOMAINS` limits
self-serve signup to listed domains. The same gate applies to a first Google sign-in. Links in
emails are built from `APP_URL` or the request URL, never from the `Origin` header.

**Abuse limits.** Per-IP and per-email limits on signup, per-IP on invite lookup, per-user on
sending invites, creating a firm, and every route that calls a model. Request fields have length
caps. In production, unexpected errors return a generic message; details go to the server log.

**Browser hardening.** `proxy.ts` refuses state-changing `/api` requests from another site
(`Origin` or `Sec-Fetch-Site`). Every response carries `X-Frame-Options: SAMEORIGIN`,
`frame-ancestors 'self'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (invite
tokens travel in the URL) and, in production, HSTS.

**Secrets.** `SUPABASE_SERVICE_ROLE`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `INNGEST_SIGNING_KEY` and
`SENTRY_AUTH_TOKEN` are server-only and must never use a `NEXT_PUBLIC_` name. Modules that use
them start with `import "server-only"`, which fails the build if a Client Component imports them.
`.env*` files are git-ignored except `.env.example`.

**AI processing.** When `GEMINI_API_KEY` is set, evidence pages are sent to the Google Gemini API
for classification and extraction, and finding text is sent for citation and CAR drafting.
Routes that call a model require a session with the matching capability. Model output is stored
as a suggestion and never used as a number in a calculation. The `/privacy` page states this to
users.

**Monitoring.** Sentry is optional and configured with `sendDefaultPii: false`.

## Known gaps

These are open and tracked. Fix them before onboarding a paying firm.

| # | Gap | Risk | Recommended fix |
| - | --- | ---- | --------------- |
| 1 | Invite tokens are not stored, so they stay valid until expiry. An invite can no longer take over an account, but the same link can be used again to rejoin the firm. | A forwarded link admits its holder to the invited email's seat, if they control that inbox or the account does not exist yet. | Store the nonce and mark it used on first signup ([open question 29](docs/product/open-questions.md)). |
| 2 | An invited account is created already confirmed, so a firm admin can invite an address that has no account and open the link themselves. | The admin holds an account under someone else's email until its owner resets the password. | Send invited users a confirmation link instead of pre-confirming them. |
| 3 | Most route handlers use the service-role client. | A missing organisation filter in a future change leaks across tenants. | Move read paths to the session client so RLS applies; add a test per route. |
| 4 | Self-serve signup is open by default. | Anyone can create a firm. | Set `AUTH_OPEN_SIGNUP=false` or an allowed-domain list in production. |
| 5 | Rate limits are held in memory per server instance. | On many instances the effective limit multiplies; a cold start resets it. | Move counters to a shared store (Upstash Redis or a Postgres table). |
| 6 | Members can read every row in their organisation, across all engagements. | No per-engagement need-to-know inside a firm. | Add engagement assignment if firms ask for it. |
| 7 | No data retention or deletion workflow for evidence. Append-only triggers refuse deletes unless `verifystack.allow_purge` is set for the transaction. | DPDP obligations on erasure and retention. | Define retention per engagement; write the purge procedure; handle shared content-addressed objects. |
| 8 | No Content Security Policy on scripts. | An injection bug would not be contained by the browser. | Add a nonce-based `script-src` once third-party scripts are settled. |

## Operational practice

- Production environment variables live only in Vercel and Supabase, never in the repository.
- Rotate the Supabase service-role key if it is ever exposed, then redeploy.
- Apply migrations in order and never edit an applied one. Migration 0012 must be applied
  before any real data is loaded: without it, members can write to tables directly.
- Set `INVITE_SIGNING_SECRET` and `APP_URL` in every deployed environment.
- Review every change to `frontend/app/api/**` for capability checks and organisation filters.
