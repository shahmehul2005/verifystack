import { describe, expect, it } from "vitest";
import { selectRunFacts, type ScopedFact } from "./runFacts";

const facts: ScopedFact[] = [
  { id: "a", field_path: "quantity", provenance_type: "spreadsheet_cell" },
  { id: "b", field_path: "calorificValue", provenance_type: "document_page" },
  { id: "c", field_path: "activeEnergy", provenance_type: "time_series_range" },
  { id: "d", field_path: "production", provenance_type: "document_page" },
  { id: "e", field_path: "naturalGas.quantity", provenance_type: "site_observation" },
  { id: "f", field_path: "legacy.row", provenance_type: null },
];

describe("selectRunFacts", () => {
  it("keeps every fact when the pack does not require workbook values", () => {
    const r = selectRunFacts({ workbook_required: false }, facts);
    expect(r.workbookRule).toBe(false);
    expect(r.facts).toHaveLength(facts.length);
    expect(r.excluded).toEqual([]);
  });

  it("keeps only workbook, time-series and site facts when the rule is on", () => {
    const r = selectRunFacts({ workbook_required: true }, facts);
    expect(r.workbookRule).toBe(true);
    expect(r.facts.map((f) => f.id)).toEqual(["a", "c", "e"]);
  });

  it("excludes PDF readings and says why", () => {
    const r = selectRunFacts({ workbook_required: true }, facts);
    expect(r.excluded.map((x) => x.id)).toEqual(["b", "d", "f"]);
    expect(r.excluded[0]!.reason).toMatch(/override/);
  });

  it("lets an explicit override bring a PDF reading back in, for that input only", () => {
    const r = selectRunFacts({ workbook_required: true }, facts, new Set(["production"]));
    expect(r.facts.map((f) => f.id)).toEqual(["a", "c", "d", "e"]);
    expect(r.excluded.map((x) => x.id)).toEqual(["b", "f"]);
  });

  it("treats a fact with no recorded provenance type as page evidence", () => {
    const r = selectRunFacts({ workbook_required: true }, [{ id: "z", field_path: "x", provenance_type: null }]);
    expect(r.facts).toEqual([]);
    expect(r.excluded[0]!.provenanceType).toBe("document_page");
  });
});
