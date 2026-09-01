import "server-only";

/**
 * Who may create an account without an invite.
 *
 * Self-serve signup writes a confirmed user with the service role, bypassing
 * email verification, because hosted Supabase Auth caps outbound mail on new
 * projects. That trade is acceptable while the product is a pilot and is not
 * acceptable once a firm holds real engagements, so the gate is configurable
 * and the default is recorded here rather than assumed at the call site.
 *
 *   AUTH_OPEN_SIGNUP=false             closes self-serve signup entirely;
 *                                      members arrive by firm-admin invite
 *   AUTH_SIGNUP_ALLOWED_DOMAINS=a,b    restricts self-serve signup to those
 *                                      email domains
 *
 * With neither set, signup is open. That is the pilot default and is deliberate.
 */

export interface SignupGate {
  allowed: boolean;
  reason: string;
}

const CLOSED =
  "Self-serve signup is closed. Ask a firm admin to invite you, and check your inbox for the invite link.";

export function signupGate(email: string): SignupGate {
  if (process.env.AUTH_OPEN_SIGNUP === "false") {
    return { allowed: false, reason: CLOSED };
  }

  const domains = allowedDomains();
  if (domains.length === 0) {
    return { allowed: true, reason: "" };
  }

  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domains.includes(domain)) {
    return {
      allowed: false,
      reason: `Accounts on ${domain || "that domain"} are not opened from this page. Ask a firm admin to invite you.`,
    };
  }
  return { allowed: true, reason: "" };
}

export function allowedDomains(): string[] {
  return (process.env.AUTH_SIGNUP_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}
