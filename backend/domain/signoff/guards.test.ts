import { describe, expect, it } from "vitest";
import {
  assertCanSignOff,
  assertMakerChecker,
  canSubmit,
  SignoffError,
} from "./guards";

describe("sign-off guards", () => {
  it("blocks sign-off while block findings are open", () => {
    expect(() =>
      assertCanSignOff([
        { id: "1", severity: "block", state: "suggested" },
        { id: "2", severity: "warn", state: "suggested" },
      ])
    ).toThrow(SignoffError);
  });

  it("allows sign-off when blocks are closed or rejected", () => {
    expect(() =>
      assertCanSignOff([
        { id: "1", severity: "block", state: "closed" },
        { id: "2", severity: "block", state: "rejected" },
        { id: "3", severity: "warn", state: "suggested" },
      ])
    ).not.toThrow();
  });

  it("enforces maker-checker distinct persons", () => {
    expect(() =>
      assertMakerChecker("independent_reviewer", "user-1", [
        { role: "lead_verifier", attestor_user_id: "user-1" },
      ])
    ).toThrow(/maker-checker/i);
    expect(() =>
      assertMakerChecker("independent_reviewer", "user-2", [
        { role: "lead_verifier", attestor_user_id: "user-1" },
      ])
    ).not.toThrow();
  });

  it("requires both lead and independent reviewer before submit", () => {
    expect(canSubmit([{ role: "lead_verifier", attestor_user_id: "a" }])).toBe(false);
    expect(
      canSubmit([
        { role: "lead_verifier", attestor_user_id: "a" },
        { role: "independent_reviewer", attestor_user_id: "b" },
      ])
    ).toBe(true);
  });
});
