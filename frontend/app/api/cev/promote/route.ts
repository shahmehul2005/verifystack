import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { promoteToFact } from "@verifystack/backend/domain/evidence/operations";

/**
 * POST /api/cev/promote
 *
 * Promote an accepted/corrected annual CEV row to a facts row for the
 * calculation engine. Only period_kind = 'annual' rows in state
 * 'accepted' or 'corrected' may be promoted.
 *
 * Body:
 *   cevId       string   — id of the CanonicalEvidenceValue to promote
 *   engagementId string
 *   fieldPath   string   — pack binding path, e.g. "calorificValue"
 *   unit        string   — unit for the new fact (overridden by cev.value_unit)
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.organizationId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!hasCapability(session.role, "review.decide")) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    cevId?: string;
    engagementId?: string;
    fieldPath?: string;
    unit?: string;
  };

  const { cevId, engagementId, fieldPath, unit } = body;

  if (!cevId || !engagementId || !fieldPath) {
    return NextResponse.json(
      { ok: false, error: "cevId, engagementId and fieldPath are required" },
      { status: 400 }
    );
  }

  try {
    const result = await promoteToFact({
      cevId,
      engagement_id: engagementId,
      organization_id: session.organizationId,
      field_path: fieldPath,
      unit: unit ?? "",
      accepted_by: session.user.id,
    });

    return NextResponse.json({ ok: true, factId: result.factId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}

