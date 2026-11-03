import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { contentDisposition } from "@verifystack/backend/lib/evidence";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { deskReviewFor, type DeskOutcome, type Readings } from "@verifystack/backend/domain/deskreview";
import { buildLeadSchedule } from "@verifystack/backend/domain/deskreview/leadSchedule";
import { binderSha256, buildBinder, collectAssertions, type BinderDocument, type BinderFinding } from "@verifystack/backend/domain/submission/binder";

export const runtime = "nodejs";

/** A cited file larger than this is listed in the binder but not bound in. */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

const Query = z.object({ engagementId: z.string().uuid() });

const parseMagnitude = (value: unknown): { value: number; unit: string } | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as { value?: unknown; unit?: unknown };
  return typeof v.value === "number" && typeof v.unit === "string" ? { value: v.value, unit: v.unit } : null;
};

/**
 * Download the desk-review binder for the latest saved run: the lead schedule,
 * the findings and decisions, an index of every figure with its file hash and
 * page, cell or region, and the cited pages themselves. Everything is built from
 * what is stored; nothing comes from the request but the engagement id. The
 * SHA-256 of the file and the content digest are recorded in the audit log and
 * returned in headers, so a reviewer can rebuild the binder and compare.
 */
export async function GET(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
    const { engagementId } = parsed.data;

    const engagement = await getEngagement(engagementId, organizationId);
    if (!engagement) return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    const def = deskReviewFor(engagement.pack_id);
    if (!def) return Response.json({ ok: false, error: "This methodology has no desk review." }, { status: 409 });
    const supabase = createServiceClient();
    if (!supabase) return Response.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const { data: review, error: reviewError } = await supabase
      .from("desk_reviews")
      .select("id, results, readings, notes, created_at")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reviewError) throw new Error(reviewError.message);
    if (!review) return Response.json({ ok: false, error: "Run the desk review first." }, { status: 409 });

    const [resolutionRows, findingRows, docRows, signoffRows] = await Promise.all([
      supabase.from("desk_resolutions").select("rule_id, resolution_state, reason").eq("engagement_id", engagementId).eq("organization_id", organizationId),
      supabase
        .from("findings")
        .select("rule_id, title, severity, state, clause_ref, detail, required_response, magnitude")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId)
        .like("rule_id", "DESK-%")
        .order("rule_id", { ascending: true }),
      supabase
        .from("documents")
        .select("id, original_filename, sha256, mime_type, storage_path, byte_size")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId),
      supabase
        .from("signoffs")
        .select("role, attestor_name, statement, created_at, report_hash")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
    ]);
    // The decisions table arrives with migration 0019. Without it the schedule shows no decisions.
    if (findingRows.error) throw new Error(findingRows.error.message);
    if (docRows.error) throw new Error(docRows.error.message);
    if (signoffRows.error) throw new Error(signoffRows.error.message);

    const results = (review.results ?? []) as unknown as DeskOutcome[];
    const readings = (review.readings ?? {}) as unknown as Readings;
    const resolutions = Object.fromEntries(
      (resolutionRows.data ?? []).map((r) => [r.rule_id, { state: r.resolution_state, reason: r.reason }])
    );
    const schedule = buildLeadSchedule({ outcomes: results, materiality: def.materiality?.(readings, results) ?? null, resolutions });

    // Bind in only the files the figures were typed or snipped from.
    const baseDocs = new Map((docRows.data ?? []).map((d) => [d.id, d]));
    const draft: BinderDocument[] = (docRows.data ?? []).map((d) => ({ id: d.id, filename: d.original_filename, sha256: d.sha256, mimeType: d.mime_type }));
    const cited = new Set(
      collectAssertions(schedule, draft)
        .filter((a) => (a.kind === "typed" || a.kind === "snip") && a.documentId && a.page)
        .map((a) => a.documentId as string)
    );
    const documents: BinderDocument[] = await Promise.all(
      draft.map(async (d) => {
        const row = baseDocs.get(d.id)!;
        if (!cited.has(d.id) || row.byte_size > MAX_FILE_BYTES) return d;
        const { data: blob, error } = await supabase.storage.from("evidence").download(row.storage_path);
        if (error || !blob) return d;
        return { ...d, bytes: new Uint8Array(await blob.arrayBuffer()) };
      })
    );

    const findings: BinderFinding[] = (findingRows.data ?? []).map((f) => ({
      ruleId: f.rule_id,
      title: f.title,
      severity: f.severity,
      state: f.state,
      clauseRef: f.clause_ref,
      detail: f.detail,
      requiredResponse: f.required_response,
      magnitude: parseMagnitude(f.magnitude),
    }));

    const result = await buildBinder({
      generatedAt: review.created_at,
      engagement: {
        id: engagement.id,
        clientName: engagement.client_name,
        plantName: engagement.plant_name,
        packId: engagement.pack_id,
        packVersion: engagement.pack_version,
        complianceYear: engagement.compliance_year,
      },
      run: { id: review.id, at: review.created_at },
      schedule,
      findings,
      documents,
      signoffs: (signoffRows.data ?? []).map((s) => ({ role: s.role, attestorName: s.attestor_name, statement: s.statement, at: s.created_at, reportHash: s.report_hash })),
      notes: ((review.notes ?? []) as unknown as string[]) ?? [],
    });

    const sha256 = binderSha256(result.bytes);
    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "desk_review.binder_generated",
      entityType: "engagement",
      entityId: engagementId,
      payload: {
        runId: review.id,
        sha256,
        contentDigest: result.contentDigest,
        pages: result.pages,
        evidencePages: result.evidencePages,
        notBound: result.notBound.length,
      },
    });

    const filename = `desk-review-binder-${engagement.client_name}-${review.id.slice(0, 8)}.pdf`;
    return new Response(result.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition("attachment", filename),
        "Cache-Control": "no-store",
        "X-Binder-SHA256": sha256,
        "X-Binder-Content-Digest": result.contentDigest,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
