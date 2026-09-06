import "server-only";

import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

export interface TeamInviteEmailInput {
  email: string;
  displayName: string;
  organizationName: string;
  role: MembershipRole;
  inviteUrl: string;
}

interface TeamInviteEmailContent {
  subject: string;
  text: string;
  html: string;
}

export function buildTeamInviteEmail(input: TeamInviteEmailInput): TeamInviteEmailContent {
  const roleLabel = ROLE_LABEL[input.role];
  const subject = `You're invited to join ${input.organizationName} on VerifyStack`;
  const text = [
    `Hi ${input.displayName},`,
    "",
    `You've been invited to join ${input.organizationName} as ${roleLabel}.`,
    "",
    "Open this invite link to create your account and set your password:",
    input.inviteUrl,
    "",
    "If you did not expect this invite, you can ignore this email.",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(input.displayName)},</p>`,
    `<p>You've been invited to join <strong>${escapeHtml(input.organizationName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>.</p>`,
    "<p>Open this invite link to create your account and set your password:</p>",
    `<p><a href="${escapeHtml(input.inviteUrl)}">${escapeHtml(input.inviteUrl)}</a></p>`,
    "<p>If you did not expect this invite, you can ignore this email.</p>",
  ].join("");
  return { subject, text, html };
}

export async function sendTeamInviteEmail(input: TeamInviteEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const content = buildTeamInviteEmail(input);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: ["Bearer", apiKey].join(" "),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
