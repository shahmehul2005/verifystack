import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { sniffUploadType } from "@verifystack/backend/lib/evidence";
import { CsvError, parseCsv } from "@verifystack/backend/domain/intake/csv";
import { XlsxError } from "@verifystack/backend/domain/intake/xlsx";
import { sheetToTable, sheetsFromBytes } from "@verifystack/backend/domain/intake/tabular";
import {
  BulkImportError,
  IMPORT_TEMPLATE_CSV,
  previewBulkImport,
  type BulkPreview,
} from "@verifystack/backend/domain/engagements/bulkImport";
import {
  EngagementCreateError,
  createEngagementRecord,
} from "@verifystack/backend/lib/data/createEngagement";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";

const MAX_BYTES = 5 * 1024 * 1024;

function tableFrom(bytes: Uint8Array, filename: string): string[][] {
  const sniffed = sniffUploadType(Buffer.from(bytes), filename);
  if (sniffed?.kind === "csv") {
    return parseCsv(new TextDecoder("utf-8").decode(bytes)).rows;
  }
  if (sniffed?.kind === "spreadsheet") {
    const sheet = sheetsFromBytes(bytes, "spreadsheet", filename)[0];
    if (!sheet) throw new BulkImportError("The workbook has no sheets.");
    return sheetToTable(sheet);
  }
  throw new BulkImportError("Upload a CSV or XLSX file.");
}

function publicPreview(p: BulkPreview) {
  return {
    headerProblems: p.headerProblems,
    unmappedHeaders: p.unmappedHeaders,
    validCount: p.validCount,
    invalidCount: p.invalidCount,
    rows: p.rows.map((r) => ({
      row: r.row,
      ok: r.ok,
      clientName: r.input?.clientName ?? null,
      plantName: r.input?.plantName ?? null,
      packId: r.input?.packId ?? null,
      complianceYear: r.input?.complianceYear ?? null,
      errors: r.errors,
      warnings: r.warnings,
    })),
  };
}

/** The template file, so nobody has to guess the column names. */
export async function GET() {
  try {
    await requireCapability("engagements.import");
    return new Response(IMPORT_TEMPLATE_CSV, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="engagements-template.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * Dry run by default. With `commit=true` the file is parsed again on the server
 * (the browser's preview is never trusted) and every valid row is created
 * through the same function the setup wizard uses.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("engagements.import");
    const organizationId = assertOrgId(session.organizationId);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Choose a CSV or XLSX file." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "The file is larger than 5 MB." }, { status: 413 });
    }
    const commit = form?.get("commit") === "true";
    const skipInvalid = form?.get("skipInvalid") === "true";

    let preview: BulkPreview;
    try {
      preview = previewBulkImport(tableFrom(new Uint8Array(await file.arrayBuffer()), file.name));
    } catch (e) {
      if (e instanceof BulkImportError || e instanceof CsvError || e instanceof XlsxError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
      }
      throw e;
    }

    if (!commit) return NextResponse.json({ ok: true, committed: false, preview: publicPreview(preview) });

    if (preview.headerProblems.length > 0 || preview.validCount === 0) {
      return NextResponse.json(
        { ok: false, error: "There is nothing valid to import.", preview: publicPreview(preview) },
        { status: 422 }
      );
    }
    if (preview.invalidCount > 0 && !skipInvalid) {
      return NextResponse.json(
        {
          ok: false,
          error: `${preview.invalidCount} row(s) have problems. Fix them, or choose to skip them.`,
          preview: publicPreview(preview),
        },
        { status: 422 }
      );
    }

    const supabase = createServiceClient();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });

    const batchId = randomUUID();
    const created: Array<{ row: number; id: string; clientName: string }> = [];
    const failed: Array<{ row: number; error: string }> = [];
    for (const r of preview.rows) {
      if (!r.ok || !r.input) continue;
      try {
        const engagement = await createEngagementRecord({
          supabase,
          organizationId,
          actorUserId: session.user.id,
          input: r.input,
          via: "bulk_import",
          importBatchId: batchId,
        });
        created.push({ row: r.row, id: engagement.id, clientName: engagement.client_name });
      } catch (e) {
        failed.push({
          row: r.row,
          error: e instanceof EngagementCreateError ? e.message : "The engagement could not be created.",
        });
        if (!(e instanceof EngagementCreateError)) console.error("[import]", e);
      }
    }

    await auditEvent({
      organizationId,
      actorUserId: session.user.id,
      action: "engagements.bulk_imported",
      entityType: "import_batch",
      entityId: batchId,
      payload: {
        filename: file.name,
        created: created.length,
        failed: failed.length,
        skipped_invalid: preview.invalidCount,
      },
    });

    return NextResponse.json({ ok: true, committed: true, batchId, created, failed });
  } catch (e) {
    return jsonError(e);
  }
}
