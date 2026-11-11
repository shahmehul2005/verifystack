import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const complianceYear = searchParams.get("year") || "2023-24";

  const tempOutputPath = join(tmpdir(), `template_${Date.now()}.xlsx`);

  try {
    await execFileAsync("python", [
      "-m",
      "services.extractor.cli",
      "generate-template",
      tempOutputPath,
      "--year",
      complianceYear,
    ]);

    const fileBuffer = await readFile(tempOutputPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="verifystack_calendar_template_${complianceYear}.xlsx"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    await unlink(tempOutputPath).catch(() => {});
  }
}

