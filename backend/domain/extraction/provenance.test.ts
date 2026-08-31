import { describe, expect, it } from "vitest";
import { provenanceGate } from "./provenance";
import { chooseRoute } from "./digital";

describe("provenance gate (3.5)", () => {
  it("accepts a fully provenanced field", () => {
    const r = provenanceGate({
      fieldPath: "quantity",
      page: 1,
      bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
      sourceText: "18,247 MT",
    });
    expect(r.ok).toBe(true);
  });

  it("drops missing source text / bbox", () => {
    expect(
      provenanceGate({ fieldPath: "quantity", page: 1, sourceText: "x" }).ok
    ).toBe(false);
    expect(
      provenanceGate({
        fieldPath: "quantity",
        page: 1,
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        sourceText: "",
      }).ok
    ).toBe(false);
  });
});

describe("digital vs vision routing (3.1)", () => {
  it("routes image scans to vision and text-rich PDFs to digital", () => {
    expect(chooseRoute(10, "image/png")).toBe("vision");
    expect(chooseRoute(500, "application/pdf")).toBe("digital");
    expect(chooseRoute(10, "application/pdf")).toBe("vision");
  });
});
