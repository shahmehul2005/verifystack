import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { getFiscalMonths } from "@verifystack/backend/domain/calendar/index";

vi.mock("server-only", () => ({}));

import {
  loadCalendarGridForEngagement,
  commitAnnualRollupsToCalculation,
} from "./calendarStore";
import { loadCommittedFactsForEngagement } from "./committedEvidence";

// Task 10.2: state filters on the roll-up and committed-fact paths (Requirements 11.5, 12.2).

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface Write {
  table: string;
  op: "insert" | "update";
  values: Row;
}

/** In-memory Supabase fake that applies eq / in / not-in filters to table rows. */
function fakeClient(tables: Tables) {
  const writes: Write[] = [];
  const client = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      };
      b.not = (col: string, _op: string, list: string) => {
        const excluded = list.replace(/[()"]/g, "").split(",");
        filters.push((r) => !excluded.includes(String(r[col])));
        return b;
      };
      b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
      b.insert = async (values: Row) => {
        writes.push({ table, op: "insert", values });
        return { data: null, error: null };
      };
      b.update = (values: Row) => ({
        eq: async () => {
          writes.push({ table, op: "update", values });
          return { data: null, error: null };
        },
      });
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve);
      return b;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, writes };
}

const ENG = "eng-1";
const ORG = "org-1";

function cev(
  monthIndex: number,
  year: string,
  state: string,
  value: number,
  extra: Row = {}
): Row {
  const m = getFiscalMonths(year)[monthIndex];
  return {
    id: `cev-${monthIndex}-${state}-${value}`,
    engagement_id: ENG,
    organization_id: ORG,
    canonical_key: "clinker_production#sourcing",
    registry_version: "source_type:sourcing",
    extraction_method: "workbook_reader",
    document_id: null,
    period_kind: "monthly",
    period_start: m.startDate,
    period_end: m.endDate,
    value_numeric: value,
    value_unit: "t",
    standard_value: value,
    standard_unit: "t",
    correction_numeric: null,
    correction_unit: null,
    provenance_page: null,
    provenance_bbox: null,
    provenance_source_text: null,
    input_hash: null,
    reading_meta: null,
    reviewed_at: null,
    reviewed_by: null,
    state,
    ...extra,
  };
}

function tablesFor(year: string | null, cevs: Row[]): Tables {
  return {
    engagements: year ? [{ id: ENG, organization_id: ORG, compliance_year: year, pack_id: "p" }] : [],
    documents: [],
    canonical_evidence_values: cevs,
    facts: [],
  };
}

function clinkerRow(grid: Awaited<ReturnType<typeof loadCalendarGridForEngagement>>) {
  const rows = grid.categories.flatMap((c) => c.rows);
  return rows.find((r) => r.stream.key === "clinker_production")!;
}

const YEAR = "FY2024-25";

describe("loadCalendarGridForEngagement state filter", () => {
  const cevs = [
    cev(0, YEAR, "accepted", 100),
    cev(1, YEAR, "corrected", 200, { correction_numeric: 250, correction_unit: "t", standard_value: null }),
    cev(2, YEAR, "suggested", 1000),
    cev(3, YEAR, "rejected", 5000),
    cev(4, YEAR, "withdrawn", 7000),
  ];

  it("without opts keeps suggested rows and drops rejected and withdrawn", async () => {
    const { client } = fakeClient(tablesFor(YEAR, cevs));
    const grid = await loadCalendarGridForEngagement(client, ENG, ORG);
    const row = clinkerRow(grid);
    expect(row.annualRollup.completedMonthsCount).toBe(3);
    expect(row.annualRollup.value).toBe(100 + 250 + 1000);
  });

  it("with states [accepted, corrected] excludes suggested rows and uses the correction", async () => {
    const { client } = fakeClient(tablesFor(YEAR, cevs));
    const grid = await loadCalendarGridForEngagement(client, ENG, ORG, {
      states: ["accepted", "corrected"],
    });
    const row = clinkerRow(grid);
    expect(row.annualRollup.completedMonthsCount).toBe(2);
    expect(row.annualRollup.value).toBe(350);
    expect(grid.summary.totalReadingsCount).toBe(2);
  });

  it("an explicit single state returns only that state", async () => {
    const { client } = fakeClient(tablesFor(YEAR, cevs));
    const grid = await loadCalendarGridForEngagement(client, ENG, ORG, { states: ["suggested"] });
    expect(clinkerRow(grid).annualRollup.value).toBe(1000);
  });

  it("a corrected row's correction wins over a stale original standard_value", async () => {
    const { client } = fakeClient(
      tablesFor(YEAR, [
        cev(1, YEAR, "corrected", 200, { correction_numeric: 250, correction_unit: "t", standard_value: 200 }),
      ])
    );
    const grid = await loadCalendarGridForEngagement(client, ENG, ORG);
    expect(clinkerRow(grid).annualRollup.value).toBe(250);
  });

  it("a suggested-only stream has no roll-up value under the strict filter", async () => {
    const { client } = fakeClient(tablesFor(YEAR, [cev(0, YEAR, "suggested", 900)]));
    const grid = await loadCalendarGridForEngagement(client, ENG, ORG, {
      states: ["accepted", "corrected"],
    });
    expect(clinkerRow(grid).annualRollup.value).toBeNull();
  });
});

describe("commitAnnualRollupsToCalculation", () => {
  it("commits only accepted and corrected values and uses the compliance-year window", async () => {
    const { client, writes } = fakeClient(
      tablesFor(YEAR, [
        cev(0, YEAR, "accepted", 100),
        cev(1, YEAR, "corrected", 200, { correction_numeric: 250, correction_unit: "t", standard_value: null }),
        cev(2, YEAR, "suggested", 1000),
      ])
    );
    const res = await commitAnnualRollupsToCalculation(client, ENG, ORG);
    expect(res.error).toBeUndefined();
    expect(res.committed).toBe(1);
    expect(res.rollups["clinker.production"]).toBe(350);

    const cevInsert = writes.find((w) => w.table === "canonical_evidence_values" && w.op === "insert")!;
    expect(cevInsert.values.period_start).toBe("2024-04-01");
    expect(cevInsert.values.period_end).toBe("2025-03-31");
    const factInsert = writes.find((w) => w.table === "facts" && w.op === "insert")!;
    expect(factInsert.values.period_start).toBe("2024-04-01");
    expect(factInsert.values.period_end).toBe("2025-03-31");
    for (const w of writes) {
      expect(JSON.stringify(w.values)).not.toContain("2023-04-01");
      expect(JSON.stringify(w.values)).not.toContain("2024-03-31");
    }
  });

  it("window follows other compliance years", async () => {
    const { client, writes } = fakeClient(
      tablesFor("2021-22", [cev(0, "2021-22", "accepted", 10)])
    );
    await commitAnnualRollupsToCalculation(client, ENG, ORG);
    const f = writes.find((w) => w.table === "facts")!;
    expect(f.values.period_start).toBe("2021-04-01");
    expect(f.values.period_end).toBe("2022-03-31");
  });

  it("returns committed 0 with an error and writes nothing when the window is null", async () => {
    const { client, writes } = fakeClient(
      tablesFor("not-a-year", [cev(0, "FY2023-24", "accepted", 100)])
    );
    const res = await commitAnnualRollupsToCalculation(client, ENG, ORG);
    expect(res.committed).toBe(0);
    expect(res.rollups).toEqual({});
    expect(res.error).toMatch(/not-a-year/);
    expect(writes).toHaveLength(0);
  });
});

describe("loadCommittedFactsForEngagement state filter", () => {
  it("a suggested calendar row yields no committed fact", async () => {
    const { client } = fakeClient(tablesFor(YEAR, [cev(0, YEAR, "suggested", 900)]));
    const facts = await loadCommittedFactsForEngagement(client, ENG, ORG);
    expect(facts.find((f) => f.field_path === "clinker.production")).toBeUndefined();
    expect(facts.find((f) => f.id === "cal-rollup-clinker_production")).toBeUndefined();
    expect(facts).toHaveLength(0);
  });

  it("accepted and corrected rows yield a fact that excludes suggested values", async () => {
    const { client } = fakeClient(
      tablesFor(YEAR, [
        cev(0, YEAR, "accepted", 100),
        cev(1, YEAR, "corrected", 200, { correction_numeric: 250, correction_unit: "t", standard_value: null }),
        cev(2, YEAR, "suggested", 1000),
      ])
    );
    const facts = await loadCommittedFactsForEngagement(client, ENG, ORG);
    const f = facts.find((x) => x.id === "cal-rollup-clinker_production");
    expect(f?.value_json).toBe(350);
  });
});
