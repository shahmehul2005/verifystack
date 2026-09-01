"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";

/**
 * Older Supabase email templates land with tokens in the URL hash.
 * PKCE uses ?code= on /auth/callback; this covers the hash fallback.
 */
export function AuthHashRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash.includes("type=")) return;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const type = params.get("type");
    const supabase = createBrowserSupabase();
    void supabase?.auth.getSession();
    if (type === "invite") {
      if (pathname !== "/invite") router.replace("/invite");
    } else if (type === "recovery" || type === "signup") {
      if (pathname !== "/update-password") router.replace("/update-password");
    }
  }, [pathname, router]);

  return null;
}
