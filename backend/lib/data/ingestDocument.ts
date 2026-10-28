import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { sha256Bytes, evidenceObjectKey } from "@verifystack/backend/lib/hash";
import {
  MAX_EVIDENCE_BYTES,
  sanitizeFilename,
  sniffUploadType,
  type UploadKind,
} from "@verifystack/backend/lib/evidence";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { inngest } from "@verifystack/backend/inngest/client";
import { isInngestConfigured } from "@verifystack/backend/lib/supabase/configured";
import { countEvidencePages, documentPageInserts } from "@verifystack/backend/domain/extraction/pages";
import { assessScan } from "@verifystack/backend/domain/intake/scan";
import { CsvError, parseCsv } from "@verifystack/backend/domain/intake/csv";
import { XlsxError } from "@verifystack/backend/domain/intake/xlsx";
import { normaliseTimeSeries, TimeSeriesError } from "@verifystack/backend/domain/intake/timeseries";
import { csvToSheet, previewSheet, sheetsFromBytes } from "@verifystack/backend/domain/intake/tabular";
import { scanSheetForSummaries, summaryHeadline } from "@verifystack/backend/domain/intake/summary";
import type { Json, Tables } from "@verifystack/backend/lib/supabase/types";

export type DocumentSource = Tables<"documents">["source"];

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export interface IngestInput {
  organizationId: string;
  engagement: Pick<Tables<"engagements">, "id" | "pack_id" | "scheme" | "adeetie_phase">;
  actorUserId: string | null;
  filename: string;
  bytes: Uint8Array;
  source: DocumentSource;
  findingId?: string | null;
  /** Kinds this caller may store. An entity response may not upload an archive, for example. */
  allow: readonly UploadKind[];
  /** Audit action prefix and actor label for entity uploads, which have no session. */
  actorLabel?: string;
}

export interface IngestResult {
  document: Tables<"documents">;
  deduped: boolean;
  kind: UploadKind;
  datasets: number;
}

const KIND_REFUSAL = "That file type is not accepted here.";

/**
 * Store one evidence file and everything derived from it: content-addressed
 * bytes, the documents row, page rows, a scan assessment for images, and D10
 * dataset rows for spreadsheets and time series.
 *
 * Bytes are validated and parsed BEFORE anything is written, so a corrupt
 * workbook leaves no half-stored document behind.
 */
export async function ingestEvidenceFile(input: IngestInput): Promise<IngestResult> {
  const filename = sanitizeFilename(input.filename);
  const buf = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  if (buf.byteLength < 16) throw new IngestError("File too small", 400);
  if (buf.byteLength > MAX_EVIDENCE_BYTES) {
    throw new IngestError("Evidence files are limited to 50 MB.", 413);
  }
  const sniffed = sniffUploadType(buf, filename);
  if (!sniffed) {
    throw new IngestError(
      "Upload a PDF, PNG, JPEG, WebP, XLSX or CSV file, or an evidence pack (.zip).",
      415
    );
  }
  if (!input.allow.includes(sniffed.kind)) throw new IngestError(KIND_REFUSAL, 415);

  // Parse first. A refusal here writes nothing.
  type DatasetRow = {
    kind: "spreadsheet" | "time_series";
    name: string;
    columns: string[];
    row_count: number;
    summary: Json;
  };
  const datasets: DatasetRow[] = [];
  try {
    if (sniffed.kind === "spreadsheet") {
      for (const sheet of sheetsFromBytes(buf, "spreadsheet", filename)) {
        datasets.push({
          kind: "spreadsheet",
          name: sheet.name,
          columns: [],
          row_count: sheet.rowCount,
          summary: {
            ...previewSheet(sheet),
            // Totals are scanned on upload. The review panel recomputes them from the file.
            summaryScan: summaryHeadline(scanSheetForSummaries(sheet)),
          } as unknown as Json,
        });
      }
    } else if (sniffed.kind === "csv") {
      const { rows } = parseCsv(new TextDecoder("utf-8").decode(buf));
      try {
        const norm = normaliseTimeSeries(rows);
        datasets.push({
          kind: "time_series",
          name: filename,
          columns: rows[0]!.map((h) => h.trim()),
          row_count: rows.length - 1,
          summary: {
            layout: norm.layout,
            timestampColumn: norm.timestampColumn,
            assumedOffsetMinutes: norm.assumedOffsetMinutes,
            tags: norm.summaries,
            warnings: norm.warnings,
          } as unknown as Json,
        });
      } catch (e) {
        if (!(e instanceof TimeSeriesError)) throw e;
        // Not a time series: keep it as a plain table that cells can be mapped from.
        const sheet = csvToSheet(filename.replace(/\.[^.]+$/, "") || "Sheet1", rows);
        datasets.push({
          kind: "spreadsheet",
          name: sheet.name,
          columns: [],
          row_count: sheet.rowCount,
          summary: {
            ...previewSheet(sheet),
            // Totals are scanned on upload. The review panel recomputes them from the file.
            summaryScan: summaryHeadline(scanSheetForSummaries(sheet)),
          } as unknown as Json,
        });
      }
    }
  } catch (e) {
    if (e instanceof XlsxError || e instanceof CsvError) throw new IngestError(e.message, 422);
    throw e;
  }

  const sha256 = sha256Bytes(buf);
  const storagePath = evidenceObjectKey(sha256);
  const admin = createServiceClient() ?? (input.source === "entity_response" ? null : await createServerSupabase());
  if (!admin) throw new IngestError("Supabase is not configured", 503);

  const { data: existing } = await admin
    .from("documents")
    .select("*")
    .eq("engagement_id", input.engagement.id)
    .eq("sha256", sha256)
    .maybeSingle();
  if (existing) {
    await auditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "document.deduped",
      entityType: "document",
      entityId: existing.id,
      payload: { sha256, source: input.source },
    });
    return { document: existing, deduped: true, kind: sniffed.kind, datasets: 0 };
  }

  const { error: upErr } = await admin.storage.from("evidence").upload(storagePath, buf, {
    contentType: sniffed.mime,
    upsert: true,
  });
  if (upErr && !/exists|duplicate/i.test(upErr.message)) {
    throw new Error(`Storage: ${upErr.message}`);
  }

  const scan =
    sniffed.kind === "page" && sniffed.mime.startsWith("image/") ? assessScan(buf) : null;

  const { data: doc, error } = await admin
    .from("documents")
    .insert({
      organization_id: input.organizationId,
      engagement_id: input.engagement.id,
      sha256,
      storage_path: storagePath,
      original_filename: filename,
      mime_type: sniffed.mime,
      byte_size: buf.byteLength,
      created_by: input.actorUserId,
      source: input.source,
      finding_id: input.findingId ?? null,
      scan_assessment: scan as unknown as Json | null,
      ...(input.engagement.scheme === "ADEETIE" && input.engagement.adeetie_phase
        ? { adeetie_phase: input.engagement.adeetie_phase }
        : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await auditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: "document.uploaded",
    entityType: "document",
    entityId: doc.id,
    payload: {
      sha256,
      filename,
      source: input.source,
      kind: sniffed.kind,
      ...(input.actorLabel ? { actor: input.actorLabel } : {}),
    },
  });

  if (sniffed.kind === "page") {
    const pageCount = await countEvidencePages(buf, sniffed.mime);
    await admin
      .from("document_pages")
      .upsert(documentPageInserts(input.organizationId, doc.id, pageCount, storagePath), {
        onConflict: "document_id,page_number",
      });
    await admin.from("documents").update({ page_count: pageCount }).eq("id", doc.id);
    // Evidence from the entity is read by a person first; only the firm's own
    // intake starts extraction on its own.
    if (isInngestConfigured() && (input.source === "upload" || input.source === "evidence_pack")) {
      await inngest.send({
        name: "documents/uploaded",
        data: {
          organizationId: input.organizationId,
          engagementId: input.engagement.id,
          documentId: doc.id,
          sha256,
          mimeType: sniffed.mime,
          packId: input.engagement.pack_id,
        },
      });
    }
  }

  if (datasets.length > 0) {
    const { error: dsErr } = await admin.from("tabular_datasets").insert(
      datasets.map((d) => ({
        organization_id: input.organizationId,
        engagement_id: input.engagement.id,
        document_id: doc.id,
        kind: d.kind,
        name: d.name,
        columns: d.columns as unknown as Json,
        row_count: d.row_count,
        summary: d.summary,
      }))
    );
    if (dsErr) throw new Error(dsErr.message);
  }

  return {
    document: { ...doc, page_count: doc.page_count },
    deduped: false,
    kind: sniffed.kind,
    datasets: datasets.length,
  };
}
