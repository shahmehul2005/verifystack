import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError, limitExceeded } from "@/lib/api";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { MAX_EVIDENCE_BYTES, sanitizeFilename } from "@verifystack/backend/lib/evidence";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { IngestError, ingestEvidenceFile } from "@verifystack/backend/lib/data/ingestDocument";

export const runtime = "nodejs";

/**
 * Upload a site photograph. Photographs go up while online and are attached to
 * an observation by id; they are never queued offline (too large for browser
 * storage). Stored like any evidence, tagged as fieldwork, and never sent to
 * extraction on their own.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("fieldwork.record");
    const organizationId = assertOrgId(session.organizationId);
    const limited = limitExceeded(`fieldwork:${session.user.id}`, LIMITS.fieldwork);
    if (limited) return limited;
    const engagementId = req.headers.get("x-engagement-id");
    if (!engagementId) return NextResponse.json({ ok: false, error: "x-engagement-id required" }, { status: 400 });
    if (Number(req.headers.get("content-length") ?? "0") > MAX_EVIDENCE_BYTES) {
      return NextResponse.json({ ok: false, error: "Photographs are limited to 50 MB." }, { status: 413 });
    }
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });

    let filename = "photo";
    try {
      filename = sanitizeFilename(decodeURIComponent(req.headers.get("x-filename") ?? "photo"));
    } catch {
      // keep the default
    }
    const result = await ingestEvidenceFile({
      organizationId,
      engagement,
      actorUserId: session.user.id,
      filename,
      bytes: new Uint8Array(await req.arrayBuffer()),
      source: "fieldwork",
      allow: ["page"],
    });
    return NextResponse.json({ ok: true, documentId: result.document.id, deduped: result.deduped });
  } catch (e) {
    if (e instanceof IngestError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return jsonError(e);
  }
}
