import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { deskReviewFor } from "@verifystack/backend/domain/deskreview";
import { parseRegion, type Region } from "@verifystack/backend/domain/deskreview/snip";
import { classifyChange, reasonProblem, type ChangeKind, type ReadingState } from "@verifystack/backend/domain/deskreview/readingChange";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const Body = z.object({
  engagementId: z.string().uuid(),
  readings: z
    .array(
      z.object({
        key: z.string().min(1).max(120),
        /** Null withdraws the reading. */
        value: z.number().finite().nullable(),
        documentId: z.string().uuid().nullable().optional(),
        page: z.number().int().min(1).max(10000).nullable().optional(),
        note: z.string().trim().max(300).nullable().optional(),
        /** The box the auditor drew on the page, normalised to it. Needs the page and what is printed in the box. */
        bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(),
        sourceText: z.string().trim().max(300).nullable().optional(),
        /** Why a figure on record was changed or withdrawn. Not needed for a first entry or an unchanged figure. */
        reason: z.string().trim().max(500).nullable().optional(),
      })
    )
    .min(1)
    .max(200),
});

const DAILY = /^(.+)@(\d{4}-\d{2}-\d{2})$/;

/** The history table arrives with migration 0021; until then the audit entry keeps the earlier figure. */
const isMissingTable = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /desk_reading_history/.test(e.message ?? "");

/**
 * Save the figures an auditor read off PDFs. Only keys the pack's desk review
 * declares are accepted, each stored with its unit from that declaration, the
 * document it came from and the page. A reading never becomes a fact and never
 * feeds a run. A figure with no document or no page is refused: a typed number
 * with nothing behind it cannot be checked.
 *
 * Changing a figure already on record, or withdrawing it, needs a reason. The
 * earlier figure is kept in desk_reading_history (and the audit entry), so an
 * edit supersedes it and a withdrawal removes it from the checks without erasing
 * it. A figure saved unchanged is left as it is.
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
    const resolved: {
      key: string;
      unit: string;
      value: number | null;
      documentId: string | null;
      page: number | null;
      note: string | null;
      bbox: Region | null;
      sourceText: string | null;
      reason: string | null;
    }[] = [];
    for (const r of body.readings) {
      const day = DAILY.exec(r.key);
      const spec = specs.get(day ? day[1]! : r.key);
      if (!spec || Boolean(day) !== (spec.kind === "daily")) {
        return NextResponse.json({ ok: false, error: `"${r.key}" is not a reading this review takes.` }, { status: 422 });
      }
      const bbox = r.bbox ? parseRegion(r.bbox) : null;
      if (r.bbox && !bbox) {
        return NextResponse.json({ ok: false, error: `The region for "${r.key}" is not a box on the page.` }, { status: 422 });
      }
      if (bbox && r.value !== null && !r.sourceText?.trim()) {
        return NextResponse.json({ ok: false, error: `Say what is printed in the box for "${r.key}".` }, { status: 422 });
      }
      resolved.push({
        key: r.key,
        unit: spec.unit,
        value: r.value,
        documentId: r.documentId ?? null,
        page: r.page ?? null,
        note: r.note ?? null,
        bbox,
        sourceText: bbox ? (r.sourceText?.trim() ?? null) : null,
        reason: r.reason?.trim() || null,
      });
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
      .select("key, value, document_id, page, bbox, source_text")
      .eq("engagement_id", body.engagementId)
      .eq("organization_id", organizationId)
      .in("key", resolved.map((r) => r.key));
    if (priorError) throw new Error(priorError.message);
    const priorState = new Map<string, ReadingState>(
      (prior ?? []).map((p) => [p.key, { value: Number(p.value), documentId: p.document_id, page: p.page, bbox: parseRegion(p.bbox), sourceText: p.source_text }])
    );
    const previousOf = (key: string): Json | null => {
      const p = priorState.get(key);
      return p ? ({ value: p.value, documentId: p.documentId, page: p.page, ...(p.bbox ? { region: p.bbox, sourceText: p.sourceText } : {}) } as unknown as Json) : null;
    };

    const changes = resolved.map((r) => {
      const next: ReadingState | null =
        r.value === null ? null : { value: r.value, documentId: r.documentId, page: r.page, bbox: r.bbox, sourceText: r.sourceText };
      return { r, kind: classifyChange(priorState.get(r.key) ?? null, next) as ChangeKind };
    });

    // A figure on record is not changed or withdrawn without saying why.
    const unexplained = [...new Set(changes.filter((c) => reasonProblem(c.kind, c.r.reason) !== null).map((c) => c.r.key.split("@")[0]!))];
    if (unexplained.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Say why you are changing or withdrawing: ${unexplained.slice(0, 5).join(", ")}${unexplained.length > 5 ? ` and ${unexplained.length - 5} more` : ""}.`,
          needsReason: unexplained,
        },
        { status: 422 }
      );
    }

    const removals = changes.filter((c) => c.kind === "withdrawn");
    const upserts = changes.filter((c) => c.kind === "entered" || c.kind === "edited");
    const unchanged = changes.filter((c) => c.kind === "unchanged").length;

    if (removals.length > 0) {
      const { error } = await supabase
        .from("desk_readings")
        .delete()
        .eq("engagement_id", body.engagementId)
        .eq("organization_id", organizationId)
        .in("key", removals.map((c) => c.r.key));
      if (error) throw new Error(error.message);
    }
    const now = new Date().toISOString();
    if (upserts.length > 0) {
      const { error } = await supabase.from("desk_readings").upsert(
        upserts.map(({ r }) => ({
          organization_id: organizationId,
          engagement_id: body.engagementId,
          key: r.key,
          value: r.value!,
          unit: r.unit,
          document_id: r.documentId,
          page: r.page,
          note: r.note,
          bbox: (r.bbox ?? null) as unknown as Json | null,
          source_text: r.sourceText,
          source_kind: r.bbox ? ("snip" as const) : ("typed" as const),
          entered_by: session.user.id,
          entered_at: now,
        })),
        { onConflict: "engagement_id,key" }
      );
      if (error) throw new Error(error.message);
    }

    let historyRecorded = true;
    const recorded = [...upserts, ...removals];
    if (recorded.length > 0) {
      const { error } = await supabase.from("desk_reading_history").insert(
        recorded.map(({ r, kind }) => ({
          organization_id: organizationId,
          engagement_id: body.engagementId,
          key: r.key,
          action: kind as "entered" | "edited" | "withdrawn",
          value: r.value,
          unit: r.unit,
          document_id: r.documentId,
          page: r.page,
          bbox: (r.bbox ?? null) as unknown as Json | null,
          source_text: r.sourceText,
          source_kind: r.value === null ? null : r.bbox ? ("snip" as const) : ("typed" as const),
          previous: previousOf(r.key),
          reason: kind === "entered" ? "" : (r.reason ?? ""),
          acted_by: session.user.id,
          acted_at: now,
        }))
      );
      if (error) {
        if (!isMissingTable(error)) throw new Error(error.message);
        historyRecorded = false;
      }
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "desk_review.readings_saved",
      entityType: "engagement",
      entityId: body.engagementId,
      payload: {
        saved: upserts.map(({ r, kind }) => ({
          key: r.key,
          value: r.value,
          documentId: r.documentId,
          page: r.page,
          change: kind,
          ...(r.bbox ? { region: { ...r.bbox }, sourceText: r.sourceText } : {}),
          ...(kind === "edited" ? { reason: r.reason, previous: previousOf(r.key) } : {}),
        })),
        removed: removals.map(({ r }) => ({ key: r.key, reason: r.reason, previous: previousOf(r.key) })),
      },
    });
    return NextResponse.json({
      ok: true,
      saved: upserts.length,
      removed: removals.length,
      unchanged,
      historyRecorded,
    });
  } catch (e) {
    return jsonError(e);
  }
}
