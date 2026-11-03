import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import {
  deskReviewFor,
  inferSlot,
  proposeFromDocuments,
  type EvidenceDocumentCandidate,
} from "@verifystack/backend/domain/deskreview";
import { readPdfText } from "@verifystack/backend/domain/extraction/pdfText";

export const runtime = "nodejs";

const Body = z.object({ engagementId: z.string().uuid() });

/** A statutory PDF is a few pages; refuse to open anything bigger here. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Read the text layer of the PDFs in this engagement's evidence slots and return
 * suggested readings for the desk review. "AI proposes, humans decide." These are
 * advisory until the auditor accepts and saves them. Every value is the number the
 * document prints; nothing is remembered from another engagement or another file.
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

    const { data: docs, error } = await supabase
      .from("documents")
      .select("id, original_filename, slot, doc_type, storage_path, mime_type, byte_size")
      .eq("engagement_id", engagementId)
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    const pdfs = (docs ?? []).filter(
      (d) => d.mime_type === "application/pdf" || /\.pdf$/i.test(d.original_filename)
    );

    const skipped: { documentId: string; documentName: string; reason: string }[] = [];
    const candidates: EvidenceDocumentCandidate[] = [];
    for (const d of pdfs) {
      const slot = inferSlot({ name: d.original_filename, slot: d.slot, docType: d.doc_type });
      if (!slot) continue;
      if (d.byte_size > MAX_PDF_BYTES) {
        skipped.push({ documentId: d.id, documentName: d.original_filename, reason: "too_large" });
        continue;
      }
      const { data: blob, error: downloadError } = await supabase.storage.from("evidence").download(d.storage_path);
      if (downloadError || !blob) {
        skipped.push({ documentId: d.id, documentName: d.original_filename, reason: "storage_unreadable" });
        continue;
      }
      let pages: Awaited<ReturnType<typeof readPdfText>> = [];
      try {
        pages = await readPdfText(new Uint8Array(await blob.arrayBuffer()));
      } catch {
        skipped.push({ documentId: d.id, documentName: d.original_filename, reason: "pdf_unreadable" });
        continue;
      }
      candidates.push({ id: d.id, name: d.original_filename, slot, docType: d.doc_type, pages });
    }

    const { suggestions, unreadable } = proposeFromDocuments(def, candidates);

    return NextResponse.json({ ok: true, suggestions, unreadable, skipped });
  } catch (e) {
    return jsonError(e);
  }
}
