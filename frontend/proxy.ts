import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@verifystack/backend/lib/supabase/updateSession";
import { appUrlHost, isCrossSiteWrite } from "@verifystack/backend/lib/sameOrigin";

/**
 * Next.js 16 session proxy. Do not also add middleware.ts — Next 16
 * rejects both files in the same project.
 * Rejects cross-site writes to /api, then does an optimistic cookie refresh and
 * the unauthenticated redirect into /login.
 * Authorization still happens in requireRole / RLS.
 */
export async function proxy(request: NextRequest) {
  const appHost = appUrlHost();
  const crossSite = isCrossSiteWrite({
    method: request.method,
    pathname: request.nextUrl.pathname,
    origin: request.headers.get("origin"),
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    allowedHosts: appHost ? [appHost] : [],
  });
  if (crossSite) {
    return NextResponse.json({ ok: false, error: "Cross-site request refused" }, { status: 403 });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
