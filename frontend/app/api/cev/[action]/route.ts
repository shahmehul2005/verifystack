import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import {
  acceptCanonicalEvidenceValue,
  correctCanonicalEvidenceValue,
  rejectCanonicalEvidenceValue,
  withdrawCanonicalEvidenceValue,
} from "@verifystack/backend/domain/evidence/operations";

export const runtime = "nodejs";

const BaseBody = z.object({
  cevId: z.string().uuid(),
  engagementId: z.string().uuid(),
  organizationId: z.string().uuid().optional(), // resolved from session when absent
});

const CorrectBody = BaseBody.extend({
  correctionNumeric: z.number().finite().optional(),
  correctionText: z.string().max(500).optional(),
  correctionUnit: z.string().max(50).optional(),
  correctionNote: z.string().min(8).max(1000),
});

const RejectBody = BaseBody.extend({
  rejectionNote: z.string().max(500).optional(),
});

const WithdrawBody = BaseBody.extend({
  withdrawalReason: z.string().min(8).max(1000),
});

type Action = "accept" | "correct" | "reject" | "withdraw";

/**
 * POST /api/cev/[action]
 *
 * Actions: accept | correct | reject | withdraw
 *
 * All actions require review.decide capability.
 *
 * Body shapes:
 *   accept:   { cevId, engagementId }
 *   correct:  { cevId, engagementId, correctionNumeric?, correctionText?, correctionUnit?, correctionNote }
 *   reject:   { cevId, engagementId, rejectionNote? }
 *   withdraw: { cevId, engagementId, withdrawalReason }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  try {
    const { action } = await params;
    const validActions: Action[] = ["accept", "correct", "reject", "withdraw"];
    if (!validActions.includes(action as Action)) {
      return NextResponse.json(
        { ok: false, error: `Unknown action "${action}". Valid: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const base = BaseBody.safeParse(body);
    if (!base.success) {
      return NextResponse.json({ ok: false, error: "cevId and engagementId are required" }, { status: 400 });
    }

    const { cevId, engagementId } = base.data;
    const common = { id: cevId, engagement_id: engagementId, organization_id: organizationId };

    let result;
    switch (action as Action) {
      case "accept": {
        result = await acceptCanonicalEvidenceValue({ ...common, reviewed_by: session.user.id });
        break;
      }
      case "correct": {
        const parsed = CorrectBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { ok: false, error: "correctionNote (≥8 chars) is required for correct" },
            { status: 400 }
          );
        }
        result = await correctCanonicalEvidenceValue({
          ...common,
          reviewed_by: session.user.id,
          correction_numeric: parsed.data.correctionNumeric,
          correction_text: parsed.data.correctionText,
          correction_unit: parsed.data.correctionUnit,
          correction_note: parsed.data.correctionNote,
        });
        break;
      }
      case "reject": {
        const parsed = RejectBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json({ ok: false, error: "Invalid body for reject" }, { status: 400 });
        }
        result = await rejectCanonicalEvidenceValue({
          ...common,
          reviewed_by: session.user.id,
          rejection_note: parsed.data.rejectionNote,
        });
        break;
      }
      case "withdraw": {
        const parsed = WithdrawBody.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { ok: false, error: "withdrawalReason (≥8 chars) is required for withdraw" },
            { status: 400 }
          );
        }
        result = await withdrawCanonicalEvidenceValue({
          ...common,
          withdrawn_by: session.user.id,
          withdrawal_reason: parsed.data.withdrawalReason,
        });
        break;
      }
    }

    return NextResponse.json({ ok: true, cev: result });
  } catch (e) {
    return jsonError(e);
  }
}

