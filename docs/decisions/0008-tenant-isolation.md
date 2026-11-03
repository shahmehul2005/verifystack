# 0008. Tenant isolation in the database and in every route

- Status: Accepted
- Date: 2026-08-31

## Context

Customers are competing verification firms holding confidential plant data. One firm must never
read another firm's engagements, evidence or findings.

## Decision

Isolation is enforced in two layers.

1. **Database.** Every tenant table has an `organization_id` and Postgres RLS policies keyed on
   `is_org_member()`. Signed-in users may only read their organisation's rows; all writes are
   revoked from `authenticated` and `anon` (migration 0012), because a member can call PostgREST
   directly with their own session and would otherwise bypass every check in the routes.
   Reference data (packs, clusters, regulatory corpus, ECM library) is readable by any signed-in
   user and writable only by the service role. `audit_events`, `calculation_runs`, `signoffs`,
   `facts` and `factor_verifications` are append-only by trigger, for every role.
2. **Route handlers.** Each handler resolves the session's organisation (`requireSession`,
   `requireCapability`, `assertOrgId`) and filters every query by `organization_id`. Most
   handlers use the service-role client (`createServiceClient() ?? createServerSupabase()`), which
   bypasses RLS, so for those routes this filter is the effective boundary.

## Consequences

- RLS protects any path that uses the user's session client.
- On service-role paths, a missing `.eq("organization_id", …)` is a cross-tenant leak. Every
  change to a route handler must be reviewed for it.
- Moving read paths to the session client, so RLS applies everywhere, is a recommended hardening
  step (see `SECURITY.md`).
- Route handlers are the only write path, so a write that needs the service role is expected,
  not a smell. A write through the session client fails.
- Schema changes must add a read policy and revoke client writes in the same migration.
