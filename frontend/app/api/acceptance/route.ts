import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { displayNameOf } from "@verifystack/backend/lib/auth/displayName";
import {
  AcceptanceDeclarationSchema,
  AcceptanceError,
  acceptanceContentHash,
  acceptanceRequired,
  evaluateAcceptance,
} from "@verifystack/backend/domain/engagements/acceptance";
import type { Json } from "@verifystack/backend/lib/supabase/types";

const Body = z.object({
  engagementId: z.string().uuid(),
  declaration: AcceptanceDeclarationSchema,
});

/**
 * Record an engagement acceptance declaration (impartiality, contract review, accredited scope).
 * Every call is a new immutable version. The outcome is computed here from the declaration, never taken from the client.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("plan.manage");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    const engagement = await getEngagement(parsed.data.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    if (!acceptanceRequired(engagement.scheme)) {
      throw new AcceptanceError("Engagement acceptance applies to CCTS engagements.");
    }
    const db = createServiceClient() ?? (await createServerSupabase());
    if (!db) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: latestRows } = await db
      .from("engagement_acceptances")
      .select("version")
      .eq("engagement_id", engagement.id)
      .eq("organization_id", organizationId)
      .order("version", { ascending: false })
      .limit(1);
    const version = (latestRows?.[0]?.version ?? 0) + 1;

    const declaration = parsed.data.declaration;
    const result = evaluateAcceptance(declaration);
    const declaredName = displayNameOf(session.user);
    const { data: row, error } = await db
      .from("engagement_acceptances")
      .insert({
        organization_id: organizationId,
        engagement_id: engagement.id,
        version,
        content: declaration as unknown as Json,
        content_hash: acceptanceContentHash(declaration),
        outcome: result.outcome,
        declared_by: session.user.id,
        declared_name: declaredName,
      })
      .select("id, version, outcome")
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "Someone recorded a newer version first. Reload and try again." },
          { status: 409 }
        );
      }
      throw new Error(error.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "acceptance.recorded",
      entityType: "engagement_acceptance",
      entityId: row.id,
      payload: {
        engagementId: engagement.id,
        version: row.version,
        outcome: row.outcome,
        blockers: result.blockers.map((b) => b.code),
        safeguarded: result.safeguarded,
      },
    });

    return NextResponse.json({
      ok: true,
      version: row.version,
      outcome: row.outcome,
      blockers: result.blockers,
      safeguarded: result.safeguarded,
    });
  } catch (e) {
    return jsonError(e);
  }
}