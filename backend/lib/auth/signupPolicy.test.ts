import { afterEach, describe, expect, it } from "vitest";
import { signupGate } from "./signupPolicy";

const KEYS = ["AUTH_OPEN_SIGNUP", "AUTH_SIGNUP_ALLOWED_DOMAINS"] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("signupGate", () => {
  it("is open when nothing is configured", () => {
    expect(signupGate("anyone@example.com").allowed).toBe(true);
  });

  it("closes entirely when open signup is switched off", () => {
    process.env.AUTH_OPEN_SIGNUP = "false";
    const gate = signupGate("anyone@example.com");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/invite/i);
  });

  it("admits a listed domain and refuses others", () => {
    process.env.AUTH_SIGNUP_ALLOWED_DOMAINS = "verifystack.in, @partner.co";
    expect(signupGate("lead@verifystack.in").allowed).toBe(true);
    expect(signupGate("lead@PARTNER.CO").allowed).toBe(true);
    expect(signupGate("someone@gmail.com").allowed).toBe(false);
  });

  it("refuses an address with no domain rather than admitting it", () => {
    process.env.AUTH_SIGNUP_ALLOWED_DOMAINS = "verifystack.in";
    expect(signupGate("no-at-sign").allowed).toBe(false);
  });
});
