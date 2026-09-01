import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { ForbiddenState } from "@/components/states";
import { ALL_FACTOR_RECORDS } from "@verifystack/backend/domain/factors";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isPlatformSteward } from "@verifystack/backend/lib/auth/steward";
import { formatIst } from "@/lib/format";
import { FactorVerifyPanel } from "./verify-form";

/**
 * `factor_verification_state` arrives with migration 0004 and is not described
 * by the hand-written Database types, so it is read through a minimal
 * structural view of the client.
 */
interface VerificationStateRow {
  factor_id: string;
  vintage: string;
  verified: boolean;
  current_value: number | null;
  cited_source: string | null;
  verified_at: string | null;
}
interface LooseDb {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): PromiseLike<{
        data: VerificationStateRow[] | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export default async function FactorsPage() {
  const session = isSupabaseConfigured() ? await getSession() : null;
  if (!hasCapability(session?.role, "nav.factors")) {
    return <ForbiddenState body="Citing reference factors (D8) is restricted to the lead verifier." />;
  }
  const organizationId = session?.organizationId ?? null;

  let state: VerificationStateRow[] = [];
  let stateError: string | null = null;
  if (organizationId) {
    const supabase = await createServerSupabase();
    if (supabase) {
      const { data, error } = await (supabase as unknown as LooseDb)
        .from("factor_verification_state")
        .select("*")
        .eq("organization_id", organizationId);
      if (error) stateError = error.message;
      else state = data ?? [];
    }
  }

  const rows = ALL_FACTOR_RECORDS.map((record) => {
    const promoted = state.find(
      (s) => s.factor_id === record.id && s.vintage === record.vintage && s.verified
    );
    return {
      record,
      verified: Boolean(promoted),
      value: promoted?.current_value ?? record.value,
      source: promoted?.cited_source ?? record.source,
      verifiedAt: promoted?.verified_at ?? null,
    };
  });

  const unverified = rows.filter((r) => !r.verified);
  const canVerify = hasCapability(session?.role, "factors.verify");
  const steward = isPlatformSteward(session?.user.email);

  return (
    <>
      <PageHeader
        kicker="D8"
        title="Factor register"
        description="Every emission factor, calorific value and process factor the engines can reach. A factor becomes verified only when a human records the publication they read it from. After that, turn draft mode off on the engagement and re-run — the engine loads this organisation's verified set."
      />

      <div className="mb-4 border border-stone-300 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-700">
        <Badge>Who owns what</Badge>
        <p className="mt-1.5 max-w-3xl leading-relaxed">
          The <span className="font-medium">value</span> is reference data. CEA publishes one grid
          emission factor and IPCC publishes one calorific value per fuel, and they are the same
          number for every firm on this platform, so keeping the catalogue current is the platform
          team&rsquo;s standing job — not work each firm repeats. The{" "}
          <span className="font-medium">attestation</span> below is yours: you record the
          publication you read, for this engagement&rsquo;s compliance year, under your name. If a
          shipped value looks wrong, say so — the correction belongs in the catalogue for everyone,
          not in one firm&rsquo;s override.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="ink">{rows.length} factors</Badge>
        <Badge tone="ok">{rows.length - unverified.length} verified</Badge>
        <Badge tone="draft">{unverified.length} unverified</Badge>
      </div>

      {unverified.length > 0 ? (
        <div className="mb-4 border border-amber-400 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-950">
          <Badge tone="draft">Unverified</Badge>
          <span className="ml-2 font-semibold">
            {unverified.length} factor value(s) are development placeholders.
          </span>
          <p className="mt-1.5 max-w-3xl leading-relaxed text-amber-900">
            The calculation engines refuse an unverified factor outside draft mode, so any run that
            touches one of these is a draft run and is not a verification opinion. Promoting a
            factor requires the publication actually read; a citation that is empty, trivial, or
            still carries a <span className="font-mono">TO VERIFY</span> marker is rejected.
          </p>
        </div>
      ) : null}

      {stateError ? (
        <div className="mb-4 border border-stone-300 bg-stone-50 px-3 py-2.5 text-[12px] text-stone-700">
          Organisation verification state could not be read ({stateError}). The catalogue below is
          shown as the code ships it, with every factor unverified.
        </div>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>Key</Th>
            <Th>Vintage</Th>
            <Th>Value</Th>
            <Th>Source</Th>
            <Th>Verified</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.record.id}::${r.record.vintage}`}>
              <Td>
                <div className="font-mono text-[12px]">{r.record.id}</div>
                <div className="text-[12px] text-stone-500">{r.record.label}</div>
              </Td>
              <Td className="font-mono text-[12px]">{r.record.vintage}</Td>
              <Td className="tabular whitespace-nowrap">
                {r.value} {r.record.unit}
                {r.verified && r.value !== r.record.value ? (
                  <div className="text-[11px] text-stone-500">
                    corrected from {r.record.value}
                  </div>
                ) : null}
              </Td>
              <Td className="max-w-sm text-[12px] leading-relaxed">
                {r.source}
                {r.record.notes && !r.verified ? (
                  <div className="mt-1 text-[11px] text-stone-500">{r.record.notes}</div>
                ) : null}
              </Td>
              <Td>
                <Badge tone={r.verified ? "ok" : "draft"}>
                  {r.verified ? "verified" : "unverified"}
                </Badge>
                {r.verifiedAt ? (
                  <div className="mt-1 text-[11px] text-stone-500">
                    {formatIst(r.verifiedAt)}
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <section className="mt-8">
        <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
          Attest a factor for this organisation
        </h2>
        {!organizationId ? (
          <ForbiddenState body="Sign in to an organisation to record a factor attestation. The catalogue above is readable without one." />
        ) : !canVerify ? (
          <ForbiddenState body="Attesting a factor is restricted to the lead verifier. It changes calculation output for every engagement in this organisation, so it is a P5 judgement, not firm administration." />
        ) : unverified.length === 0 ? (
          <p className="border border-dashed border-stone-300 bg-white px-3 py-4 text-[12px] text-stone-600">
            Every factor in the register carries a citation. Nothing is waiting for promotion.
          </p>
        ) : (
          <FactorVerifyPanel
            canChangeValue={steward}
            factors={unverified.map((r) => ({
              id: r.record.id,
              vintage: r.record.vintage,
              label: r.record.label,
              value: r.record.value,
              unit: r.record.unit,
            }))}
          />
        )}
      </section>
    </>
  );
}
