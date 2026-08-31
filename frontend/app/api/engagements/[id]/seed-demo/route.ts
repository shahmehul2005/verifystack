import { NextResponse } from "next/server";
import { requireSession, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { getEngagement, ensureEngagementStatus } from "@verifystack/backend/lib/data/engagements";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { sha256Bytes, evidenceObjectKey } from "@verifystack/backend/lib/hash";
import { CEMENT_DEMO_RUN_FACTS } from "@verifystack/backend/demo/seed";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const BBOX = { x: 0.1, y: 0.2, width: 0.35, height: 0.05 };

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const engagement = await getEngagement(id, organizationId);
    if (!engagement) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (engagement.pack_id !== "CCTS-CEMENT-v1") {
      return NextResponse.json(
        { ok: false, error: "Synthetic Cement facts only apply to CCTS-CEMENT-v1." },
        { status: 409 }
      );
    }
    if (!engagement.draft_mode) {
      return NextResponse.json(
        { ok: false, error: "Seed demo facts only on draft-mode engagements." },
        { status: 409 }
      );
    }

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: existing } = await admin
      .from("facts")
      .select("field_path")
      .eq("engagement_id", id)
      .eq("organization_id", organizationId);
    const have = new Set((existing ?? []).map((f) => f.field_path));
    const missing = CEMENT_DEMO_RUN_FACTS.filter((f) => !have.has(f.field_path));
    if (missing.length === 0) {
      return NextResponse.json({ ok: true, seeded: 0, message: "Demo facts already present." });
    }

    const sha256 = sha256Bytes(Buffer.concat([PNG, Buffer.from(id)]));
    const storagePath = evidenceObjectKey(sha256);
    await admin.storage.from("evidence").upload(storagePath, PNG, {
      contentType: "image/png",
      upsert: true,
    });

    const { data: existingDoc } = await admin
      .from("documents")
      .select("id")
      .eq("engagement_id", id)
      .eq("sha256", sha256)
      .maybeSingle();

    let documentId = existingDoc?.id;
    if (!documentId) {
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .insert({
          organization_id: organizationId,
          engagement_id: id,
          sha256,
          storage_path: storagePath,
          original_filename: "aravalli-synthetic-placeholder.png",
          mime_type: "image/png",
          byte_size: PNG.byteLength,
          doc_type: "production_log",
          created_by: session.user.id,
        })
        .select("id")
        .single();
      if (docErr || !doc) throw new Error(docErr?.message ?? "Could not store placeholder document");
      documentId = doc.id;
    }

    const rows = missing.map((f) => ({
      organization_id: organizationId,
      engagement_id: id,
      document_id: documentId,
      field_path: f.field_path,
      value_json: f.value_json as Json,
      unit: f.unit,
      page: 1,
      bbox: BBOX as Json,
      source_text: f.source_text,
      accepted_by: session.user.id,
    }));
    const { error: factErr } = await admin.from("facts").insert(rows);
    if (factErr) throw new Error(factErr.message);

    await auditEvent({
      organizationId,
      action: "facts.seeded_demo",
      entityType: "engagement",
      entityId: id,
      payload: { fields: missing.map((f) => f.field_path) },
    });

    await ensureEngagementStatus({
      organizationId,
      engagementId: id,
      current: engagement.status,
      target: "review",
    });

    return NextResponse.json({ ok: true, seeded: rows.length });
  } catch (error) {
    return jsonError(error);
  }
}
