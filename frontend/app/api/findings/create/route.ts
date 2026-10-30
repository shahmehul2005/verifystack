import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

export const runtime = "nodejs";

const CreateFindingSchema = z.object({
  engagementId: z.string().uuid(),
  ruleId: z.string().max(80),
  severity: z.enum(["block", "warn", "info"]),
  title: z.string().min(3).max(500),
  detail: z.string().min(5).max(5000),
  clauseRef: z.string().max(1000).optional(),
  evidenceRefs: z.array(z.string().max(200)).optional(),
  magnitude: z.object({ value: z.number(), unit: z.string().max(40) }).optional(),
  requiredResponse: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireCapability("findings.decide");
    const organizationId = assertOrgId(session.organizationId);

    const body = CreateFindingSchema.safeParse(await req.json());
    if (!body.success) {
      return NextResponse.json({ ok: false, error: "Invalid finding payload", details: body.error.issues }, { status: 400 });
    }

    const { engagementId, ruleId, severity, title, detail, clauseRef, evidenceRefs, magnitude, requiredResponse } = body.data;

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
    }

    const row = {
      organization_id: organizationId,
      engagement_id: engagementId,
      rule_id: ruleId,
      severity,
      title,
      detail,
      clause_ref: clauseRef ?? "BEE CCTS Detailed Procedure (v1.0, July 2024)",
      evidence_refs: evidenceRefs ?? [],
      magnitude: magnitude ?? null,
      state: "suggested",
      heading: title,
      body: detail,
      required_response: requiredResponse ?? "Provide clarification or revised evidentiary records.",
      generator: "desk_review_lead_schedule",
    };

    const { data: finding, error } = await supabase
      .from("findings")
      .insert(row as never)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "finding.create",
      entityType: "finding",
      entityId: (finding as { id: string }).id,
      payload: {
        engagementId,
        ruleId,
        severity,
        title,
      },
    });

    return NextResponse.json({ ok: true, finding });
  } catch (e) {
    return jsonError(e);
  }
}

