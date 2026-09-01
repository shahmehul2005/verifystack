import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { canSubmit } from "@verifystack/backend/domain/signoff/guards";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { formatIst } from "@/lib/format";
import { AdeetieReportLinks } from "@/components/adeetie/report-links";
import { ReportDisclaimer } from "@/components/adeetie/notices";
import { SignoffForm } from "./signoff-form";
import { CloseFindingButton } from "../findings/finding-actions";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { signoffsForPass } from "@verifystack/backend/domain/adeetie/lifecycle";
import {
  ADEETIE_PHASE_SHORT_LABEL,
  type AdeetiePhase,
} from "@verifystack/backend/domain/packs/adeetie";

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
      <ForbiddenState body="Sign-off (P7) is the lead verifier, then a different independent reviewer." />
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
  const role = session.role as MembershipRole | null;
  const canLead = hasCapability(role, "signoff.lead");
  const canReviewer = hasCapability(role, "signoff.reviewer");

  return (
    <>
      <PageHeader
        kicker="P7"
        title="Sign-off"
        description={
          isAdeetie && currentPhase
            ? `Maker-checker for this ${ADEETIE_PHASE_SHORT_LABEL[currentPhase]} pass. Named attestation is not a Digital Signature. Download the working paper and file on the BEE portal yourself.`
            : "Maker-checker: lead verifier, then a different independent reviewer. Named attestation is not a Digital Signature under the IT Act. P7 filing (Form A/B, ICM, BEE) is still a download-and-submit step."
        }
        actions={
          /**
           * The unqualified report endpoint renders the GEI verification
           * working paper. On an SEC engagement that is the wrong document, so
           * ADEETIE gets its per-pass links below instead of a button that
           * would download a report for a calculation this engagement never ran.
           */
          isAdeetie ? undefined : (
            <a
              href={`/api/reports?engagementId=${id}`}
              className="inline-flex h-9 items-center bg-white px-3 text-sm ring-1 ring-stone-300"
            >
              Download PDF (includes input hash)
            </a>
          )
        }
      />
      <ReportDisclaimer />
      <div className="mb-4 border border-stone-300 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-700">
        <Badge>Named attestation</Badge>
        <p className="mt-1.5 max-w-3xl leading-relaxed">
          Recording a name here hashes the latest calculation run into D7. It is not a Class 2/3
          DSC and not Aadhaar eSign. BEE / ICM / the lender still receive the PDF you download —
          this system does not submit to those portals.
        </p>
      </div>
      {isAdeetie ? (
        <section className="mb-6">
          <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
            ADEETIE reports
          </h2>
          <AdeetieReportLinks engagementId={id} />
        </section>
      ) : null}

      <section className="mb-6 border border-stone-200 bg-white p-4">
        <h2 className="text-[11px] uppercase tracking-wide text-stone-500">Finding gate</h2>
        <p className="mt-1 text-sm text-stone-600">
          {all.length} finding{all.length === 1 ? "" : "s"} on this engagement.
          {" "}Accept CAR does not clear a block. Only Close or Reject does.
        </p>
        {blocks.length > 0 ? (
          <div className="mt-3 border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-800">
              {blocks.length} open block finding{blocks.length === 1 ? "" : "s"} — attestation is
              locked.
            </p>
            <ul className="mt-2 space-y-2">
              {blocks.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <Badge tone="block">{f.severity}</Badge>{" "}
                    <Badge>{f.state}</Badge>{" "}
                    <span className="font-mono text-[11px] text-stone-500">{f.rule_id}</span>{" "}
                    {f.title}
                  </span>
                  <CloseFindingButton findingId={f.id} engagementId={id} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm text-emerald-800">
            No open block findings. Lead attestation may be recorded.
          </p>
        )}
        {cleared.length > 0 ? (
          <ul className="mt-3 space-y-1 text-[12px] text-stone-600">
            {cleared.map((f) => (
              <li key={f.id} className="font-mono">
                {f.state} {f.rule_id} — {f.title}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {ready ? (
        <p className="mb-4 border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          Lead and independent reviewer have both attested. Engagement may be marked submitted.
        </p>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
          Attestations{isAdeetie && currentPhase ? ` · ${ADEETIE_PHASE_SHORT_LABEL[currentPhase]}` : ""}
        </h2>
        {!passSignoffs.length ? (
          <p className="mb-4 text-sm text-stone-600">
            None yet for this pass. Your role is {role ? ROLE_LABEL[role] : "unset"}.
            {!canLead && !canReviewer
              ? " Only the lead verifier can record the first attestation, and only a different independent reviewer can counter-sign it."
              : null}
          </p>
        ) : (
          <ul className="mb-6 space-y-2">
            {passSignoffs.map((s) => (
              <li key={s.id} className="border border-stone-200 bg-white p-3 text-sm">
                <Badge>{s.role}</Badge> {s.attestor_name} · hash {s.report_hash.slice(0, 16)}… ·{" "}
                {formatIst(s.created_at)}
              </li>
            ))}
          </ul>
        )}
        {priorSignoffs.length ? (
          <div className="mb-6">
            <h3 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
              Earlier passes
            </h3>
            <ul className="space-y-2">
              {priorSignoffs.map((s) => (
                <li key={s.id} className="border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
                  <Badge>{s.adeetie_phase ?? "—"}</Badge> <Badge>{s.role}</Badge> {s.attestor_name} ·{" "}
                  {formatIst(s.created_at)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {blocks.length === 0 && canLead ? (
        <SignoffForm engagementId={id} role="lead_verifier" />
      ) : null}
      <div className="h-4" />
      {blocks.length === 0 && canReviewer ? (
        <SignoffForm engagementId={id} role="independent_reviewer" />
      ) : null}
    </>
  );
}
