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
import { registryForPack } from "@verifystack/backend/domain/registry";
import type { CevRow } from "@/components/review/cev-panel";

/** "Page 3", "Spreadsheet cell", etc. Falls back to the stored type for a malformed row. */
function describeFactSource(f: ProvenanceColumns): string {
  const p = provenanceFromColumns(f);
  if (!p) return "Incomplete";
  return p.type === "document_page" ? `Page ${p.page}` : PROVENANCE_LABEL[p.type];
}

/** Inline expandable CEV context for a fact that has a canonical_key. */
function CevContext({
  canonicalKey,
  cevs,
  label,
}: {
  canonicalKey: string;
  cevs: CevRow[];
  label: string;
}) {
  if (cevs.length === 0) return null;

  const METHOD_SHORT: Record<string, string> = {
    ai_extraction: "AI",
    workbook_reader: "Workbook",
    regex_propose: "Desk-review",
    manual_entry: "Manual",
    site_observation: "Site",
  };

  const fmtVal = (c: CevRow) => {
    if (c.state === "corrected") {
      const v = c.correction_numeric ?? c.correction_text ?? "—";
      const u = c.correction_unit ?? c.value_unit ?? "";
      return `${v}${u ? " " + u : ""} ✎`;
    }
    const v = c.value_numeric ?? c.value_text ?? c.value_as_stated ?? "—";
    const u = c.value_unit ?? "";
    return `${v}${u ? " " + u : ""}`;
  };

  const activeCevs = cevs.filter((c) => c.state === "accepted" || c.state === "corrected");
  const promotedCev = cevs.find((c) => c.fact_id !== null);

  return (
    <details className="mt-1">
      <summary className="cursor-pointer select-none text-xs text-teal-700 hover:underline">
        {activeCevs.length} source{activeCevs.length !== 1 ? "s" : ""} for {label || canonicalKey}
        {promotedCev ? " · From CEV roll-up" : ""}
      </summary>
      <div className="mt-1.5 overflow-x-auto rounded border border-mist-200 bg-mist-50 p-2">
        <table className="w-full text-[11px] text-mist-700">
          <thead>
            <tr className="border-b border-mist-200">
              <th className="pb-1 pr-3 text-left font-medium">Source</th>
              <th className="pb-1 pr-3 text-left font-medium">Period</th>
              <th className="pb-1 pr-3 text-right font-medium">Value</th>
              <th className="pb-1 text-left font-medium">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mist-100">
            {activeCevs.map((c) => (
              <tr key={c.id}>
                <td className="py-0.5 pr-3">{METHOD_SHORT[c.extraction_method] ?? c.extraction_method}</td>
                <td className="py-0.5 pr-3 font-mono">
                  {c.period_kind === "single_reading" || c.period_kind === "document_period"
                    ? c.period_kind.replace("_", " ")
                    : c.period_start && c.period_end
                      ? `${c.period_start.slice(0, 7)} – ${c.period_end.slice(0, 7)}`
                      : c.period_kind}
                </td>
                <td className="py-0.5 pr-3 text-right font-mono font-medium text-mist-900 tabular">
                  {fmtVal(c)}
                </td>
                <td className="py-0.5">
                  {c.fact_id ? (
                    <span className="text-green-700">✓ promoted</span>
                  ) : c.state === "corrected" ? (
                    <span className="text-blue-700">corrected</span>
                  ) : (
                    <span className="text-green-700">accepted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
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
  const [{ data: facts }, { data: withdrawn }, { data: cevRows }] = await Promise.all([
    supabase!
      .from("facts")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("accepted_at", { ascending: false }),
    // Without migration 0022 this table is absent: facts still show, and withdrawing waits.
    supabase!
      .from("fact_withdrawals")
      .select("id, field_path, value_json, unit, reason, withdrawn_at")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("withdrawn_at", { ascending: false })
      .limit(200),
    // Accepted/corrected CEVs for multi-source context (read-only here)
    supabase!
      .from("canonical_evidence_values")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .in("state", ["accepted", "corrected"])
      .order("created_at", { ascending: false }),
  ]);

  const canWithdraw = !["signoff", "submitted"].includes(engagement.status);

  // Build canonical_key → CevRow[] map for context sidebar
  const cevByKey: Record<string, CevRow[]> = {};
  for (const cev of cevRows ?? []) {
    const key = cev.canonical_key as string;
    if (!cevByKey[key]) cevByKey[key] = [];
    cevByKey[key]!.push(cev as unknown as CevRow);
  }

  // Human-readable label for each canonical_key
  const registry = registryForPack(engagement.pack_id);
  const keyLabel: Record<string, string> = {};
  if (registry) {
    for (const entry of registry.entries) {
      keyLabel[entry.key] = entry.meaning;
    }
  }

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
            {facts.map((f) => {
              const canonicalKey = (f as Record<string, unknown>).canonical_key as string | null;
              const cevs = canonicalKey ? (cevByKey[canonicalKey] ?? []) : [];
              return (
                <tr key={f.id}>
                  <Td className="font-mono text-xs text-mist-700">
                    <span className="block">{f.field_path}</span>
                    {canonicalKey ? (
                      <CevContext
                        canonicalKey={canonicalKey}
                        cevs={cevs}
                        label={keyLabel[canonicalKey] ?? canonicalKey}
                      />
                    ) : null}
                  </Td>
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
              );
            })}
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
