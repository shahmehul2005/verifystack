import { NextResponse } from "next/server";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";
import { SignoffError } from "@verifystack/backend/domain/signoff/guards";
import { AdeetieLifecycleError } from "@verifystack/backend/domain/adeetie/lifecycle";

export function jsonError(err: unknown, fallback = 500) {
  if (err instanceof AuthError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  if (err instanceof SignoffError || err instanceof AdeetieLifecycleError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 422 });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ ok: false, error: message }, { status: fallback });
}
