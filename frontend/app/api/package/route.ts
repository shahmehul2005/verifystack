import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadSubmissionInput } from "@verifystack/backend/lib/data/submissionPackage";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { contentDisposition } from "@verifystack/backend/lib/evidence";
import { SubmissionError, buildSubmissionPackage } from "@verifystack/backend/domain/submission/package";

const Query = z.object({ engagementId: z.string().uuid() });

/**
 * Download the submission package. Built on demand from the records, never
 * stored, so it cannot drift from them. Refuses, with the reasons, until the
 * engagement is actually ready to hand over.
 */
export async function GET(req: Request) {
  try {
    const session = await requireCapability("signoff.lead");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Query.safeParse({ engagementId: new URL(req.url).searchParams.get("engagementId") });
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });

    const engagement = await getEngagement(parsed.data.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const { input } = await loadSubmissionInput(organizationId, engagement, { includeBytes: true });

    let built;
    try {
      built = buildSubmissionPackage(input);
    } catch (e) {
      if (e instanceof SubmissionError) {
        return NextResponse.json({ ok: false, error: e.message, blockers: e.blockers }, { status: 422 });
      }
      throw e;
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "package.generated",
      entityType: "engagement",
      entityId: engagement.id,
      payload: {
        sha256: built.sha256,
        filename: built.filename,
        evidence_files: built.includedEvidenceFiles,
        bytes: built.bytes.byteLength,
      },
    });

    return new Response(Buffer.from(built.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition("attachment", built.filename),
        "Cache-Control": "private, no-store",
        "X-Package-Sha256": built.sha256,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
