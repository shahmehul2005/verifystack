import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { CSV_MIME, XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { parseCsv } from "@verifystack/backend/domain/intake/csv";
import {
  CellReadError,
  readCell,
  sheetsFromBytes,
} from "@verifystack/backend/domain/intake/tabular";
import {
  aggregateRange,
  normaliseTimeSeries,
  TimeSeriesError,
} from "@verifystack/backend/domain/intake/timeseries";
import {
  TIME_SERIES_AGGREGATIONS,
  provenanceToColumns,
  type Provenance,
} from "@verifystack/backend/domain/provenance";
import type { Json } from "@verifystack/backend/lib/supabase/types";

export const runtime = "nodejs";

const FieldPath = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_.\-[\]]+$/, "Use letters, digits, dots and underscores");
const Unit = z.string().trim().max(30).optional();

const Body = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cell"),
    items: z
      .array(
        z.object({
          sheet: z.string().min(1).max(120),
          cellRef: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/),
          fieldPath: FieldPath,
          unit: Unit,
        })
      )
      .min(1)
      .max(100),
  }),
  z.object({
    type: z.literal("range"),
    items: z
      .array(
        z.object({
          tag: z.string().min(1).max(200),
          start: z.string().min(8).max(40),
          end: z.string().min(8).max(40),
          aggregation: z.enum(TIME_SERIES_AGGREGATIONS),
          fieldPath: FieldPath,
          unit: Unit,
        })
      )
      .min(1)
      .max(50),
  }),
]);

/**
 * Turn spreadsheet cells or time-series windows into extraction proposals
 * (DFD 2.4, 2.5). The route reads the stored file itself: the browser names a
 * cell or a window, never a value. Each proposal still needs a human decision
 * in the review queue, like a value read from a page.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCapability("documents.extract");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    const admin = createServiceClient() ?? (await createServerSupabase());
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }

    const { data: doc } = await admin
      .from("documents")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (doc.mime_type !== XLSX_MIME && doc.mime_type !== CSV_MIME) {
      return NextResponse.json(
        { ok: false, error: "Only spreadsheet and CSV files can be mapped." },
        { status: 409 }
      );
    }
    const { data: blob, error: dlErr } = await admin.storage.from("evidence").download(doc.storage_path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Storage object missing");
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const proposals: { fieldPath: string; unit: string | null; value: Json; prov: Provenance }[] = [];
    const rejected: { index: number; reason: string }[] = [];

    if (parsed.data.type === "cell") {
      const sheets = sheetsFromBytes(bytes, doc.mime_type === XLSX_MIME ? "spreadsheet" : "csv", doc.original_filename);
      parsed.data.items.forEach((item, index) => {
        try {
          const c = readCell(sheets, item.sheet, item.cellRef);
          proposals.push({
            fieldPath: item.fieldPath,
            unit: item.unit || null,
            value: c.value,
            prov: {
              type: "spreadsheet_cell",
              documentId: doc.id,
              sheet: c.sheet,
              cellRef: c.cellRef,
              value: c.value,
              ...(c.formula ? { formula: c.formula } : {}),
            },
          });
        } catch (e) {
          if (e instanceof CellReadError) rejected.push({ index, reason: e.message });
          else throw e;
        }
      });
    } else {
      if (doc.mime_type !== CSV_MIME) {
        return NextResponse.json(
          { ok: false, error: "Time-series windows are read from CSV exports." },
          { status: 409 }
        );
      }
      let series;
      try {
        series = normaliseTimeSeries(parseCsv(new TextDecoder("utf-8").decode(bytes)).rows).series;
      } catch (e) {
        if (e instanceof TimeSeriesError) {
          return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
        }
        throw e;
      }
      parsed.data.items.forEach((item, index) => {
        const points = series.get(item.tag);
        if (!points) {
          rejected.push({ index, reason: `There is no tag named "${item.tag}" in this file.` });
          return;
        }
        try {
          const agg = aggregateRange(points, item.start, item.end, item.aggregation);
          if (!agg) {
            rejected.push({ index, reason: `${item.tag} has no readings in that window.` });
            return;
          }
          proposals.push({
            fieldPath: item.fieldPath,
            unit: item.unit || null,
            value: agg.value,
            prov: {
              type: "time_series_range",
              documentId: doc.id,
              tag: item.tag,
              start: item.start,
              end: item.end,
              aggregation: item.aggregation,
              rowCount: agg.rowCount,
            },
          });
        } catch (e) {
          if (e instanceof TimeSeriesError) rejected.push({ index, reason: e.message });
          else throw e;
        }
      });
    }

    let created = 0;
    for (const p of proposals) {
      const cols = provenanceToColumns(p.prov);
      const { error } = await admin.from("extracted_fields").insert({
        organization_id: organizationId,
        engagement_id: doc.engagement_id,
        document_id: doc.id,
        extraction_job_id: null,
        field_path: p.fieldPath,
        value_json: p.value,
        unit: p.unit,
        // Read directly from the file by code, not estimated by a model.
        confidence: 1,
        page: null,
        bbox: null,
        source_text: null,
        provenance_type: cols.provenance_type,
        provenance: cols.provenance as Json | null,
        triage_action: "human_review",
        state: "suggested",
        proposed_by: session.user.id,
      });
      if (error) throw new Error(error.message);
      created += 1;
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "extraction.proposed_from_table",
      entityType: "document",
      entityId: doc.id,
      payload: { kind: parsed.data.type, created, rejected: rejected.length },
    });

    return NextResponse.json({ ok: true, created, rejected });
  } catch (e) {
    return jsonError(e);
  }
}
