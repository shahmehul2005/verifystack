import { describe, expect, it } from "vitest";
import {
  acceptanceShare,
  assessRisk,
  MAX_BULK_BATCH,
  MIN_SAMPLE,
  planBulkAccept,
  samplePosition,
  selectSample,
  type TriageField,
} from "./risk";

const ENG = "eng-1";

function field(i: number, over: Partial<TriageField> = {}): TriageField {
  return {
    id: `f${i}`,
    field_path: `invoice.vendor${i}.address`,
    confidence: 0.97,
    triage_action: "auto_commit",
    state: "suggested",
    ...over,
  };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => field(i));

describe("a snipped value", () => {
  it("is always read by a person, however sure the number looks", () => {
    const r = assessRisk(field(1, { snip: true, confidence: 1 }));
    expect(r.tier).toBe("high");
    expect(r.reasons).toEqual(["Entered from a region drawn on the page: always read by a person."]);
  });

  it("is never eligible for bulk accept and never enters the review sample", () => {
    const fields = [...many(40), field(100, { snip: true, confidence: 1 }), field(101, { snip: true, confidence: 1 })];
    const plan = planBulkAccept(ENG, fields);
    expect(plan.eligibleIds).not.toContain("f100");
    expect(plan.eligibleIds).not.toContain("f101");
    expect(plan.sample.map((s) => s.id)).not.toContain("f100");
    expect(plan.sample.map((s) => s.id)).not.toContain("f101");
    expect(plan.lowRiskPending).toBe(40);
  });
});

describe("assessRisk", () => {
  it("is low for a confident, non-material field", () => {
    expect(assessRisk(field(1))).toEqual({ tier: "low", reasons: [] });
  });
  it("is high for material fields whatever the confidence", () => {
    const r = assessRisk(field(1, { field_path: "invoice.lines.0.quantity", confidence: 0.99 }));
    expect(r.tier).toBe("high");
    expect(r.reasons[0]).toMatch(/High-materiality/);
  });
  it("is high below the review threshold and on a declared mismatch", () => {
    expect(assessRisk(field(1, { confidence: 0.8 })).tier).toBe("high");
    expect(assessRisk(field(1), { declaredMismatch: true }).reasons).toContain("Differs from what the entity declared.");
  });
});

describe("selectSample", () => {
  it("is deterministic and independent of input order", () => {
    const a = selectSample(ENG, many(50)).map((f) => f.id);
    const b = selectSample(ENG, [...many(50)].reverse()).map((f) => f.id);
    expect(a).toEqual(b);
    expect(a.length).toBe(10);
  });
  it("takes the minimum when the pool is small, and everything when tiny", () => {
    expect(selectSample(ENG, many(10)).length).toBe(MIN_SAMPLE);
    expect(selectSample(ENG, many(2)).length).toBe(2);
    expect(selectSample(ENG, [])).toEqual([]);
  });
  it("differs by engagement", () => {
    const a = selectSample("eng-1", many(100)).map((f) => f.id).join();
    const b = selectSample("eng-2", many(100)).map((f) => f.id).join();
    expect(a).not.toBe(b);
  });
  it("rejects a nonsense rate", () => {
    expect(() => selectSample(ENG, many(5), 0)).toThrow(RangeError);
    expect(() => selectSample(ENG, many(5), 1.5)).toThrow(RangeError);
  });
  it("positions fall in [0, 1)", () => {
    const p = samplePosition(ENG, "x");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(1);
  });
});

describe("planBulkAccept", () => {
  it("blocks until the sample is reviewed, then allows the rest", () => {
    const fields = many(40);
    const first = planBulkAccept(ENG, fields);
    expect(first.canBulkAccept).toBe(false);
    expect(first.blockedReason).toMatch(/Review the sample first/);
    expect(first.eligibleIds.length).toBe(40 - first.sample.length);

    const sampled = new Set(first.sample.map((s) => s.id));
    const after = fields.map((f) => (sampled.has(f.id) ? { ...f, state: "accepted" as const } : f));
    const second = planBulkAccept(ENG, after);
    expect(second.canBulkAccept).toBe(true);
    expect(second.sampleDecided).toBe(second.sample.length);
    expect(second.eligibleIds).not.toEqual(expect.arrayContaining([...sampled]));
  });

  it("blocks when any sampled value was rejected or corrected", () => {
    const fields = many(40);
    const sampled = planBulkAccept(ENG, fields).sample.map((s) => s.id);
    const after = fields.map((f) =>
      sampled.includes(f.id) ? { ...f, state: f.id === sampled[0] ? ("rejected" as const) : ("accepted" as const) } : f
    );
    const plan = planBulkAccept(ENG, after);
    expect(plan.canBulkAccept).toBe(false);
    expect(plan.blockedReason).toMatch(/rejected or corrected/);
  });

  it("keeps the same sample as values get decided", () => {
    const fields = many(40);
    const a = planBulkAccept(ENG, fields).sample.map((s) => s.id);
    const decided = fields.map((f, i) => (i % 3 === 0 && !a.includes(f.id) ? { ...f, state: "accepted" as const } : f));
    expect(planBulkAccept(ENG, decided).sample.map((s) => s.id)).toEqual(a);
  });

  it("never offers high-risk, non-page or already-decided values", () => {
    const fields: TriageField[] = [
      ...many(30),
      field(100, { field_path: "invoice.lines.0.quantity", triage_action: "human_review" }),
      field(101, { provenance_type: "spreadsheet_cell" }),
      field(102, { confidence: 0.5 }),
    ];
    const plan = planBulkAccept(ENG, fields);
    for (const id of ["f100", "f101", "f102"]) {
      expect(plan.eligibleIds).not.toContain(id);
      expect(plan.sample.map((s) => s.id)).not.toContain(id);
    }
  });

  it("excludes values that disagree with the declaration", () => {
    const fields = many(30).map((f, i) => (i === 5 ? { ...f, declaredMismatch: true } : f));
    expect(planBulkAccept(ENG, fields).eligibleIds).not.toContain("f5");
  });

  it("caps one batch", () => {
    const plan = planBulkAccept(
      ENG,
      many(MAX_BULK_BATCH + 200).map((f) => ({ ...f }))
    );
    const sampled = new Set(plan.sample.map((s) => s.id));
    const decided = many(MAX_BULK_BATCH + 200).map((f) => (sampled.has(f.id) ? { ...f, state: "accepted" as const } : f));
    expect(planBulkAccept(ENG, decided).blockedReason).toMatch(/at most/);
  });
});

describe("acceptanceShare", () => {
  it("reports the bulk share", () => {
    expect(acceptanceShare([{ accept_mode: "bulk" }, { accept_mode: "individual" }, { accept_mode: null }, { accept_mode: "bulk" }])).toEqual({
      total: 4,
      individual: 2,
      bulk: 2,
      bulkShare: 0.5,
    });
    expect(acceptanceShare([]).bulkShare).toBe(0);
  });
});
