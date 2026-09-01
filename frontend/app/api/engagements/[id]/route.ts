import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { assertTransition, type Status } from "@verifystack/backend/domain/engagements/status";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import type { Database } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  status: z
    .enum(["setup", "intake", "review", "calc", "findings", "signoff", "submitted"])
    .optional(),
  draftMode: z.boolean().optional(),
  loanAmountInr: z.number().nonnegative().nullable().optional(),
  projectCostInr: z.number().nonnegative().nullable().optional(),
  sanctionedInterestRatePct: z.number().nonnegative().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const pack = loadPack(engagement.pack_id);
    if (parsed.data.draftMode !== undefined) {
      if (!hasCapability(session.role, "engagements.draftMode")) {
        throw new AuthError("Leaving or entering draft mode is restricted to the lead verifier.", 403);
      }
    }
    if (
      parsed.data.loanAmountInr !== undefined ||
      parsed.data.projectCostInr !== undefined ||
      parsed.data.sanctionedInterestRatePct !== undefined
    ) {
      if (!hasCapability(session.role, "adeetie.operate")) {
        throw new AuthError("ADEETIE finance fields are restricted to the lead verifier.", 403);
      }
    }
    if (parsed.data.status) {
      if (!hasCapability(session.role, "engagements.create") && !hasCapability(session.role, "adeetie.operate")) {
        throw new AuthError("Status changes are restricted to the lead verifier.", 403);
      }
    }
    if (parsed.data.status) {
      if (!canStartWork(pack) && parsed.data.status !== "setup") {
        return NextResponse.json(
          { ok: false, error: "Scaffold packs cannot start active work" },
          { status: 409 }
        );
      }
      assertTransition(engagement.status as Status, parsed.data.status as Status);
    }

    const patch: Database["public"]["Tables"]["engagements"]["Update"] = {};
    if (parsed.data.status) patch.status = parsed.data.status;
    if (parsed.data.draftMode !== undefined) patch.draft_mode = parsed.data.draftMode;
    if (parsed.data.loanAmountInr !== undefined) patch.loan_amount_inr = parsed.data.loanAmountInr;
    if (parsed.data.projectCostInr !== undefined) {
      patch.project_cost_inr = parsed.data.projectCostInr;
    }
    if (parsed.data.sanctionedInterestRatePct !== undefined) {
      patch.sanctioned_interest_rate_pct = parsed.data.sanctionedInterestRatePct;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { error } = await supabase
      .from("engagements")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);
    await auditEvent({
      organizationId,
      action: parsed.data.draftMode !== undefined
        ? "engagement.draft_mode"
        : parsed.data.status
          ? "engagement.status"
          : "engagement.adeetie_finance",
      entityType: "engagement",
      entityId: id,
      payload: { from: engagement.status, ...patch },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
