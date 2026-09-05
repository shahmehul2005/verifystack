import { describe, expect, it } from "vitest";
import {
  inviteExpiresAt,
  inviteSignupPath,
  signFirmInvite,
  verifyFirmInvite,
} from "./firmInvite";

const KEY = "test-invite-secret";

describe("firm invite tokens", () => {
  it("round-trips a signed invite", () => {
    const token = signFirmInvite(
      {
        email: "Lead@Firm.IN",
        organizationId: "11111111-1111-4111-8111-111111111111",
        role: "verifier",
        displayName: "Priya",
      },
      KEY
    );
    const payload = verifyFirmInvite(token, KEY);
    expect(payload?.email).toBe("lead@firm.in");
    expect(payload?.role).toBe("verifier");
    expect(payload?.displayName).toBe("Priya");
  });

  it("rejects a tampered token and an expired one", () => {
    const token = signFirmInvite(
      {
        email: "a@b.co",
        organizationId: "11111111-1111-4111-8111-111111111111",
        role: "lead_verifier",
        displayName: "A",
        exp: Date.now() - 1,
      },
      KEY
    );
    expect(verifyFirmInvite(token, KEY)).toBeNull();
    const live = signFirmInvite(
      {
        email: "a@b.co",
        organizationId: "11111111-1111-4111-8111-111111111111",
        role: "lead_verifier",
        displayName: "A",
      },
      KEY
    );
    expect(verifyFirmInvite(`${live}x`, KEY)).toBeNull();
  });

  it("builds a signup URL the invitee can open", () => {
    expect(inviteSignupPath("abc")).toBe("/signup?invite=abc");
    expect(inviteExpiresAt(0)).toBeGreaterThan(0);
  });
});
