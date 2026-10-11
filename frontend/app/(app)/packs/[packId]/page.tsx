import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { buttonVariants } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { loadPack, PackError } from "@verifystack/backend/domain/packs";
import type {
  MethodologyPack,
  PackEnergyBinding,
  PackQuantityBinding,
  PackStreamBinding,
} from "@verifystack/backend/domain/packs";
import { ALL_FACTOR_RECORDS } from "@verifystack/backend/domain/factors";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  return { title: packId };
}

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
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Methodology packs", href: "/packs" },
            { label: pack.scheme, href: `/packs?scheme=${pack.scheme}` },
            { label: pack.pack_id },
          ]}
        />
      </div>
      <PageHeader
        kicker={`${pack.scheme} · ${pack.sector_or_cluster}`}
        title={<span className="font-mono text-xl">{pack.pack_id}</span>}
        description={pack.notes}
        meta={
          <>
            <Badge tone={pack.status === "runnable" ? "ok" : "draft"} dot>
              {pack.status === "runnable" ? "Runnable" : "Not yet runnable"}
            </Badge>
            <Badge>{pack.calculation_method}</Badge>
            <Badge tone="ink">v{pack.version}</Badge>
            <span className="text-xs text-mist-600">
              Report template <span className="font-mono">{pack.report_template}</span>
            </span>
          </>
        }
        actions={
          <Link
            href={`/packs?scheme=${pack.scheme}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            All {pack.scheme} packs
          </Link>
        }
      />

      {pack.structure_only ? (
        <>
          <Alert tone="warn" title="Structure only" className="mb-6">
            {pack.structure_only.summary} This pack records the boundary and the inputs a method will
            need. It holds no factor, formula or threshold, and no engagement can be started on it.
          </Alert>
          <Section title="Boundary">
            <ul className="list-disc space-y-1 pl-5 text-sm text-mist-800">
              {pack.structure_only.boundary.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Section>
          <Section title="Inputs the method will need">
            <Table>
              <thead>
                <tr>
                  <Th>Input</Th>
                  <Th>Evidence it may rest on</Th>
                  <Th>Unit family</Th>
                </tr>
              </thead>
              <tbody>
                {pack.structure_only.requiredInputs.map((i) => (
                  <tr key={i.key}>
                    <Td className="text-mist-900">{i.label}</Td>
                    <Td className="text-[13px] text-mist-600">{i.evidence.join(", ").replaceAll("_", " ")}</Td>
                    <Td className="text-[13px] text-mist-600">{i.unitFamily ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
          <Section title="Open items before this can run">
            <ul className="list-disc space-y-1 pl-5 text-sm text-mist-800">
              {pack.structure_only.openItems.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </Section>
        </>
      ) : pack.status === "scaffold" ? (
        <Alert tone="warn" title="Not yet runnable" className="mb-6">
          This pack is declared but cannot run yet. An engagement can be recorded against it in
          setup; intake, extraction and calculation stay disabled.
        </Alert>
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
                  <div className="font-mono text-xs text-mist-500">{t.id}</div>
                </Td>
                <Td>
                  <Badge tone={t.extractable ? "ok" : "neutral"}>
                    {t.extractable ? "Extractable" : "Manual entry"}
                  </Badge>
                  {t.extractable ? (
                    <div className="mt-1 font-mono text-xs text-mist-500">
                      {pack.field_schemas[t.id] ?? "—"}
                    </div>
                  ) : null}
                </Td>
                <Td className="max-w-md text-xs text-mist-600">{t.notes ?? "—"}</Td>
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
                <Td className="font-mono text-xs">{pack.production_binding.path}</Td>
                <Td className="font-mono text-xs">
                  {pack.production_binding.units.join(", ")}
                </Td>
                <Td className="font-mono text-xs">{pack.production_binding.defaultUnit}</Td>
                <Td className="text-xs">
                  {pack.production_binding.productLabel}
                  <div className="font-mono text-xs text-mist-500">
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
          <dl className="grid gap-4 rounded-lg border border-mist-200 bg-white p-5 text-[13px] shadow-xs sm:grid-cols-3">
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
                    <Td className="font-mono text-xs">{binding.path}</Td>
                    <Td className="font-mono text-xs">{binding.units.join(", ")}</Td>
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
            <Alert tone="info" className="mb-3">
              These clause references are compiled working references. Any reference marked{" "}
              <span className="font-mono">TO VERIFY</span> has not been read back against the
              operative published document and must not be cited in a filed report as it stands.
            </Alert>
            <Table>
              <thead>
                <tr>
                  <Th>Rule</Th>
                  <Th>Clause reference</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {pack.clause_citations.map((c) => (
                    <tr key={c.ruleId}>
                      <Td className="font-mono text-xs">{c.ruleId}</Td>
                      <Td className="max-w-xl text-xs leading-relaxed">{c.clauseRef}</Td>
                      <Td>
                        <Badge>Recorded</Badge>
                      </Td>
                    </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Section>

      {pack.adeetie ? (
        <Section title="ADEETIE notified clusters">
          {pack.adeetie.clusterSource ? (
            <p className="mb-3 text-xs leading-relaxed text-mist-600">{pack.adeetie.clusterSource}</p>
          ) : null}
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
                  <div className="font-mono text-xs text-mist-500">{b.streamId}</div>
                </Td>
                <Td className="font-mono text-xs">{b.kind}</Td>
                <Td className="font-mono text-xs">
                  {b.quantity.path}
                  <div className="text-mist-500">
                    {b.quantity.units.join(", ")} · default {b.quantity.defaultUnit}
                  </div>
                </Td>
                <Td className="font-mono text-xs">
                  {b.kind === "process_direct"
                    ? b.methodologyRef
                    : `${b.factorKey} (${b.factorVintage})`}
                  {b.kind === "fuel_combustion" ? (
                    <div className="text-mist-500">
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
          it is not yet runnable.
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
                  <div className="font-mono text-xs text-mist-500">
                    {b.streamId}
                    {b.onSiteGeneration ? " · on-site generation" : ""}
                  </div>
                </Td>
                <Td className="font-mono text-xs">{b.kind}</Td>
                <Td className="font-mono text-xs">
                  {b.quantity.path}
                  <div className="text-mist-500">
                    {b.quantity.units.join(", ")} · default {b.quantity.defaultUnit}
                  </div>
                </Td>
                <Td className="font-mono text-xs">
                  {b.calorificValue ? (
                    <>
                      {b.calorificValue.path}
                      <div className="text-mist-500">
                        measured value wins; falls back to {b.factorKey ?? "—"} (
                        {b.factorVintage ?? "—"})
                      </div>
                    </>
                  ) : b.factorKey ? (
                    `${b.factorKey} (${b.factorVintage ?? "—"})`
                  ) : (
                    <span className="text-mist-500">none — already an energy quantity</span>
                  )}
                  {b.energyContentBasis ? (
                    <div className="text-mist-500">
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
  return (
    <Section title="Declared factors">
      {rows.length === 0 ? (
        <Muted>This pack declares no emission or energy factors.</Muted>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Factor</Th>
                <Th>Role</Th>
                <Th>Vintage</Th>
                <Th>Value</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ref, record }) => (
                <tr key={`${ref.factorKey}::${ref.vintage}`}>
                  <Td>
                    <div className="font-mono text-xs">{ref.factorKey}</div>
                    <div className="text-xs text-mist-500">{record?.label ?? "—"}</div>
                  </Td>
                  <Td className="text-xs">{ref.role}</Td>
                  <Td className="font-mono text-xs">{ref.vintage}</Td>
                  <Td className="tabular whitespace-nowrap text-xs">
                    {record ? `${record.value} ${record.unit}` : "not in registry"}
                  </Td>
                  <Td className="max-w-sm text-xs leading-relaxed text-mist-600">
                    {record?.source ?? "—"}
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
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-mist-300 bg-white px-4 py-5 text-[13px] text-mist-600">
      {children}
    </p>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-mist-600">{label}</dt>
      <dd className="mt-0.5 font-mono text-[13px] text-mist-900">{value}</dd>
    </div>
  );
}
