import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CEMENT_REGISTRY } from "./index";
import { compareEvidence, nablGcvReadings, type ComparisonInput, type FactInput, type ReadingInput } from "./compare";
import { CEMENT_DESK_REVIEW } from "../deskreview/cement";
import { runDeskReview } from "../deskreview/engine";
import { deskFindings } from "../deskreview/toFindings";
import { DEFAULT_TOLERANCE } from "../compare/declared";
import { readingsForComparison } from "../../lib/data/evidenceComparison";

const names: Record<string, string> = { certA: "nabl_cert_q3.pdf", certB: "lab_report_q2.pdf", bill1: "grid_bill_nov.pdf" };

const fact = (over: Partial<FactInput> = {}): FactInput => ({
  id: "f1",
  documentId: "certA",
  fieldPath: "calorificValue",
  value: 4230,
  unit: "kcal/kg",
  canonicalKey: "coal_gcv",
  periodStatus: "known",
  periodStart: "2023-10-01",
  periodEnd: "2023-10-01",
  periodNote: null,
  ...over,
});

const base = (over: Partial<ComparisonInput> = {}): ComparisonInput => ({
  registry: CEMENT_REGISTRY,
  readings: {
    "pf.gcv_coal": { value: 4150 },
    "lab.gcv_mean": { value: 4210 },
    "coal.nabl_gcv": { value: 4230, documentId: "certA" },
  },
  facts: [fact()],
  documentName: (id) => names[id] ?? null,
  tolerance: DEFAULT_TOLERANCE,
  ...over,
});

const gcv = (c: ReturnType<typeof compareEvidence>) => c.entries.find((e) => e.key === "coal_gcv")!;
const pair = (c: ReturnType<typeof compareEvidence>, other: string) => {
  const e = gcv(c);
  const oi = e.sources.findIndex((s) => s.name === other);
  return e.pairs.find((p) => p.other === oi)!;
};

describe("compareEvidence: what is lined up", () => {
  it("shows the pro forma, the workbook, the typed reading and the fact, each on kcal/kg", () => {
    const e = gcv(compareEvidence(base()));
    expect(e.sources.map((s) => `${s.origin}:${s.name}`)).toEqual(["proforma:pf.gcv_coal", "workbook:lab.gcv_mean", "desk_reading:coal.nabl_gcv", "fact:calorificValue"]);
    expect(e.sources.every((s) => s.standard !== null)).toBe(true);
    expect(e.sources.find((s) => s.origin === "fact")).toMatchObject({ factId: "f1", documentName: "nabl_cert_q3.pdf", period: "2023-10-01 to 2023-10-01" });
  });

  it("puts a fact stated in MJ/kg on kcal/kg", () => {
    const e = gcv(compareEvidence(base({ facts: [fact({ value: 17.7102, unit: "MJ/kg" })] })));
    expect(e.sources.find((s) => s.origin === "fact")!.standard).toBeCloseTo(4230, 0);
  });

  it("leaves out a series, a pack binding and anything the registry has no value for", () => {
    const e = gcv(compareEvidence(base({ readings: { "lab.gcv@2023-11-01": { value: 4200 } } as Record<string, ReadingInput> })));
    expect(e.sources.filter((s) => s.origin !== "fact")).toEqual([]);
  });

  it("counts approved facts that carry no key, and does not show them", () => {
    const c = compareEvidence(base({ facts: [fact(), fact({ id: "f2", canonicalKey: null, fieldPath: "quantity" }), fact({ id: "f3", canonicalKey: undefined })] }));
    expect(c.unmappedFacts).toBe(2);
    expect(gcv(c).sources.filter((s) => s.origin === "fact")).toHaveLength(1);
  });

  it("keeps one quantity's facts out of another's", () => {
    const c = compareEvidence(base({ facts: [fact({ canonicalKey: "grid_electricity_import", fieldPath: "electricity.activeEnergy", value: 250000, unit: "kWh" })] }));
    expect(gcv(c).sources.filter((s) => s.origin === "fact")).toHaveLength(0);
    expect(c.entries.find((e) => e.key === "grid_electricity_import")!.sources.filter((s) => s.origin === "fact")).toHaveLength(1);
  });
});

describe("compareEvidence: what may be compared", () => {
  it("compares a fact with the reading typed from the same document, and they agree", () => {
    const p = pair(compareEvidence(base()), "coal.nabl_gcv");
    expect(p).toMatchObject({ state: "agree", relDiff: 0 });
    expect(p.reason).toMatch(/nabl_cert_q3\.pdf/);
  });

  it("flags a transposed digit as a disagreement", () => {
    const p = pair(compareEvidence(base({ facts: [fact({ value: 4320 })] })), "coal.nabl_gcv");
    expect(p.state).toBe("disagree");
    expect(p.relDiff).toBeCloseTo(90 / 4230, 6);
    expect(p.reason).toMatch(/differ: 4,320 and 4,230 kcal\/kg/);
  });

  it("uses the tolerance it is given", () => {
    const f = fact({ value: 4240 }); // 0.236% off
    expect(pair(compareEvidence(base({ facts: [f], tolerance: 0.005 })), "coal.nabl_gcv").state).toBe("agree");
    expect(pair(compareEvidence(base({ facts: [f], tolerance: 0.001 })), "coal.nabl_gcv").state).toBe("disagree");
  });

  it("does not compare figures read from different documents", () => {
    const p = pair(compareEvidence(base({ facts: [fact({ documentId: "certB" })] })), "coal.nabl_gcv");
    expect(p.state).toBe("not_compared");
    expect(p.reason).toMatch(/different documents/);
  });

  it("does not compare a reading that is not linked to a document", () => {
    const p = pair(compareEvidence(base({ readings: { "coal.nabl_gcv": { value: 4230 } } })), "coal.nabl_gcv");
    expect(p.state).toBe("not_compared");
    expect(p.reason).toMatch(/not linked to a document/);
  });

  it("never compares a one-document fact with the annual cell or a mean of samples, however close", () => {
    const c = compareEvidence(base({ facts: [fact({ value: 4150 })] }));
    for (const other of ["pf.gcv_coal", "lab.gcv_mean"]) {
      const p = pair(c, other);
      expect(p.state, other).toBe("not_compared");
      expect(p.reason).toMatch(/different spans/);
    }
    // And a fact that equals the annual cell exactly is still not called agreement.
    expect(pair(compareEvidence(base({ facts: [fact({ value: 4150 })] })), "pf.gcv_coal").state).toBe("not_compared");
  });

  it("does not compare a bill's month with a total over the evidenced months", () => {
    const c = compareEvidence(
      base({
        readings: { "grid.bill_kwh": { value: 3_000_000, documentId: "bill1" }, "pf.grid_kwh": { value: 3_000_000 } },
        facts: [fact({ canonicalKey: "grid_electricity_import", fieldPath: "electricity.activeEnergy", value: 250000, unit: "kWh", documentId: "bill1" })],
      })
    );
    const e = c.entries.find((x) => x.key === "grid_electricity_import")!;
    expect(e.pairs.length).toBeGreaterThan(0);
    expect(e.pairs.every((p) => p.state === "not_compared")).toBe(true);
  });

  it("explains a figure it could not put on the standard unit, and does not compare it", () => {
    const c = compareEvidence(
      base({
        readings: {},
        facts: [fact({ canonicalKey: "grid_electricity_import", fieldPath: "electricity.activeEnergy", value: 250000, unit: "kVAh", documentId: "bill1" })],
      })
    );
    const row = c.entries.find((x) => x.key === "grid_electricity_import")!.sources[0]!;
    expect(row.standard).toBeNull();
    expect(row.note).toMatch(/apparent energy/);
  });

  it("refuses a fact whose value is not a number, and a fact with no unit", () => {
    const e = gcv(compareEvidence(base({ facts: [fact({ value: "four thousand" }), fact({ id: "f9", unit: null })] })));
    const facts = e.sources.filter((s) => s.origin === "fact");
    expect(facts[0]).toMatchObject({ standard: null, note: "Not a number." });
    expect(facts[1]).toMatchObject({ standard: null });
    expect(facts[1]!.note).toMatch(/No unit/);
  });

  it("does not change what it is given", () => {
    const input = base();
    const frozen = JSON.stringify(input);
    Object.freeze(input.facts);
    for (const f of input.facts) Object.freeze(f);
    compareEvidence(input);
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe("nablGcvReadings: what desk review's check is given", () => {
  const state = (over: Partial<ComparisonInput>) => nablGcvReadings(compareEvidence(base(over)));

  it("passes both figures, on kcal/kg, when the same document holds both", () => {
    expect(state({})).toEqual({
      "xcmp.coal_gcv.state": "compared",
      "xcmp.coal_gcv.fact": 4230,
      "xcmp.coal_gcv.reading": 4230,
      "xcmp.coal_gcv.document": "nabl_cert_q3.pdf",
    });
  });

  it("says why when it cannot compare", () => {
    expect(state({ readings: {} })).toMatchObject({ "xcmp.coal_gcv.state": "no_reading" });
    expect(state({ facts: [] })).toMatchObject({ "xcmp.coal_gcv.state": "no_fact" });
    expect(state({ readings: { "coal.nabl_gcv": { value: 4230 } } })).toMatchObject({ "xcmp.coal_gcv.state": "unlinked" });
    const other = state({ facts: [fact({ documentId: "certB" })] });
    expect(other).toMatchObject({ "xcmp.coal_gcv.state": "different_document" });
    expect(String(other["xcmp.coal_gcv.why"])).toMatch(/other documents/);
    expect(state({ facts: [fact(), fact({ id: "f2", value: 4300 })] })).toMatchObject({ "xcmp.coal_gcv.state": "ambiguous" });
    expect(state({ facts: [fact({ unit: "kJ" })] })).toMatchObject({ "xcmp.coal_gcv.state": "unreadable" });
  });
});

describe("desk review's evidence_nabl_gcv check", () => {
  const rule = CEMENT_DESK_REVIEW.rules.find((r) => r.id === "evidence_nabl_gcv")!;
  const run = (r: Record<string, number | string>) => rule.evaluate(r);

  it("is part of the cement review and waits for nothing", () => {
    expect(rule).toBeDefined();
    expect(rule.needs).toEqual([]);
    const outcome = runDeskReview(CEMENT_DESK_REVIEW, {}).find((o) => o.id === "evidence_nabl_gcv")!;
    expect(outcome.status).toBe("not_applicable");
    expect(outcome.status).not.toBe("pending");
  });

  it("is not applicable when the comparison was not run, and says why when it could not compare", () => {
    expect(run({}).detail).toMatch(/was not run/);
    const r = run({ "xcmp.coal_gcv.state": "no_fact", "xcmp.coal_gcv.why": "No Workbench fact has been approved for coal GCV." });
    expect(r.status).toBe("not_applicable");
    expect(r.detail).toMatch(/No Workbench fact/);
  });

  it("passes when the two readings of one page agree", () => {
    const r = run({ "xcmp.coal_gcv.state": "compared", "xcmp.coal_gcv.fact": 4230, "xcmp.coal_gcv.reading": 4230, "xcmp.coal_gcv.document": "nabl_cert_q3.pdf" });
    expect(r).toMatchObject({ status: "pass", actual: 4230, expected: 4230, diff: 0 });
    expect(r.detail).toMatch(/nabl_cert_q3\.pdf/);
  });

  it("fails on a transposed digit, and the finding tells the verifier what to do", () => {
    const outcomes = runDeskReview(CEMENT_DESK_REVIEW, {
      "xcmp.coal_gcv.state": "compared",
      "xcmp.coal_gcv.fact": 4320,
      "xcmp.coal_gcv.reading": 4230,
      "xcmp.coal_gcv.document": "nabl_cert_q3.pdf",
    });
    const outcome = outcomes.find((o) => o.id === "evidence_nabl_gcv")!;
    expect(outcome).toMatchObject({ status: "fail", diff: 90 });
    const draft = deskFindings(outcomes).find((d) => d.ruleId === "DESK-evidence_nabl_gcv")!;
    expect(draft.severity).toBe("warn");
    expect(draft.requiredResponse).toMatch(/withdraw the fact/);
  });

  it("is not decided when a figure is not a number", () => {
    expect(run({ "xcmp.coal_gcv.state": "compared", "xcmp.coal_gcv.fact": Number.NaN, "xcmp.coal_gcv.reading": 4230 }).status).toBe("not_applicable");
  });
});

describe("the comparison is read only", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the loader and the view never write", () => {
    for (const f of ["../../lib/data/evidenceComparison.ts", "../../../frontend/app/(app)/engagements/[id]/desk-review/evidence-comparison.tsx", "./compare.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src, f).not.toMatch(/fetch\(|method:\s*["']POST/);
    }
  });

  it("a fact's value is never written into the verifier's readings or the facts", () => {
    const route = read("../../../frontend/app/api/desk-review/route.ts");
    // The only use of the comparison is Object.assign into this run's in-memory readings.
    expect(route).toMatch(/Object\.assign\(all, nablGcvReadings\(comparison\)\)/);
    expect(route).not.toMatch(/from\("desk_readings"\)\s*\.(insert|upsert|update)/);
    expect(route).not.toMatch(/from\("facts"\)\s*\.(insert|upsert|update|delete)/);
  });

  it("typed readings win a key and carry their document", () => {
    const merged = readingsForComparison({ "pf.gcv_coal": 4150, "coal.nabl_gcv": 1 }, [{ key: "coal.nabl_gcv", value: 4230, document_id: "certA" }]);
    expect(merged["pf.gcv_coal"]).toEqual({ value: 4150 });
    expect(merged["coal.nabl_gcv"]).toEqual({ value: 4230, documentId: "certA" });
  });
});
