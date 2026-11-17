import { z } from "zod";
import { requireCapability, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { isMissingObjectMessage, XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { parseXlsx, XlsxError } from "@verifystack/backend/domain/intake/xlsx";
import { parseCsv, CsvError } from "@verifystack/backend/domain/intake/csv";
import { buildSheetView, csvToWorkbook, previewModeFor } from "@verifystack/backend/domain/intake/preview";

export const runtime = "nodejs";

/** Absent parameters stay undefined. buildSheetView clamps the values. */
const Query = z.object({
  sheet: z.coerce.number().int().min(0).max(1000).optional(),
  rowStart: z.coerce.number().int().min(1).max(10_000_000).optional(),
  rowLimit: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** A bounded, read-only window of a stored XLSX or CSV, read from bytes in memory. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCapability("documents.view");
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;

    const sp = new URL(req.url).searchParams;
    const parsed = Query.safeParse({
      sheet: sp.get("sheet") ?? undefined,
      rowStart: sp.get("rowStart") ?? undefined,
      rowLimit: sp.get("rowLimit") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Invalid sheet, rowStart or rowLimit." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return Response.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: doc } = await supabase
      .from("documents")
      .select("id, storage_path, mime_type, original_filename, organization_id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!doc) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (previewModeFor(doc.mime_type) !== "sheet") {
      return Response.json(
        { ok: false, error: "Only XLSX and CSV documents can be shown as a sheet." },
        { status: 415 }
      );
    }

    const { data, error } = await supabase.storage.from("evidence").download(doc.storage_path);
    if (error || !data) {
      if (!error || isMissingObjectMessage(error.message)) {
        return Response.json(
          {
            ok: false,
            code: "file_missing",
            error: "The stored file for this document is missing. Upload the same file again on Documents to restore it.",
          },
          { status: 404 }
        );
      }
      throw new Error(error.message);
    }
    const bytes = new Uint8Array(await data.arrayBuffer());

    let workbook;
    try {
      workbook =
        doc.mime_type === XLSX_MIME
          ? parseXlsx(bytes)
          : csvToWorkbook(parseCsv(new TextDecoder("utf-8").decode(bytes)).rows, doc.original_filename);
    } catch (e) {
      if (e instanceof XlsxError || e instanceof CsvError) {
        return Response.json({ ok: false, error: e.message }, { status: 422 });
      }
      throw e;
    }

    const view = buildSheetView(workbook, {
      sheetIndex: parsed.data.sheet,
      rowStart: parsed.data.rowStart,
      rowLimit: parsed.data.rowLimit,
    });
    const truncated = view.active.hasMoreRows || view.active.hasMoreColumns || view.active.sourceTruncated;
    return Response.json(
      {
        ok: true,
        document: { id: doc.id, name: doc.original_filename, mimeType: doc.mime_type },
        view,
        truncated,
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (e) {
    return jsonError(e);
  }
}
