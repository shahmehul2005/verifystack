import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { MAX_EVIDENCE_BYTES, sanitizeFilename } from "@verifystack/backend/lib/evidence";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { IngestError, ingestEvidenceFile } from "@verifystack/backend/lib/data/ingestDocument";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
export const runtime = "nodejs";

const TOO_LARGE = "Evidence files are limited to 50 MB.";

/**
 * Single-file intake. PDFs and images go to page extraction; XLSX and CSV become
 * D10 datasets that cells and time-series ranges are mapped from. An evidence
 * pack (.zip) goes through /api/documents/pack instead, which verifies every
 * file in it against its manifest.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const engagementId = req.headers.get("x-engagement-id");
    let filename: string;
    try {
      filename = sanitizeFilename(decodeURIComponent(req.headers.get("x-filename") ?? "upload"));
    } catch {
      filename = "upload";
    }
    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "x-engagement-id required" }, { status: 400 });
    }
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_EVIDENCE_BYTES) {
      return NextResponse.json({ ok: false, error: TOO_LARGE }, { status: 413 });
    }
    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Engagement not found" }, { status: 404 });
    }
    if (!canStartWork(loadPack(engagement.pack_id))) {
      return NextResponse.json(
        { ok: false, error: "Scaffold packs cannot start active work" },
        { status: 409 }
      );
    }

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (declaredLength > 0 && bytes.byteLength !== declaredLength) {
      return NextResponse.json(
        { ok: false, error: "The upload arrived incomplete. Try again." },
        { status: 400 }
      );
    }

    const result = await ingestEvidenceFile({
      organizationId,
      engagement,
      actorUserId: session.user.id,
      filename,
      bytes,
      source: "upload",
      allow: ["page", "spreadsheet", "csv"],
    });

    await ensureEngagementStatus({
      organizationId,
      actorUserId: session.user.id,
      engagementId,
      current: engagement.status,
      target: "intake",
    });
    return NextResponse.json({
      ok: true,
      document: result.document,
      deduped: result.deduped,
      kind: result.kind,
      datasets: result.datasets,
    });
  } catch (e) {
    if (e instanceof IngestError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return jsonError(e);
  }
}
