import "server-only";

import { z } from "zod";

export const DEMO_SCHEMES = ["CCTS", "ADEETIE", "Both"] as const;

export const DemoRequestBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  firm: z.string().trim().min(1).max(160),
  scheme: z.enum(DEMO_SCHEMES),
  message: z.string().trim().max(2000).optional(),
  /** Honeypot. Real visitors never see or fill it. */
  website: z.string().max(200).optional(),
});

export type DemoRequest = z.infer<typeof DemoRequestBody>;

export type DemoRequestSendResult = "sent" | "not_configured" | "failed";

/** Recipients from DEMO_REQUEST_TO, comma-separated. */
export function demoRequestRecipients(): string[] {
  return (process.env.DEMO_REQUEST_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => z.string().email().safeParse(s).success);
}

export function buildDemoRequestEmail(input: DemoRequest) {
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const subject = `Demo request: ${oneLine(input.firm)} (${input.scheme})`;
  const message = input.message?.trim() || "(none)";
  const text = [
    `Name: ${oneLine(input.name)}`,
    `Email: ${input.email}`,
    `Firm: ${oneLine(input.firm)}`,
    `Scheme: ${input.scheme}`,
    "",
    "Message:",
    message,
  ].join("\n");
  const html = [
    "<table cellpadding=\"4\" style=\"font-size:14px\">",
    row("Name", input.name),
    row("Email", input.email),
    row("Firm", input.firm),
    row("Scheme", input.scheme),
    "</table>",
    "<p style=\"font-size:14px\"><strong>Message</strong></p>",
    `<p style="font-size:14px;white-space:pre-wrap">${escapeHtml(message)}</p>`,
  ].join("");
  return { subject, text, html };
}

export async function sendDemoRequestEmail(input: DemoRequest): Promise<DemoRequestSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = demoRequestRecipients();
  if (!apiKey || to.length === 0) return "not_configured";

  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const content = buildDemoRequestEmail(input);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: ["Bearer", apiKey].join(" "),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: input.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      console.error(`[resend] Failed to send demo request: HTTP ${response.status} — ${body}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("[resend] Network error sending demo request:", err);
    return "failed";
  }
}

function row(label: string, value: string): string {
  return `<tr><td style="color:#5f7471">${label}</td><td>${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
