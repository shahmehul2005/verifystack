import { afterEach, describe, expect, it } from "vitest";
import { isPlatformSteward, stewardEmails } from "./steward";

afterEach(() => {
  delete process.env.VERIFYSTACK_STEWARD_EMAILS;
});

describe("platform steward", () => {
  it("fails closed when no stewards are configured", () => {
    expect(stewardEmails()).toEqual([]);
    expect(isPlatformSteward("anyone@example.com")).toBe(false);
  });

  it("matches a configured address regardless of case or padding", () => {
    process.env.VERIFYSTACK_STEWARD_EMAILS = " Dev@verifystack.in , ops@verifystack.in";
    expect(isPlatformSteward("dev@verifystack.in")).toBe(true);
    expect(isPlatformSteward("OPS@VERIFYSTACK.IN")).toBe(true);
    expect(isPlatformSteward("lead@client.co")).toBe(false);
  });

  it("treats a missing email as not a steward", () => {
    process.env.VERIFYSTACK_STEWARD_EMAILS = "dev@verifystack.in";
    expect(isPlatformSteward(null)).toBe(false);
    expect(isPlatformSteward(undefined)).toBe(false);
    expect(isPlatformSteward("")).toBe(false);
  });
});
