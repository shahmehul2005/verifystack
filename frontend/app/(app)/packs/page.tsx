import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/states";
import { UnverifiedNotice } from "@/components/adeetie/notices";
import { listPacks } from "@verifystack/backend/domain/packs";
import type {
  MethodologyPack,
  PackScheme,
} from "@verifystack/backend/domain/packs";

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

  const unverifiedClusters = all.some(
    (p) => p.adeetie && !p.adeetie.clustersVerified
  );

  return (
    <>
      <PageHeader
        kicker="D3"
        title="Methodology packs"
        description="Process 3.0 and 5.0 load a pack record. They never contain sector if-branches. All nine CCTS sectors and all fourteen ADEETIE Phase 1 sectors are runnable; factors remain unverified until a human cites a published source."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
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

      {unverifiedClusters && (active === null || active === "ADEETIE") ? (
        <UnverifiedNotice
          title="ADEETIE notified cluster lists carried by these packs are UNVERIFIED"
          body="The official BEE cluster page has not been read back against the rows held here. Cluster coverage shown on an ADEETIE pack is a working reference, not an eligibility determination."
        />
      ) : null}

      {groups.length === 0 ? (
        <EmptyState
          title="No packs"
          body="No methodology pack matches this filter."
          action={{ href: "/packs", label: "Clear filter" }}
        />
      ) : (
        groups.map((group) => (
          <section key={group.scheme} className="mb-8">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{group.scheme}</h2>
              <Badge>{group.packs.length} pack(s)</Badge>
              <Badge tone="ok">
                {group.packs.filter((p) => p.status === "runnable").length} runnable
              </Badge>
              <Badge tone="draft">
                {group.packs.filter((p) => p.status === "scaffold").length} scaffold
              </Badge>
            </div>
            <PackTable packs={group.packs} />
          </section>
        ))
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
      className={
        selected
          ? "inline-flex h-8 items-center bg-stone-900 px-2.5 text-[12px] text-white"
          : "inline-flex h-8 items-center bg-white px-2.5 text-[12px] text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"
      }
    >
      {label}
      <span className="ml-2 text-stone-400">{count}</span>
    </Link>
  );
}

function PackTable({ packs }: { packs: MethodologyPack[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Pack</Th>
          <Th>Sector / cluster</Th>
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
              <Td className="font-mono text-[12px]">
                <Link href={`/packs/${p.pack_id}`} className="hover:underline">
                  {p.pack_id}
                </Link>
                <div className="text-[11px] text-stone-500">v{p.version}</div>
              </Td>
              <Td>{p.sector_or_cluster}</Td>
              <Td>{p.calculation_method}</Td>
              <Td className="text-[12px] text-stone-600">{bindings}</Td>
              <Td className="text-[12px]">
                {p.adeetie ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {p.adeetie.clusters.length}
                    <Badge tone={p.adeetie.clustersVerified ? "ok" : "draft"}>
                      {p.adeetie.clustersVerified ? "verified" : "unverified"}
                    </Badge>
                  </span>
                ) : (
                  <span className="text-stone-400">—</span>
                )}
              </Td>
              <Td>
                <Badge tone={p.status === "runnable" ? "ok" : "draft"}>{p.status}</Badge>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
