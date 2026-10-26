import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Download } from "lucide-react";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader, SectionTitle } from "@/components/ui/card";
import { CopyText } from "@/components/ui/copy-text";
import { Table, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { getSession } from "@/lib/session";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@/lib/session";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { canSubmit } from "@verifystack/backend/domain/signoff/guards";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { formatIst, humanize } from "@/lib/format";
import { AdeetieReportLinks } from "@/components/adeetie/report-links";
import { ReportDisclaimer } from "@/components/adeetie/notices";
import { SignoffForm } from "./signoff-form";
import { loadTechnicalReview } from "@verifystack/backend/lib/data/technicalReview";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { signoffsForPass } from "@verifystack/backend/domain/adeetie/lifecycle";
import {
  ADEETIE_PHASE_SHORT_LABEL,
  type AdeetiePhase,
} from "@verifystack/backend/domain/packs/adeetie";

export const metadata = { title: "Sign-off" };

export default async function SignoffPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (
    !hasCapability(session.role, "signoff.lead") &&
    !hasCapability(session.role, "signoff.reviewer")
  ) {
    return (
      <ForbiddenState body="Sign-off is done by the lead verifier, then a different independent reviewer." />
    );
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [{ data: findings }, { data: signoffs }] = await Promise.all([
    supabase!
      .from("findings")
      .select("id, rule_id, title, severity, state")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false }),
    supabase!
      .from("signoffs")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
  ]);

  const all = findings ?? [];
  const blocks = all.filter(
    (f) => f.severity === "block" && f.state !== "closed" && f.state !== "rejected"
  );
  const cleared = all.filter(
    (f) => f.severity === "block" && (f.state === "closed" || f.state === "rejected")
  );
  const isAdeetie = engagement.scheme === "ADEETIE";
  const currentPhase = (engagement.adeetie_phase ?? null) as AdeetiePhase | null;
  const passSignoffs = isAdeetie
    ? signoffsForPass(signoffs ?? [], currentPhase)
    : (signoffs ?? []);
  const priorSignoffs = isAdeetie
    ? (signoffs ?? []).filter((s) => (s.adeetie_phase ?? null) !== currentPhase)
    : [];
  const ready = canSubmit(passSignoffs);
  const review = await loadTechnicalReview(session.organizationId, engagement);
  const role = session.role as MembershipRole | null;
  const canLead = hasCapability(role, "signoff.lead");
  const canReviewer = hasCapability(role, "signoff.reviewer");

  const leadSig = passSignoffs.find((s) => s.role === "lead_verifier");
  const reviewerSig = passSignoffs.find((s) => s.role === "independent_reviewer");

  return (
    <>
      <PageHeader
        title="Sign-off"
        description={
          isAdeetie && currentPhase
            ? `Two-person sign-off for this ${ADEETIE_PHASE_SHORT_LABEL[currentPhase]} pass. A named attestation is not a digital signature. Download the working paper and file it on the BEE portal yourself.`
            : "Two-person sign-off: the lead verifier, then a different independent reviewer. A named attestation is not a digital signature under the IT Act. Filing (Form A/B, ICM, BEE) is still a download-and-submit step."
        }
        actions={
          /**
           * The unqualified report endpoint renders the GEI verification
           * working paper. On an SEC engagement that is the wrong document, so
           * ADEETIE gets its per-pass links below instead of a button that
           * would download a report for a calculation this engagement never ran.
           */
          isAdeetie ? undefined : (
            <a href={`/api/reports?engagementId=${id}`} className={buttonVariants({ variant: "secondary" })}>
              <Download />
              Download working paper (PDF)
            </a>
          )
        }
      />

      <Alert tone="info" title="What a named attestation is" className="mb-6">
        Recording your name fixes it against a fingerprint of the latest calculation run in the
        audit log. It is not a Class 2/3 DSC or Aadhaar eSign. BEE, ICM and the lender still receive
        the PDF you download; VerifyStack does not submit to those portals.
      </Alert>

      <section className="mb-6">
        <SectionTitle>
          Signatures{isAdeetie && currentPhase ? ` · ${ADEETIE_PHASE_SHORT_LABEL[currentPhase]} pass` : ""}
        </SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <SignatureSlot step={1} title="Lead verifier" signoff={leadSig} />
          <SignatureSlot step={2} title="Independent reviewer" signoff={reviewerSig} />
        </div>
        {ready ? (
          <Alert tone="ok" title="Both signatures recorded" className="mt-3">
            The lead verifier and the independent reviewer have both attested this engagement.
          </Alert>
        ) : !passSignoffs.length ? (
          <p className="mt-3 text-[13px] text-mist-600">
            Your role is {role ? ROLE_LABEL[role] : "not set"}.
            {!canLead && !canReviewer
              ? " Only the lead verifier can record the first attestation, and only a different independent reviewer can counter-sign it."
              : null}
          </p>
        ) : null}
      </section>

      <Card className="mb-6">
        <CardHeader
          title="Finding gate"
          description={`${all.length} ${all.length === 1 ? "finding" : "findings"} on this engagement. Accepting a CAR does not clear a blocking finding; closing or rejecting it does.`}
          actions={
            <Badge tone={blocks.length ? "block" : "ok"} dot>
              {blocks.length ? `${blocks.length} blocking open` : "Clear"}
            </Badge>
          }
        />
        <CardBody>
          {blocks.length > 0 ? (
            <>
              <p className="text-sm text-red-800">
                Attestation is locked until {blocks.length === 1 ? "this finding is" : "these findings are"} closed or rejected.
              </p>
              <ul className="mt-3 divide-y divide-mist-100 rounded-md border border-red-200">
                {blocks.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium text-mist-900">{f.title}</span>
                      <span className="ml-2 font-mono text-xs text-mist-500">{f.rule_id}</span>
                      <span className="ml-2">
                        <Badge>{humanize(f.state)}</Badge>
                      </span>
                    </span>
                    <Link
                      href={`/engagements/${id}/findings`}
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                    >
                      Resolve
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-green-800">
              <CircleCheck aria-hidden className="size-4" />
              No blocking findings open. The lead attestation can be recorded.
            </p>
          )}
          {cleared.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-medium text-mist-600">Cleared</p>
              <ul className="mt-1.5 space-y-1 text-xs text-mist-600">
                {cleared.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono">{f.rule_id}</span> · {f.title} ·{" "}
                    <span className="text-mist-500">{humanize(f.state)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {review.state.status !== "not_required" ? (
        <Alert
          tone={review.state.blocks ? "error" : review.state.status === "approved" ? "ok" : "info"}
          title={
            review.state.status === "approved"
              ? "Technical review approved"
              : review.state.blocks
                ? "Technical review is holding sign-off"
                : "Technical review is out of date"
          }
          className="mb-6"
          actions={
            <Link
              href={`/engagements/${id}/technical-review`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Open technical review
            </Link>
          }
        >
          {review.state.message ??
            (review.state.status === "approved"
              ? "The independent reviewer approved the current facts and calculation."
              : "The facts or calculation changed after the last review, so it no longer applies. A new review is optional for this pack.")}
        </Alert>
      ) : null}

      {blocks.length === 0 && !review.state.blocks && (canLead || canReviewer) ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {canLead ? <SignoffForm engagementId={id} role="lead_verifier" /> : null}
          {canReviewer ? <SignoffForm engagementId={id} role="independent_reviewer" /> : null}
        </div>
      ) : null}

      {isAdeetie ? (
        <section className="mb-6">
          <SectionTitle>ADEETIE reports</SectionTitle>
          <AdeetieReportLinks engagementId={id} />
        </section>
      ) : (
        <ReportDisclaimer />
      )}

      {priorSignoffs.length ? (
        <section className="mt-8">
          <SectionTitle>Earlier passes</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Pass</Th>
                <Th>Role</Th>
                <Th>Name</Th>
                <Th>Signed</Th>
              </tr>
            </thead>
            <tbody>
              {priorSignoffs.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Badge tone="ink">{s.adeetie_phase ?? "—"}</Badge>
                  </Td>
                  <Td>{ROLE_LABEL[s.role as MembershipRole] ?? humanize(s.role)}</Td>
                  <Td>{s.attestor_name}</Td>
                  <Td className="whitespace-nowrap text-xs text-mist-600">{formatIst(s.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}
    </>
  );
}

function SignatureSlot({
  step,
  title,
  signoff,
}: {
  step: number;
  title: string;
  signoff?: { attestor_name: string; created_at: string; report_hash: string };
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white px-5 py-4 shadow-xs",
        signoff ? "border-green-200" : "border-dashed border-mist-300"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-mist-600">
          Step {step} · {title}
        </p>
        <Badge tone={signoff ? "ok" : "neutral"} dot>
          {signoff ? "Signed" : "Awaiting"}
        </Badge>
      </div>
      {signoff ? (
        <>
          <p className="mt-3 font-serif text-xl italic text-mist-950">{signoff.attestor_name}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-mist-100 pt-3 text-xs text-mist-600">
            <span>{formatIst(signoff.created_at)}</span>
            <span className="flex items-center gap-1.5">
              Report fingerprint <CopyText value={signoff.report_hash} />
            </span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-mist-500">Not signed for this pass yet.</p>
      )}
    </div>
  );
}
