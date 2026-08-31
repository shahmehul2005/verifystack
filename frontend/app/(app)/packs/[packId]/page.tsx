import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { ClusterSourceNotice } from "@/components/adeetie/notices";
import { loadPack, PackError } from "@verifystack/backend/domain/packs";
import type {
  MethodologyPack,
  PackEnergyBinding,
  PackQuantityBinding,
  PackStreamBinding,
} from "@verifystack/backend/domain/packs";
import { ALL_FACTOR_RECORDS } from "@verifystack/backend/domain/factors";

export default async function PackDetailPage({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  let pack: MethodologyPack;
  try {
    pack = loadPack(packId);
  } catch (e) {
    if (e instanceof PackError) notFound();
    throw e;
  }

  return (
    <>
      <PageHeader
        kicker={`${pack.scheme} · ${pack.sector_or_cluster}`}
        title={pack.pack_id}
        description={pack.notes}
        actions={
          <Link
            href={`/packs?scheme=${pack.scheme}`}
            className="inline-flex h-9 items-center bg-white px-3 text-sm ring-1 ring-stone-300 hover:bg-stone-50"
          >
            All {pack.scheme} packs
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={pack.status === "runnable" ? "ok" : "draft"}>{pack.status}</Badge>
        <Badge>{pack.calculation_method}</Badge>
        <Badge tone="ink">v{pack.version}</Badge>
        <span className="text-[12px] text-stone-600">
          report template <span className="font-mono">{pack.report_template}</span>
        </span>
      </div>

      {pack.status === "scaffold" ? (
        <div className="mb-6 border border-amber-400 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-950">
          <Badge tone="draft">Scaffold</Badge>
          <span className="ml-2">
            This pack is declared but not runnable. An engagement can be recorded against it in
            setup; intake, extraction and calculation stay disabled.
          </span>
        </div>
      ) : null}

      <Section title="Document taxonomy">
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Extractable</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {pack.document_taxonomy.map((t) => (
              <tr key={t.id}>
                <Td>
                  <div className="text-[13px]">{t.label}</div>
                  <div className="font-mono text-[11px] text-stone-500">{t.id}</div>
                </Td>
                <Td>
                  <Badge tone={t.extractable ? "ok" : "neutral"}>
                    {t.extractable ? "extractable" : "manual"}
                  </Badge>
                  {t.extractable ? (
                    <div className="mt-1 font-mono text-[11px] text-stone-500">
                      {pack.field_schemas[t.id] ?? "—"}
                    </div>
                  ) : null}
                </Td>
                <Td className="max-w-md text-[12px] text-stone-600">{t.notes ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      {pack.calculation_method === "SEC" ? (
        <EnergyBindings bindings={pack.energy_bindings ?? []} />
      ) : (
        <StreamBindings bindings={pack.stream_bindings} />
      )}

      <Section title="Production binding (the denominator)">
        {pack.production_binding ? (
          <Table>
            <thead>
              <tr>
                <Th>Fact path</Th>
                <Th>Accepted units</Th>
                <Th>Default unit</Th>
                <Th>Product</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="font-mono text-[12px]">{pack.production_binding.path}</Td>
                <Td className="font-mono text-[12px]">
                  {pack.production_binding.units.join(", ")}
                </Td>
                <Td className="font-mono text-[12px]">{pack.production_binding.defaultUnit}</Td>
                <Td className="text-[12px]">
                  {pack.production_binding.productLabel}
                  <div className="font-mono text-[11px] text-stone-500">
                    {pack.production_binding.productUnitLabel}
                  </div>
                </Td>
              </tr>
            </tbody>
          </Table>
        ) : (
          <Muted>
            No production binding is declared, so this pack has no denominator and cannot be run.
          </Muted>
        )}
      </Section>

      {pack.sec_config ? (
        <Section title="SEC reporting configuration">
          <dl className="grid gap-2 border border-stone-200 bg-white p-3 text-[13px] sm:grid-cols-3">
            <Field label="Reporting energy unit" value={pack.sec_config.reportingEnergyUnit} />
            <Field label="Intensity unit" value={pack.sec_config.secUnitLabel} />
            <Field
              label="Minimum savings"
              value={
                pack.sec_config.minSavingsPct !== undefined
                  ? `${pack.sec_config.minSavingsPct}% (TO VERIFY)`
                  : "not declared"
              }
            />
          </dl>
        </Section>
      ) : null}

      {pack.demand_binding ? (
        <Section title="Demand binding (apparent power — never summed into energy)">
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Fact path</Th>
                <Th>Accepted units</Th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Contracted demand", pack.demand_binding.contractedDemand],
                  ["Maximum demand", pack.demand_binding.maximumDemand],
                ] as [string, PackQuantityBinding | undefined][]
              )
                .filter((row): row is [string, PackQuantityBinding] => Boolean(row[1]))
                .map(([label, binding]) => (
                  <tr key={label}>
                    <Td>{label}</Td>
                    <Td className="font-mono text-[12px]">{binding.path}</Td>
                    <Td className="font-mono text-[12px]">{binding.units.join(", ")}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Section>
      ) : null}

      <DeclaredFactors pack={pack} />

      <Section title="Reconciliation rules and clause citations">
        {pack.clause_citations.length === 0 ? (
          <Muted>No clause citations are declared for this pack.</Muted>
        ) : (
          <>
            <p className="mb-2 text-[12px] text-stone-600">
              Clause references below are compiled working references. Any reference carrying a{" "}
              <span className="font-mono">TO VERIFY</span> marker has not been read back against
              the operative published document and must not be cited in a filed report as it
              stands.
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Clause reference</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {pack.clause_citations.map((c) => {
                  const unverified = /TO VERIFY/i.test(c.clauseRef);
                  return (
                    <tr key={c.ruleId}>
                      <Td className="font-mono text-[12px]">{c.ruleId}</Td>
                      <Td className="max-w-xl text-[12px] leading-relaxed">{c.clauseRef}</Td>
                      <Td>
                        <Badge tone={unverified ? "draft" : "neutral"}>
                          {unverified ? "unverified" : "recorded"}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}
      </Section>

      {pack.adeetie ? (
        <Section title="ADEETIE notified clusters">
          <ClusterSourceNotice
            clusterSource={pack.adeetie.clusterSource}
            clustersVerified={pack.adeetie.clustersVerified}
            clusterCount={pack.adeetie.clusters.length}
          />
          {pack.adeetie.clusters.length === 0 ? (
            <Muted>No notified cluster is recorded for this sector.</Muted>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>State</Th>
                  <Th>Cluster as notified</Th>
                </tr>
              </thead>
              <tbody>
                {pack.adeetie.clusters.map((c) => (
                  <tr key={`${c.state}-${c.cluster}`}>
                    <Td>{c.state}</Td>
                    <Td>{c.cluster}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      ) : null}
    </>
  );
}

function StreamBindings({ bindings }: { bindings: PackStreamBinding[] }) {
  return (
    <Section title="Stream bindings (GEI)">
      {bindings.length === 0 ? (
        <Muted>This pack declares no stream bindings.</Muted>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Stream</Th>
              <Th>Kind</Th>
              <Th>Quantity fact</Th>
              <Th>Factor / methodology</Th>
              <Th>Required</Th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.streamId}>
                <Td>
                  <div className="text-[13px]">{b.label}</div>
                  <div className="font-mono text-[11px] text-stone-500">{b.streamId}</div>
                </Td>
                <Td className="font-mono text-[12px]">{b.kind}</Td>
                <Td className="font-mono text-[11px]">
                  {b.quantity.path}
                  <div className="text-stone-500">
                    {b.quantity.units.join(", ")} · default {b.quantity.defaultUnit}
                  </div>
                </Td>
                <Td className="font-mono text-[11px]">
                  {b.kind === "process_direct"
                    ? b.methodologyRef
                    : `${b.factorKey} (${b.factorVintage})`}
                  {b.kind === "fuel_combustion" ? (
                    <div className="text-stone-500">
                      {b.calorificValue.path} · basis {b.calorificBasis ?? "inferred"} · {b.phase}
                    </div>
                  ) : null}
                </Td>
                <Td>{b.required ? <Badge tone="block">required</Badge> : <Badge>optional</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

function EnergyBindings({ bindings }: { bindings: PackEnergyBinding[] }) {
  return (
    <Section title="Energy bindings (SEC)">
      {bindings.length === 0 ? (
        <Muted>
          This pack declares no energy bindings, so no SEC run can be mapped from it. That is why
          it is a scaffold.
        </Muted>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Stream</Th>
              <Th>Kind</Th>
              <Th>Quantity fact</Th>
              <Th>Calorific value</Th>
              <Th>Required</Th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.streamId}>
                <Td>
                  <div className="text-[13px]">{b.label}</div>
                  <div className="font-mono text-[11px] text-stone-500">
                    {b.streamId}
                    {b.onSiteGeneration ? " · on-site generation" : ""}
                  </div>
                </Td>
                <Td className="font-mono text-[12px]">{b.kind}</Td>
                <Td className="font-mono text-[11px]">
                  {b.quantity.path}
                  <div className="text-stone-500">
                    {b.quantity.units.join(", ")} · default {b.quantity.defaultUnit}
                  </div>
                </Td>
                <Td className="font-mono text-[11px]">
                  {b.calorificValue ? (
                    <>
                      {b.calorificValue.path}
                      <div className="text-stone-500">
                        measured value wins; falls back to {b.factorKey ?? "—"} (
                        {b.factorVintage ?? "—"})
                      </div>
                    </>
                  ) : b.factorKey ? (
                    `${b.factorKey} (${b.factorVintage ?? "—"})`
                  ) : (
                    <span className="text-stone-500">none — already an energy quantity</span>
                  )}
                  {b.energyContentBasis ? (
                    <div className="text-stone-500">
                      basis {b.energyContentBasis} · {b.phase ?? "—"}
                    </div>
                  ) : null}
                </Td>
                <Td>{b.required ? <Badge tone="block">required</Badge> : <Badge>optional</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

function DeclaredFactors({ pack }: { pack: MethodologyPack }) {
  const rows = pack.emission_or_energy_factors.map((ref) => ({
    ref,
    record: ALL_FACTOR_RECORDS.find(
      (r) => r.id === ref.factorKey && r.vintage === ref.vintage
    ),
  }));
  const unverified = rows.filter((r) => r.record && !r.record.verified).length;

  return (
    <Section title="Declared factors">
      {rows.length === 0 ? (
        <Muted>This pack declares no emission or energy factors.</Muted>
      ) : (
        <>
          {unverified > 0 ? (
            <div className="mb-2 border border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              <Badge tone="draft">Unverified</Badge>
              <span className="ml-2">
                {unverified} of {rows.length} declared factor(s) are development placeholders that
                no human has read back against a published source. The engine refuses them outside
                draft mode. Promote them on the{" "}
                <Link href="/factors" className="underline">
                  factor register
                </Link>
                .
              </span>
            </div>
          ) : null}
          <Table>
            <thead>
              <tr>
                <Th>Factor</Th>
                <Th>Role</Th>
                <Th>Vintage</Th>
                <Th>Value</Th>
                <Th>Source</Th>
                <Th>Verified</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ref, record }) => (
                <tr key={`${ref.factorKey}::${ref.vintage}`}>
                  <Td>
                    <div className="font-mono text-[12px]">{ref.factorKey}</div>
                    <div className="text-[11px] text-stone-500">{record?.label ?? "—"}</div>
                  </Td>
                  <Td className="text-[12px]">{ref.role}</Td>
                  <Td className="font-mono text-[12px]">{ref.vintage}</Td>
                  <Td className="tabular whitespace-nowrap text-[12px]">
                    {record ? `${record.value} ${record.unit}` : "not in registry"}
                  </Td>
                  <Td className="max-w-sm text-[11px] leading-relaxed text-stone-600">
                    {record?.source ?? "—"}
                  </Td>
                  <Td>
                    <Badge tone={record?.verified ? "ok" : "draft"}>
                      {record?.verified ? "verified" : "unverified"}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">{title}</h2>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-stone-300 bg-white px-3 py-4 text-[12px] text-stone-600">
      {children}
    </p>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="font-mono text-[13px]">{value}</dd>
    </div>
  );
}
