import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadPack } from "@verifystack/backend/domain/packs";
import {
  deskReviewFor,
  inferSlot,
  readWorkbooks,
  reconcileResolutions,
  runDeskReview,
  type DeskWorkbook,
  type ReadingOrigin,
  type Readings,
  type ResolutionState,
} from "@verifystack/backend/domain/deskreview";
import { deskEvidenceRefs, deskFindings } from "@verifystack/backend/domain/deskreview/toFindings";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const Body = z.object({ engagementId: z.string().uuid() });

/**
 * Run the desk review. Workbook readings are computed here from the stored files
 * in their evidence slots; PDF readings are the ones the auditor entered. The
 * result and every reading the rules saw are saved, so the run can be replayed.
 * Each check also records which document, cell or page every reading came from.
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

    const [{ data: docs, error: dErr }, { data: manual, error: mErr }] = await Promise.all([
      supabase
        .from("documents")
        .select("id, original_filename, mime_type, storage_path, slot, doc_type")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId)
        .eq("mime_type", XLSX_MIME)
        .limit(40),
      supabase
        .from("desk_readings")
        .select("key, value, document_id, page, entered_at")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId),
    ]);
    if (dErr) throw new Error(dErr.message);
    if (mErr) throw new Error(mErr.message);

    const files = (
      await Promise.all(
        (docs ?? []).map(async (d): Promise<DeskWorkbook | null> => {
          const { data: blob, error } = await supabase.storage.from("evidence").download(d.storage_path);
          if (error || !blob) return null;
          const effectiveSlot = d.slot ?? inferSlot({ name: d.original_filename, slot: d.slot, docType: d.doc_type });
          if (!effectiveSlot) return null;
          return { slot: effectiveSlot, name: d.original_filename, bytes: new Uint8Array(await blob.arrayBuffer()), documentId: d.id };
        })
      )
    ).filter((f): f is DeskWorkbook => f !== null);

    const { readings, notes, origins } = readWorkbooks(def, files, loadPack(engagement.pack_id).proforma_inputs ?? []);
    const all: Readings = { ...readings };
    const allOrigins: Record<string, ReadingOrigin> = { ...origins };

    // PDF figures: the document and page the auditor typed each one against.
    const manualDocIds = [...new Set((manual ?? []).map((m) => m.document_id).filter((id): id is string => Boolean(id)))];
    const { data: manualDocs, error: mdErr } =
      manualDocIds.length > 0
        ? await supabase.from("documents").select("id, original_filename").in("id", manualDocIds).eq("organization_id", organizationId)
        : { data: [], error: null };
    if (mdErr) throw new Error(mdErr.message);
    const docName = new Map((manualDocs ?? []).map((d) => [d.id, d.original_filename]));
    const specByKey = new Map(def.manual.map((s) => [s.key, s]));
    for (const m of manual ?? []) {
      all[m.key] = Number(m.value);
      const spec = specByKey.get(m.key.split("@")[0]!);
      allOrigins[m.key] = {
        slot: spec?.slot ?? "",
        documentId: m.document_id,
        filename: m.document_id ? (docName.get(m.document_id) ?? null) : null,
        location: m.page ? `p. ${m.page}` : null,
        kind: "typed",
        enteredAt: m.entered_at,
        ...(spec ? { label: spec.label } : {}),
      };
    }
    const results = runDeskReview(def, all, allOrigins);

    const { data: saved, error } = await supabase
      .from("desk_reviews")
      .insert({
        organization_id: organizationId,
        engagement_id: engagementId,
        pack_id: engagement.pack_id,
        results: results as unknown as Json,
        readings: all as unknown as Json,
        notes: notes as unknown as Json,
        run_by: session.user.id,
      })
      .select("id")
      .single();
    if (error || !saved) throw new Error(error?.message ?? "Could not save the desk review");

    // Findings and resolutions never fail the run itself: the review is already saved.
    const drafts = deskFindings(results);
    let deskFindingsInserted = 0;
    let findingsError: string | undefined;
    let resolutionsError: string | undefined;
    let autoResolved: string[] = [];
    let reopened: string[] = [];
    const findingIds = new Map<string, string>();
    try {
      const { data: existing, error: existingError } = await supabase
        .from("findings")
        .select("id, rule_id, state")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId);
      if (existingError) throw new Error(existingError.message);
      // Any stored row for this rule id counts, including closed and rejected.
      const present = new Map((existing ?? []).map((row) => [row.rule_id, row]));
      for (const row of existing ?? []) findingIds.set(row.rule_id, row.id);

      const fresh = drafts.filter((draft) => !present.has(draft.ruleId));
      if (fresh.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from("findings")
          .insert(
            fresh.map((draft) => ({
              organization_id: organizationId,
              engagement_id: engagementId,
              calculation_run_id: null,
              rule_id: draft.ruleId,
              severity: draft.severity,
              title: draft.title,
              detail: draft.detail,
              clause_ref: draft.clauseRef,
              evidence_refs: draft.evidenceRefs as unknown as Json,
              state: "suggested" as const,
            }))
          )
          .select("id, rule_id");
        if (insertError) throw new Error(insertError.message);
        for (const row of inserted ?? []) findingIds.set(row.rule_id, row.id);
        deskFindingsInserted = fresh.length;
      }

      // A finding that is still open points at the readings of the latest run. Closed ones keep their history.
      const outcomes = new Map(results.map((r) => [`DESK-${r.id}`, r]));
      for (const [ruleId, row] of present) {
        if (row.state === "closed" || row.state === "rejected") continue;
        const outcome = outcomes.get(ruleId);
        if (!outcome || outcome.status === "pass") continue;
        const { error: refError } = await supabase
          .from("findings")
          .update({ evidence_refs: deskEvidenceRefs(outcome) as unknown as Json, updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("organization_id", organizationId);
        if (refError) throw new Error(refError.message);
      }
    } catch (err) {
      findingsError = err instanceof Error ? err.message : "Could not save desk findings";
    }

    try {
      const { data: decided, error: decidedError } = await supabase
        .from("desk_resolutions")
        .select("rule_id, resolution_state")
        .eq("engagement_id", engagementId)
        .eq("organization_id", organizationId);
      if (decidedError) throw new Error(decidedError.message);
      const plan = reconcileResolutions(
        results,
        (decided ?? []).map((d) => ({ rule_id: d.rule_id, resolution_state: d.resolution_state as ResolutionState })),
        new Set(findingIds.keys())
      );
      if (plan.markResolved.length > 0) {
        const { error: upsertError } = await supabase.from("desk_resolutions").upsert(
          plan.markResolved.map((ruleId) => ({
            organization_id: organizationId,
            engagement_id: engagementId,
            rule_id: ruleId,
            resolution_state: "resolved" as const,
            reason: "The check agrees on re-run.",
            finding_id: findingIds.get(`DESK-${ruleId}`) ?? null,
            decided_by: session.user.id,
            decided_at: new Date().toISOString(),
          })),
          { onConflict: "engagement_id,rule_id" }
        );
        if (upsertError) throw new Error(upsertError.message);
        autoResolved = plan.markResolved;
      }
      if (plan.reopen.length > 0) {
        const { error: deleteError } = await supabase
          .from("desk_resolutions")
          .delete()
          .eq("engagement_id", engagementId)
          .eq("organization_id", organizationId)
          .in("rule_id", plan.reopen);
        if (deleteError) throw new Error(deleteError.message);
        reopened = plan.reopen;
      }
    } catch (err) {
      resolutionsError = err instanceof Error ? err.message : "Could not update desk resolutions";
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "desk_review.run",
      entityType: "engagement",
      entityId: engagementId,
      payload: {
        reviewId: saved.id,
        pass: results.filter((r) => r.status === "pass").length,
        fail: results.filter((r) => r.status === "fail").length,
        pending: results.filter((r) => r.status === "pending").length,
        deskFindingsInserted,
        ...(autoResolved.length ? { autoResolved } : {}),
        ...(reopened.length ? { reopened } : {}),
        ...(findingsError ? { findingsError } : {}),
        ...(resolutionsError ? { resolutionsError } : {}),
      },
    });
    return NextResponse.json({
      ok: true,
      id: saved.id,
      results,
      deskFindingsInserted,
      autoResolved,
      reopened,
      ...(findingsError ? { findingsError } : {}),
      ...(resolutionsError ? { resolutionsError } : {}),
    });
  } catch (e) {
    return jsonError(e);
  }
}
