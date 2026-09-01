"use client";

import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { safeNextPath } from "@verifystack/backend/lib/auth/redirect";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { rememberIntendedRole } from "./intended-role";

export function oauthRedirectTo(next?: string | null, role?: MembershipRole | null) {
  const origin = window.location.origin;
  const dest = safeNextPath(next, homePathFor(role));
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", dest);
  return url.toString();
}

export async function signInWithGoogle(next?: string | null, role?: MembershipRole | null) {
  const supabase = createBrowserSupabase();
  if (!supabase) return { error: "Supabase is not configured." };
  if (role) rememberIntendedRole(role);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: oauthRedirectTo(next, role),
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  });
  return { error: error?.message ?? null };
}
