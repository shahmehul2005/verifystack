import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createRouteSupabase } from "@verifystack/backend/lib/supabase/routeClient";
import { DEFAULT_AFTER_AUTH, safeNextPath } from "@verifystack/backend/lib/auth/redirect";

const OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function fail(origin: string, code: string) {
  const dest = new URL("/login", origin);
  dest.searchParams.set("error", code);
  return NextResponse.redirect(dest);
}

/**
 * PKCE + email-link landing. Google, password recovery, and confirm-signup
 * all return here with ?code= (or token_hash for older templates).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const typeParam = url.searchParams.get("type");
  const type = OTP_TYPES.has(typeParam as EmailOtpType)
    ? (typeParam as EmailOtpType)
    : null;
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return fail(origin, oauthError === "access_denied" ? "access_denied" : "auth");
  }

  const fallback =
    type === "invite" ? "/invite" : type === "recovery" ? "/update-password" : DEFAULT_AFTER_AUTH;
  const next = safeNextPath(url.searchParams.get("next"), fallback);

  if (!code && !tokenHash) {
    return fail(origin, "auth");
  }

  const response = NextResponse.redirect(new URL(next, origin));
  const supabase = createRouteSupabase(request, response);
  if (!supabase) return fail(origin, "auth");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(origin, type === "recovery" ? "expired" : "auth");
    return response;
  }

  const { error } = await supabase.auth.verifyOtp({
    type: type ?? "email",
    token_hash: tokenHash!,
  });
  if (error) return fail(origin, "expired");
  return response;
}
