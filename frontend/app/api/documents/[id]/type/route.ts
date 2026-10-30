import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadPack } from "@verifystack/backend/domain/packs";
import { GeminiExtractionProvider } from "@verifystack/backend/domain/extraction/gemini";
import { splitEvidencePages } from "@verifystack/backend/domain/extraction/pages";
import { isGeminiConfigured } from "@verifystack/backend/lib/supabase/configured";

export const runtime = "nodejs";

const PatchBody = z.object({ doc_type: z.string().min(1).max(80).nullable() });

function deriveSlotFromDocType(docType: string | null, slots: Array<{ id: string }>): string | null {
  if (!docType) return null;
  if (slots.some((s) => s.id === docType)) return docType;
  const MAP: Record<string, string> = {
    production_log: "production_evidence",
    cpp_generation_log: "cpp_generation",
    fuel_invoice: "coal_purchase",
    lab_certificate: "coal_quality",
    fuel_lab_log: "coal_quality",
    electricity_bill: "grid_electricity",
    proforma_workbook: "proforma_workbook",
    sampling_plan: "sampling_plan",
    data_flow_sop: "data_flow_sop",
    form1: "form1",
    re_undertaking: "re_undertaking",
    petcoke_log: "petcoke_log",
    rec_declaration: "rec_declaration",
    weighbridge_slip: "coal_purchase",
  };
  const target = MAP[docType];
  if (target && slots.some((s) => s.id === target)) return target;
  return null;
}

/**
 * Assign or reassign a document to a pack taxonomy type by hand, or clear it.
 * Also synchronizes the corresponding evidence slot so the checklist is automatically satisfied.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: doc } = await supabase
      .from("documents")
      .select("id, engagement_id, doc_type, slot")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const pack = loadPack(engagement.pack_id);

    const validTaxonomyIds = new Set((pack.document_taxonomy ?? []).map((t) => t.id));
    validTaxonomyIds.add("unknown");

    if (parsed.data.doc_type && !validTaxonomyIds.has(parsed.data.doc_type)) {
      return NextResponse.json(
        { ok: false, error: "This methodology pack does not define that document type." },
        { status: 422 }
      );
    }

    const derivedSlot = deriveSlotFromDocType(parsed.data.doc_type, pack.evidence_slots ?? []);

    const updatePayload: { doc_type: string | null; classification_confidence: number; slot?: string | null } = {
      doc_type: parsed.data.doc_type,
      classification_confidence: 1.0,
    };
    if (derivedSlot !== null || parsed.data.doc_type === null) {
      updatePayload.slot = derivedSlot;
    }

    const { error } = await supabase
      .from("documents")
      .update(updatePayload)
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "document.type_set",
      entityType: "document",
      entityId: id,
      payload: { from: doc.doc_type ?? null, to: parsed.data.doc_type, slot: derivedSlot },
    });

    return NextResponse.json({ ok: true, doc_type: parsed.data.doc_type, slot: derivedSlot });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * AI-suggested document classification scoped strictly to the engagement pack taxonomy.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: doc } = await supabase
      .from("documents")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const engagement = await getEngagement(doc.engagement_id, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const pack = loadPack(engagement.pack_id);

    if (!isGeminiConfigured()) {
      return NextResponse.json(
        { ok: false, error: "Gemini is not configured for document classification." },
        { status: 503 }
      );
    }

    const { data: file, error: fileErr } = await supabase.storage.from("evidence").download(doc.storage_path);
    if (fileErr || !file) {
      return NextResponse.json({ ok: false, error: "Could not read storage object" }, { status: 404 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const pages = await splitEvidencePages(buf, doc.mime_type);
    if (pages.length === 0) {
      return NextResponse.json({ ok: false, error: "Document has no readable pages" }, { status: 422 });
    }

    const provider = new GeminiExtractionProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: process.env.GEMINI_MODEL || undefined,
    });

    const allowedTaxonomy = (pack.document_taxonomy ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      notes: t.notes,
    }));

    const firstPage = {
      evidenceId: doc.sha256,
      pageNumber: pages[0]!.pageNumber,
      mimeType: pages[0]!.mimeType,
      data: Buffer.from(pages[0]!.bytes).toString("base64"),
    };

    const classified = await provider.classify(firstPage, { allowedDocTypes: allowedTaxonomy });

    if (!classified.ok || !classified.data) {
      return NextResponse.json({
        ok: false,
        error: classified.validationErrors?.join("; ") ?? classified.log.error ?? "Classification failed",
      }, { status: 422 });
    }

    const { docType, confidence, reasoning } = classified.data;
    const derivedSlot = deriveSlotFromDocType(docType, pack.evidence_slots ?? []);

    const updatePayload: { doc_type: string; classification_confidence: number; slot?: string } = {
      doc_type: docType,
      classification_confidence: confidence,
    };
    if (derivedSlot) updatePayload.slot = derivedSlot;

    // Save suggested type & synced slot
    await supabase
      .from("documents")
      .update(updatePayload)
      .eq("id", id)
      .eq("organization_id", organizationId);

    return NextResponse.json({
      ok: true,
      docType,
      confidence,
      reasoning,
      slot: derivedSlot,
    });
  } catch (e) {
    return jsonError(e);
  }
}
