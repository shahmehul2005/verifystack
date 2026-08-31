import type { NextRequest } from "next/server";
import { updateSession } from "@verifystack/backend/lib/supabase/updateSession";

/**
 * Next.js 16 session proxy. Do not also add middleware.ts — Next 16
 * rejects both files in the same project.
 * Optimistic cookie refresh + unauthenticated redirect into /login.
 * Authorization still happens in requireRole / RLS.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
