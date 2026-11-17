import { NextRequest, NextResponse } from "next/server";

import { fiscalStartYear } from "@verifystack/backend/domain/calendar/months";
import { extractorClient, isExtractorConfigured } from "@verifystack/backend/lib/extractor/client";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("year") || "2023-24";
  const startYear = fiscalStartYear(raw);
  if (startYear === null) {
    return NextResponse.json({ ok: false, error: "Invalid year" }, { status: 400 });
  }
  const year = `FY${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

  if (!isExtractorConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Extractor service is not configured. Set EXTRACTOR_URL and EXTRACTOR_API_KEY." },
      { status: 503 },
    );
  }

  const result = await extractorClient.template(year);
  if (!result.ok) {
    const { kind } = result.error;
    const status = kind === "not_configured" ? 503 : kind === "timeout" ? 504 : 502;
    return NextResponse.json({ ok: false, error: result.error.message }, { status });
  }

  return new NextResponse(result.data.bytes, {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="verifystack_calendar_template_${year}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
