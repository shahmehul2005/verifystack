import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { suggestEcmsForEngagement } from "@verifystack/backend/lib/data/ecm";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("adeetie.view");
    const organizationId = assertOrgId(session.organizationId);
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
