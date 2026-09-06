import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTeamInviteEmail, sendTeamInviteEmail } from "./invite";

describe("team invite email", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("builds invite content with required details", () => {
    const content = buildTeamInviteEmail({
      email: "new@firm.com",
      displayName: "Priya",
      organizationName: "Acme Energy",
      role: "lead_verifier",
      inviteUrl: "https://app.test/signup?invite=abc123",
    });

    expect(content.subject).toContain("Acme Energy");
    expect(content.text).toContain("Hi Priya");
    expect(content.text).toContain("Lead verifier");
    expect(content.text).toContain("https://app.test/signup?invite=abc123");
    expect(content.html).toContain("Acme Energy");
    expect(content.html).toContain("Lead verifier");
    expect(content.html).toContain("href=\"https://app.test/signup?invite=abc123\"");
  });

  it("returns false when resend is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const sent = await sendTeamInviteEmail({
      email: "new@firm.com",
      displayName: "Priya",
      organizationName: "Acme Energy",
      role: "verifier",
      inviteUrl: "https://app.test/signup?invite=abc123",
    });
    expect(sent).toBe(false);
  });

  it("posts to resend when configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@verifystack.dev");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendTeamInviteEmail({
      email: "new@firm.com",
      displayName: "Priya",
      organizationName: "Acme Energy",
      role: "verifier",
      inviteUrl: "https://app.test/signup?invite=abc123",
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
    const [, options] = fetchMock.mock.calls[0] as [string, { headers: { Authorization: string } }];
    expect(options.headers.Authorization.startsWith("Bearer ")).toBe(true);
  });
});
