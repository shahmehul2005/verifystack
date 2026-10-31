import Link from "next/link";
import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BulkAcceptButton } from "@/components/review/bulk-accept";
import { DeclaredForm } from "@/components/review/declared-form";
import { ComparisonTable } from "@/components/review/comparison-table";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@/lib/session";
import { loadEngagementTriage } from "@verifystack/backend/lib/data/triage";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack, packFieldTargets } from "@verifystack/backend/domain/packs";
import { isSnipProvenance } from "@verifystack/backend/domain/deskreview/snip";
import { inputStatuses, toProvenancedFact } from "@verifystack/backend/domain/calc/run";
import { ReviewWorkbench, type ReviewField } from "./review-workbench";
import type { Json } from "@verifystack/backend/lib/supabase/types";

function asBBox(raw: Json) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    x: Number(o.x ?? 0),
    y: Number(o.y ?? 0),
    width: Number(o.width ?? 0),
    height: Number(o.height ?? 0),
  };
}

export const metadata = { title: "Review workbench" };

export default async function AppWorkbenchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="The review workbench is for verifiers and reviewers." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [triage, { data: docs }, { data: factRows }] = await Promise.all([
    loadEngagementTriage(session.organizationId, id),
    supabase!
      .from("documents")
      .select("id, storage_path, mime_type, original_filename")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
    supabase!.from("facts").select("*").eq("engagement_id", id).eq("organization_id", session.organizationId),
  ]);

  const docById = new Map((docs ?? []).map((d) => [d.id, d]));

  // The workbench shows a page image with a highlighted region, so it only
  // takes page evidence. Spreadsheet, time-series and site proposals have no page
  // and are decided from the review queue, where their source is shown.
  const waiting = triage.fields.filter((f) => f.state === "suggested" || f.state === "corrected");
  const pageFields = waiting.filter(
    (f) =>
      (f.provenance_type ?? "document_page") === "document_page" &&
      f.page != null &&
      f.document_id != null
  );
  const otherWaiting = waiting.length - pageFields.length;
  const mapped: ReviewField[] = pageFields.map((f) => {
    const documentId = f.document_id as string;
    const doc = docById.get(documentId);
    const risk = triage.risk.get(f.id);
    return {
      id: f.id,
      field_path: f.field_path,
      value_json: f.value_json,
      unit: f.unit,
      confidence: Number(f.confidence),
      page: f.page ?? 1,
      bbox: asBBox(f.bbox),
      source_text: f.source_text ?? "",
      state: f.state,
      triage_action: f.triage_action,
      document_id: documentId,
      fileUrl: doc?.storage_path ? `/api/documents/${documentId}/file` : null,
      mimeType: doc?.mime_type ?? null,
      snip: isSnipProvenance(f.provenance),
      inSample: triage.sampleIds.has(f.id),
      riskReasons: risk?.tier === "high" ? risk.reasons : undefined,
    };
  });

  const { plan, comparisonSummary: cs, share } = triage;
  // Each input the methodology reads, with where it stands in the ledger, from the same check a run uses.
  const pack = loadPack(engagement.pack_id);
  const states = inputStatuses(pack, (factRows ?? []).map(toProvenancedFact), {
    draftMode: engagement.draft_mode,
    complianceYear: engagement.compliance_year,
  });
  const targets = packFieldTargets(pack).map((t) => ({ ...t, state: states[t.path] ?? ("optional" as const) }));
  // A value can be snipped from any PDF or image in the engagement, including one the model read nothing from.
  const snipDocs = (docs ?? [])
    .filter((d) => d.mime_type === "application/pdf" || d.mime_type.startsWith("image/"))
    .map((d) => ({ id: d.id, name: d.original_filename, mimeType: d.mime_type }));
  const hasLowRisk = plan.lowRiskPending > 0 || plan.sample.length > 0;

  return (
    <>
      <PageHeader
        title="Review workbench"
        description="Check each extracted value against the page it came from, then accept, correct or reject it. Only accepted values enter the facts ledger."
      />

      {hasLowRisk ? (
        <Card className="mb-6">
          <CardHeader
            title="Low-risk values"
            description={`High-materiality, low-confidence and declared-mismatch values always need a person. The rest can be accepted together once a ${Math.round(
              triage.sampleRate * 100
            )}% sample of them has been read and every sampled value passed.${
              triage.sampleRateFromPlan ? " Rate set by the approved verification plan." : " Firm default rate; the plan can set one."
            }`}
          />
          <CardBody>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-mist-500">Low-risk waiting</dt>
                <dd className="text-lg font-semibold tabular">{plan.lowRiskPending}</dd>
              </div>
              <div>
                <dt className="text-xs text-mist-500">Review sample</dt>
                <dd className="text-lg font-semibold tabular">
                  {plan.sampleDecided}/{plan.sample.length} read
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist-500">Eligible for bulk accept</dt>
                <dd className="text-lg font-semibold tabular">{plan.eligibleIds.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-mist-500">Accepted in bulk so far</dt>
                <dd className="text-lg font-semibold tabular">
                  {share.bulk}/{share.total}
                  {share.total > 0 ? (
                    <span className="ml-1 text-xs font-normal text-mist-500">
                      ({Math.round(share.bulkShare * 100)}%)
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {plan.blockedReason ? (
              <p className="mt-3 text-[13px] text-mist-600">{plan.blockedReason}</p>
            ) : null}
            <div className="mt-3">
              <BulkAcceptButton
                engagementId={id}
                count={plan.eligibleIds.length}
                disabled={!plan.canBulkAccept}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {otherWaiting > 0 ? (
        <Alert tone="info" className="mb-6" title={`${otherWaiting} value(s) from spreadsheets, time series or site visits`}>
          These have no page to show. Decide them in the{" "}
          <Link href="/review-queue" className="font-medium underline">
            review queue
          </Link>
          , where the source cell, window or observation is shown.
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader
          title="Declared and extracted"
          description={
            triage.declaredCount === 0
              ? "No figures declared by the entity yet. Import an evidence pack, or type the entity's declared figure below, to compare it with the evidence."
              : `${cs.agree} agree, ${cs.disagree} differ, ${cs.unitProblems} unit problem(s), ${cs.noEvidence} without evidence. A difference is a prompt to look, not a verdict.`
          }
          actions={
            cs.disagree + cs.unitProblems > 0 ? (
              <Badge tone="block">{cs.disagree + cs.unitProblems} to look at</Badge>
            ) : undefined
          }
        />
        <CardBody>
          <ComparisonTable rows={triage.comparisons.filter((c) => c.status !== "no_declaration")} />
          {hasCapability(session.role, "documents.upload") ? (
            <DeclaredForm engagementId={id} paths={targets} />
          ) : null}
        </CardBody>
      </Card>

      {mapped.length === 0 && snipDocs.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing waiting for review"
          body={
            (docs ?? []).length > 0
              ? "Evidence is stored, but no values have been extracted yet. Open Documents and choose Extract on a file. Each page is read and every value is recorded with where it came from."
              : "Upload evidence on Documents and run extraction, then come back here to review each value."
          }
          action={{
            href: `/engagements/${id}/documents`,
            label: (docs ?? []).length > 0 ? "Extract on Documents" : "Upload evidence",
          }}
        />
      ) : (
        <ReviewWorkbench engagementId={id} fields={mapped} documents={snipDocs} targets={targets} />
      )}
    </>
  );
}
