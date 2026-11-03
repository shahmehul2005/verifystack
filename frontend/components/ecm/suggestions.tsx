import { ExternalLink, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states";
import { ECM_NO_MATCH_MESSAGE } from "@verifystack/backend/domain/ecm/types";
import type { EcmSuggestionsPayload } from "@verifystack/backend/domain/ecm/types";
import { humanize } from "@/lib/format";

function formatGap(gap: EcmSuggestionsPayload["gap"]): string {
  if (!gap) return "No calculated intensity gap yet, so ranking uses equipment tags only.";
  const sign = gap.gapPct > 0 ? "above" : gap.gapPct < 0 ? "below" : "at";
  return `${gap.metric} ${gap.facilityValue} vs benchmark ${gap.benchmarkValue} (${Math.abs(gap.gapPct).toFixed(2)}% ${sign} benchmark).`;
}

export function EcmSuggestions({
  payload,
}: {
  payload: EcmSuggestionsPayload;
}) {
  return (
    <div>
      <div className="mb-4 rounded-lg border border-mist-200 bg-white px-4 py-3">
        <p className="max-w-3xl text-[13px] leading-relaxed text-mist-700">
          Matched only from the facility&apos;s bound energy streams and the calculated{" "}
          {payload.gap?.metric ?? "SEC/GEI"} gap. Measures come from the curated library; the model
          never invents one.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-mist-500">Equipment:</span>
          {payload.equipmentTags.length ? (
            payload.equipmentTags.map((t) => <Badge key={t}>{humanize(t)}</Badge>)
          ) : (
            <span className="text-xs text-mist-500">none bound</span>
          )}
        </div>
        <p className="mt-2 text-xs text-mist-600 tabular">{formatGap(payload.gap)}</p>
      </div>

      {payload.matchStatus === "no_match" ? (
        <EmptyState
          icon={Lightbulb}
          title={payload.noMatchMessage ?? ECM_NO_MATCH_MESSAGE}
          body="Nothing in the library matches this facility's sector and bound equipment. VerifyStack will not improvise a suggestion from outside the library."
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {payload.suggestions.map((s) => (
            <li key={s.id} className="flex flex-col rounded-lg border border-mist-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge>{humanize(s.equipmentTag)}</Badge>
                {s.presentation === "styled" ? (
                  <Badge tone="ai">Worded by AI from the library row</Badge>
                ) : (
                  <Badge tone="neutral">Library wording</Badge>
                )}
              </div>
              <h3 className="mt-3 text-[15px] font-semibold text-mist-950">{s.ecmName}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-mist-700">{s.sentence ?? s.description}</p>
              {s.typicalSavingsRange || s.typicalPaybackMonths != null ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-mist-50 px-3 py-2.5 text-sm">
                  {s.typicalSavingsRange ? (
                    <div>
                      <dt className="text-xs text-mist-500">Typical savings</dt>
                      <dd className="mt-0.5 font-medium text-mist-900">{s.typicalSavingsRange}</dd>
                    </div>
                  ) : null}
                  {s.typicalPaybackMonths != null ? (
                    <div>
                      <dt className="text-xs text-mist-500">Typical payback</dt>
                      <dd className="mt-0.5 font-medium text-mist-900 tabular">
                        {s.typicalPaybackMonths} months
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <div className="mt-auto pt-4">
                <p className="text-xs font-medium text-mist-600">Source · verify independently</p>
                <p className="mt-1 rounded-md border border-mist-200 bg-mist-50 px-2.5 py-2 font-mono text-xs leading-relaxed text-mist-800">
                  {s.sourceReference}
                </p>
                {s.sourceUrl ? (
                  <a
                    className="mt-1.5 inline-flex items-center gap-1 break-all text-xs text-teal-700 hover:text-teal-800 hover:underline"
                    href={s.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {s.sourceUrl}
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
