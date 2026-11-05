import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { WITHDRAW_MIN_REASON, withdrawFailure, withdrawRpcParams } from "@verifystack/backend/domain/ledger/withdrawal";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  factId: z.string().uuid(),
  reason: z.string().trim().min(WITHDRAW_MIN_REASON, `Say why in at least ${WITHDRAW_MIN_REASON} characters.`).max(500),
});

/** Once sign-off starts, the ledger the lead and the reviewer are signing is fixed. */
const FROZEN = new Set(["signoff", "submitted"]);

/**
 * Take a wrong fact out of the ledger a run reads, keeping it.
 *
 * The facts table is append-only, so the route never deletes from it. It calls the database function
 * `withdraw_fact` (migration 0024), which in one transaction copies the fact in full to
 * fact_withdrawals with who, when and why, removes it from facts, marks the extracted value it came
 * from as rejected and writes the audit event. If any step fails nothing changes. A replacement comes
 * from a new snip or another accepted value. Calculation runs already made keep the figures they
 * used, so run again afterwards.
 *
 * The checks below give a clear answer early; the function repeats them under a lock, so a sign-off
 * that starts in between still wins.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const body = parsed.data;

    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (FROZEN.has(engagement.status)) {
      return NextResponse.json({ ok: false, error: "Sign-off has started, so the facts ledger can no longer change." }, { status: 409 });
    }
    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: withdrawalId, error } = await supabase.rpc(
      "withdraw_fact",
      withdrawRpcParams({
        organizationId,
        engagementId: body.engagementId,
        factId: body.factId,
        reason: body.reason,
        userId: session.user.id,
      })
    );
    if (error) {
      const failure = withdrawFailure(error);
      return NextResponse.json({ ok: false, error: failure.message }, { status: failure.status });
    }
    return NextResponse.json({ ok: true, withdrawalId });
  } catch (e) {
    return jsonError(e);
  }
}
