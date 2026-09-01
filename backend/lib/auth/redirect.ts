/** Default landing after a successful sign-in. */
export const DEFAULT_AFTER_AUTH = "/engagements";

export const MIN_PASSWORD_LENGTH = 8;

const BLOCKED_NEXT = new Set(["/login", "/signup", "/forgot-password", "/auth/callback"]);

/**
 * Same-origin relative paths only. Blocks open redirects and looping back
 * through the auth screens.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = DEFAULT_AFTER_AUTH
): string {
  if (!raw) return fallback;
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("://") || value.includes("\\") || value.includes("\0")) return fallback;

  const pathname = (value.split("?")[0] ?? value).replace(/\/+$/, "") || "/";
  if (BLOCKED_NEXT.has(pathname) || pathname.startsWith("/auth/callback")) {
    return fallback;
  }
  return value;
}

export function passwordIssue(password: string, confirm?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (confirm !== undefined && password !== confirm) {
    return "Passwords do not match.";
  }
  return null;
}

export function publicAuthMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "access_denied":
      return "Google sign-in was cancelled.";
    case "expired":
      return "That link has expired. Request a new one.";
    case "auth":
    default:
      return "Could not complete sign-in. Try again.";
  }
}
