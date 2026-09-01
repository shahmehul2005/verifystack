import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";
import { isSupabaseConfigured } from "./configured";

const APP_PREFIXES = [
  "/engagements",
  "/review-queue",
  "/packs",
  "/factors",
  "/audit",
  "/team",
  "/home",
  "/forbidden",
];

function isAppPath(pathname: string) {
  if (pathname === "/") return false;
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic session refresh + login redirect.
 * Not an authorization boundary — every server action/route still calls requireRole.
 */
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isAppPath(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Recovery / invite / password-change screens need the session present.
  if ((pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/engagements";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
