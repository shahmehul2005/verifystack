import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { deskReviewFor } from "@verifystack/backend/domain/deskreview";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  readings: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        /** Null removes the reading. */
        value: z.number().finite().nullable(),
        documentId: z.string().uuid().nullable().optional(),
        page: z.number().int().min(1).max(10000).nullable().optional(),
        note: z.string().trim().max(300).nullable().optional(),
      })
    )
    .min(1)
    .max(200),
});

const DAILY = /^(.+)@(\d{4}-\d{2}-\d{2})$/;

/**
 * Save the figures an auditor read off PDFs. Only keys the pack's desk review
 * declares are accepted, each stored with its unit from that declaration, the
 * document it came from and the page. A reading never becomes a fact and never
 * feeds a run. A figure with no document or no page is refused: a typed number
 * with nothing behind it cannot be checked. A replaced or removed figure is kept
 * in the audit entry, since the row itself holds only the latest.
 */
export async function PUT(req: Request) {
  try {
    const session = await requireCapability("review.decide");
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    const body = parsed.data;

    const engagement = await getEngagement(body.engagementId, organizationId);
    if (!engagement) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const def = deskReviewFor(engagement.pack_id);
    if (!def) return NextResponse.json({ ok: false, error: "This methodology has no desk review." }, { status: 409 });
    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const specs = new Map(def.manual.map((s) => [s.key, s]));
    const resolved: { key: string; unit: string; value: number | null; documentId: string | null; page: number | null; note: string | null }[] = [];
    for (const r of body.readings) {
      const day = DAILY.exec(r.key);
      const spec = specs.get(day ? day[1]! : r.key);
      if (!spec || Boolean(day) !== (spec.kind === "daily")) {
        return NextResponse.json({ ok: false, error: `"${r.key}" is not a reading this review takes.` }, { status: 422 });
      }
      resolved.push({ key: r.key, unit: spec.unit, value: r.value, documentId: r.documentId ?? null, page: r.page ?? null, note: r.note ?? null });
    }

    const unsourced = [...new Set(resolved.filter((r) => r.value !== null && (r.documentId === null || r.page === null)).map((r) => r.key.split("@")[0]!))];
    if (unsourced.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Each figure needs the document and page it was read from. Missing for: ${unsourced.slice(0, 5).join(", ")}${unsourced.length > 5 ? ` and ${unsourced.length - 5} more` : ""}.`,
        },
        { status: 422 }
      );
    }

    const docIds = [...new Set(resolved.map((r) => r.documentId).filter((d): d is string => d !== null))];
    if (docIds.length > 0) {
      const { data: docs, error } = await supabase
        .from("documents")
        .select("id")
        .eq("engagement_id", body.engagementId)
        .eq("organization_id", organizationId)
        .in("id", docIds);
      if (error) throw new Error(error.message);
      if ((docs?.length ?? 0) !== docIds.length) {
        return NextResponse.json({ ok: false, error: "A source document is not in this engagement." }, { status: 422 });
      }
    }

    const { data: prior, error: priorError } = await supabase
      .from("desk_readings")
      .select("key, value, document_id, page")
      .eq("engagement_id", body.engagementId)
      .eq("organization_id", organizationId)
      .in("key", resolved.map((r) => r.key));
    if (priorError) throw new Error(priorError.message);
    const before = new Map((prior ?? []).map((p) => [p.key, { value: Number(p.value), documentId: p.document_id, page: p.page }]));

    const removals = resolved.filter((r) => r.value === null).map((r) => r.key);
    const upserts = resolved.filter((r) => r.value !== null);
    if (removals.length > 0) {
      const { error } = await supabase.from("desk_readings").delete().eq("engagement_id", body.engagementId).eq("organization_id", organizationId).in("key", removals);
      if (error) throw new Error(error.message);
    }
    if (upserts.length > 0) {
      const { error } = await supabase.from("desk_readings").upsert(
        upserts.map((r) => ({
          organization_id: organizationId,
          engagement_id: body.engagementId,
          key: r.key,
          value: r.value!,
          unit: r.unit,
          document_id: r.documentId,
          page: r.page,
          note: r.note,
          entered_by: session.user.id,
          entered_at: new Date().toISOString(),
        })),
        { onConflict: "engagement_id,key" }
      );
      if (error) throw new Error(error.message);
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "desk_review.readings_saved",
      entityType: "engagement",
      entityId: body.engagementId,
      payload: {
        saved: upserts.map((r) => ({
          key: r.key,
          value: r.value,
          documentId: r.documentId,
          page: r.page,
          ...(before.has(r.key) ? { previous: before.get(r.key) } : {}),
        })),
        removed: removals.map((key) => ({ key, ...(before.has(key) ? { previous: before.get(key) } : {}) })),
      },
    });
    return NextResponse.json({ ok: true, saved: upserts.length, removed: removals.length });
  } catch (e) {
    return jsonError(e);
  }
}
