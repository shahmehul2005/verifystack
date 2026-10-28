import { describe, expect, it } from "vitest";
import type { EvidenceSlot } from "../packs/types";
import { evaluateChecklist, isKnownSlot } from "./checklist";

const SLOTS: EvidenceSlot[] = [
  { id: "proforma", label: "Pro forma", gate: "run", accepts: "xlsx", basis: "test" },
  { id: "bills", label: "Electricity bills", gate: "run", accepts: "pdf, xlsx, csv", basis: "test" },
  { id: "cpp", label: "CPP", gate: "none", accepts: "xlsx", basis: "test" },
  { id: "form1", label: "Form 1", gate: "submission", accepts: "pdf", basis: "test" },
];

describe("evaluateChecklist", () => {
  it("blocks a run until every run-gated slot holds a document", () => {
    const r = evaluateChecklist(SLOTS, []);
    expect(r.canRun).toBe(false);
    expect(r.missingForRun.map((s) => s.id)).toEqual(["proforma", "bills"]);
  });

  it("ticks a slot with one document and counts many under one label", () => {
    const r = evaluateChecklist(SLOTS, [
      { documentId: "d1", slot: "proforma" },
      { documentId: "d2", slot: "bills" },
      { documentId: "d3", slot: "bills" },
      { documentId: "d4", slot: "bills" },
    ]);
    expect(r.canRun).toBe(true);
    const bills = r.slots.find((s) => s.slot.id === "bills")!;
    expect(bills.ticked).toBe(true);
    expect(bills.documentIds).toEqual(["d2", "d3", "d4"]);
  });

  it("does not let a corroboration slot block a run", () => {
    const r = evaluateChecklist(SLOTS, [
      { documentId: "d1", slot: "proforma" },
      { documentId: "d2", slot: "bills" },
    ]);
    expect(r.canRun).toBe(true);
    expect(r.slots.find((s) => s.slot.id === "cpp")!.ticked).toBe(false);
  });

  it("reports Form 1 as missing for submission but not for a run", () => {
    const r = evaluateChecklist(SLOTS, [
      { documentId: "d1", slot: "proforma" },
      { documentId: "d2", slot: "bills" },
    ]);
    expect(r.canRun).toBe(true);
    expect(r.canSubmit).toBe(false);
    expect(r.missingForSubmission.map((s) => s.id)).toEqual(["form1"]);
  });

  it("keeps assignments to slots the pack does not define, and never counts them", () => {
    const r = evaluateChecklist(SLOTS, [{ documentId: "d9", slot: "retired-slot" }]);
    expect(r.unknownAssignments).toEqual([{ documentId: "d9", slot: "retired-slot" }]);
    expect(r.canRun).toBe(false);
  });

  it("ignores unassigned documents", () => {
    const r = evaluateChecklist(SLOTS, [{ documentId: "d1", slot: null }]);
    expect(r.slots.every((s) => s.documentIds.length === 0)).toBe(true);
  });
});

describe("isKnownSlot", () => {
  it("allows null and defined ids only", () => {
    expect(isKnownSlot(SLOTS, null)).toBe(true);
    expect(isKnownSlot(SLOTS, "bills")).toBe(true);
    expect(isKnownSlot(SLOTS, "made-up")).toBe(false);
    expect(isKnownSlot(undefined, "bills")).toBe(false);
  });
});
