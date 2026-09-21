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
    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      console.error(
        `[resend] Failed to send invite email to ${input.email}: HTTP ${response.status} — ${body}`
      );
    }
    return response.ok;
  } catch (err) {
    console.error(`[resend] Network error sending invite email to ${input.email}:`, err);
    return false;
  }
}

export interface SignupConfirmationEmailInput {
  email: string;
  confirmationUrl: string;
}

export async function sendSignupConfirmationEmail(
  input: SignupConfirmationEmailInput
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const subject = "Confirm your VerifyStack account";
  const text = [
    "Welcome to VerifyStack!",
    "",
    "Click the link below to confirm your email address and activate your account:",
    input.confirmationUrl,
    "",
    "This link expires in 24 hours.",
    "",
    "If you didn't create this account, you can safely ignore this email.",
  ].join("\n");
  const html = [
    "<p>Welcome to VerifyStack!</p>",
    "<p>Click the link below to confirm your email address and activate your account:</p>",
    `<p><a href="${escapeHtml(input.confirmationUrl)}" style="display:inline-block;padding:10px 20px;background:#18181b;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;">Confirm my email address</a></p>`,
    "<p style='color:#6b7280;font-size:13px;'>This link expires in 24 hours. If you didn't create a VerifyStack account, you can safely ignore this email.</p>",
  ].join("");

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
        subject,
        text,
        html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      console.error(
        `[resend] Failed to send signup confirmation email to ${input.email}: HTTP ${response.status} — ${body}`
      );
    }
    return response.ok;
  } catch (err) {
    console.error(
      `[resend] Network error sending signup confirmation email to ${input.email}:`,
      err
    );
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

