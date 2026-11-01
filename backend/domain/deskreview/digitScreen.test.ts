import { describe, expect, it } from "vitest";
import {
  BENFORD_P1,
  MIN_SCREEN_SAMPLE,
  benfordApplies,
  benfordFirstDigit,
  chiSquarePValue,
  describeScreen,
  firstDigit,
  roundEndingShare,
  terminalDigit,
  terminalDigitOfText,
  terminalDigitUniformity,
} from "./digitScreen";

/** A deterministic pseudo-random generator, so the fixtures never change between runs. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("firstDigit", () => {
  it("reads the leading digit of a positive quantity", () => {
    expect(firstDigit(1)).toBe(1);
    expect(firstDigit(9.99)).toBe(9);
    expect(firstDigit(0.0042)).toBe(4);
    expect(firstDigit(1234567)).toBe(1);
  });

  it("has no leading digit for zero or a non-number", () => {
    expect(firstDigit(0)).toBeNull();
    expect(firstDigit(Number.NaN)).toBeNull();
    expect(firstDigit(-5)).toBe(5);
  });
});

describe("terminalDigit", () => {
  it("reads the last digit as written", () => {
    expect(terminalDigit(1250)).toBe(0);
    expect(terminalDigit(3497)).toBe(7);
    expect(terminalDigit(4200.5)).toBe(5);
    expect(terminalDigit(4000)).toBe(0);
  });

  it("declines a value so large that its written digits are lost", () => {
    expect(terminalDigit(1.5e21)).toBeNull();
  });

  it("reads the last digit of the text a person typed", () => {
    expect(terminalDigitOfText("1,250")).toBe(0);
    expect(terminalDigitOfText("406.4")).toBe(4);
    expect(terminalDigitOfText("")).toBeNull();
  });
});

describe("the p-value matches the chi-square distribution", () => {
  it("is 1 at zero and small for a large statistic", () => {
    expect(chiSquarePValue(0, 8)).toBeCloseTo(1, 6);
    expect(chiSquarePValue(8, 8)).toBeCloseTo(0.4335, 4);
    expect(chiSquarePValue(20, 8)).toBeCloseTo(0.0103, 3);
    expect(chiSquarePValue(26.124, 8)).toBeCloseTo(0.001, 3);
  });

  it("matches the 5% critical value on 9 degrees of freedom", () => {
    expect(chiSquarePValue(16.919, 9)).toBeCloseTo(0.05, 3);
  });
});

describe("benfordFirstDigit", () => {
  it("does not judge a sample smaller than the screen needs", () => {
    const out = benfordFirstDigit([1, 2, 3, 4, 5]);
    expect(out.smallSample).toBe(true);
    expect(Number.isNaN(out.pValue)).toBe(true);
  });

  it("finds no deviation in quantities drawn from a Benford distribution", () => {
    const rand = rng(2024);
    const values: number[] = [];
    // A log-uniform draw follows Benford's law exactly in expectation.
    for (let i = 0; i < 400; i += 1) values.push(10 ** (rand() * 4));
    const out = benfordFirstDigit(values);
    expect(out.n).toBe(values.length);
    expect(out.pValue).toBeGreaterThan(0.01);
  });

  it("finds a strong deviation when every value starts with the same digit", () => {
    const values = Array.from({ length: 120 }, (_, i) => 5000 + i * 7);
    const out = benfordFirstDigit(values);
    expect(out.n).toBe(120);
    expect(out.pValue).toBeLessThan(0.001);
  });

  it("states the expected shares that sum to one", () => {
    expect(BENFORD_P1.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(BENFORD_P1[0]).toBeCloseTo(0.30103, 5);
  });
});

describe("terminalDigitUniformity", () => {
  it("does not judge a small sample", () => {
    expect(terminalDigitUniformity([1, 2, 3]).smallSample).toBe(true);
  });

  it("does not flag a genuinely varied set", () => {
    const values = Array.from({ length: 200 }, (_, i) => 1000 + i * 3.7);
    const out = terminalDigitUniformity(values);
    expect(out.pValue).toBeGreaterThan(0.01);
  });

  it("flags a set where every weight ends in the same digit", () => {
    const values = Array.from({ length: 60 }, (_, i) => 4000 + i * 10);
    const out = terminalDigitUniformity(values);
    expect(out.pValue).toBeLessThan(0.001);
    expect(describeScreen("Terminal digits", out)).toMatch(/strong deviation/);
  });

  it("reports how many values end in 0 or 5", () => {
    const out = roundEndingShare([1250, 1255, 1300, 431.7, 888.2]);
    expect(out.n).toBe(5);
    expect(out.share).toBeCloseTo(3 / 5, 6);
    expect(roundEndingShare([]).n).toBe(0);
  });

  it("declines Benford on a narrow set instead of reporting a deviation", () => {
    expect(benfordApplies([4117, 4275, 4188, 4200]).ok).toBe(false);
    expect(benfordApplies([1, 2, 3]).ok).toBe(false);
    const narrow = benfordApplies([4117, 4275, 4188, 4200]);
    if (narrow.ok) return;
    expect(narrow.reason).toMatch(/within one order of magnitude/);
  });

  it("applies Benford to a set that spans the right orders of magnitude", () => {
    expect(benfordApplies([12, 950, 4300]).ok).toBe(true);
    expect(benfordApplies([1e6, 2, 3]).ok).toBe(false);
  });

  it("uses the same minimum sample everywhere", () => {
    expect(MIN_SCREEN_SAMPLE).toBe(30);
    expect(describeScreen("Benford", benfordFirstDigit([1, 2, 3]))).toMatch(/fewer than the 30/);
  });});
