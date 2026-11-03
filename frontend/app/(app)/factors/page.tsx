import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SectionTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat";
import { Table, Td, Th } from "@/components/ui/table";
import { ForbiddenState } from "@/components/states";
import { ALL_FACTOR_RECORDS } from "@verifystack/backend/domain/factors";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getSession } from "@/lib/session";
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

export const metadata = { title: "Factor register" };

export default async function FactorsPage() {
  const session = isSupabaseConfigured() ? await getSession() : null;
  if (!isPlatformSteward(session?.user.email)) {
    return (
      <ForbiddenState body="The factor catalogue is maintained by the platform team. Firm members do not attest or override published values." />
    );
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

  return (
    <>
      <PageHeader
        kicker="Library"
        title="Factor register"
        description="The platform catalogue of emission factors, calorific values and process factors. Record the publication you read, and correct a value only when the published figure differs from what ships in code."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile label="Factors in the catalogue" value={String(rows.length)} />
        <StatTile label="Verified" value={String(rows.length - unverified.length)} tone="ok" />
        <StatTile
          label="Unverified"
          value={String(unverified.length)}
          tone={unverified.length > 0 ? "warn" : "neutral"}
        />
      </div>

      {unverified.length > 0 ? (
        <Alert
          tone="warn"
          className="mb-4"
          title={`${unverified.length} factor ${unverified.length === 1 ? "value is a development placeholder" : "values are development placeholders"}`}
        >
          Record the publication you actually read (document, table, edition). A citation that is
          empty, trivial, or still carries a <span className="font-mono">TO VERIFY</span> marker is
          rejected. Corrected values apply to this organisation&rsquo;s runs.
        </Alert>
      ) : null}

      {stateError ? (
        <Alert tone="error" className="mb-4" title="Verification state could not be read">
          {stateError}. The catalogue below is shown as the code ships it, with every factor
          unverified.
        </Alert>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>Factor</Th>
            <Th>Vintage</Th>
            <Th className="text-right">Value</Th>
            <Th>Source</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.record.id}::${r.record.vintage}`}>
              <Td>
                <div className="text-[13px] font-medium text-mist-900">{r.record.label}</div>
                <div className="font-mono text-xs text-mist-500">{r.record.id}</div>
              </Td>
              <Td className="font-mono text-xs">{r.record.vintage}</Td>
              <Td className="whitespace-nowrap text-right tabular">
                {r.value} <span className="text-xs text-mist-500">{r.record.unit}</span>
                {r.verified && r.value !== r.record.value ? (
                  <div className="text-xs text-mist-500">corrected from {r.record.value}</div>
                ) : null}
              </Td>
              <Td className="max-w-sm text-xs leading-relaxed text-mist-700">
                {r.source}
                {r.record.notes && !r.verified ? (
                  <div className="mt-1 text-mist-500">{r.record.notes}</div>
                ) : null}
              </Td>
              <Td>
                <Badge tone={r.verified ? "ok" : "draft"} dot>
                  {r.verified ? "Verified" : "Unverified"}
                </Badge>
                {r.verifiedAt ? (
                  <div className="mt-1 text-xs text-mist-500">
                    {formatIst(r.verifiedAt)}
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <section className="mt-10">
        <SectionTitle>Record a catalogue citation</SectionTitle>
        {!organizationId ? (
          <ForbiddenState body="Sign in to an organisation to write catalogue citations." />
        ) : unverified.length === 0 ? (
          <Alert tone="ok">Every factor in the register carries a citation.</Alert>
        ) : (
          <FactorVerifyPanel
            canChangeValue
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
