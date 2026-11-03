import Link from "next/link";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/cn";
import { listPacks, listStructurePacks } from "@verifystack/backend/domain/packs";
import type {
  MethodologyPack,
  PackScheme,
} from "@verifystack/backend/domain/packs";

export const metadata = { title: "Methodology packs" };

const SCHEMES: PackScheme[] = ["CCTS", "ADEETIE"];

function isScheme(value: string | undefined): value is PackScheme {
  return value === "CCTS" || value === "ADEETIE";
}

export default async function PacksPage({
  searchParams,
}: {
  searchParams: Promise<{ scheme?: string }>;
}) {
  const { scheme } = await searchParams;
  const active = isScheme(scheme) ? scheme : null;
  const all = listPacks();
  const packs = active ? all.filter((p) => p.scheme === active) : all;

  const groups = SCHEMES.map((s) => ({
    scheme: s,
    packs: packs.filter((p) => p.scheme === s),
  })).filter((g) => g.packs.length > 0);

  return (
    <>
      <PageHeader
        kicker="Library"
        title="Methodology packs"
        description="Each pack holds a sector's document types, calculation bindings, factors and clause references as data. The calculation engine reads the pack; it never branches on sector."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by scheme">
        <SchemeFilter active={active} label="All schemes" href="/packs" count={all.length} />
        {SCHEMES.map((s) => (
          <SchemeFilter
            key={s}
            active={active}
            scheme={s}
            label={s}
            href={`/packs?scheme=${s}`}
            count={all.filter((p) => p.scheme === s).length}
          />
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No packs match"
          body="No methodology pack matches this filter."
          action={{ href: "/packs", label: "Clear filter" }}
        />
      ) : (
        groups.map((group) => {
          const runnable = group.packs.filter((p) => p.status === "runnable").length;
          const notYet = group.packs.length - runnable;
          return (
            <section key={group.scheme} className="mb-8">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-mist-900">{group.scheme}</h2>
                <span className="text-xs text-mist-500">
                  {group.packs.length} {group.packs.length === 1 ? "pack" : "packs"}
                </span>
                <Badge tone="ok" dot>
                  {runnable} runnable
                </Badge>
                {notYet > 0 ? (
                  <Badge tone="draft" dot>
                    {notYet} not yet runnable
                  </Badge>
                ) : null}
              </div>
              <PackTable packs={group.packs} />
            </section>
          );
        })
      )}

      {active ? null : (
        <section className="mb-8" aria-labelledby="structure-heading">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id="structure-heading" className="text-sm font-semibold text-mist-900">
              Structure only
            </h2>
            <Badge tone="neutral">Not runnable</Badge>
          </div>
          <p className="mb-3 max-w-3xl text-sm text-mist-600">
            These describe the boundary and the inputs a methodology will need. They hold no emission
            factor, formula or threshold, because none has been sourced. No engagement can be started on
            them.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Pack</Th>
                <Th>Scope</Th>
                <Th>Inputs declared</Th>
                <Th>Open items</Th>
              </tr>
            </thead>
            <tbody>
              {listStructurePacks().map((p) => (
                <tr key={p.pack_id}>
                  <Td>
                    <Link
                      href={`/packs/${p.pack_id}`}
                      className="font-mono text-[13px] font-medium text-teal-800 hover:underline"
                    >
                      {p.pack_id}
                    </Link>
                  </Td>
                  <Td className="text-mist-900">{p.sector_or_cluster}</Td>
                  <Td className="text-[13px] tabular">{p.structure_only?.requiredInputs.length ?? 0}</Td>
                  <Td className="text-[13px] tabular">{p.structure_only?.openItems.length ?? 0}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </>
  );
}

function SchemeFilter({
  active,
  scheme,
  label,
  href,
  count,
}: {
  active: PackScheme | null;
  scheme?: PackScheme;
  label: string;
  href: string;
  count: number;
}) {
  const selected = (scheme ?? null) === active;
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors",
        selected
          ? "border-teal-700 bg-teal-700 text-white"
          : "border-mist-200 bg-white text-mist-700 hover:border-mist-300 hover:bg-mist-50"
      )}
    >
      {label}
      <span className={cn("text-xs tabular", selected ? "text-teal-100" : "text-mist-500")}>{count}</span>
    </Link>
  );
}

function PackTable({ packs }: { packs: MethodologyPack[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Pack</Th>
          <Th>Sector or cluster</Th>
          <Th>Method</Th>
          <Th>Bindings</Th>
          <Th>Clusters</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {packs.map((p) => {
          const bindings =
            p.calculation_method === "SEC"
              ? `${p.energy_bindings?.length ?? 0} energy`
              : `${p.stream_bindings.length} stream`;
          return (
            <tr key={p.pack_id}>
              <Td>
                <Link
                  href={`/packs/${p.pack_id}`}
                  className="font-mono text-[13px] font-medium text-teal-800 hover:underline"
                >
                  {p.pack_id}
                </Link>
                <div className="text-xs text-mist-500">v{p.version}</div>
              </Td>
              <Td className="text-mist-900">{p.sector_or_cluster}</Td>
              <Td>
                <Badge>{p.calculation_method}</Badge>
              </Td>
              <Td className="text-[13px] text-mist-600">{bindings}</Td>
              <Td className="text-[13px] tabular">
                {p.adeetie ? p.adeetie.clusters.length : <span className="text-mist-400">—</span>}
              </Td>
              <Td>
                <Badge tone={p.status === "runnable" ? "ok" : "draft"} dot>
                  {p.status === "runnable" ? "Runnable" : "Not yet runnable"}
                </Badge>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
