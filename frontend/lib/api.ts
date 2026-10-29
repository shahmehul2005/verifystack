import { NextResponse } from "next/server";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";
import { SignoffError } from "@verifystack/backend/domain/signoff/guards";
import { AdeetieLifecycleError } from "@verifystack/backend/domain/adeetie/lifecycle";
import { ObservationError } from "@verifystack/backend/domain/fieldwork/observation";
import { IssueTransitionError } from "@verifystack/backend/domain/issues/lifecycle";
import { TechnicalReviewError } from "@verifystack/backend/domain/review/technical";
import { SubmissionError } from "@verifystack/backend/domain/submission/package";
import { StageError } from "@verifystack/backend/domain/stages/stages";
import { PlanError } from "@verifystack/backend/domain/planning/plan";
import { MethodNotImplementedError } from "@verifystack/backend/domain/calc/dispatch";
import { ResolutionError } from "@verifystack/backend/domain/deskreview/resolution";
import { rateLimit, type LIMITS } from "@verifystack/backend/lib/rateLimit";

export function jsonError(err: unknown, fallback = 500) {
  if (err instanceof AuthError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  if (
    err instanceof SignoffError ||
    err instanceof AdeetieLifecycleError ||
    err instanceof ObservationError ||
    err instanceof IssueTransitionError ||
    err instanceof TechnicalReviewError ||
    err instanceof SubmissionError ||
    err instanceof StageError ||
    err instanceof PlanError ||
    err instanceof ResolutionError ||
    err instanceof MethodNotImplementedError
  ) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 422 });
  }
  console.error("[api]", err);
  // Database and storage messages name tables, columns and constraints.
  const message =
    process.env.NODE_ENV === "production"
      ? "Something went wrong. Try again, and contact support if it keeps happening."
      : err instanceof Error
        ? err.message
        : "Unexpected error";
  return NextResponse.json({ ok: false, error: message }, { status: fallback });
}

/** Client IP as reported by the hosting proxy. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

/** Returns a 429 response when the key is over its limit, otherwise null. */
export function limitExceeded(
  key: string,
  rule: (typeof LIMITS)[keyof typeof LIMITS]
): NextResponse | null {
  const result = rateLimit(key, rule.limit, rule.windowMs);
  if (result.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Too many requests. Wait a moment and try again." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } }
  );
}

/**
 * Origin for links sent in email. Taken from APP_URL when set, otherwise from
 * the URL the request was routed to — never from the Origin header, which the
 * caller controls.
 */
export function appOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}
