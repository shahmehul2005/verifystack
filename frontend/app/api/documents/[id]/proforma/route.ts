import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
import { parseXlsx } from "@verifystack/backend/domain/intake/xlsx";
import { readProforma } from "@verifystack/backend/domain/proforma/reader";
import { provenanceToColumns, type Provenance } from "@verifystack/backend/domain/provenance";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  approvals: z
    .array(
      z.object({
        /** Index of the pack's pro forma input. The server finds the cell; the browser names nothing else. */
        index: z.number().int().min(0).max(200),
        /** The auditor's value. Null means: use the value the server read from the workbook. */
        value: z.number().finite().nullable(),
      })
    )
    .min(1)
    .max(60),
});

async function load(id: string, organizationId: string) {
  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) return { error: NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 }) };
  const { data: doc } = await supabase
    .from("documents")
    .select("id, engagement_id, original_filename, mime_type, storage_path")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!doc) return { error: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }) };
  if (doc.mime_type !== XLSX_MIME) {
    return { error: NextResponse.json({ ok: false, error: "The pro forma must be an .xlsx workbook." }, { status: 409 }) };
  }
  const { data: blob, error } = await supabase.storage.from("evidence").download(doc.storage_path);
  if (error || !blob) throw new Error(error?.message ?? "Storage object missing");
  return { supabase, doc, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

/** What the pro forma holds for each calculation input. Read-only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.view");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const loaded = await load(id, organizationId);
    if ("error" in loaded) return loaded.error;
    const { doc, bytes } = loaded;
    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const inputs = loadPack(engagement.pack_id).proforma_inputs;
    if (!inputs?.length) {
      return NextResponse.json({ ok: false, error: "This methodology does not read inputs from a pro forma." }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      document: { id: doc.id, name: doc.original_filename },
      reading: readProforma(parseXlsx(bytes), inputs),
    });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Commit the pro forma inputs the auditor approved, as facts. The server re-reads
 * the stored workbook and recomputes its formulas. The browser only says which
 * inputs to take, and may carry a corrected value. An input declared as zero is
 * never written: the stream then counts as zero and the run says so.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const body = parsed.data;

    const loaded = await load(id, organizationId);
    if ("error" in loaded) return loaded.error;
    const { supabase, doc, bytes } = loaded;
    if (doc.engagement_id !== body.engagementId) {
      return NextResponse.json({ ok: false, error: "That document is not in this engagement." }, { status: 404 });
    }
    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const pack = loadPack(engagement.pack_id);
    if (!canStartWork(pack)) {
      return NextResponse.json({ ok: false, error: "Scaffold packs cannot start active work" }, { status: 409 });
    }
    const inputs = pack.proforma_inputs ?? [];
    const reading = readProforma(parseXlsx(bytes), inputs);

    const plan: { index: number; fieldPath: string; value: number; state: "accepted" | "corrected"; unit: string; label: string; sheet: string; cellRef: string; formula: string | null; workbookValue: number; scale: number }[] = [];
    const seen = new Set<number>();
    for (const a of body.approvals) {
      const d = reading.drafts[a.index];
      if (!d || seen.has(a.index)) return NextResponse.json({ ok: false, error: "Unknown or repeated input." }, { status: 422 });
      seen.add(a.index);
      if (d.fieldPath === null || d.sheet === null || d.cellRef === null || d.workbookValue === null) {
        return NextResponse.json({ ok: false, error: `"${d.label}" cannot become a fact: ${d.note}` }, { status: 422 });
      }
      if (d.status === "zero" && a.value === null) {
        return NextResponse.json({ ok: false, error: `"${d.label}" is zero in the workbook. Leave it out; the stream counts as zero.` }, { status: 422 });
      }
      const value = a.value ?? d.value;
      if (value === null) return NextResponse.json({ ok: false, error: `No value for "${d.label}".` }, { status: 422 });
      plan.push({
        index: a.index,
        fieldPath: d.fieldPath,
        value,
        state: a.value !== null && a.value !== d.value ? "corrected" : "accepted",
        unit: d.unit,
        label: d.label,
        sheet: d.sheet,
        cellRef: d.cellRef,
        formula: d.formula,
        workbookValue: d.workbookValue,
        scale: d.scale,
      });
    }

    const taken: string[] = [];
    for (const p of plan) {
      const { data: existing, error } = await supabase
        .from("facts")
        .select("id")
        .eq("engagement_id", body.engagementId)
        .eq("organization_id", organizationId)
        .eq("field_path", p.fieldPath)
        .limit(1);
      if (error) throw new Error(error.message);
      if (existing && existing.length > 0) taken.push(p.fieldPath);
    }
    if (taken.length > 0) {
      return NextResponse.json(
        { ok: false, error: `A value for ${taken.join(", ")} is already in the ledger. Correct that value instead of adding a second one.` },
        { status: 409 }
      );
    }

    const decidedAt = new Date().toISOString();
    const committed: { fieldPath: string; factId: string; state: string; value: number }[] = [];
    for (const p of plan) {
      // The provenance value is what the workbook computes, not the stale stored result.
      const prov: Provenance = {
        type: "spreadsheet_cell",
        documentId: doc.id,
        sheet: p.sheet,
        cellRef: p.cellRef,
        value: p.workbookValue,
        ...(p.formula ? { formula: p.formula } : {}),
        label: p.scale === 1 ? p.label : `${p.label} (×${p.scale} to ${p.unit})`,
      };
      const cols = provenanceToColumns(prov);
      const { data: field, error: fErr } = await supabase
        .from("extracted_fields")
        .insert({
          organization_id: organizationId,
          engagement_id: body.engagementId,
          document_id: doc.id,
          extraction_job_id: null,
          field_path: p.fieldPath,
          value_json: p.value,
          unit: p.unit,
          confidence: 1,
          page: null,
          bbox: null,
          source_text: null,
          provenance_type: cols.provenance_type,
          provenance: cols.provenance as Json | null,
          triage_action: "human_review",
          state: p.state,
          proposed_by: session.user.id,
          reviewed_by: session.user.id,
          reviewed_at: decidedAt,
          accept_mode: "individual",
          correction_json: p.state === "corrected" ? (p.value as Json) : null,
        })
        .select("id")
        .single();
      if (fErr || !field) throw new Error(fErr?.message ?? "Could not record the extraction");
      const { data: fact, error: factErr } = await supabase
        .from("facts")
        .insert({
          organization_id: organizationId,
          engagement_id: body.engagementId,
          extracted_field_id: field.id,
          document_id: doc.id,
          field_path: p.fieldPath,
          value_json: p.value,
          unit: p.unit,
          page: null,
          bbox: null,
          source_text: null,
          provenance_type: cols.provenance_type,
          provenance: cols.provenance as Json | null,
          accepted_by: session.user.id,
          accept_mode: "individual",
        })
        .select("id")
        .single();
      if (factErr || !fact) throw new Error(factErr?.message ?? "Could not write the fact");
      committed.push({ fieldPath: p.fieldPath, factId: fact.id, state: p.state, value: p.value });
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "proforma_inputs.committed",
      entityType: "document",
      entityId: doc.id,
      payload: {
        fields: committed.map((c) => ({ fieldPath: c.fieldPath, state: c.state, value: c.value })),
        staleFormulaCells: reading.staleFormulaCells,
      },
    });
    await ensureEngagementStatus({
      organizationId,
      actorUserId: session.user.id,
      engagementId: body.engagementId,
      current: engagement.status,
      target: "review",
    });
    return NextResponse.json({ ok: true, committed: committed.length, facts: committed });
  } catch (e) {
    return jsonError(e);
  }
}
