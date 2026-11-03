/**
 * Cross-site request check for state-changing API calls. Session cookies are
 * SameSite=Lax already; this is the second wall, so a browser on another site
 * cannot drive a signed-in verifier's session.
 *
 * Requests without an Origin header (server scripts, CLIs, Inngest) pass: they
 * carry no ambient browser cookies to abuse.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RequestShape {
  method: string;
  pathname: string;
  origin: string | null;
  host: string | null;
  secFetchSite: string | null;
  allowedHosts?: string[];
}

export function isCrossSiteWrite(req: RequestShape): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  if (!req.pathname.startsWith("/api/")) return false;
  if (req.pathname.startsWith("/api/inngest")) return false;

  if (req.secFetchSite === "cross-site") return true;
  if (!req.origin) return false;

  let originHost: string;
  try {
    originHost = new URL(req.origin).host.toLowerCase();
  } catch {
    return true;
  }
  const allowed = [req.host, ...(req.allowedHosts ?? [])]
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase());
  return !allowed.includes(originHost);
}

/** Host of `APP_URL`, when set. */
export function appUrlHost(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}
