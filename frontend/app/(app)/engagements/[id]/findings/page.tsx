import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { readFindingCitation } from "@verifystack/backend/domain/citations/types";
import { openBlockFindings } from "@verifystack/backend/domain/signoff/guards";
import { CitationPanel } from "./citation-panel";
import { FindingActions } from "./finding-actions";
import { CircleAlert, Flag, Info, OctagonX } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatIst, humanize } from "@/lib/format";
import {
  ISSUE_STATE_LABEL,
  ageing,
  summariseIssues,
  type IssueSeverity,
  type IssueState,
} from "@verifystack/backend/domain/issues/lifecycle";

const SEVERITY = {
  block: { label: "Blocking", tone: "block", icon: OctagonX, iconClass: "text-red-600", edge: "border-l-red-500" },
  warn: { label: "Warning", tone: "draft", icon: CircleAlert, iconClass: "text-amber-600", edge: "border-l-amber-400" },
  info: { label: "Note", tone: "neutral", icon: Info, iconClass: "text-mist-500", edge: "border-l-mist-300" },
} as const;

export const metadata = { title: "Findings" };

export default async function FindingsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "findings.decide")) {
    return <ForbiddenState body="Findings are for verifiers and reviewers." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data: findings } = await supabase!
    .from("findings")
    .select("*")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false });
  const openBlocks = openBlockFindings(findings ?? []).length;
  const issues = (findings ?? []).map((f) => ({
    state: f.state as IssueState,
    severity: f.severity as IssueSeverity,
    due_at: f.due_at,
  }));
  const summary = summariseIssues(issues);

  const [{ data: responses }, { data: responseDocs }] = await Promise.all([
    supabase!
      .from("issue_responses")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: true }),
    supabase!
      .from("documents")
      .select("id, original_filename, finding_id")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .eq("source", "entity_response"),
  ]);
  const docName = new Map((responseDocs ?? []).map((d) => [d.id, d.original_filename]));
  const responsesByFinding = new Map<string, NonNullable<typeof responses>>();
  for (const r of responses ?? []) {
    const list = responsesByFinding.get(r.finding_id) ?? [];
    list.push(r);
    responsesByFinding.set(r.finding_id, list);
  }

  return (
    <>
      <PageHeader
        title="Findings"
        description="Reconciliation rules raise findings; people decide them. Accept a CAR, open it with the entity, read their response, verify it, then close. A blocking finding holds sign-off until it is closed or rejected."
        meta={
          findings?.length ? (
            <>
              <Badge tone={openBlocks > 0 ? "block" : "ok"} dot>
                {openBlocks > 0
                  ? `${openBlocks} blocking ${openBlocks === 1 ? "finding" : "findings"} open`
                  : "No blocking findings open"}
              </Badge>
              <span className="text-xs text-mist-500 tabular">{findings.length} in total</span>
              {summary.overdue > 0 ? (
                <Badge tone="block" dot>
                  {summary.overdue} overdue with the entity
                </Badge>
              ) : null}
              {summary.awaitingVerifier > 0 ? (
                <Badge tone="draft" dot>
                  {summary.awaitingVerifier} awaiting your review
                </Badge>
              ) : null}
            </>
          ) : undefined
        }
      />
      {!findings?.length ? (
        <EmptyState
          icon={Flag}
          title="No findings yet"
          body="Findings appear after a calculation runs and the reconciliation rules check the result."
        />
      ) : (
        <ul className="space-y-4">
          {findings.map((f) => {
            const sev = SEVERITY[f.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
            const Icon = sev.icon;
            return (
              <li
                key={f.id}
                className={cn(
                  "overflow-hidden rounded-lg border border-l-4 border-mist-200 bg-white shadow-xs",
                  sev.edge
                )}
              >
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon aria-hidden className={cn("size-4", sev.iconClass)} />
                    <Badge tone={sev.tone}>{sev.label}</Badge>
                    <Badge tone={f.state === "responded" ? "draft" : f.state === "verified" || f.state === "closed" ? "ok" : "neutral"}>
                      {ISSUE_STATE_LABEL[f.state as IssueState] ?? humanize(f.state)}
                    </Badge>
                    {(() => {
                      const a = ageing({ state: f.state as IssueState, due_at: f.due_at });
                      if (!f.due_at || a.status === "settled" || a.status === "no_due_date") return null;
                      if (f.state === "responded") return null;
                      return (
                        <Badge tone={a.status === "overdue" ? "block" : a.status === "due_soon" ? "draft" : "neutral"} dot>
                          {a.status === "overdue"
                            ? `Overdue by ${Math.abs(a.daysLeft ?? 0)} ${Math.abs(a.daysLeft ?? 0) === 1 ? "day" : "days"}`
                            : `Due ${formatIst(f.due_at, false)}`}
                        </Badge>
                      );
                    })()}
                    <span className="ml-auto font-mono text-xs text-mist-500">{f.rule_id}</span>
                  </div>
                  <h2 className="mt-2.5 text-[15px] font-semibold text-mist-950">{f.heading ?? f.title}</h2>
                  <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-mist-700">{f.body ?? f.detail}</p>
                  {f.clause_ref ? (
                    <p className="mt-2 text-xs text-mist-500">Clause: {f.clause_ref}</p>
                  ) : null}
                  <CitationPanel
                    citation={readFindingCitation(f)}
                    findingId={f.id}
                    engagementId={id}
                  />
                  {(responsesByFinding.get(f.id) ?? []).length > 0 ? (
                    <div className="mt-4 space-y-2.5 border-t border-mist-100 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-mist-500">Responses</p>
                      {(responsesByFinding.get(f.id) ?? []).map((r) => {
                        const docIds = Array.isArray(r.document_ids) ? (r.document_ids as string[]) : [];
                        return (
                          <div key={r.id} className="rounded-md border border-mist-200 bg-mist-50/50 px-3.5 py-2.5">
                            <p className="flex flex-wrap items-center gap-x-2 text-xs text-mist-600">
                              <span className="font-medium text-mist-900">{r.responder_name}</span>
                              <Badge tone={r.kind === "entity" ? "ink" : "neutral"}>
                                {r.kind === "entity" ? "From the entity" : "Recorded by verifier"}
                              </Badge>
                              <span>{formatIst(r.created_at)}</span>
                              {r.responder_contact ? <span>{r.responder_contact}</span> : null}
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-mist-800">{r.body}</p>
                            {docIds.length > 0 ? (
                              <ul className="mt-2 flex flex-wrap gap-2">
                                {docIds.map((d) => (
                                  <li key={d}>
                                    <a
                                      href={`/api/documents/${d}/file`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs font-medium text-teal-700 underline-offset-2 hover:underline"
                                    >
                                      {docName.get(d) ?? "Attachment"}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-mist-100 bg-mist-50/60 px-5 py-3">
                  <FindingActions
                    findingId={f.id}
                    engagementId={id}
                    state={f.state as IssueState}
                    severity={f.severity as IssueSeverity}
                    dueAt={f.due_at}
                    hasLiveLink={Boolean(f.response_nonce)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
