import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionTitle } from "@/components/ui/card";
import { CopyText } from "@/components/ui/copy-text";
import { formatIst } from "@/lib/format";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadTechnicalReview } from "@verifystack/backend/lib/data/technicalReview";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Technical review" };

export default async function TechnicalReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const canReview = hasCapability(session.role, "review.technical");
  if (!canReview && !hasCapability(session.role, "signoff.lead")) {
    return <ForbiddenState body="Technical review is done by the independent reviewer." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();

  const ctx = await loadTechnicalReview(session.organizationId, engagement);
  const iDrafted = ctx.drafters.has(session.user.id);
  const status = ctx.state.status;

  const tone = status === "approved" ? "ok" : ctx.state.blocks ? "error" : "info";
  const title =
    status === "approved"
      ? "Approved for the current facts and calculation"
      : status === "changes_requested"
        ? "Changes requested"
        : status === "missing"
          ? "Review required, none recorded"
          : status === "stale"
            ? "The last review is out of date"
            : "Not required for this pack";

  return (
    <>
      <PageHeader
        title="Technical review"
        description="The independent reviewer reads the facts, the calculation and the findings before sign-off, and records approve or changes requested. It is separate from the signature: both are kept."
        meta={
          <Badge tone={ctx.required ? "ink" : "neutral"}>
            {ctx.required ? "Required by this pack" : "Optional for this pack"}
          </Badge>
        }
      />

      <Alert tone={tone} title={title} className="mb-6">
        {ctx.state.message ??
          (status === "approved"
            ? "Nothing has changed since the review, so it counts toward sign-off."
            : status === "stale"
              ? "The facts or the calculation changed after it. It no longer counts, and it does not block sign-off while this pack leaves review optional."
              : "A review is optional for this pack. It is still worth doing before sign-off, and a request for changes would block it.")}
      </Alert>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader
            title="What is being reviewed"
            description="A fingerprint of the latest calculation run and every accepted fact. Change either and a past review stops counting."
          />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Accepted facts">{ctx.factCount}</Row>
            <Row label="Latest run">
              {ctx.latestRun ? (
                <>
                  {formatIst(ctx.latestRun.created_at)} · <CopyText value={ctx.latestRun.input_hash} />
                </>
              ) : (
                <span className="text-mist-500">No calculation has been run</span>
              )}
            </Row>
            <Row label="Review fingerprint">
              <CopyText value={ctx.snapshotHash} />
            </Row>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/engagements/${id}/facts`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Facts
              </Link>
              <Link href={`/engagements/${id}/runs`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Runs
              </Link>
              <Link href={`/engagements/${id}/findings`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Findings
              </Link>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Your review" />
          <CardBody>
            {!canReview ? (
              <p className="text-sm text-mist-600">
                Only the independent reviewer records a technical review. You can read it here.
              </p>
            ) : iDrafted ? (
              <Alert tone="warn" title="You cannot review this work">
                You accepted facts or ran a calculation in this engagement. Another independent reviewer has to do the
                review.
              </Alert>
            ) : !ctx.latestRun ? (
              <p className="text-sm text-mist-600">Run the calculation first. There is nothing to review yet.</p>
            ) : (
              <ReviewForm engagementId={id} />
            )}
          </CardBody>
        </Card>
      </div>

      <section>
        <SectionTitle>History</SectionTitle>
        {ctx.reviews.length === 0 ? (
          <p className="text-sm text-mist-500">No review has been recorded.</p>
        ) : (
          <ul className="space-y-2.5">
            {ctx.reviews.map((r) => (
              <li key={r.id} className="rounded-lg border border-mist-200 bg-white px-4 py-3 shadow-xs">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mist-600">
                  <span className="font-medium text-mist-900">{r.reviewer_name}</span>
                  <Badge tone={r.decision === "approved" ? "ok" : "block"} dot>
                    {r.decision === "approved" ? "Approved" : "Changes requested"}
                  </Badge>
                  {r.snapshot_hash !== ctx.snapshotHash ? <Badge tone="draft">Out of date</Badge> : null}
                  <span>{formatIst(r.created_at)}</span>
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-mist-800">{r.comments}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <span className="text-[13px] text-mist-600">{label}</span>
      <span className="text-mist-900">{children}</span>
    </div>
  );
}
