import { describe, expect, it } from "vitest";
import { signFirmInvite } from "./firmInvite";
import { newResponseNonce, responseLinkPath, signResponseLink, verifyResponseLink } from "./responseLink";

const KEY = "test-secret";
const base = {
  findingId: "11111111-1111-4111-8111-111111111111",
  engagementId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  nonce: "abc123",
};

describe("response links", () => {
  it("round-trips the issue, engagement, firm and nonce", () => {
    const token = signResponseLink(base, KEY);
    expect(verifyResponseLink(token, KEY)).toMatchObject(base);
  });

  it("rejects tampering, the wrong key and expiry", () => {
    const token = signResponseLink(base, KEY);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...base, findingId: "other", exp: Date.now() + 1e9 })).toString("base64url");
    expect(verifyResponseLink(`${forged}.${sig}`, KEY)).toBeNull();
    expect(verifyResponseLink(token, "other-key")).toBeNull();
    expect(verifyResponseLink(`${body}.x`, KEY)).toBeNull();
    const old = signResponseLink({ ...base, exp: 1_000 }, KEY);
    expect(verifyResponseLink(old, KEY)).toBeNull();
    expect(verifyResponseLink(old, KEY, 500)).not.toBeNull();
  });

  it("cannot be replayed as a firm invite, or the reverse", () => {
    const invite = signFirmInvite(
      { email: "a@b.in", organizationId: base.organizationId, role: "verifier", displayName: "A" },
      KEY
    );
    expect(verifyResponseLink(invite, KEY)).toBeNull();
  });

  it("refuses garbage and oversized tokens", () => {
    expect(verifyResponseLink("", KEY)).toBeNull();
    expect(verifyResponseLink("nodot", KEY)).toBeNull();
    expect(verifyResponseLink("x".repeat(3000), KEY)).toBeNull();
  });

  it("makes distinct nonces and a URL-safe path", () => {
    expect(newResponseNonce()).not.toBe(newResponseNonce());
    expect(responseLinkPath("a.b")).toBe("/respond/a.b");
  });
});
