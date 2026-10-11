import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { MAX_EVIDENCE_BYTES } from "@verifystack/backend/lib/evidence";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
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
 * Import an evidence pack (DFD 2.6). Every file is hashed and compared with the
 * manifest before anything is stored; one mismatch rejects the whole pack.
 * Declared values are stored as declarations (never facts) for the
 * declared-versus-extracted comparison.
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

    const imported: { name: string; documentId: string; deduped: boolean; kind: string }[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const file of pack.files) {
      try {
        const r = await ingestEvidenceFile({
          organizationId,
          engagement,
          actorUserId: session.user.id,
          filename: file.name,
          bytes: file.bytes,
          source: "evidence_pack",
          allow: ["page", "spreadsheet", "csv"],
        });
        imported.push({
          name: file.path,
          documentId: r.document.id,
          deduped: r.deduped,
          kind: r.kind,
        });
      } catch (e) {
        if (e instanceof IngestError) skipped.push({ name: file.path, reason: e.message });
        else throw e;
      }
    }

    const admin = createServiceClient() ?? (await createServerSupabase());
    if (admin && pack.manifest.declared.length > 0) {
      const { error } = await admin.from("declared_values").upsert(
        pack.manifest.declared.map((d) => ({
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
        declared: pack.manifest.declared.length,
        sourceSystem: pack.manifest.source?.system ?? null,
      },
    });

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
      declared: pack.manifest.declared.length,
    });
  } catch (e) {
    return jsonError(e);
  }
}
