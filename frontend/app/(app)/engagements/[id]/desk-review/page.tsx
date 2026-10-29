import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat";
import { getSession, getEngagement } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack } from "@verifystack/backend/domain/packs";
import {
  PERIOD_MONTHS,
  RESOLUTION_LABEL,
  deskReviewFor,
  slotCoverage,
  type DeskOutcome,
  type DeskSourceRef,
  type DeskStatus,
  type Readings,
  type ResolutionState,
  type SlotCoverage,
} from "@verifystack/backend/domain/deskreview";
import { BLOCK_IDS } from "@verifystack/backend/domain/deskreview/toFindings";
import { formatIst } from "@/lib/format";
import { ReadingsForm, RunDeskReviewButton, TriageBar } from "./desk-review-client";

export const metadata = { title: "Desk review" };

const STATUS: Record<DeskStatus, { label: string; tone: BadgeTone }> = {
  pass: { label: "Agrees", tone: "ok" },
  fail: { label: "Disagrees", tone: "block" },
  pending: { label: "Waiting for readings", tone: "draft" },
  not_applicable: { label: "Cannot be decided", tone: "neutral" },
};

const RESOLUTION_TONE: Record<ResolutionState, BadgeTone> = {
  resolved: "ok",
  accepted_with_explanation: "ok",
  unresolved_immaterial: "neutral",
  unresolved_material: "block",
  scope_limitation: "block",
};

const COVERAGE_TONE: Record<SlotCoverage["state"], BadgeTone> = { present: "ok", partial: "draft", missing: "neutral" };

const tonnes = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} tCO2e`;

function sourceText(s: DeskSourceRef): string {
  const value = typeof s.value === "number" ? String(Math.round(s.value * 1e4) / 1e4) : String(s.value);
  const clipped = value.length > 40 ? `${value.slice(0, 37)}...` : value;
  return `${s.label}: ${clipped}${s.unit ? ` ${s.unit}` : ""}`;
}

function sourceHref(s: DeskSourceRef): string | null {
  if (!s.documentId) return null;
  const page = /^p\. (\d+)$/.exec(s.location ?? "");
  return `/api/documents/${s.documentId}/file${page ? `#page=${page[1]}` : ""}`;
}

function SourcePill({ s }: { s: DeskSourceRef }) {
  const where = [s.filename ?? s.slot, s.location].filter(Boolean).join(" · ");
  const href = sourceHref(s);
  const body = (
    <>
      <span className="text-mist-900">{sourceText(s)}</span>
      {where ? <span className="text-mist-500"> · {where}</span> : null}
    </>
  );
  const cls = "inline-block max-w-full truncate rounded border border-mist-200 bg-mist-50 px-1.5 py-0.5 text-[11px]";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:border-teal-300 hover:bg-teal-50/40`} title={where}>
      {body}
    </a>
  ) : (
    <span className={cls} title={where}>
      {body}
    </span>
  );
}

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
  if (!def) {
    return (
      <>
        <PageHeader title="Desk review" description="Cross-checks between the evidence documents." />
        <EmptyState title="No desk review for this methodology" body="This methodology has no cross-document rules yet." />
      </>
    );
  }

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
    supabase!.from("desk_readings").select("key, value, document_id, page").eq("engagement_id", id).eq("organization_id", session.organizationId),
    supabase!.from("documents").select("id, original_filename, slot").eq("engagement_id", id).eq("organization_id", session.organizationId),
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
  const resolutions = new Map((resolutionRows.data ?? []).map((r) => [r.rule_id, r]));
  const findingFor = new Map((deskFindings ?? []).map((f) => [f.rule_id, f]));

  const results = ((review?.results ?? []) as unknown as DeskOutcome[]) ?? [];
  const notes = ((review?.notes ?? []) as unknown as string[]) ?? [];
  const seen = (review?.readings ?? {}) as unknown as Readings;
  const count = (s: DeskStatus) => results.filter((r) => r.status === s).length;
  const sections = [...new Set(results.map((r) => r.section))];
  const pack = loadPack(engagement.pack_id);
  const coverage = slotCoverage(
    def,
    (pack.evidence_slots ?? []).map((s) => ({ id: s.id, label: s.label, gate: s.gate })),
    (docs ?? []).map((d) => ({ slot: d.slot })),
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
        description="Cross-checks between the evidence documents, before any calculation. Workbook figures are read by code; PDF figures are the ones you enter against the page."
        actions={hasCapability(session.role, "review.decide") ? <RunDeskReviewButton engagementId={id} /> : undefined}
      />

      {!review ? (
        <EmptyState
          title="No desk review run yet"
          body="Assign the evidence slots on the Documents page, enter the PDF figures below, then run the review. Checks without their figures wait; none is skipped."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Agree" value={count("pass")} tone="ok" />
            <StatTile label="Disagree" value={count("fail")} tone={count("fail") ? "block" : "neutral"} />
            <StatTile label="Waiting for readings" value={count("pending")} tone={count("pending") ? "warn" : "neutral"} />
            <StatTile label="Run" value={formatIst(review.created_at)} />
          </div>

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

          {notes.length > 0 ? (
            <Alert tone="warn" title="Reading notes">
              <ul className="list-disc space-y-0.5 pl-4">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {sections.map((section) => (
            <Card key={section}>
              <CardHeader title={section} />
              <CardBody className="p-0">
                <ul className="divide-y divide-mist-100">
                  {results
                    .filter((r) => r.section === section)
                    .map((r) => {
                      const s = STATUS[r.status];
                      const resolution = resolutions.get(r.id) ?? null;
                      const finding = findingFor.get(`DESK-${r.id}`) ?? null;
                      const findingOpen = finding !== null && finding.state !== "closed" && finding.state !== "rejected";
                      return (
                        <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                          <Badge tone={s.tone} dot>
                            {s.label}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-mist-900">{r.label}</p>
                              {resolution ? <Badge tone={RESOLUTION_TONE[resolution.resolution_state as ResolutionState]}>{RESOLUTION_LABEL[resolution.resolution_state as ResolutionState]}</Badge> : null}
                            </div>
                            <p className="text-xs text-mist-700">{r.status === "pending" ? `Needs: ${r.missing?.join(", ")}` : r.detail}</p>
                            {r.thresholdSource ? <p className="text-[11px] text-mist-500">Band: {r.thresholdSource}</p> : null}
                            {r.sources && r.sources.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {r.sources.map((src) => (
                                  <SourcePill key={src.key} s={src} />
                                ))}
                              </div>
                            ) : null}
                            {r.status === "pass" && findingOpen ? (
                              <p className="mt-1.5 text-xs text-mist-600">
                                This check agrees now. Its finding is still {finding.state}.{" "}
                                <a href={`/engagements/${id}/findings#finding-${finding.id}`} className="font-medium text-teal-700 underline-offset-2 hover:underline">
                                  Close it on the Findings page
                                </a>
                                .
                              </p>
                            ) : null}
                            {canDecide && (r.status === "fail" || r.status === "pending") ? (
                              <TriageBar
                                engagementId={id}
                                ruleId={r.id}
                                status={r.status}
                                inherentBlock={BLOCK_IDS.has(r.id)}
                                resolution={
                                  resolution
                                    ? { state: resolution.resolution_state as ResolutionState, reason: resolution.reason, decidedAt: resolution.decided_at }
                                    : null
                                }
                                finding={finding ? { id: finding.id, state: finding.state, severity: finding.severity } : null}
                                available={resolutionsAvailable}
                              />
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {hasCapability(session.role, "review.decide") ? (
        <Card className="mt-5">
          <CardHeader
            title="Figures from PDFs"
            description="Type each figure from the document in its slot, with the page. These are the only figures entered by hand."
          />
          <CardBody>
            <ReadingsForm
              engagementId={id}
              specs={def.manual}
              saved={(readings ?? []).map((r) => ({ key: r.key, value: Number(r.value), documentId: r.document_id, page: r.page }))}
              docs={(docs ?? []).map((d) => ({ id: d.id, name: d.original_filename, slot: d.slot }))}
            />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
