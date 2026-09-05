import { describe, expect, it } from "vitest";
import { SYNTHETIC_ECM_LIBRARY } from "./fixture";
import { styleIsGrounded } from "./style";

const coke = SYNTHETIC_ECM_LIBRARY.find((r) => r.id === "00000000-0000-4000-a000-000000000001")!;

describe("styleIsGrounded", () => {
  it("accepts a sentence that only restates the source row", () => {
    const sentence =
      "Consider: SYNTHETIC cupola coke-bed practice (FIXTURE) — SYNTHETIC fixture only. " +
      "Placeholder text about cupola coke-bed height. Not a BEE measure. " +
      "(typical savings 8-15% of related SEC, payback 18 months, source: " +
      "SYNTHETIC FIXTURE — not a BEE publication. Do not use for production decisions.)";
    expect(styleIsGrounded(coke, sentence)).toBe(true);
  });

  it("rejects a sentence that introduces a number absent from the row", () => {
    const sentence =
      "Consider: SYNTHETIC cupola coke-bed practice (FIXTURE) with typical savings 40% of related SEC.";
    expect(styleIsGrounded(coke, sentence)).toBe(false);
  });

  it("rejects a sentence that introduces equipment absent from the row", () => {
    const sentence =
      "Based on your induction furnace usage, consider: SYNTHETIC cupola coke-bed practice (FIXTURE).";
    expect(styleIsGrounded(coke, sentence)).toBe(false);
  });

  it("rejects a sentence that drops the row and invents a claim", () => {
    const sentence = "This plant should install a waste-heat recovery boiler immediately.";
    expect(styleIsGrounded(coke, sentence)).toBe(false);
  });

  it("rejects empty text", () => {
    expect(styleIsGrounded(coke, "   ")).toBe(false);
  });
});
