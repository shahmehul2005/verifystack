import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WITHDRAW_MIN_REASON, withdrawFailure, withdrawRpcParams } from "./withdrawal";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SQL = read("../../supabase/migrations/0024_withdraw_fact_fn.sql");
const ROUTE = read("../../../frontend/app/api/facts/withdraw/route.ts");

describe("withdraw_fact arguments", () => {
  it("passes every scoping id and trims the reason", () => {
    expect(
      withdrawRpcParams({ organizationId: "org", engagementId: "eng", factId: "fact", reason: "  duplicate of the Q3 invoice  ", userId: "user" })
    ).toEqual({
      p_organization_id: "org",
      p_engagement_id: "eng",
      p_fact_id: "fact",
      p_reason: "duplicate of the Q3 invoice",
      p_withdrawn_by: "user",
    });
  });
});

describe("how a refusal reads", () => {
  it("says the fact is not in this engagement for no_data_found", () => {
    expect(withdrawFailure({ code: "P0002" })).toMatchObject({ status: 404 });
  });
  it("says the ledger is fixed once sign-off has started", () => {
    const f = withdrawFailure({ code: "23514" });
    expect(f.status).toBe(409);
    expect(f.message).toMatch(/Sign-off has started/);
  });
  it("asks for a longer reason", () => {
    const f = withdrawFailure({ code: "22023" });
    expect(f.status).toBe(400);
    expect(f.message).toContain(String(WITHDRAW_MIN_REASON));
  });
  it("tells the operator to apply the migration when the function is missing", () => {
    for (const code of ["42883", "PGRST202"]) {
      const f = withdrawFailure({ code });
      expect(f.status).toBe(409);
      expect(f.message).toMatch(/migration 0024/);
    }
  });
  it("does not blame the user when the append-only guard itself refuses", () => {
    const f = withdrawFailure({ code: "42501", message: "facts is append-only: DELETE is not allowed" });
    expect(f.status).toBe(500);
    expect(f.message).toMatch(/Nothing was changed/);
  });
  it("falls back to the database message for anything else", () => {
    expect(withdrawFailure({ code: "XX000", message: "boom" })).toEqual({ status: 500, message: "boom" });
  });
});

describe("the route no longer touches the append-only ledger directly", () => {
  it("never deletes from facts or fact_withdrawals", () => {
    expect(ROUTE).not.toMatch(/from\(["']facts["']\)\s*\.delete/);
    expect(ROUTE).not.toMatch(/from\(["']fact_withdrawals["']\)\s*\.delete/);
    expect(ROUTE).not.toMatch(/\.delete\(\)/);
  });
  it("goes through the database function", () => {
    expect(ROUTE).toMatch(/rpc\(\s*["']withdraw_fact["']/);
  });
});

describe("migration 0024: the function's guards", () => {
  const fn = SQL.slice(SQL.indexOf("create or replace function public.withdraw_fact"), SQL.indexOf("-- Supabase grants execute"));

  it("is a security definer with a pinned search path", () => {
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = public, pg_temp/);
  });

  it("is executable by the service role only", () => {
    expect(SQL).toMatch(/revoke all on function public\.withdraw_fact\(uuid, uuid, uuid, text, uuid\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.withdraw_fact\(uuid, uuid, uuid, text, uuid\) to service_role;/);
    // Every grant in the file goes to the service role and nobody else.
    const grants = SQL.match(/grant execute[^;]*;/g) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/ to service_role;$/);
  });

  it("checks the engagement and the fact against the organization, under a lock", () => {
    expect(fn).toMatch(/from public\.engagements e[\s\S]*e\.id = p_engagement_id[\s\S]*e\.organization_id = p_organization_id[\s\S]*for update/);
    expect(fn).toMatch(/from public\.facts[\s\S]*id = p_fact_id[\s\S]*engagement_id = p_engagement_id[\s\S]*organization_id = p_organization_id[\s\S]*for update/);
    expect(fn).toMatch(/'signoff', 'submitted'/);
  });

  it("requires every argument and a reason of eight characters", () => {
    expect(fn).toMatch(/p_withdrawn_by is null/);
    expect(fn).toMatch(/length\(btrim\(coalesce\(p_reason, ''\)\)\) < 8/);
  });

  it("writes the history before it removes anything", () => {
    const insert = fn.indexOf("insert into public.fact_withdrawals");
    const del = fn.indexOf("delete from public.facts");
    expect(insert).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(insert);
  });

  it("turns the purge permission on for the one DELETE and off straight after, locally", () => {
    const on = fn.indexOf("set_config('verifystack.allow_purge', 'on', true)");
    const del = fn.indexOf("delete from public.facts");
    const off = fn.indexOf("set_config('verifystack.allow_purge', '', true)");
    expect(on).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(on);
    expect(off).toBeGreaterThan(del);
    // Transaction-local only: the third argument is true each time, and nothing sets it session-wide.
    expect(SQL.match(/set_config\('verifystack\.allow_purge'[^)]*\)/g)).toHaveLength(2);
    expect(SQL).not.toMatch(/set_config\('verifystack\.allow_purge'[^)]*false\)/);
    expect(SQL).not.toMatch(/\bset\s+(local\s+)?verifystack\.allow_purge\s*=/i);
  });

  it("removes exactly one fact", () => {
    expect(fn).toMatch(/get diagnostics removed = row_count/);
    expect(fn).toMatch(/removed <> 1/);
  });

  it("rejects the extracted value and audits in the same transaction", () => {
    expect(fn).toMatch(/update public\.extracted_fields[\s\S]*state = 'rejected'/);
    expect(fn).toMatch(/append_audit_event_as\(/);
    expect(fn).toMatch(/'fact\.withdrawn'/);
  });
});

describe("migration 0024: the history is kept", () => {
  it("makes fact_withdrawals append-only for every role", () => {
    expect(SQL).toMatch(/create trigger fact_withdrawals_append_only[\s\S]*before update or delete on public\.fact_withdrawals[\s\S]*forbid_mutation\(\)/);
  });
  it("copies every column of the fact into the withdrawal", () => {
    for (const col of ["field_path", "value_json", "unit", "page", "bbox", "source_text", "provenance_type", "provenance", "accept_mode", "accepted_by", "accepted_at", "document_id", "extracted_field_id"]) {
      expect(SQL).toContain(`f.${col}`);
    }
  });
});
