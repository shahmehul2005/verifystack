import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";
import { isSupabaseConfigured } from "./configured";
import { hasSupabaseAuthCookie } from "./authCookies";

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

const AUTH_GATE_PATHS = new Set(["/login", "/signup", "/forgot-password"]);

function isAppPath(pathname: string) {
  if (pathname === "/") return false;
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Optimistic session gate + login redirect.
 * Not an authorization boundary — every server action/route still calls requireRole.
 *
 * Auth network work is kept to one place per click:
 * - No auth cookie → no getUser (anonymous traffic and unauthenticated app redirects).
 * - Auth pages with a cookie → getUser once, to send signed-in users to /engagements.
 * - Everywhere else with a cookie → pass through; Server Components call getUser
 *   via getSession() (and refresh cookies there). That avoids paying Supabase Auth
 *   twice on every tab click.
 */
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  const cookies = request.cookies.getAll();
  if (!hasSupabaseAuthCookie(cookies)) {
    if (isAppPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  // Signed-in navigations into the app (and APIs, marketing, etc.) skip getUser
  // here. getSession() in the page does the single Auth round trip.
  if (!AUTH_GATE_PATHS.has(pathname)) {
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

  if (user) {
    const url = request.nextUrl.clone();
    url.pathname = "/engagements";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
