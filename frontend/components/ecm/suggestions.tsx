import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { ECM_NO_MATCH_MESSAGE } from "@verifystack/backend/domain/ecm/types";
import type { EcmSuggestionsPayload } from "@verifystack/backend/domain/ecm/types";

function formatGap(gap: EcmSuggestionsPayload["gap"]): string {
  if (!gap) return "No calculated intensity gap yet (ranking uses equipment tags only).";
  const sign = gap.gapPct > 0 ? "above" : gap.gapPct < 0 ? "below" : "at";
  return `${gap.metric} ${gap.facilityValue} vs benchmark ${gap.benchmarkValue} (${Math.abs(gap.gapPct).toFixed(2)}% ${sign} benchmark).`;
}

export function EcmSuggestions({
  payload,
}: {
  payload: EcmSuggestionsPayload;
}) {
  return (
    <section>
      <p className="mb-3 max-w-3xl text-[12px] text-stone-600">
        Matched only from the facility&apos;s bound energy streams and the calculated{" "}
        {payload.gap?.metric ?? "SEC/GEI"} gap. The model does not invent measures. Source
        references are shown in full, not in a tooltip.
      </p>
      <p className="mb-4 font-mono text-[11px] text-stone-500">
        Equipment tags: {payload.equipmentTags.length ? payload.equipmentTags.join(", ") : "(none)"}
        . {formatGap(payload.gap)}
      </p>

      {payload.matchStatus === "no_match" ? (
        <EmptyState
          title={payload.noMatchMessage ?? ECM_NO_MATCH_MESSAGE}
          body="Nothing in the library matches this facility's sector and bound equipment. The module will not improvise a suggestion outside the library."
        />
      ) : (
        <ul className="space-y-3">
          {payload.suggestions.map((s) => (
            <li key={s.id} className="border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{s.equipmentTag}</Badge>
                <Badge tone={s.styled ? "ok" : "draft"}>
                  {s.presentation === "styled" ? "Styled (grounded)" : "Raw row"}
                </Badge>
              </div>
              <h2 className="mt-2 text-sm font-semibold">{s.ecmName}</h2>
              {s.sentence ? (
                <p className="mt-2 text-sm leading-relaxed text-stone-700">{s.sentence}</p>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-stone-700">{s.description}</p>
              )}
              <dl className="mt-3 grid gap-1 text-[12px] text-stone-700">
                {s.typicalSavingsRange ? (
                  <div>
                    <dt className="inline font-medium">Typical savings: </dt>
                    <dd className="inline">{s.typicalSavingsRange}</dd>
                  </div>
                ) : null}
                {s.typicalPaybackMonths != null ? (
                  <div>
                    <dt className="inline font-medium">Typical payback: </dt>
                    <dd className="inline">{s.typicalPaybackMonths} months</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="mb-0.5 font-medium">Source (verify independently)</dt>
                  <dd className="border border-stone-200 bg-stone-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-stone-800">
                    {s.sourceReference}
                    {s.sourceUrl ? (
                      <>
                        {" "}
                        ·{" "}
                        <a className="underline" href={s.sourceUrl} rel="noreferrer" target="_blank">
                          {s.sourceUrl}
                        </a>
                      </>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
