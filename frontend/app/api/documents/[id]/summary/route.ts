import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { CSV_MIME, XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { canStartWork, loadPack, packFieldTargets } from "@verifystack/backend/domain/packs";
import { sheetsFromBytes } from "@verifystack/backend/domain/intake/tabular";
import { columnLetters, scanSheetForSummaries, type SummaryCandidate } from "@verifystack/backend/domain/intake/summary";
import { provenanceToColumns, type Provenance } from "@verifystack/backend/domain/provenance";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const FieldPath = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.\-[\]]+$/, "Use letters, digits, dots, underscores or hyphens");

const Approval = z.object({
  /** Column number of the total cell (1 = A). The server finds the draft by column. */
  col: z.number().int().min(1).max(16384),
  fieldPath: FieldPath,
  unit: z.string().trim().max(30).nullable(),
  label: z.string().trim().min(1).max(200),
  /** The auditor's value. Null means: use the value the server offers for this total. */
  value: z.number().finite().nullable(),
});

const Body = z.object({
  engagementId: z.string().uuid(),
  sheet: z.string().min(1).max(120),
  /** "total:36" for a total row in the file, "block:6-35" for totals computed here. */
  candidateKey: z.string().min(3).max(60).regex(/^(total:\d+|block:\d+-\d+)$/, "Unknown candidate"),
  approvals: z.array(Approval).min(1).max(60),
});

async function loadDocument(id: string, organizationId: string) {
  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) return { error: NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 }) };
  const { data: doc } = await supabase
    .from("documents")
    .select("id, engagement_id, original_filename, mime_type, storage_path")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!doc) return { error: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }) };
  if (doc.mime_type !== XLSX_MIME && doc.mime_type !== CSV_MIME) {
    return {
      error: NextResponse.json({ ok: false, error: "Only spreadsheet and CSV files have totals to review." }, { status: 409 }),
    };
  }
  const { data: blob, error: dlErr } = await supabase.storage.from("evidence").download(doc.storage_path);
  if (dlErr || !blob) throw new Error(dlErr?.message ?? "Storage object missing");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { supabase, doc, bytes };
}

/**
 * The totals on every sheet of a stored spreadsheet, recomputed from the file.
 * Read-only: this proposes, it does not write.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.view");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const loaded = await loadDocument(id, organizationId);
    if ("error" in loaded) return loaded.error;
    const { doc, bytes } = loaded;

    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const targets = packFieldTargets(loadPack(engagement.pack_id));

    const sheets = sheetsFromBytes(bytes, doc.mime_type === XLSX_MIME ? "spreadsheet" : "csv", doc.original_filename);
    return NextResponse.json({
      ok: true,
      document: { id: doc.id, name: doc.original_filename },
      sheets: sheets.map((s) => ({ name: s.name, candidates: scanSheetForSummaries(s, { targets }) })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Commit the totals the auditor approved, as facts. Each approved total becomes a
 * decided extraction (accepted, or corrected when the auditor changed the value)
 * and then a fact, with spreadsheet-cell provenance. The browser names the sheet,
 * the total row and the columns. The server re-reads the file, recomputes the
 * drafts, and takes the cell and the workbook value from the file, never from the
 * browser. A value only changes when the auditor typed one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const body = parsed.data;

    const loaded = await loadDocument(id, organizationId);
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

    // Recompute from the stored bytes. The browser's copy is not trusted.
    const sheets = sheetsFromBytes(bytes, doc.mime_type === XLSX_MIME ? "spreadsheet" : "csv", doc.original_filename);
    const sheet = sheets.find((s) => s.name === body.sheet);
    if (!sheet) return NextResponse.json({ ok: false, error: `There is no sheet named "${body.sheet}".` }, { status: 422 });
    const candidate: SummaryCandidate | undefined = scanSheetForSummaries(sheet, {
      targets: packFieldTargets(pack),
    }).find((c) => c.key === body.candidateKey);
    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: `Those totals are not on "${body.sheet}" any more. Reopen Review totals and try again.` },
        { status: 422 }
      );
    }
    if (candidate.source === "computed" && (candidate.firstDataRow === null || candidate.lastDataRow === null)) {
      return NextResponse.json({ ok: false, error: "The rows for these totals could not be located." }, { status: 422 });
    }

    // Validate every approval before writing anything.
    const seenPaths = new Set<string>();
    const plan: {
      draft: SummaryCandidate["drafts"][number];
      fieldPath: string;
      unit: string | null;
      label: string;
      value: number;
      state: "accepted" | "corrected";
    }[] = [];
    for (const a of body.approvals) {
      const draft = candidate.drafts.find((d) => d.col === a.col);
      if (!draft) {
        return NextResponse.json(
          { ok: false, error: `Column ${columnLetters(a.col)} is not one of the totals offered on "${body.sheet}".` },
          { status: 422 }
        );
      }
      if (seenPaths.has(a.fieldPath)) {
        return NextResponse.json({ ok: false, error: `The tag "${a.fieldPath}" is used twice in this approval.` }, { status: 422 });
      }
      seenPaths.add(a.fieldPath);
      const offered = draft.preferredValue;
      const value = a.value ?? offered;
      if (value === null) {
        return NextResponse.json(
          { ok: false, error: `No value for "${a.label}". Enter one, because the workbook stored none.` },
          { status: 422 }
        );
      }
      const corrected = a.value !== null && a.value !== offered;
      plan.push({
        draft,
        fieldPath: a.fieldPath,
        unit: a.unit,
        label: a.label,
        value,
        state: corrected ? "corrected" : "accepted",
      });
    }

    // The ledger holds one value per tag. Refuse a second one; a correction goes through its own record.
    // One lookup per tag, so a tag with unusual characters cannot break a combined filter.
    const taken: string[] = [];
    for (const p of plan) {
      const { data: existing, error: exErr } = await supabase
        .from("facts")
        .select("id")
        .eq("engagement_id", body.engagementId)
        .eq("organization_id", organizationId)
        .eq("field_path", p.fieldPath)
        .limit(1);
      if (exErr) throw new Error(exErr.message);
      if (existing && existing.length > 0) taken.push(p.fieldPath);
    }
    if (taken.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `A value for ${taken.join(", ")} is already in the ledger. Correct that value instead of adding a second one.`,
        },
        { status: 409 }
      );
    }

    const decidedAt = new Date().toISOString();
    const committed: { fieldPath: string; factId: string; state: string; value: number }[] = [];
    for (const p of plan) {
      // A workbook total names its cell. A total computed here names the range it was summed from.
      const prov: Provenance =
        candidate.source === "total_row"
          ? {
              type: "spreadsheet_cell",
              documentId: doc.id,
              sheet: candidate.sheet,
              cellRef: p.draft.cellRef,
              value: p.draft.cachedValue,
              ...(p.draft.formula ? { formula: p.draft.formula } : {}),
              label: p.label,
              ...(candidate.coverage ? { coverage: candidate.coverage } : {}),
            }
          : {
              type: "spreadsheet_range",
              documentId: doc.id,
              sheet: candidate.sheet,
              column: columnLetters(p.draft.col),
              fromRow: candidate.firstDataRow!,
              toRow: candidate.lastDataRow!,
              aggregation: "sum",
              rowCount: p.draft.dataCount,
              label: p.label,
              ...(candidate.coverage ? { coverage: candidate.coverage } : {}),
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
      action: "summary_totals.committed",
      entityType: "document",
      entityId: doc.id,
      payload: {
        sheet: candidate.sheet,
        candidateKey: candidate.key,
        source: candidate.source,
        fields: committed.map((c) => ({ fieldPath: c.fieldPath, state: c.state, value: c.value })),
        corrected: committed.filter((c) => c.state === "corrected").length,
        coverage: candidate.coverage,
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
