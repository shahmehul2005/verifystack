import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { deskReviewFor, proposeReadings, type EvidenceDocumentCandidate } from "@verifystack/backend/domain/deskreview";

export const runtime = "nodejs";

const Body = z.object({ engagementId: z.string().uuid() });

/**
 * Scan documents in evidence slots and return suggested readings for the desk review.
 * "AI proposes, humans decide." These are advisory suggestions until the auditor
 * explicitly accepts and saves them.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const { engagementId } = parsed.data;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const def = deskReviewFor(engagement.pack_id);
    if (!def) return NextResponse.json({ ok: false, error: "This methodology has no desk review." }, { status: 409 });

    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: docs, error } = await supabase
      .from("documents")
      .select("id, original_filename, slot, storage_path, mime_type")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .not("slot", "is", null);

    if (error) throw new Error(error.message);

    const candidates: EvidenceDocumentCandidate[] = (docs ?? []).map((d) => ({
      id: d.id,
      name: d.original_filename,
      slot: d.slot,
      text: null,
    }));

    const suggestions = proposeReadings(def, candidates);

    return NextResponse.json({ ok: true, suggestions });
  } catch (e) {
    return jsonError(e);
  }
}

