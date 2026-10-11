import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { formatIst } from "@/lib/format";
import { PROVENANCE_LABEL, factLabel } from "@verifystack/backend/domain/provenance";
import { QueueActions } from "./queue-actions";

export const metadata = { title: "Review queue" };

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export default async function ReviewQueuePage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "nav.reviewQueue")) {
    return <ForbiddenState body="The review queue is for verifiers and reviewers." />;
  }
  const canDecide = hasCapability(session.role, "review.decide");
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data } = await supabase!
    .from("extracted_fields")
    .select("*")
    .eq("organization_id", session.organizationId)
    .eq("state", "suggested")
    .eq("triage_action", "human_review")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader
        kicker="Work"
        title="Review queue"
        description="Extracted values that need a person before they become facts: anything material (quantities, calorific values, production, energy) or with confidence below 90%. Accept records the fact; reject drops it."
        meta={data?.length ? <Badge tone="draft" dot>{data.length} waiting</Badge> : undefined}
      />
      {!data?.length ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting for review"
          body="New extracted values land here when they are material or low-confidence."
        />
      ) : (
        <ul className="divide-y divide-mist-100 overflow-hidden rounded-lg border border-mist-200 bg-white shadow-xs">
          {data.map((f) => {
            const pct = Math.round(Number(f.confidence) * 100);
            return (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px] font-medium text-mist-900">{f.field_path}</span>
                    {f.provenance_type === "document_page" || !f.provenance_type ? (
                      <>
                        <Badge tone="ai">AI-proposed</Badge>
                        <Badge tone={pct < 90 ? "draft" : "neutral"}>{pct}% confidence</Badge>
                      </>
                    ) : (
                      <Badge tone="ink">{PROVENANCE_LABEL[f.provenance_type]}</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[15px] font-semibold text-mist-950 tabular">
                    {displayValue(f.value_json)}{" "}
                    {f.unit ? <span className="text-sm font-normal text-mist-500">{f.unit}</span> : null}
                  </p>
                  {factLabel(f) ? (
                    <blockquote className="mt-2 max-w-3xl border-l-2 border-mist-200 pl-3 text-[13px] leading-relaxed text-mist-600">
                      {factLabel(f)}
                    </blockquote>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-mist-500">
                    <span>{formatIst(f.created_at)}</span>
                    {f.provenance_type === "document_page" || !f.provenance_type ? (
                      <Link
                        href={`/engagements/${f.engagement_id}/workbench`}
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-900 hover:underline"
                      >
                        Open in workbench with the source page
                        <ArrowRight className="size-3.5" />
                      </Link>
                    ) : f.provenance_type === "site_observation" ? (
                      <Link
                        href={`/engagements/${f.engagement_id}/fieldwork`}
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-900 hover:underline"
                      >
                        Open fieldwork
                        <ArrowRight className="size-3.5" />
                      </Link>
                    ) : (
                      <Link
                        href={`/engagements/${f.engagement_id}/documents`}
                        className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-900 hover:underline"
                      >
                        Open the source file
                        <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
                {canDecide ? <QueueActions fieldId={f.id} engagementId={f.engagement_id} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
