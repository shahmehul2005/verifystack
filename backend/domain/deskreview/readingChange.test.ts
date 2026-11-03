import { describe, expect, it } from "vitest";
import { classifyChange, needsReason, reasonProblem, type ReadingState } from "./readingChange";

const base: ReadingState = { value: 100, documentId: "d1", page: 3, bbox: null, sourceText: null };
const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };

describe("classifyChange", () => {
  it("calls a first figure an entry and no figure at all nothing", () => {
    expect(classifyChange(null, base)).toBe("entered");
    expect(classifyChange(null, null)).toBe("nothing");
  });

  it("calls an identical figure unchanged", () => {
    expect(classifyChange(base, { ...base })).toBe("unchanged");
  });

  it("calls a different value, document, page or region an edit", () => {
    expect(classifyChange(base, { ...base, value: 101 })).toBe("edited");
    expect(classifyChange(base, { ...base, documentId: "d2" })).toBe("edited");
    expect(classifyChange(base, { ...base, page: 4 })).toBe("edited");
    expect(classifyChange(base, { ...base, bbox: box, sourceText: "100" })).toBe("edited");
  });

  it("calls a removed figure a withdrawal", () => {
    expect(classifyChange(base, null)).toBe("withdrawn");
  });

  it("ignores a region that moved by rounding and whitespace around the printed text", () => {
    const a: ReadingState = { ...base, bbox: box, sourceText: "100 t" };
    expect(classifyChange(a, { ...a, bbox: { ...box, x: box.x + 1e-12 }, sourceText: " 100 t " })).toBe("unchanged");
  });

  it("calls a moved region or different printed text an edit", () => {
    const a: ReadingState = { ...base, bbox: box, sourceText: "100 t" };
    expect(classifyChange(a, { ...a, bbox: { ...box, x: 0.5 } })).toBe("edited");
    expect(classifyChange(a, { ...a, sourceText: "110 t" })).toBe("edited");
  });
});

describe("reasons", () => {
  it("asks for a reason on an edit and a withdrawal only", () => {
    expect(needsReason("edited")).toBe(true);
    expect(needsReason("withdrawn")).toBe(true);
    expect(needsReason("entered")).toBe(false);
    expect(needsReason("unchanged")).toBe(false);
    expect(needsReason("nothing")).toBe(false);
  });

  it("refuses a missing or short reason where one is needed", () => {
    expect(reasonProblem("edited", undefined)).not.toBeNull();
    expect(reasonProblem("withdrawn", "   typo  ")).not.toBeNull();
    expect(reasonProblem("edited", "Misread the MPR total")).toBeNull();
  });

  it("does not ask for a reason where none is needed", () => {
    expect(reasonProblem("entered", "")).toBeNull();
    expect(reasonProblem("unchanged", null)).toBeNull();
  });
});
