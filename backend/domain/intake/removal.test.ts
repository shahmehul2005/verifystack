import { describe, expect, it } from "vitest";
import { assessRemoval, type RemovalInput } from "./removal";

const CLEAN: RemovalInput = {
  engagementStatus: "intake",
  source: "upload",
  facts: 0,
  reviewedFields: 0,
  declaredValues: 0,
  deskReadings: 0,
};

describe("assessRemoval", () => {
  it("allows a mistaken upload nothing else rests on", () => {
    expect(assessRemoval(CLEAN)).toEqual({ allowed: true, reasons: [] });
  });

  it("allows a document from an evidence pack", () => {
    expect(assessRemoval({ ...CLEAN, source: "evidence_pack" }).allowed).toBe(true);
  });

  it("still allows removal during review, calculation and findings", () => {
    for (const engagementStatus of ["setup", "intake", "review", "calc", "findings"] as const) {
      expect(assessRemoval({ ...CLEAN, engagementStatus }).allowed).toBe(true);
    }
  });

  it("locks the evidence from sign-off on", () => {
    for (const engagementStatus of ["signoff", "submitted"] as const) {
      const r = assessRemoval({ ...CLEAN, engagementStatus });
      expect(r.allowed).toBe(false);
      expect(r.reasons[0]).toMatch(/locked/);
    }
  });

  it("refuses the entity's responses and fieldwork files", () => {
    expect(assessRemoval({ ...CLEAN, source: "entity_response" }).allowed).toBe(false);
    expect(assessRemoval({ ...CLEAN, source: "fieldwork" }).allowed).toBe(false);
  });

  it("refuses a document an accepted fact cites", () => {
    const r = assessRemoval({ ...CLEAN, facts: 2 });
    expect(r.allowed).toBe(false);
    expect(r.reasons).toEqual(["2 accepted facts cite this document. Remove or supersede them first."]);
  });

  it("uses the singular for one reference", () => {
    expect(assessRemoval({ ...CLEAN, facts: 1 }).reasons[0]).toMatch(/^1 accepted fact cites .* it first\.$/);
  });

  it("refuses a document with reviewed extractions, declared figures or desk readings", () => {
    expect(assessRemoval({ ...CLEAN, reviewedFields: 3 }).allowed).toBe(false);
    expect(assessRemoval({ ...CLEAN, declaredValues: 1 }).allowed).toBe(false);
    expect(assessRemoval({ ...CLEAN, deskReadings: 4 }).allowed).toBe(false);
  });

  it("lists every reason, so the person sees all of them at once", () => {
    const r = assessRemoval({ ...CLEAN, engagementStatus: "signoff", facts: 1, deskReadings: 2 });
    expect(r.reasons).toHaveLength(3);
  });
});
