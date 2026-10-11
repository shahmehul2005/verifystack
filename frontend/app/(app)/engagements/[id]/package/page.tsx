import { notFound } from "next/navigation";
import { CircleCheck, Download, OctagonX } from "lucide-react";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { loadSubmissionInput } from "@verifystack/backend/lib/data/submissionPackage";
import { submissionBlockers } from "@verifystack/backend/domain/submission/package";

export const metadata = { title: "Submission package" };

export default async function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "signoff.lead")) {
    return <ForbiddenState body="The submission package is assembled by the lead verifier." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();

  const { input } = await loadSubmissionInput(session.organizationId, engagement, { includeBytes: false });
  const blockers = submissionBlockers(input);
  const ready = blockers.length === 0;
  const a = input.acceptance;

  return (
    <>
      <PageHeader
        title="Submission package"
        description="One ZIP to hand over: accepted facts with their provenance, the calculation record, findings and their outcome, sign-offs, and the evidence files, all listed with SHA-256 digests."
        actions={
          ready ? (
            <a href={`/api/package?engagementId=${id}`} className={buttonVariants({})}>
              <Download />
              Download package (ZIP)
            </a>
          ) : undefined
        }
      />

      <Alert tone="warn" title="The layout is generic" className="mb-6">
        No scheme or portal submission template has been supplied, so this is not a regulator-prescribed format. You
        still file through the scheme&apos;s own channel. The package says so in its README.
      </Alert>

      <Card className="mb-6">
        <CardHeader
          title="Readiness"
          actions={
            <Badge tone={ready ? "ok" : "block"} dot>
              {ready ? "Ready" : `${blockers.length} ${blockers.length === 1 ? "thing" : "things"} in the way`}
            </Badge>
          }
        />
        <CardBody>
          {ready ? (
            <p className="flex items-center gap-2 text-sm text-green-800">
              <CircleCheck aria-hidden className="size-4" />
              A calculation run, both signatures and the finding gate are in place.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {blockers.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-red-800">
                  <OctagonX aria-hidden className="mt-0.5 size-4 shrink-0 text-red-600" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What the package will disclose"
          description="These go into the README whether or not they are flattering."
        />
        <CardBody>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Accepted facts">{a.total}</Item>
            <Item label="Accepted in bulk">
              {a.bulk} of {a.total} ({(a.bulkShare * 100).toFixed(1)}%)
            </Item>
            <Item label="Technical review">{humanize(input.technicalReview.status)}</Item>
            <Item label="Unverified factors used">
              {input.unverifiedFactors.length === 0 ? (
                "None"
              ) : (
                <span className="text-amber-800">{input.unverifiedFactors.join(", ")}</span>
              )}
            </Item>
            <Item label="Evidence files">{input.documents.length}</Item>
            <Item label="Findings">
              {input.findings.length} ({input.findings.filter((f) => f.state === "closed").length} closed)
            </Item>
          </dl>
          <ul className={cn("mt-4 space-y-1 border-t border-mist-100 pt-3 text-[13px] text-mist-600")}>
            {input.openItems.map((o) => (
              <li key={o}>· {o}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-mist-600">{label}</dt>
      <dd className="mt-0.5 font-medium text-mist-900">{children}</dd>
    </div>
  );
}
