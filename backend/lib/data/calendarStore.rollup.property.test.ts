import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { commitAnnualRollupsToCalculation } from "./calendarStore";
import { loadCommittedFactsForEngagement } from "./committedEvidence";

// Feature: industrial-extractor, Property 37: Rollups exclude suggested rows

type Row = Record<string, unknown>;

const MONTHS = [
  "2023-04", "2023-05", "2023-06", "2023-07", "2023-08", "2023-09",
  "2023-10", "2023-11", "2023-12", "2024-01", "2024-02", "2024-03",
];

/** Suggested and rejected values sit far above any committed value. */
const POISON = 1_000_000_000;

/**
 * Fake client. The canonical_evidence_values table applies eq, in and not-in
 * filters to the supplied rows, so a source that forgets to filter by state
 * would see the suggested rows.
 */
function fakeClient(cevRows: Row[]) {
  const inserted: { table: string; row: Row }[] = [];
  const client = {
    from: (table: string) => {
      const source: Row[] =
        table === "canonical_evidence_values"
          ? cevRows
          : table === "engagements"
            ? [{ id: "eng-1", organization_id: "org-1", compliance_year: "FY2023-24", pack_id: "p" }]
            : [];
      const preds: ((r: Row) => boolean)[] = [];
      const run = () => source.filter((r) => preds.every((p) => p(r)));
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          preds.push((r) => r[col] === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          preds.push((r) => vals.includes(r[col]));
          return chain;
        },
        not: (col: string, op: string, raw: string) => {
          if (op === "in") {
            const vals = raw.replace(/[()"]/g, "").split(",");
            preds.push((r) => !vals.includes(String(r[col])));
          }
          return chain;
        },
        order: () => chain,
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        insert: async (row: Row) => {
          inserted.push({ table, row });
          return { data: null, error: null };
        },
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: run(), error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, inserted };
}

let seq = 0;
function cevRow(over: Row): Row {
  return {
    id: `cev-${++seq}`,
    engagement_id: "eng-1",
    organization_id: "org-1",
    canonical_key: "clinker_production#sourcing",
    extraction_method: "workbook_reader",
    registry_version: null,
    document_id: null,
    period_kind: "monthly",
    value_unit: "t",
    standard_unit: "t",
    correction_numeric: null,
    correction_unit: null,
    reading_meta: null,
    provenance_page: null,
    provenance_bbox: null,
    provenance_source_text: null,
    input_hash: "h",
    reviewed_at: null,
    reviewed_by: null,
    ...over,
  };
}

function monthRow(month: string, state: string, value: number, corrected = false): Row {
  return cevRow({
    period_start: `${month}-01`,
    period_end: `${month}-28`,
    state,
    value_numeric: corrected ? POISON : value,
    standard_value: corrected ? null : value,
    correction_numeric: corrected ? value : null,
    correction_unit: corrected ? "t" : null,
  });
}

interface MonthPlan {
  verified: { state: "accepted" | "corrected"; value: number } | null;
  suggested: number; // count of suggested rows in this month
  rejected: boolean;
}

const arbMonth: fc.Arbitrary<MonthPlan> = fc.record({
  verified: fc.option(
    fc.record({
      state: fc.constantFrom("accepted" as const, "corrected" as const),
      value: fc.integer({ min: 0, max: 100_000 }),
    }),
    { nil: null }
  ),
  suggested: fc.integer({ min: 0, max: 2 }),
  rejected: fc.boolean(),
});

const arbPlan = fc.array(arbMonth, { minLength: 12, maxLength: 12 });

function build(plan: MonthPlan[], extra: Row[] = []) {
  const rows: Row[] = [...extra];
  let expected = 0;
  let any = false;
  plan.forEach((p, i) => {
    const m = MONTHS[i];
    if (p.verified) {
      rows.push(monthRow(m, p.verified.state, p.verified.value, p.verified.state === "corrected"));
      expected += p.verified.value;
      any = true;
    }
    for (let k = 0; k < p.suggested; k++) rows.push(monthRow(m, "suggested", POISON + k + 1));
    if (p.rejected) rows.push(monthRow(m, "rejected", POISON + 77));
  });
  return { rows, expected, any };
}

// A suggested annual value for a stream that has no verified reading at all.
const suggestedAnnual = () =>
  cevRow({
    canonical_key: "opc_production#proforma",
    period_kind: "annual",
    period_start: "2023-04-01",
    period_end: "2024-03-31",
    state: "suggested",
    value_numeric: POISON,
    standard_value: POISON,
  });

describe("Property 37: Rollups exclude suggested rows", () => {
  /** **Validates: Requirements 11.5** */
  it("commitAnnualRollupsToCalculation uses only accepted and corrected rows", async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { rows, expected, any } = build(plan, [suggestedAnnual()]);
        const { client, inserted } = fakeClient(rows);

        const res = await commitAnnualRollupsToCalculation(client, "eng-1", "org-1");

        expect(res.error).toBeUndefined();
        expect(res.rollups).toEqual(any ? { "clinker.production": expected } : {});
        expect(res.committed).toBe(any ? 1 : 0);
        for (const { row } of inserted) {
          expect(Number(row.value_numeric ?? row.value_json)).toBeLessThan(POISON);
        }
      }),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 11.5** */
  it("loadCommittedFactsForEngagement never carries a suggested value into a fact", async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { rows, expected, any } = build(plan, [suggestedAnnual()]);
        const { client } = fakeClient(rows);

        const facts = await loadCommittedFactsForEngagement(client, "eng-1", "org-1");

        const clinker = facts.find((f) => f.field_path === "clinker.production");
        if (any) expect(clinker?.value_json).toBe(expected);
        else expect(clinker).toBeUndefined();
        expect(facts.find((f) => f.field_path === "opc.production")).toBeUndefined();
        for (const f of facts) {
          expect(Number(f.value_json)).toBeLessThan(POISON);
        }
      }),
      { numRuns: 100 }
    );
  });

  /** **Validates: Requirements 11.5** */
  it("a set of only suggested rows commits nothing", async () => {
    const plan: MonthPlan[] = MONTHS.map(() => ({ verified: null, suggested: 2, rejected: true }));
    const { rows } = build(plan, [suggestedAnnual()]);
    const { client, inserted } = fakeClient(rows);

    const res = await commitAnnualRollupsToCalculation(client, "eng-1", "org-1");
    const facts = await loadCommittedFactsForEngagement(client, "eng-1", "org-1");

    expect(res).toEqual({ committed: 0, rollups: {} });
    expect(inserted).toHaveLength(0);
    expect(facts).toEqual([]);
  });
});
