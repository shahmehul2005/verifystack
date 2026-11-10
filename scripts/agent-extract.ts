/**
 * Agent-Assisted Extraction CLI
 *
 * Bypasses external model quota limitations during testing and manual verification.
 * Extracts fields from uploaded documents, creates `extracted_fields` rows and
 * wires them to `canonical_evidence_values` in 'suggested' state with full provenance.
 *
 * Usage:
 *   npx tsx scripts/agent-extract.ts list <engagementId>
 *   npx tsx scripts/agent-extract.ts inspect <documentId>
 *   npx tsx scripts/agent-extract.ts inject <documentId> <jsonPayloadFileOrString>
 */

import { config } from "dotenv";
config({ path: "frontend/.env.local" });
config({ path: ".env" });

import { createServiceClient } from "../backend/lib/supabase/admin";
import { readPdfText } from "../backend/domain/extraction/pdfText";
import { registryForPack } from "../backend/domain/registry";
import { annotateDocument, registryColumns } from "../backend/domain/registry/annotate";
import { createCevFromExtraction } from "../backend/domain/evidence";
import type { CevPeriodKind } from "../backend/domain/evidence/types";
import { loadPack } from "../backend/domain/packs";
import type { Json } from "../backend/lib/supabase/types";

function cevPeriodKind(
  periodStart: string | null,
  periodEnd: string | null,
  periodStatus: "known" | "unknown" | null
): CevPeriodKind {
  if (!periodStart || !periodEnd || periodStatus !== "known") return "document_period";
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days <= 1) return "single_reading";
  if (days <= 2) return "daily";
  if (days <= 35) return "monthly";
  if (days <= 100) return "quarterly";
  return "annual";
}

export interface ExtractedFieldInput {
  fieldPath: string;
  value: number | string;
  unit?: string | null;
  confidence?: number;
  page?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  sourceText?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const admin = createServiceClient();
  if (!admin) {
    console.error("Supabase service client not available. Check SUPABASE_SERVICE_ROLE in .env.local");
    process.exit(1);
  }

  if (command === "list") {
    const engagementId = args[1];
    if (!engagementId) {
      console.error("Usage: npx tsx scripts/agent-extract.ts list <engagementId>");
      process.exit(1);
    }
    const { data: docs, error } = await admin
      .from("documents")
      .select("id, original_filename, mime_type, doc_type, page_count, created_at")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to list documents:", error.message);
      process.exit(1);
    }
    console.log(`\nDocuments in engagement ${engagementId}:`);
    console.table(docs);
    return;
  }

  if (command === "inspect") {
    const documentId = args[1];
    if (!documentId) {
      console.error("Usage: npx tsx scripts/agent-extract.ts inspect <documentId>");
      process.exit(1);
    }
    const { data: doc, error } = await admin.from("documents").select("*").eq("id", documentId).single();
    if (error || !doc) {
      console.error("Document not found:", error?.message);
      process.exit(1);
    }
    console.log(`\nDocument: ${doc.original_filename} (${doc.mime_type})`);
    console.log(`ID: ${doc.id}`);
    console.log(`Doc type: ${doc.doc_type ?? "(unclassified)"}`);
    console.log(`Storage path: ${doc.storage_path}`);

    if (doc.mime_type === "application/pdf") {
      const { data: file, error: downloadErr } = await admin.storage.from("evidence").download(doc.storage_path);
      if (downloadErr || !file) {
        console.error("Failed to download PDF:", downloadErr?.message);
        return;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const pages = await readPdfText(buf);
      console.log(`\nExtracted text from ${pages.length} page(s):`);
      for (const p of pages) {
        console.log(`\n--- Page ${p.page} ---`);
        console.log(p.lines.slice(0, 30).join("\n"));
        if (p.lines.length > 30) console.log(`... and ${p.lines.length - 30} more lines`);
      }
    }
    return;
  }

  if (command === "inject") {
    const documentId = args[1];
    const payloadRaw = args[2];
    if (!documentId || !payloadRaw) {
      console.error("Usage: npx tsx scripts/agent-extract.ts inject <documentId> '<jsonPayload>'");
      process.exit(1);
    }

    const { data: doc, error: docErr } = await admin.from("documents").select("*").eq("id", documentId).single();
    if (docErr || !doc) {
      console.error("Document not found:", docErr?.message);
      process.exit(1);
    }

    const { data: engagement, error: engErr } = await admin
      .from("engagements")
      .select("id, organization_id, pack_id")
      .eq("id", doc.engagement_id)
      .single();
    if (engErr || !engagement) {
      console.error("Engagement not found:", engErr?.message);
      process.exit(1);
    }

    let fields: ExtractedFieldInput[];
    try {
      if (payloadRaw.endsWith(".json")) {
        const { readFileSync } = await import("fs");
        fields = JSON.parse(readFileSync(payloadRaw, "utf8"));
      } else {
        fields = JSON.parse(payloadRaw);
      }
    } catch {
      console.error("Failed to parse JSON payload. Provide valid JSON array of ExtractedFieldInput or a path to a .json file.");
      process.exit(1);
    }

    // Set up extraction job record
    const { data: job } = await admin
      .from("extraction_jobs")
      .insert({
        organization_id: engagement.organization_id,
        document_id: doc.id,
        status: "done",
        route: "assisted",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const jobId = job?.id ?? null;

    // Registry annotation
    const pack = loadPack(engagement.pack_id);
    const registry = registryForPack(pack.id);
    const docType = (doc.doc_type ?? "fuel_invoice") as import("../backend/domain/extraction/schemas").DocType;

    const annotations = annotateDocument(
      registry,
      docType,
      fields.map((f) => ({ fieldPath: f.fieldPath, value: f.value }))
    );

    console.log(`\nInjecting ${fields.length} extracted field(s) into engagement ${engagement.id}...`);

    for (const f of fields) {
      const page = f.page ?? 1;
      const bbox = f.bbox ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.05 };
      const sourceText = f.sourceText ?? String(f.value);
      const confidence = f.confidence ?? 0.95;

      const baseRow = {
        organization_id: engagement.organization_id,
        extraction_job_id: jobId,
        document_id: doc.id,
        engagement_id: engagement.id,
        field_path: f.fieldPath,
        value_json: f.value as Json,
        unit: f.unit ?? null,
        confidence,
        page,
        bbox,
        source_text: sourceText,
        triage_action: "human_review" as const,
        state: "suggested" as const,
      };

      const annotation = annotations.get(f.fieldPath);
      const rowToInsert = annotation ? { ...baseRow, ...registryColumns(annotation) } : baseRow;

      const { data: insertedField, error: insErr } = await admin
        .from("extracted_fields")
        .insert(rowToInsert)
        .select("id")
        .single();

      if (insErr) {
        console.error(`Failed to insert extracted field ${f.fieldPath}:`, insErr.message);
        continue;
      }

      console.log(`  ✓ Extracted field: ${f.fieldPath} = ${f.value} ${f.unit ?? ""}`);

      // Create CEV if canonical key exists
      if (annotation?.canonicalKey && insertedField?.id) {
        try {
          const pk = cevPeriodKind(annotation.periodStart, annotation.periodEnd, annotation.periodStatus);
          const rawNum = typeof f.value === "number" ? f.value : parseFloat(String(f.value).replace(/,/g, ""));
          const valNum = Number.isFinite(rawNum) ? rawNum : undefined;

          const cev = await createCevFromExtraction({
            organization_id: engagement.organization_id,
            engagement_id: engagement.id,
            canonical_key: annotation.canonicalKey,
            registry_version: annotation.registryVersion,
            document_id: doc.id,
            extracted_field_id: insertedField.id,
            period_kind: pk,
            period_start: annotation.periodStart ?? undefined,
            period_end: annotation.periodEnd ?? undefined,
            value_numeric: valNum,
            value_unit: f.unit ?? undefined,
            value_as_stated: String(f.value),
            confidence,
            provenance_page: page,
            provenance_bbox: bbox,
            provenance_source_text: sourceText,
            document_file_hash: doc.sha256 ?? "sha256-assisted",
            extraction_params: JSON.stringify({ mode: "assisted" }),
            prompt_version: "2026-agent-assisted",
          });

          console.log(`    → Created CEV: ${cev.canonical_key} (${pk}) state=${cev.state}`);
        } catch (cevErr) {
          console.error(`    ✗ Could not create CEV for ${annotation.canonicalKey}:`, (cevErr as Error).message);
        }
      }
    }

    console.log("\nDone! Fields and CEVs are ready in the Review Workbench.\n");
    return;
  }

  console.log(`
Agent-Assisted Extraction CLI
Commands:
  list <engagementId>                       - List documents in an engagement
  inspect <documentId>                      - Read PDF text and inspect document
  inject <documentId> '<jsonPayload>'       - Inject extracted fields & wire CEVs
`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
