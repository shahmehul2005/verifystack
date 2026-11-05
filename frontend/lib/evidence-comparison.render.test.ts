import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceComparison } from "@/app/(app)/engagements/[id]/desk-review/evidence-comparison";
import { compareEvidence } from "@verifystack/backend/domain/registry/compare";
import { CEMENT_REGISTRY } from "@verifystack/backend/domain/registry";

const names: Record<string, string> = { certA: "09_coal_nabl_external_certificate.pdf", certB: "08_lab.pdf" };

const render = (c: ReturnType<typeof compareEvidence> | null) => renderToStaticMarkup(createElement(EvidenceComparison, { comparison: c }));

const input = (factValue: number, factDoc = "certA") => ({
  registry: CEMENT_REGISTRY,
  readings: {
    "pf.gcv_coal": { value: 4150 },
    "lab.gcv_mean": { value: 4210 },
    "coal.nabl_gcv": { value: 4230, documentId: "certA" },
  },
  facts: [
    { id: "f1", documentId: factDoc, fieldPath: "calorificValue", value: factValue, unit: "kcal/kg", canonicalKey: "coal_gcv", periodStatus: "known" as const, periodStart: "2023-10-01", periodEnd: "2023-10-01" },
    { id: "f2", documentId: "certB", fieldPath: "quantity", value: 5, unit: "t", canonicalKey: null },
  ],
  documentName: (id: string) => names[id] ?? null,
  tolerance: 0.005,
});

describe("the side-by-side card", () => {
  it("renders nothing when there is no registry for the pack", () => {
    expect(render(null)).toBe("");
  });

  it("shows every source for coal GCV with its origin, unit, span and document", () => {
    const html = render(compareEvidence(input(4230)));
    expect(html).toContain("Evidence side by side");
    for (const text of ["Pro forma", "Workbook", "Desk reading", "Workbench fact", "pf.gcv_coal", "coal.nabl_gcv", "calorificValue", "09_coal_nabl_external_certificate.pdf", "On kcal/kg", "2023-10-01 to 2023-10-01"]) {
      expect(html, text).toContain(text);
    }
  });

  it("says Agrees for the same certificate, and Not compared for a different span", () => {
    const html = render(compareEvidence(input(4230)));
    expect(html).toContain("Agrees");
    expect(html).toMatch(/Not compared[\s\S]*different spans/);
  });

  it("says Disagrees, with both figures, when the same certificate was read two ways", () => {
    const html = render(compareEvidence(input(4320)));
    expect(html).toContain("Disagrees");
    expect(html).toMatch(/4,320 and 4,230 kcal\/kg/);
  });

  it("says Not compared when the fact is from another document", () => {
    const html = render(compareEvidence(input(4230, "certB")));
    expect(html).not.toContain("Agrees");
    expect(html).toContain("different documents");
  });

  it("mentions facts it has not keyed, and offers no way to change anything", () => {
    const html = render(compareEvidence(input(4230)));
    expect(html).toMatch(/1 approved fact is not keyed/);
    expect(html).not.toMatch(/<button|<form|<input|onclick/i);
  });

  it("says so when nothing has been recorded yet", () => {
    const html = render(compareEvidence({ ...input(1), readings: {}, facts: [] }));
    expect(html).toContain("has been recorded");
  });
});
