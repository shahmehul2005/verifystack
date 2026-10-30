import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getSession, getEngagement } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat";
import {
  PERIOD_MONTHS,
  deskReviewFor,
  inferSlot,
  readWorkbooks,
  runDeskReview,
  slotCoverage,
  type DeskOutcome,
  type DeskStatus,
  type DeskWorkbook,
  type Readings,
  type ResolutionState,
  type SlotCoverage,
} from "@verifystack/backend/domain/deskreview";
import { BLOCK_IDS } from "@verifystack/backend/domain/deskreview/toFindings";
import { parseRegion } from "@verifystack/backend/domain/deskreview/snip";
import { parseXlsx } from "@verifystack/backend/domain/intake/xlsx";
import { readProforma, type ProformaReading } from "@verifystack/backend/domain/proforma/reader";
import { loadPack } from "@verifystack/backend/domain/packs";
import { XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { DeskReviewStudio, type TriageFinding, type TriageResolution } from "./desk-review-client";

export const metadata = { title: "Desk review" };

const COVERAGE_TONE: Record<SlotCoverage["state"], BadgeTone> = { present: "ok", partial: "draft", missing: "neutral" };

const tonnes = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} tCO2e`;
export default async function DeskReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="Desk review is for verifiers and the lead verifier." />;
  }
  // The decision route also needs findings.decide, because a decision lands on a finding.
  const canDecide = hasCapability(session.role, "findings.decide");
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const def = deskReviewFor(engagement.pack_id);
  if (!def) notFound();

  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [{ data: review }, { data: readings }, { data: docs }, resolutionRows, { data: deskFindings }] = await Promise.all([
    supabase!
      .from("desk_reviews")
      .select("id, results, readings, notes, created_at")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase!.from("desk_readings").select("key, value, document_id, page, bbox, source_text").eq("engagement_id", id).eq("organization_id", session.organizationId),
    supabase!.from("documents").select("id, original_filename, slot, doc_type, storage_path, mime_type").eq("engagement_id", id).eq("organization_id", session.organizationId),
    supabase!
      .from("desk_resolutions")
      .select("rule_id, resolution_state, reason, decided_at")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
    supabase!
      .from("findings")
      .select("id, rule_id, state, severity")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .like("rule_id", "DESK-%"),
  ]);
  // Without migration 0019 the table is absent. The checks still show; decisions wait.
  const resolutionsAvailable = !resolutionRows.error;
  const resolutions: Record<string, TriageResolution> = {};
  for (const r of resolutionRows.data ?? []) {
    resolutions[r.rule_id] = { state: r.resolution_state as ResolutionState, reason: r.reason, decidedAt: r.decided_at };
  }
  const findingFor: Record<string, TriageFinding> = {};
  for (const f of deskFindings ?? []) findingFor[f.rule_id] = { id: f.id, state: f.state, severity: f.severity };

  let results = ((review?.results ?? []) as unknown as DeskOutcome[]) ?? [];
  let notes = ((review?.notes ?? []) as unknown as string[]) ?? [];

  // Attempt to read the pro-forma workbook and evidence workbooks if present in evidence slots
  const resolvedDocs = (docs ?? []).map((d) => ({
    ...d,
    effectiveSlot: d.slot ?? inferSlot({ name: d.original_filename, slot: d.slot, docType: d.doc_type }),
  }));

  // Attempt to read the pro-forma workbook and evidence workbooks if present in evidence slots
  const proformaDoc = resolvedDocs.find((d) => d.effectiveSlot === "proforma_workbook" || /pro-?forma/i.test(d.original_filename));
  let proformaReading: ProformaReading | null = null;
  const proformaFileName = proformaDoc?.original_filename ?? null;

  const xlsxDocs = resolvedDocs.filter((d) => d.mime_type === XLSX_MIME && d.effectiveSlot && d.storage_path);
  let workbookReadings: Readings = {};

  if (xlsxDocs.length > 0) {
    try {
      const files: DeskWorkbook[] = (
        await Promise.all(
          xlsxDocs.map(async (d): Promise<DeskWorkbook | null> => {
            const { data: blob } = await supabase!.storage.from("evidence").download(d.storage_path);
            if (!blob) return null;
            return { slot: d.effectiveSlot as string, name: d.original_filename, bytes: new Uint8Array(await blob.arrayBuffer()) };
          })
        )
      ).filter((f): f is DeskWorkbook => f !== null);

      const proformaFile = files.find((f) => f.slot === "proforma_workbook");
      if (proformaFile) {
        const wb = parseXlsx(proformaFile.bytes);
        proformaReading = readProforma(wb, def.proformaCells);
      }

      const wbResult = readWorkbooks(def, files, loadPack(engagement.pack_id).proforma_inputs ?? []);
      workbookReadings = wbResult.readings;
      if (notes.length === 0) notes = wbResult.notes;
    } catch {
      // Advisory read only
    }
  }

  // If no desk review run has been recorded in the database yet, run live evaluation so the auditor sees all checks!
  if (results.length === 0) {
    const allReadings: Readings = { ...workbookReadings };
    for (const r of readings ?? []) {
      allReadings[r.key] = Number(r.value);
    }
    results = runDeskReview(def, allReadings);
  }

  const count = (st: DeskStatus) => results.filter((r) => r.status === st).length;
  const seen = (review?.readings ?? {}) as unknown as Readings;
  const pack = loadPack(engagement.pack_id);
  const coverage = slotCoverage(
    def,
    (pack.evidence_slots ?? []).map((s) => ({ id: s.id, label: s.label, gate: s.gate })),
    resolvedDocs.map((d) => ({ slot: d.effectiveSlot })),
    seen
  );
  const materiality = review ? (def.materiality?.(seen, results) ?? null) : null;
  const unresolvedHolds = (deskFindings ?? []).filter(
    (f) => f.severity === "block" && f.state !== "closed" && f.state !== "rejected"
  ).length;

  return (
    <>
      <PageHeader
        kicker="Verification"
        title="Desk review"
        description="Cross-checks between primary evidence and sector pro-forma inputs. Code recomputes formulas deterministically; AI proposes readings with mandatory auditor sign-off."
      />

      {review ? (
        <p className="text-xs text-mist-600">
          {results.length} checks: {count("pass")} agree, {count("fail")} disagree, {count("pending")} waiting for readings,{" "}
          {count("not_applicable")} cannot be decided. {notes.length} reading note{notes.length === 1 ? "" : "s"}.{" "}
          {(readings ?? []).length} figure{(readings ?? []).length === 1 ? "" : "s"} typed from PDFs.
        </p>
      ) : null}

      {review ? (
        <>
      <Card>
        <CardHeader
          title="Materiality and completeness"
          description="What the checks could put a number on, against 2% of what the entity reported, and which evidence is missing or covers only part of the year."
        />
        <CardBody className="space-y-4">
          {materiality ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Reported total" value={tonnes(materiality.reportedTotal)} />
              <StatTile label={`${materiality.fraction * 100}% threshold`} value={tonnes(materiality.threshold)} />
              <StatTile
                label="Quantified misstatement"
                value={tonnes(materiality.quantified)}
                tone={materiality.quantified > materiality.threshold ? "block" : "ok"}
              />
              <StatTile
                label="Sign-off held by"
                value={unresolvedHolds === 0 ? "Nothing" : `${unresolvedHolds} finding${unresolvedHolds === 1 ? "" : "s"}`}
                tone={unresolvedHolds === 0 ? "ok" : "block"}
              />
            </div>
          ) : (
            <p className="text-sm text-mist-600">The pro forma was not read in this run, so there is no materiality position yet.</p>
          )}
          {materiality && materiality.limitations.length > 0 ? (
            <Alert tone="warn" title="The total is incomplete">
              <ul className="list-disc space-y-0.5 pl-4">
                {materiality.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {coverage.map((c) => (
              <li key={c.slot} className="flex items-center justify-between gap-3 rounded-md border border-mist-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-mist-900">{c.label}</p>
                  <p className="text-[11px] text-mist-500">
                    {c.documents} document{c.documents === 1 ? "" : "s"}
                    {c.months !== null ? ` · ${c.months} of ${PERIOD_MONTHS} months` : ""}
                  </p>
                </div>
                <Badge tone={c.state === "missing" && c.gate === "run" ? "block" : COVERAGE_TONE[c.state]} dot>
                  {c.state === "missing" ? "Missing" : c.state === "partial" ? "Part of the year" : "Present"}
                </Badge>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
        </>
      ) : null}

      <DeskReviewStudio
        engagementId={id}
        packId={engagement.pack_id}
        rules={def.rules.map((r) => ({
          id: r.id,
          section: r.section,
          label: r.label,
          needs: r.needs,
        }))}
        manualSpecs={def.manual}
        initialResults={results}
        initialNotes={notes}
        savedReadings={(readings ?? []).map((r) => ({
          key: r.key,
          value: Number(r.value),
          documentId: r.document_id,
          page: r.page,
          bbox: parseRegion(r.bbox),
          sourceText: r.source_text,
        }))}
        docs={(docs ?? []).map((d) => ({
          id: d.id,
          name: d.original_filename,
          slot: d.slot ?? inferSlot({ name: d.original_filename, slot: d.slot, docType: d.doc_type }),
          docType: d.doc_type,
          mimeType: d.mime_type,
        }))}
        proforma={proformaReading}
        proformaFileName={proformaFileName}
        lastRunAt={review?.created_at ?? null}
        canDecide={canDecide}
        resolutions={resolutions}
        deskFindings={findingFor}
        blockIds={[...BLOCK_IDS]}
        resolutionsAvailable={resolutionsAvailable}
        hasSavedRun={Boolean(review)}
        materiality={materiality}
      />
    </>
  );
}
