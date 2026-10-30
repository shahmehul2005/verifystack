import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { MAX_EVIDENCE_BYTES } from "@verifystack/backend/lib/evidence";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { inferSlot } from "@verifystack/backend/domain/deskreview";
import { IngestError, ingestEvidenceFile } from "@verifystack/backend/lib/data/ingestDocument";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
import {
  EvidencePackError,
  importEvidencePack,
} from "@verifystack/backend/domain/intake/evidencePack";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

/**
 * Import an evidence package (DFD 2.6). A manifest is optional: a plain folder of
 * PDFs and workbooks imports directly. When a manifest is present, mismatched
 * files are still imported, flagged, and written to the audit log. Nothing is
 * refused for a manifest problem. Declared values are stored as declarations
 * (never facts) for the declared-versus-extracted comparison.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("documents.upload");
    const organizationId = assertOrgId(session.organizationId);
    const engagementId = req.headers.get("x-engagement-id");
    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "x-engagement-id required" }, { status: 400 });
    }
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_EVIDENCE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Evidence packs are limited to 50 MB." },
        { status: 413 }
      );
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
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Evidence packs are limited to 50 MB." },
        { status: 413 }
      );
    }

    let pack;
    try {
      pack = importEvidencePack(bytes);
    } catch (e) {
      if (e instanceof EvidencePackError) {
        return NextResponse.json(
          { ok: false, error: e.message, problems: e.problems },
          { status: 422 }
        );
      }
      throw e;
    }

    const imported: { name: string; documentId: string; deduped: boolean; kind: string; integrity: string }[] = [];
    const skipped: { name: string; reason: string }[] = pack.skipped.map((s) => ({ name: s.path, reason: s.reason }));
    // A manifest-backed pack keeps its source label; a plain folder is ordinary upload.
    const source = pack.manifest ? "evidence_pack" : "upload";
    for (const file of pack.files) {
      try {
        const r = await ingestEvidenceFile({
          organizationId,
          engagement,
          actorUserId: session.user.id,
          filename: file.name,
          bytes: file.bytes,
          source,
          allow: ["page", "spreadsheet", "csv"],
        });
        imported.push({
          name: file.path,
          documentId: r.document.id,
          deduped: r.deduped,
          kind: r.kind,
          integrity: file.integrity.status,
        });
        const effectiveSlot = inferSlot({ name: file.name, docType: file.docType });
        if (effectiveSlot || file.docType) {
          const adm = createServiceClient() ?? (await createServerSupabase());
          if (adm) {
            await adm
              .from("documents")
              .update({
                ...(file.docType ? { doc_type: file.docType } : {}),
                ...(effectiveSlot ? { slot: effectiveSlot } : {}),
              })
              .eq("id", r.document.id);
          }
        }
      } catch (e) {
        if (e instanceof IngestError) skipped.push({ name: file.path, reason: e.message });
        else throw e;
      }
    }

    const declared = pack.manifest?.declared ?? [];
    const admin = createServiceClient() ?? (await createServerSupabase());
    if (admin && declared.length > 0) {
      const { error } = await admin.from("declared_values").upsert(
        declared.map((d) => ({
          organization_id: organizationId,
          engagement_id: engagementId,
          field_path: d.fieldPath,
          value_json: d.value as Json,
          unit: d.unit ?? null,
          source: "evidence_pack" as const,
          created_by: session.user.id,
        })),
        { onConflict: "engagement_id,field_path,source" }
      );
      if (error) throw new Error(error.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "evidence_pack.imported",
      entityType: "engagement",
      entityId: engagementId,
      payload: {
        adapter: pack.adapter,
        files: pack.files.length,
        imported: imported.length,
        skipped: skipped.length,
        declared: declared.length,
        unlisted: pack.unlisted.length,
        mismatches: pack.mismatches.length,
        sourceSystem: pack.manifest?.source?.system ?? null,
      },
    });
    // A hash mismatch is not a block, but it is a tamper signal the audit trail must hold.
    if (pack.mismatches.length > 0) {
      await auditEvent({
        organizationId,
        actorUserId: session.user.id,
        action: "evidence_pack.hash_mismatch",
        entityType: "engagement",
        entityId: engagementId,
        payload: {
          files: pack.mismatches.map((m) => ({
            path: m.path,
            expectedSha256: m.expectedSha256,
            actualSha256: m.actualSha256,
          })),
        },
      });
    }

    if (imported.length > 0) {
      await ensureEngagementStatus({
        organizationId,
        actorUserId: session.user.id,
        engagementId,
        current: engagement.status,
        target: "intake",
      });
    }

    return NextResponse.json({
      ok: true,
      adapter: pack.adapter,
      imported,
      skipped,
      unlisted: pack.unlisted,
      mismatches: pack.mismatches.map((m) => ({ name: m.path, expected: m.expectedSha256, actual: m.actualSha256 })),
      warnings: pack.warnings,
      declared: declared.length,
    });
  } catch (e) {
    return jsonError(e);
  }
}
