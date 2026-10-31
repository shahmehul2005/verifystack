import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@/lib/session";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { formatIst } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";
import { WithdrawFactButton } from "./withdraw-fact-button";
import {
  factLabel,
  PROVENANCE_LABEL,
  provenanceFromColumns,
  type ProvenanceColumns,
} from "@verifystack/backend/domain/provenance";

/** "Page 3", "Spreadsheet cell", etc. Falls back to the stored type for a malformed row. */
function describeFactSource(f: ProvenanceColumns): string {
  const p = provenanceFromColumns(f);
  if (!p) return "Incomplete";
  return p.type === "document_page" ? `Page ${p.page}` : PROVENANCE_LABEL[p.type];
}

export const metadata = { title: "Facts ledger" };

export default async function FactsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="The facts ledger is for verifiers and reviewers." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data: facts } = await supabase!
    .from("facts")
    .select("*")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("accepted_at", { ascending: false });
  // Without migration 0022 this table is absent: facts still show, and withdrawing waits.
  const { data: withdrawn } = await supabase!
    .from("fact_withdrawals")
    .select("id, field_path, value_json, unit, reason, withdrawn_at")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("withdrawn_at", { ascending: false })
    .limit(200);
  const canWithdraw = !["signoff", "submitted"].includes(engagement.status);

  return (
    <>
      <PageHeader
        title="Facts ledger"
        description="Values a person has accepted. Each one keeps its document, page, region and the exact source text it was read from."
        meta={
          facts?.length ? (
            <Badge tone="ok" dot>
              {facts.length} accepted {facts.length === 1 ? "fact" : "facts"}
            </Badge>
          ) : undefined
        }
      />
      {!facts?.length ? (
        <EmptyState
          icon={BookOpen}
          title="No accepted facts yet"
          body="Upload evidence, run extraction and accept values in the review workbench. Accepted values appear here."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th className="text-right">Value</Th>
              <Th>Source text</Th>
              <Th className="text-right">Evidence</Th>
              <Th>Accepted</Th>
              {canWithdraw ? <Th className="text-right">Withdraw</Th> : null}
            </tr>
          </thead>
          <tbody>
            {facts.map((f) => (
              <tr key={f.id}>
                <Td className="font-mono text-xs text-mist-700">{f.field_path}</Td>
                <Td className="whitespace-nowrap text-right tabular">
                  <span className="font-medium text-mist-950">{JSON.stringify(f.value_json)}</span>
                  {f.unit ? <span className="ml-1 text-xs text-mist-500">{f.unit}</span> : null}
                </Td>
                <Td className="max-w-sm">
                  <span className="block truncate font-mono text-xs text-mist-600" title={factLabel(f)}>
                    {factLabel(f)}
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-right text-xs text-mist-600">
                  {describeFactSource(f)}
                </Td>
                <Td className="whitespace-nowrap text-xs text-mist-600">{formatIst(f.accepted_at)}</Td>
                {canWithdraw ? (
                  <Td className="text-right">
                    <WithdrawFactButton engagementId={id} factId={f.id} label={f.field_path} />
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {withdrawn?.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-mist-900">Withdrawn facts</h2>
          <p className="mb-3 text-[13px] text-mist-600">
            Taken out of the ledger a calculation reads, and kept here with who withdrew them and why.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Field</Th>
                <Th className="text-right">Value</Th>
                <Th>Reason</Th>
                <Th>Withdrawn</Th>
              </tr>
            </thead>
            <tbody>
              {withdrawn.map((w) => (
                <tr key={w.id}>
                  <Td className="font-mono text-xs text-mist-700">{w.field_path}</Td>
                  <Td className="whitespace-nowrap text-right tabular">
                    <span className="font-medium text-mist-950">{JSON.stringify(w.value_json)}</span>
                    {w.unit ? <span className="ml-1 text-xs text-mist-500">{w.unit}</span> : null}
                  </Td>
                  <Td className="max-w-sm text-xs text-mist-700">{w.reason}</Td>
                  <Td className="whitespace-nowrap text-xs text-mist-600">{formatIst(w.withdrawn_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}
    </>
  );
}
