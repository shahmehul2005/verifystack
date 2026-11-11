import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const engagementId = formData.get("engagementId") as string | null;
    const mode = (formData.get("mode") as string) || "auto-map"; // "proforma" | "template" | "auto-map"
    const complianceYear = (formData.get("complianceYear") as string) || "2023-24";
    const sourceType = (formData.get("sourceType") as string) || "corroboration";

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }
    if (!engagementId) {
      return NextResponse.json({ ok: false, error: "engagementId is required" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const tempFilePath = join(tmpdir(), `upload_${Date.now()}_${file.name}`);
    await writeFile(tempFilePath, bytes);

    let cliCommand = "auto-map";
    const cliArgs = [tempFilePath, "--year", complianceYear];

    if (mode === "proforma" || file.name.toLowerCase().includes("proforma") || file.name.toLowerCase().includes("performa")) {
      cliCommand = "parse-proforma";
    } else if (mode === "template") {
      cliCommand = "parse-template";
      cliArgs.push("--source", sourceType);
    } else {
      cliCommand = "auto-map";
      cliArgs.push("--source", sourceType);
    }

    try {
      const { stdout } = await execFileAsync("python", [
        "-m",
        "services.extractor.cli",
        cliCommand,
        ...cliArgs,
      ]);

      const result: CliExtractionOutput = JSON.parse(stdout);

      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error || "CLI extraction failed" }, { status: 500 });
      }

      // Persist all extracted readings into Supabase Calendar Store
      const savedCount = await persistReadings(engagementId, result.readings);

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
  items: CliExtractionOutput["readings"]
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
    const res = await saveCalendarReading(admin, {
      engagementId,
      organizationId,
      streamKey: item.stream_key,
      monthKey: item.month_key,
      sourceType: item.source_type as SourceType,
      valueNumeric: item.normalized_value ?? item.raw_value,
      unit: item.normalized_unit ?? item.unit_as_printed,
      provenancePage: item.provenance.page,
      provenanceBbox: item.provenance.bbox,
      provenanceSourceText: item.provenance.source_text,
    });
    if (res.ok) count++;
  }
  return count;
}
