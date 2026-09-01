import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import {
  assertCanSignOff,
  assertMakerChecker,
  canSubmit,
  type OpenFinding,
} from "@verifystack/backend/domain/signoff/guards";
import { createEsignProvider } from "@verifystack/backend/domain/esign/provider";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { signoffsForPass } from "@verifystack/backend/domain/adeetie/lifecycle";
import type { AdeetiePhase, MembershipRole } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  engagementId: z.string().uuid(),
  attestorName: z.string().min(1),
  statement: z.string().min(1),
  role: z.enum(["lead_verifier", "independent_reviewer"]),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }
    const cap = parsed.data.role === "lead_verifier" ? "signoff.lead" : "signoff.reviewer";
    const session = await requireCapability(cap);
    if (session.role !== parsed.data.role) {
      return NextResponse.json(
        { ok: false, error: "You can only attest in your own role." },
        { status: 403 }
      );
    }
    const organizationId = assertOrgId(session.organizationId);
    const engagement = await getEngagement(parsed.data.engagementId, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: findings } = await supabase
      .from("findings")
      .select("id, severity, state")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId);
    assertCanSignOff((findings ?? []) as OpenFinding[]);

    const { data: existing } = await supabase
      .from("signoffs")
      .select("role, attestor_user_id, adeetie_phase")
      .eq("engagement_id", engagement.id);

    const passSignoffs = signoffsForPass(
      existing ?? [],
      engagement.adeetie_phase as AdeetiePhase | null
    );

    assertMakerChecker(
      parsed.data.role as MembershipRole,
      session.user.id,
      passSignoffs
    );

    const { data: latestRun } = await supabase
      .from("calculation_runs")
      .select("input_hash, engine_version, pack_version")
      .eq("engagement_id", engagement.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const reportHash = createHash("sha256")
      .update(engagement.id)
      .update(latestRun?.input_hash ?? "no-run")
      .update(parsed.data.attestorName)
      .digest("hex");

    const esign = createEsignProvider();
    const attestation = await esign.attest({
      engagementId: engagement.id,
      attestorName: parsed.data.attestorName,
      attestorUserId: session.user.id,
      role: parsed.data.role,
      reportHash,
      statement: parsed.data.statement,
    });

    const { data: row, error } = await supabase
      .from("signoffs")
      .insert({
        organization_id: organizationId,
        engagement_id: engagement.id,
        role: parsed.data.role,
        attestor_name: parsed.data.attestorName,
        attestor_user_id: session.user.id,
        report_hash: reportHash,
        statement: parsed.data.statement,
        ...(engagement.scheme === "ADEETIE" && engagement.adeetie_phase
          ? { adeetie_phase: engagement.adeetie_phase }
          : {}),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      action: "engagement.signed",
      entityType: "signoff",
      entityId: row.id,
      payload: {
        role: parsed.data.role,
        report_hash: reportHash,
        provider: attestation.provider,
        input_hash: latestRun?.input_hash ?? null,
      },
    });

    const after = [
      ...passSignoffs,
      { role: parsed.data.role, attestor_user_id: session.user.id },
    ];
    await ensureEngagementStatus({
      organizationId,
      engagementId: engagement.id,
      current: engagement.status,
      target: canSubmit(after) ? "submitted" : "signoff",
    });

    return NextResponse.json({ ok: true, signoff: row, attestation });
  } catch (e) {
    return jsonError(e);
  }
}
