import { describe, expect, it } from "vitest";
import { CEMENT_DESK_REVIEW } from "./cement";
import { proposeFromDocuments, type EvidenceDocumentCandidate } from "./propose";
import { suggestionIdentity, suggestionInput, suggestionShown } from "./suggestionValue";

const cert = (id: string, name: string, basisLine: string): EvidenceDocumentCandidate => ({
  id,
  name,
  slot: "coal_quality",
  pages: [{ page: 1, lines: ["NABL Accredited Laboratory — Coal Test Certificate", basisLine, "GCV (kcal/kg) 4230"] }],
});

describe("what Apply puts in the box", () => {
  it("never writes the string 'undefined'", () => {
    // The word reading that used to apply as "undefined".
    expect(suggestionInput({ text: "ADB" })).toBe("ADB");
    expect(suggestionInput({})).toBeNull();
    expect(suggestionInput({ value: Number.NaN })).toBeNull();
    expect(suggestionInput({ text: "   " })).toBeNull();
  });

  it("uses a typed series first, then a word, then the number", () => {
    expect(suggestionInput({ value: 400, rawText: "2023-11-01 400\n2023-11-02 435.4" })).toBe("2023-11-01 400\n2023-11-02 435.4");
    expect(suggestionInput({ value: 7, text: "ARB" })).toBe("ARB");
    expect(suggestionInput({ value: 12500 })).toBe("12500");
    expect(suggestionInput({ value: 0 })).toBe("0");
  });

  it("shows a word, a number with its unit, or a series without inventing a figure", () => {
    expect(suggestionShown({ text: "ADB" }, "")).toBe("ADB");
    expect(suggestionShown({ value: 4230 }, "kcal/kg")).toBe("4230 kcal/kg");
    expect(suggestionShown({ value: 400, rawText: "2023-11-01 400\n2023-11-02 435.4" }, "t")).toBe("2 dated rows");
    expect(suggestionShown({}, "t")).toBe("nothing readable");
    expect(suggestionShown({ text: "ADB" }, "")).not.toMatch(/undefined/);
  });

  it("compares numbers as numbers and words ignoring case and spacing", () => {
    expect(suggestionIdentity({ value: 1 })).toBe(suggestionIdentity({ value: 1 }));
    expect(suggestionIdentity({ value: 1 })).not.toBe(suggestionIdentity({ value: 2 }));
    expect(suggestionIdentity({ text: "Air  Dried" })).toBe(suggestionIdentity({ text: "air dried" }));
    expect(suggestionIdentity({ text: "ARB" })).not.toBe(suggestionIdentity({ value: 1 }));
  });
});

describe("a word suggestion from a real proposal", () => {
  it("carries text, no value, and applies as the word", () => {
    const { suggestions } = proposeFromDocuments(CEMENT_DESK_REVIEW, [cert("c1", "nabl.pdf", "Sample basis: Air-dried basis (ADB)")]);
    const basis = suggestions.find((s) => s.key === "coal.nabl_basis");
    expect(basis).toBeDefined();
    expect(basis?.value).toBeUndefined();
    expect(basis?.text).toBe("ADB");
    expect(suggestionInput(basis!)).toBe("ADB");
    expect(suggestionShown(basis!, basis!.unit)).not.toMatch(/undefined/);
  });

  it("flags two certificates that print different bases, which a value comparison missed", () => {
    const { suggestions } = proposeFromDocuments(CEMENT_DESK_REVIEW, [
      cert("c1", "nabl_a.pdf", "Sample basis: Air-dried basis (ADB)"),
      cert("c2", "nabl_b.pdf", "Sample basis: As received (ARB)"),
    ]);
    const basis = suggestions.find((s) => s.key === "coal.nabl_basis");
    expect(basis?.note).toMatch(/other document\(s\) in this slot print a different figure/);
    expect(basis?.note).toMatch(/nabl_b\.pdf ARB/);
    expect(basis?.confidence).toBeLessThanOrEqual(0.5);
  });

  it("does not flag two certificates that print the same basis in different case", () => {
    const { suggestions } = proposeFromDocuments(CEMENT_DESK_REVIEW, [
      cert("c1", "nabl_a.pdf", "Sample basis: Air-dried basis (ADB)"),
      cert("c2", "nabl_b.pdf", "SAMPLE BASIS: AIR DRIED (ADB)"),
    ]);
    const basis = suggestions.find((s) => s.key === "coal.nabl_basis");
    expect(basis?.note ?? "").not.toMatch(/different figure/);
  });
});
