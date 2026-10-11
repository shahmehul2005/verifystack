import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DemoRequestBody,
  buildDemoRequestEmail,
  demoRequestRecipients,
  sendDemoRequestEmail,
  type DemoRequest,
} from "./demoRequest";

const request: DemoRequest = {
  name: "Priya Rao",
  email: "priya@acva.example",
  firm: "Acme Verification LLP",
  scheme: "CCTS",
  message: "We verify two cement plants.",
};

describe("demo request email", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("validates the request body", () => {
    expect(DemoRequestBody.safeParse(request).success).toBe(true);
    expect(DemoRequestBody.safeParse({ ...request, email: "not-an-email" }).success).toBe(false);
    expect(DemoRequestBody.safeParse({ ...request, scheme: "PAT" }).success).toBe(false);
    expect(DemoRequestBody.safeParse({ ...request, firm: "   " }).success).toBe(false);
    expect(DemoRequestBody.safeParse({ ...request, message: "x".repeat(2001) }).success).toBe(false);
  });

  it("escapes HTML and keeps the subject on one line", () => {
    const content = buildDemoRequestEmail({
      ...request,
      firm: "Acme\r\nBcc: x@y.z",
      message: "<script>alert(1)</script>",
    });
    expect(content.subject).toBe("Demo request: Acme Bcc: x@y.z (CCTS)");
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
    expect(content.text).toContain("Email: priya@acva.example");
  });

  it("reads only valid addresses from DEMO_REQUEST_TO", () => {
    vi.stubEnv("DEMO_REQUEST_TO", " sales@verifystack.example, nonsense ,ops@verifystack.example");
    expect(demoRequestRecipients()).toEqual([
      "sales@verifystack.example",
      "ops@verifystack.example",
    ]);
  });

  it("does not send when Resend or the recipient is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("DEMO_REQUEST_TO", "sales@verifystack.example");
    expect(await sendDemoRequestEmail(request)).toBe("not_configured");

    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("DEMO_REQUEST_TO", "");
    expect(await sendDemoRequestEmail(request)).toBe("not_configured");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to Resend with the requester as reply-to", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_FROM_EMAIL", "noreply@verifystack.example");
    vi.stubEnv("DEMO_REQUEST_TO", "sales@verifystack.example");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendDemoRequestEmail(request)).toBe("sent");
    const [url, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(options.body);
    expect(body.to).toEqual(["sales@verifystack.example"]);
    expect(body.reply_to).toBe("priya@acva.example");
    expect(body.from).toBe("noreply@verifystack.example");
  });

  it("reports a failed delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("DEMO_REQUEST_TO", "sales@verifystack.example");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendDemoRequestEmail(request)).toBe("failed");
  });
});
