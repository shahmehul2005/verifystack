import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * GET /api/cev?engagementId=<uuid>
 *
 * Returns all canonical evidence value rows for the engagement, grouped by
 * canonical_key. Each group is an array sorted by created_at descending so the
 * most recent suggestion is first.
 *
 * Requires review.decide capability (same as /api/facts).
 *
 * Response shape:
 *   { ok: true, groups: { [canonicalKey: string]: CevRow[] } }
 */
export async function GET(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);

    const { searchParams } = new URL(req.url);
    const engagementId = searchParams.get("engagementId");
    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "engagementId is required" }, { status: 400 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("canonical_evidence_values")
      .select("*")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Group by canonical_key
    const groups: Record<string, typeof data> = {};
    for (const row of data ?? []) {
      const key = row.canonical_key as string;
      if (!groups[key]) groups[key] = [];
      groups[key]!.push(row);
    }

    return NextResponse.json({ ok: true, groups });
  } catch (e) {
    return jsonError(e);
  }
}

