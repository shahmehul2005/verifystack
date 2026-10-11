import { describe, expect, it } from "vitest";
import { collectUnverifiedFactors } from "./factors";

describe("collectUnverifiedFactors", () => {
  it("finds unverified factors at any depth, once each and sorted", () => {
    const result = {
      streams: [
        {
          factorsUsed: [
            { id: "coal", vintage: "2024", verified: false },
            { id: "grid", vintage: "2024", verified: true },
          ],
        },
        { nested: { factorsUsed: [{ id: "coal", vintage: "2024", verified: false }, { id: "ash", verified: false }] } },
      ],
    };
    expect(collectUnverifiedFactors(result)).toEqual(["ash", "coal@2024"]);
  });

  it("returns nothing when every factor is verified or the result is empty", () => {
    expect(collectUnverifiedFactors({ factorsUsed: [{ id: "x", vintage: "1", verified: true }] })).toEqual([]);
    expect(collectUnverifiedFactors(null)).toEqual([]);
    expect(collectUnverifiedFactors("text")).toEqual([]);
  });

  it("does not loop on a cyclic structure", () => {
    const a: Record<string, unknown> = { factorsUsed: [{ id: "x", verified: false }] };
    a.self = a;
    expect(collectUnverifiedFactors(a)).toEqual(["x"]);
  });
});
