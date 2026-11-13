import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { saveCalendarReading } from "@verifystack/backend/lib/data/calendarStore";
import type { SourceType } from "@verifystack/backend/domain/calendar";

const execFileAsync = promisify(execFile);

interface CliExtractionOutput {
  ok: boolean;
  readings: Array<{
    stream_key: string;
    duration_kind: string;
    month_key: string;
    date_key?: string | null;
    source_type: string;
    raw_value: number;
    unit_as_printed: string;
    normalized_value?: number;
    normalized_unit?: string;
    confidence: number;
    provenance: {
      page?: number;
      bbox?: { x: number; y: number; width: number; height: number };
      source_text: string;
      sheet_name?: string;
      cell_coordinate?: string;
      document_sha256?: string;
    };
  }>;
  count: number;
  mappings?: Record<string, string>;
  unmapped?: string[];
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    let file: File | null = null;
    let engagementId: string | null = null;
    let documentId: string | null = null;
    let mode = "auto-map";
    let complianceYear = "2023-24";
    let sourceType = "corroboration";
    let fileName = "";
    let bytes: Buffer | null = null;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      file = formData.get("file") as File | null;
      engagementId = formData.get("engagementId") as string | null;
      documentId = formData.get("documentId") as string | null;
      mode = (formData.get("mode") as string) || "auto-map";
      complianceYear = (formData.get("complianceYear") as string) || "2023-24";
      sourceType = (formData.get("sourceType") as string) || "corroboration";
    } else {
      const json = await req.json().catch(() => ({}));
      engagementId = json.engagementId;
      documentId = json.documentId;
      mode = json.mode || "auto-map";
      complianceYear = json.complianceYear || "2023-24";
      sourceType = json.sourceType || "corroboration";
    }

    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "engagementId is required" }, { status: 400 });
    }

    const admin = createServiceClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Database not configured" }, { status: 503 });
    }

    let resolvedDocId: string | null = documentId;

    if (file) {
      bytes = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
    } else if (documentId) {
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .select("id, original_filename, storage_path, organization_id, mime_type")
        .eq("id", documentId)
        .single();

      if (docErr || !doc) {
        return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
      }

      resolvedDocId = doc.id;
      fileName = doc.original_filename;
      const { data: blob, error: dlErr } = await admin.storage.from("evidence").download(doc.storage_path);
      if (dlErr || !blob) {
        return NextResponse.json({ ok: false, error: "Failed to download document from storage" }, { status: 500 });
      }
      bytes = Buffer.from(await blob.arrayBuffer());
    } else {
      return NextResponse.json({ ok: false, error: "Either file or documentId must be provided" }, { status: 400 });
    }

    const tempFilePath = join(tmpdir(), `upload_${Date.now()}_${fileName}`);
    await writeFile(tempFilePath, bytes);

    let cliCommand = "auto-map";
    const cliArgs = [tempFilePath, "--year", complianceYear];

    if (mode === "proforma" || fileName.toLowerCase().includes("proforma") || fileName.toLowerCase().includes("performa")) {
      cliCommand = "parse-proforma";
    } else if (mode === "template") {
      cliCommand = "parse-template";
      cliArgs.push("--source", sourceType);
    } else if (mode === "two-stage") {
      cliCommand = "two-stage-extract";
      cliArgs.push("--source", sourceType);
    } else {
      cliCommand = "auto-map";
      cliArgs.push("--source", sourceType);
    }

        const repoRoot = resolve(process.cwd(), process.cwd().endsWith("frontend") ? ".." : ".");

    try {
      const { stdout, stderr } = await execFileAsync("python", [
        "-m",
        "services.extractor.cli",
        cliCommand,
        ...cliArgs,
      ], {
        cwd: repoRoot,
        env: { ...process.env, PYTHONPATH: repoRoot },
      });

      if (!stdout && stderr) {
        return NextResponse.json({ ok: false, error: stderr }, { status: 500 });
      }

      let result: CliExtractionOutput;
      try {
        result = JSON.parse(stdout);
      } catch {
        return NextResponse.json({ ok: false, error: `Invalid JSON from CLI: ${stdout || stderr}` }, { status: 500 });
      }

      // If auto-map returned zero readings on an arbitrary plant spreadsheet,
      // fallback to the two-stage extractor (Agent 1 layout -> Agent 2 semantic mapper)
      if (result.ok && result.readings.length === 0 && cliCommand === "auto-map") {
        try {
          const fallback = await execFileAsync("python", [
            "-m",
            "services.extractor.cli",
            "two-stage-extract",
            tempFilePath,
            "--year",
            complianceYear,
            "--source",
            sourceType,
          ], {
            cwd: repoRoot,
            env: { ...process.env, PYTHONPATH: repoRoot },
          });
          if (fallback.stdout) {
            const fallbackParsed = JSON.parse(fallback.stdout) as CliExtractionOutput;
            if (fallbackParsed.ok && fallbackParsed.readings?.length > 0) {
              result = fallbackParsed;
              cliCommand = "two-stage-extract";
            }
          }
        } catch {
          // keep original result
        }
      }

      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "CLI extraction failed" }, { status: 500 });
      }

      // Persist all extracted readings into Supabase Calendar Store
      const savedCount = await persistReadings(engagementId, result.readings, resolvedDocId);

      return NextResponse.json({
        ok: true,
        mode: cliCommand,
        extractedCount: result.count,
        savedCount,
        mappings: result.mappings,
        unmapped: result.unmapped,
        readings: result.readings,
      });
    } finally {
      // Clean up temp file
      await unlink(tempFilePath).catch(() => {});
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function persistReadings(
  engagementId: string,
  items: CliExtractionOutput["readings"],
  documentId?: string | null
): Promise<number> {
  const admin = createServiceClient();
  if (!admin) return 0;

  const { data: eng } = await admin
    .from("engagements")
    .select("organization_id")
    .eq("id", engagementId)
    .single();

  const organizationId = eng?.organization_id || "";

  let count = 0;
  for (const item of items) {
    const provBbox = item.provenance.bbox || (item.provenance.cell_coordinate ? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      sheet: item.provenance.sheet_name,
      cellRef: item.provenance.cell_coordinate,
    } : undefined);

    const sourceText = item.provenance.source_text || (item.provenance.cell_coordinate
      ? `Cell ${item.provenance.cell_coordinate} on sheet '${item.provenance.sheet_name || ""}'`
      : "Excel reading");

    const res = await saveCalendarReading(admin, {
      engagementId,
      organizationId,
      streamKey: item.stream_key,
      monthKey: item.month_key,
      readingDate: item.date_key ?? undefined,
      sourceType: item.source_type as SourceType,
      valueNumeric: item.normalized_value ?? item.raw_value,
      unit: item.normalized_unit ?? item.unit_as_printed,
      documentId: documentId ?? undefined,
      provenancePage: item.provenance.page ?? 1,
      provenanceBbox: provBbox,
      provenanceSourceText: sourceText,
    });
    if (res.ok) count++;
  }
  return count;
}
