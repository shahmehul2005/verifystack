import { notFound } from "next/navigation";
import { FileImage, FileSpreadsheet, FileText, Upload } from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isGeminiConfigured, isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { isBatchable } from "@verifystack/backend/domain/extraction/classifyBatch";
import { needsExtraction } from "@verifystack/backend/domain/extraction/extractRunner";
import { getEngagement } from "@/lib/session";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { canStartWork, loadPack, packFieldTargets } from "@verifystack/backend/domain/packs";
import { CSV_MIME, XLSX_MIME } from "@verifystack/backend/lib/evidence";
import type { ScanAssessment } from "@verifystack/backend/domain/intake/scan";
import { formatBytes, formatIst } from "@/lib/format";
import { UploadForm } from "./upload-form";
import { ClassifyAllButton } from "./classify-all-button";
import { ExtractAllButton } from "./extract-all-button";
import { ExtractButton } from "./extract-button";
import { TableMapper, type DatasetView } from "./table-mapper";
import { SlotChecklist } from "./slot-checklist";
import { SummaryReviewButton } from "./summary-review";
import { ProformaReviewButton } from "./proforma-review";
import { DocTypeSelector } from "./doc-type-selector";
import { DocRow } from "./doc-row";
import { PdfInlineViewer } from "./pdf-viewer";

export const metadata = { title: "Documents" };

const SOURCE_LABEL: Record<string, string> = {
  upload: "Uploaded",
  evidence_pack: "Evidence pack",
  entity_response: "Entity response",
  fieldwork: "Fieldwork",
};

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "documents.view")) {
    return <ForbiddenState body="Document intake is handled by verifiers and the lead verifier." />;
  }
  const canUpload = hasCapability(session.role, "documents.upload");
  const canExtract = hasCapability(session.role, "documents.extract");
  const canDecide = hasCapability(session.role, "review.decide");
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const pack = loadPack(engagement.pack_id);
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [{ data: docs }, { data: datasets }] = await Promise.all([
    supabase!
      .from("documents")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false }),
    supabase!
      .from("tabular_datasets")
      .select("id, document_id, kind, name, row_count, summary")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
  ]);

  // Files still to read: PDFs and images with no finished, running or waiting extraction job. A failed one is tried again.
  const readable = (docs ?? []).filter((d) => d.mime_type === "application/pdf" || d.mime_type.startsWith("image/"));
  const { data: jobs } = readable.length
    ? await supabase!
        .from("extraction_jobs")
        .select("document_id, status")
        .eq("organization_id", session.organizationId)
        .in("document_id", readable.map((d) => d.id))
    : { data: [] };
  const toExtract = needsExtraction(readable, jobs ?? []).map((d) => ({ id: d.id, name: d.original_filename }));

  // Files with no type yet that the model can read: PDF, PNG and JPEG. Spreadsheets are typed by hand.
  const unassigned = (docs ?? [])
    .filter((d) => !d.doc_type && isBatchable(d.mime_type))
    .map((d) => ({ id: d.id, mimeType: d.mime_type, byteSize: d.byte_size }));

  const isAdeetie = engagement.scheme === "ADEETIE";
  const targets = packFieldTargets(pack);
  const slots = pack.evidence_slots ?? [];
  const hasProforma = (pack.proforma_inputs?.length ?? 0) > 0;
  const datasetsByDoc = new Map<string, DatasetView[]>();
  for (const d of datasets ?? []) {
    const list = datasetsByDoc.get(d.document_id) ?? [];
    list.push({ id: d.id, kind: d.kind, name: d.name, rowCount: d.row_count, summary: d.summary });
    datasetsByDoc.set(d.document_id, list);
  }
  const columns = isAdeetie ? 9 : 8;

  return (
    <>
      <PageHeader
        title="Documents"
        description={
          isAdeetie && engagement.adeetie_phase
            ? `New uploads are tagged ${engagement.adeetie_phase}. Baseline SEC reads IGEA evidence; post-implementation SEC reads M&V evidence.`
            : "Upload stores each file first and reads nothing. Extract reads a PDF when you ask for it. Spreadsheets and CSV files are mapped cell by cell or window by window. Every value keeps its source."
        }
        actions={
          canUpload ? (
            <div className="flex flex-wrap items-start justify-end gap-3">
              {canExtract && toExtract.length > 0 ? <ExtractAllButton engagementId={id} candidates={toExtract} configured={isGeminiConfigured()} /> : null}
              {unassigned.length > 0 ? <ClassifyAllButton engagementId={id} candidates={unassigned} configured={isGeminiConfigured()} /> : null}
              <UploadForm engagementId={id} disabled={!canStartWork(pack)} />
            </div>
          ) : undefined
        }
      />
      {slots.length > 0 ? (
        <SlotChecklist
          engagementId={id}
          slots={slots}
          documents={(docs ?? []).map((d) => ({ id: d.id, name: d.original_filename, slot: d.slot }))}
          canEdit={canUpload}
        />
      ) : null}
      {!docs?.length ? (
        <EmptyState
          icon={Upload}
          title="No evidence yet"
          body="Upload a bill, invoice, lab certificate, production log, spreadsheet or SCADA export, or import an evidence pack from the entity. PDF, PNG, JPEG, WebP, XLSX or CSV, up to 50 MB."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="min-w-[260px] max-w-[340px]">File</Th>
              <Th>Type</Th>
              <Th className="text-right">Pages</Th>
              {isAdeetie ? <Th>Phase</Th> : null}
              <Th>Source</Th>
              <Th>Fingerprint</Th>
              <Th className="text-right">Size</Th>
              <Th>Received</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const isTable = d.mime_type === XLSX_MIME || d.mime_type === CSV_MIME;
              const isPdf = d.mime_type === "application/pdf" || d.original_filename.toLowerCase().endsWith(".pdf");
              const Icon = isTable
                ? FileSpreadsheet
                : d.mime_type?.startsWith("image/")
                  ? FileImage
                  : FileText;
              const scan = d.scan_assessment as ScanAssessment | null;
              const ds = datasetsByDoc.get(d.id) ?? [];
              return (
                <DocRow
                  key={d.id}
                  documentId={d.id}
                  filename={d.original_filename}
                  columns={columns}
                  hasMapper={isTable && canExtract && ds.length > 0}
                  isPdf={isPdf}
                  canDelete={canUpload}
                  actions={
                    <>
                      {canExtract && !isTable ? <ExtractButton documentId={d.id} engagementId={id} /> : null}
                      {canDecide && hasProforma && (d.slot === "proforma_workbook" || d.doc_type === "proforma_workbook" || /pro-?forma/i.test(d.original_filename)) && d.mime_type === XLSX_MIME ? (
                        <ProformaReviewButton documentId={d.id} documentName={d.original_filename} engagementId={id} />
                      ) : null}
                      {isTable && canDecide ? (
                        <SummaryReviewButton
                          documentId={d.id}
                          documentName={d.original_filename}
                          engagementId={id}
                          targets={targets}
                        />
                      ) : null}
                    </>
                  }
                  mapper={
                    isTable && canExtract && ds.length > 0 ? (
                      <TableMapper documentId={d.id} datasets={ds} targets={targets} />
                    ) : null
                  }
                  pdfViewer={
                    isPdf ? (
                      <PdfInlineViewer documentId={d.id} filename={d.original_filename} pageCount={d.page_count} />
                    ) : null
                  }
                >
                  <Td className="min-w-[260px] max-w-[340px]">
                    <span className="flex items-start gap-2.5">
                      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-mist-400" />
                      <span className="min-w-0">
                        <span className="break-words font-medium text-mist-900" title={d.original_filename}>{d.original_filename}</span>
                        {scan && scan.quality !== "ok" && scan.quality !== "unknown" ? (
                          <span
                            className={`mt-1 block text-xs ${scan.quality === "poor" ? "text-red-700" : "text-amber-700"}`}
                          >
                            Scan check: {scan.issues.join(" ")}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <DocTypeSelector
                      documentId={d.id}
                      currentType={d.doc_type}
                      confidence={d.classification_confidence ? Number(d.classification_confidence) : null}
                      taxonomy={pack.document_taxonomy ?? []}
                      canEdit={canUpload}
                      isTable={isTable}
                      slotLabel={slots.find((s) => s.id === d.slot)?.label ?? null}
                    />
                  </Td>
                  <Td className="text-right tabular">{isTable ? "—" : (d.page_count ?? "—")}</Td>
                  {isAdeetie ? (
                    <Td>
                      {d.adeetie_phase ? (
                        <Badge tone="ink">{d.adeetie_phase}</Badge>
                      ) : (
                        <Badge tone="draft">Untagged</Badge>
                      )}
                    </Td>
                  ) : null}
                  <Td>
                    <Badge tone={d.source === "entity_response" ? "ai" : "neutral"}>
                      {SOURCE_LABEL[d.source] ?? d.source}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-mist-600" title={d.sha256}>
                      {d.sha256.slice(0, 12)}…
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular">{formatBytes(d.byte_size)}</Td>
                  <Td className="whitespace-nowrap text-xs text-mist-600">{formatIst(d.created_at)}</Td>
                </DocRow>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}