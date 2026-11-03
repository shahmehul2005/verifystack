import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError, limitExceeded } from "@/lib/api";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { suggestEcmsForEngagement } from "@verifystack/backend/lib/data/ecm";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("adeetie.view");
    const organizationId = assertOrgId(session.organizationId);
    const limited = limitExceeded(`model:${session.user.id}`, LIMITS.modelCallsPerUser);
    if (limited) return limited;
    const { id } = await params;
    const payload = await suggestEcmsForEngagement(id, organizationId, { style: true });
    if (!payload) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...payload });
  } catch (e) {
    return jsonError(e);
  }
}
