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

/**
 * Assign or reassign a document to a pack taxonomy type by hand, or clear it.
 * Audited and validated against pack.document_taxonomy.
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
      .select("id, engagement_id, doc_type")
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

    const { error } = await supabase
      .from("documents")
      .update({
        doc_type: parsed.data.doc_type,
        classification_confidence: 1.0,
      })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "document.type_set",
      entityType: "document",
      entityId: id,
      payload: { from: doc.doc_type ?? null, to: parsed.data.doc_type },
    });

    return NextResponse.json({ ok: true, doc_type: parsed.data.doc_type });
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

    // Save suggested type
    await supabase
      .from("documents")
      .update({
        doc_type: docType,
        classification_confidence: confidence,
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    return NextResponse.json({
      ok: true,
      docType,
      confidence,
      reasoning,
    });
  } catch (e) {
    return jsonError(e);
  }
}
