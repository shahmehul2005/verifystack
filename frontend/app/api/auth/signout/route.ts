import { NextResponse, type NextRequest } from "next/server";
import { createRouteSupabase } from "@verifystack/backend/lib/supabase/routeClient";

export async function POST(request: NextRequest) {
  const dest = new URL("/login", request.url);
  dest.searchParams.set("signed_out", "1");
  const response = NextResponse.redirect(dest, { status: 303 });
  const supabase = createRouteSupabase(request, response);
  if (supabase) {
    await supabase.auth.signOut();
  }
  return response;
}
