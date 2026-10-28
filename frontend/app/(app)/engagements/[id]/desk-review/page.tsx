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
import { deskReviewFor, type DeskOutcome, type DeskStatus } from "@verifystack/backend/domain/deskreview";
import { formatIst } from "@/lib/format";
import { ReadingsForm, RunDeskReviewButton } from "./desk-review-client";

export const metadata = { title: "Desk review" };

const STATUS: Record<DeskStatus, { label: string; tone: BadgeTone }> = {
  pass: { label: "Agrees", tone: "ok" },
  fail: { label: "Disagrees", tone: "block" },
  pending: { label: "Waiting for readings", tone: "draft" },
  not_applicable: { label: "Cannot be decided", tone: "neutral" },
};

export default async function DeskReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="Desk review is for verifiers and the lead verifier." />;
  }
  const canDecide = true;
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
  const [{ data: review }, { data: readings }, { data: docs }] = await Promise.all([
    supabase!
      .from("desk_reviews")
      .select("id, results, notes, created_at")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase!.from("desk_readings").select("key, value, document_id, page").eq("engagement_id", id).eq("organization_id", session.organizationId),
    supabase!.from("documents").select("id, original_filename, slot").eq("engagement_id", id).eq("organization_id", session.organizationId),
  ]);

  const results = ((review?.results ?? []) as unknown as DeskOutcome[]) ?? [];
  const notes = ((review?.notes ?? []) as unknown as string[]) ?? [];
  const count = (s: DeskStatus) => results.filter((r) => r.status === s).length;
  const sections = [...new Set(results.map((r) => r.section))];

  return (
    <>
      <PageHeader
        kicker="Verification"
        title="Desk review"
        description="Cross-checks between the evidence documents, before any calculation. Workbook figures are read by code; PDF figures are the ones you enter against the page."
        actions={canDecide ? <RunDeskReviewButton engagementId={id} /> : undefined}
      />

      {!review ? (
        <EmptyState
          title="No desk review run yet"
          body={
            canDecide
              ? "Assign the evidence slots on the Documents page, enter the PDF figures below, then run the review. Checks without their figures wait; none is skipped."
              : "A verifier has not run the desk review yet."
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Agree" value={count("pass")} tone="ok" />
            <StatTile label="Disagree" value={count("fail")} tone={count("fail") ? "block" : "neutral"} />
            <StatTile label="Waiting for readings" value={count("pending")} tone={count("pending") ? "warn" : "neutral"} />
            <StatTile label="Run" value={formatIst(review.created_at)} />
          </div>
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
                      return (
                        <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                          <Badge tone={s.tone} dot>
                            {s.label}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-mist-900">{r.label}</p>
                            <p className="text-xs text-mist-700">{r.status === "pending" ? `Needs: ${r.missing?.join(", ")}` : r.detail}</p>
                            {r.thresholdSource ? <p className="text-[11px] text-mist-500">Band: {r.thresholdSource}</p> : null}
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

      {canDecide ? (
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
