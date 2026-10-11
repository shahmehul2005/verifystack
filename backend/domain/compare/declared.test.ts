import { describe, expect, it } from "vitest";
import { compareDeclared, mismatchedPaths, summariseComparisons, type DeclaredValue, type EvidenceValue } from "./declared";

const d = (fieldPath: string, value: DeclaredValue["value"], unit?: string): DeclaredValue => ({
  fieldPath,
  value,
  unit: unit ?? null,
  source: "evidence_pack",
});
const e = (refId: string, fieldPath: string, value: unknown, unit?: string): EvidenceValue => ({
  refId,
  fieldPath,
  value,
  unit: unit ?? null,
});

describe("compareDeclared", () => {
  it("matches identical values and values within the tolerance", () => {
    const r = compareDeclared(
      [d("electricity.activeEnergy", 100_000, "kWh"), d("production", 18_250, "t")],
      [e("a", "activeEnergy", 100_000, "kWh"), e("b", "production", 18_247.5, "t")]
    );
    expect(r.map((x) => x.status)).toEqual(["match", "within_tolerance"]);
  });

  it("flags a real disagreement with the size of the gap", () => {
    const [r] = compareDeclared([d("production", 18_250, "t")], [e("b", "production", 15_000, "t")]);
    expect(r!.status).toBe("mismatch");
    expect(r!.difference).toBe(-3_250);
    expect(r!.note).toMatch(/17\.81%/);
  });

  it("converts compatible units before comparing", () => {
    const [r] = compareDeclared([d("electricity.activeEnergy", 100, "MWh")], [e("a", "activeEnergy", 100_000, "kWh")]);
    expect(r!.status).toBe("match");
  });

  it("refuses to compare across dimensions or when one unit is missing", () => {
    expect(compareDeclared([d("production", 10, "t")], [e("b", "production", 10, "kWh")])[0]!.status).toBe("unit_mismatch");
    expect(compareDeclared([d("production", 10, "t")], [e("b", "production", 10)])[0]!.status).toBe("unit_mismatch");
    expect(compareDeclared([d("production", 10, "zorb")], [e("b", "production", 10, "t")])[0]!.status).toBe("unit_mismatch");
  });

  it("compares text case-insensitively and reports a number/text clash", () => {
    expect(compareDeclared([d("udyamRegistrationNumber", "UDYAM-MH-01-0001")], [e("u", "udyamRegistrationNumber", "udyam-mh-01-0001")])[0]!.status).toBe("match");
    expect(compareDeclared([d("production", "lots")], [e("b", "production", 5)])[0]!.status).toBe("not_comparable");
  });

  it("reports gaps on both sides", () => {
    const r = compareDeclared([d("production", 5, "t")], [e("x", "gstin", "27ABCDE1234F1Z5")]);
    expect(r.map((x) => x.status).sort()).toEqual(["no_declaration", "no_evidence"]);
  });

  it("picks the closest of several matching values", () => {
    const [r] = compareDeclared(
      [d("quantity", 100, "t")],
      [e("p", "invoice.quantity", 40, "t"), e("q", "invoice.quantity", 100.2, "t")]
    );
    expect(r!.evidence!.refId).toBe("q");
    expect(r!.status).toBe("within_tolerance");
    expect(r!.note).toMatch(/Closest of 2/);
  });

  it("handles declared zero", () => {
    expect(compareDeclared([d("production", 0, "t")], [e("b", "production", 0, "t")])[0]!.status).toBe("match");
    expect(compareDeclared([d("production", 0, "t")], [e("b", "production", 3, "t")])[0]!.status).toBe("mismatch");
  });

  it("honours a stricter tolerance", () => {
    const [r] = compareDeclared([d("production", 18_250, "t")], [e("b", "production", 18_247.5, "t")], { tolerance: 0 });
    expect(r!.status).toBe("mismatch");
  });
});

describe("summaries", () => {
  it("counts and lists disagreements", () => {
    const r = compareDeclared(
      [d("production", 18_250, "t"), d("quantity", 5, "t"), d("fuelKind", "coal")],
      [e("b", "production", 15_000, "t"), e("q", "quantity", 5, "t")]
    );
    expect(summariseComparisons(r)).toMatchObject({ agree: 1, disagree: 1, noEvidence: 1 });
    expect([...mismatchedPaths(r)]).toEqual(["production"]);
  });
});
