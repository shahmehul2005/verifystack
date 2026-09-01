import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { GeminiExtractionProvider } from "@verifystack/backend/domain/extraction/gemini";
import {
  DOC_SCHEMAS,
  isExtractable,
  triageFields,
  type DocType,
} from "@verifystack/backend/domain/extraction/schemas";
import type { DocumentPage } from "@verifystack/backend/domain/extraction/provider";

export const runtime = "nodejs";

const Body = z.object({
  evidenceId: z.string().min(1).max(80),
  pageNumber: z.number().int().positive().default(1),
  mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]),
  data: z.string().min(20),
  docType: z
    .enum([
      "fuel_invoice",
      "tax_invoice",
      "electricity_bill",
      "lab_certificate",
      "production_log",
      "weighbridge_slip",
      "monitoring_plan",
      "unknown",
    ])
    .optional(),
});

/**
 * Ad-hoc single-page extraction for the standalone workbench.
 *
 * This calls a paid model on caller-supplied bytes, so it is gated on the same
 * capability as extraction inside an engagement (P3). The workbench's seeded
 * demo still renders without a session; only live extraction needs one.
 */
export async function POST(req: Request) {
  try {
    await requireCapability("documents.extract");
  } catch (e) {
    return jsonError(e);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "GEMINI_API_KEY is not set. The seeded workbench still runs without it. Add the key to .env.local to try live extraction.",
      },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const page: DocumentPage = {
    evidenceId: parsed.data.evidenceId,
    pageNumber: parsed.data.pageNumber,
    mimeType: parsed.data.mimeType,
    data: parsed.data.data.replace(/^data:[^;]+;base64,/, ""),
  };

  const provider = new GeminiExtractionProvider({
    apiKey,
    model: process.env.GEMINI_MODEL || undefined,
  });

  const classified = await provider.classify(page);
  if (!classified.ok || !classified.data) {
    return NextResponse.json({
      ok: false,
      stage: "classify",
      validationErrors: classified.validationErrors,
      log: classified.log,
    });
  }

  const docType = (parsed.data.docType ?? classified.data.docType) as DocType;
  if (!isExtractable(docType)) {
    return NextResponse.json({
      ok: true,
      classification: classified.data,
      extraction: null,
      message: `Classified as ${docType}; no extraction schema for this type in the prototype.`,
      log: classified.log,
    });
  }

  const extracted = await provider.extract(page, docType, DOC_SCHEMAS[docType]);
  const triage =
    extracted.ok && extracted.data ? triageFields(extracted.data) : [];

  return NextResponse.json({
    ok: extracted.ok,
    classification: classified.data,
    extraction: extracted.data ?? null,
    triage,
    validationErrors: extracted.validationErrors,
    logs: [classified.log, extracted.log],
  });
}
