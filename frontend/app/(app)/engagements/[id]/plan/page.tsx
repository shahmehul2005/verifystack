import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadEngagementTriage } from "@verifystack/backend/lib/data/triage";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import {
  PlanContentSchema,
  RISK_FACTORS,
  assessPlan,
  deriveAutoFactors,
  planApprovalBlockers,
  type PlanContent,
} from "@verifystack/backend/domain/planning/plan";
import { formatIst, humanize } from "@/lib/format";
import { PlanEditor, type PlanDraft } from "./plan-editor";

export const metadata = { title: "Verification plan" };

const EMPTY: PlanContent = { factors: [], visits: [] };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "runs.view")) {
    return <ForbiddenState body="The verification plan is for verifiers and reviewers." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const canManage = hasCapability(session.role, "plan.manage");

  const db = createServiceClient() ?? (await createServerSupabase());
  const [{ data: versions }, triage] = await Promise.all([
    db!
      .from("verification_plans")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("version", { ascending: false }),
    loadEngagementTriage(session.organizationId, id),
  ]);

  const latest = versions?.[0] ?? null;
  const parsed = latest ? PlanContentSchema.safeParse(latest.content) : null;
  const content = parsed?.success ? parsed.data : EMPTY;
  const auto = deriveAutoFactors({
    comparison: { compared: triage.comparisonSummary.compared, disagree: triage.comparisonSummary.disagree },
  });
  const assessment = assessPlan(content, auto);
  const blockers = latest ? planApprovalBlockers(content, auto) : [];
  const approved = versions?.find((v) => v.status === "approved") ?? null;

  return (
    <>
      <PageHeader
        title="Verification plan"
        description="Decide how hard to look before reading the evidence: rate each risk factor and say why, then see the sampling rate and site-visit recommendation that follow. The approved plan's sampling rate drives bulk accept in the workbench."
        meta={
          latest ? (
            <>
              <Badge tone={latest.status === "approved" ? "ok" : "draft"} dot>
                v{latest.version} {latest.status}
              </Badge>
              <span className="text-xs text-mist-500">{formatIst(latest.created_at)}</span>
            </>
          ) : (
            <Badge tone="draft">No plan yet</Badge>
          )
        }
      />

      {latest ? (
        <Card className="mb-6">
          <CardHeader
            title="Assessment"
            description="Overall risk is the highest rating of any factor. Rates are firm policy defaults, not scheme requirements."
          />
          <CardBody>
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-mist-500">Overall risk</dt>
                <dd className="text-lg font-semibold capitalize">{assessment.overall}</dd>
              </div>
              <div>
                <dt className="text-xs text-mist-500">Review sampling rate</dt>
                <dd className="text-lg font-semibold tabular">
                  {Math.round(assessment.sampleRate * 100)}%
                  <span className="ml-1 text-xs font-normal text-mist-500">{assessment.sampleRateSource}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist-500">Site visit</dt>
                <dd className="text-lg font-semibold">
                  {assessment.siteVisitRecommended
                    ? content.siteVisitWaiverReason
                      ? "Waived"
                      : "Recommended"
                    : "Not needed"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mist-500">Approved plan</dt>
                <dd className="text-lg font-semibold">{approved ? `v${approved.version}` : "None"}</dd>
              </div>
            </dl>
            {assessment.siteVisitReasons.length > 0 ? (
              <p className="mt-3 text-[13px] text-mist-600">{assessment.siteVisitReasons.join(" ")}</p>
            ) : null}
            {auto.length > 0 ? (
              <ul className="mt-3 space-y-1 text-[13px] text-mist-700">
                {auto.map((a) => (
                  <li key={a.key}>
                    <Badge tone={a.rating === "high" ? "block" : a.rating === "medium" ? "draft" : "ok"}>
                      {humanize(a.rating)}
                    </Badge>{" "}
                    <span className="font-medium">{a.label}:</span> {a.rationale}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {latest?.status === "draft" && blockers.length > 0 ? (
        <Alert tone="warn" title="Before this can be approved" className="mb-6">
          <ul className="list-disc pl-4">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {canManage ? (
        <Card className="mb-6">
          <CardHeader title="Edit plan" description="Saving creates a new version; earlier versions are kept." />
          <CardBody>
            <PlanEditor
              engagementId={id}
              defs={RISK_FACTORS.map((f) => ({ key: f.key, label: f.label, prompt: f.prompt }))}
              initial={content as PlanDraft}
              latestStatus={latest ? latest.status : null}
              canApprove={canManage}
            />
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info" className="mb-6">
          Only the lead verifier edits and approves the plan. This page shows the latest version.
        </Alert>
      )}

      {versions && versions.length > 0 ? (
        <Card>
          <CardHeader title="Versions" />
          <CardBody>
            <ul className="divide-y divide-mist-100 text-[13px]">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">v{v.version}</span>
                  <Badge tone={v.status === "approved" ? "ok" : "draft"}>{v.status}</Badge>
                  <span className="text-mist-600 capitalize">{v.overall_risk} risk</span>
                  <span className="text-mist-600 tabular">{Math.round(Number(v.sample_rate) * 100)}% sample</span>
                  <span className="font-mono text-xs text-mist-500" title={v.content_hash}>
                    {v.content_hash.slice(0, 10)}…
                  </span>
                  <span className="ml-auto text-xs text-mist-500">{formatIst(v.created_at)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
