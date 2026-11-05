import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { Comparison, Origin, PairResult } from "@verifystack/backend/domain/registry/compare";

/**
 * The same quantity from every source that states it, side by side. Read only: nothing on this card
 * writes, and no figure is ever copied from one source into another. The sources stay independent so
 * that an agreement means something.
 */

const ORIGIN_LABEL: Record<Origin, { label: string; hint: string }> = {
  proforma: { label: "Pro forma", hint: "the entity's declaration" },
  workbook: { label: "Workbook", hint: "the entity's own file, read by code" },
  desk_reading: { label: "Desk reading", hint: "typed from a page by the verifier" },
  fact: { label: "Workbench fact", hint: "approved by a person from an extraction" },
};

const PAIR_TONE: Record<PairResult["state"], BadgeTone> = { agree: "ok", disagree: "block", not_compared: "neutral" };
const PAIR_LABEL: Record<PairResult["state"], string> = { agree: "Agrees", disagree: "Disagrees", not_compared: "Not compared" };

export function EvidenceComparison({ comparison }: { comparison: Comparison | null }) {
  if (!comparison) return null;
  const entries = comparison.entries.filter((e) => e.sources.length > 0);

  return (
    <Card>
      <CardHeader
        title="Evidence side by side"
        description="Each quantity from every source that states it, on one unit. Read only: nothing here is copied between sources, and two figures are compared only when they cover the same thing."
      />
      <CardBody className="space-y-5">
        {entries.length === 0 ? (
          <p className="text-sm text-mist-600">
            No pro forma figure, workbook reading, typed reading or approved fact has been recorded for clinker production, coal GCV or
            grid electricity yet.
          </p>
        ) : (
          entries.map((e) => {
            const facts = e.sources.map((s, i) => ({ s, i })).filter((x) => x.s.origin === "fact");
            return (
              <section key={e.key} className="space-y-2" aria-labelledby={`cmp-${e.key}`}>
                <div>
                  <h3 id={`cmp-${e.key}`} className="font-mono text-xs font-semibold text-mist-700">
                    {e.key}
                  </h3>
                  <p className="text-[11px] text-mist-500">{e.meaning}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-mist-200 text-[11px] uppercase tracking-wide text-mist-500">
                        <th className="py-1 pr-3 font-medium">Source</th>
                        <th className="py-1 pr-3 font-medium">Name</th>
                        <th className="py-1 pr-3 font-medium">As stated</th>
                        <th className="py-1 pr-3 font-medium">On {e.standardUnit}</th>
                        <th className="py-1 pr-3 font-medium">Covers</th>
                        <th className="py-1 font-medium">Document</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.sources.map((s, i) => (
                        <tr key={`${s.origin}:${s.name}:${s.factId ?? i}`} className="border-b border-mist-100 align-top">
                          <td className="py-1.5 pr-3">
                            <span className="font-medium text-mist-900">{ORIGIN_LABEL[s.origin].label}</span>
                            <span className="block text-[11px] text-mist-500">{ORIGIN_LABEL[s.origin].hint}</span>
                          </td>
                          <td className="py-1.5 pr-3 font-mono text-[11px] text-mist-700">{s.name}</td>
                          <td className="py-1.5 pr-3 tabular-nums text-mist-900">{s.asStated}</td>
                          <td className="py-1.5 pr-3 tabular-nums text-mist-900">
                            {s.standard === null ? (
                              <span className="text-mist-500" title={s.note ?? undefined}>
                                not placed
                              </span>
                            ) : (
                              s.standard.toLocaleString("en-IN", { maximumFractionDigits: 3 })
                            )}
                            {s.standard === null && s.note ? <span className="block text-[11px] text-mist-500">{s.note}</span> : null}
                          </td>
                          <td className="py-1.5 pr-3 text-mist-600">{s.period ?? s.scope.replace(/_/g, " ")}</td>
                          <td className="py-1.5 text-mist-600">{s.documentName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {facts.length > 0 ? (
                  <ul className="space-y-1">
                    {e.pairs.map((p) => (
                      <li key={`${p.fact}:${p.other}`} className="flex flex-wrap items-start gap-2 text-[11px] text-mist-600">
                        <Badge tone={PAIR_TONE[p.state]} dot>
                          {PAIR_LABEL[p.state]}
                        </Badge>
                        <span className="min-w-0 flex-1">
                          <span className="font-mono">{e.sources[p.fact]?.name}</span> against{" "}
                          <span className="font-mono">{e.sources[p.other]?.name}</span>: {p.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-mist-500">No approved Workbench fact is keyed to this quantity yet, so there is nothing to set the others against.</p>
                )}
              </section>
            );
          })
        )}
        {comparison.unmappedFacts > 0 ? (
          <p className="text-[11px] text-mist-500">
            {comparison.unmappedFacts} approved fact{comparison.unmappedFacts === 1 ? " is" : "s are"} not keyed to a registry quantity: accepted before the registry, or
            from a source it does not map. They are not shown here and are not affected.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
