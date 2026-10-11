"use client";

import { useEffect, useState } from "react";
import { Check, PenLine, X } from "lucide-react";
import { DocumentFacsimile } from "@/components/workbench/document-facsimile";
import type { DemoFact } from "@verifystack/backend/fixtures/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { EvidencePageViewer } from "@/components/workbench/evidence-page-viewer";
import { toast } from "sonner";

export interface ReviewField {
  id: string;
  field_path: string;
  value_json: unknown;
  unit: string | null;
  confidence: number;
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  source_text: string;
  state: string;
  triage_action: string;
  document_id: string;
  fileUrl: string | null;
  mimeType: string | null;
  /** In the deterministic low-risk sample that must be read before a bulk accept. */
  inSample?: boolean;
  /** Why this value always needs a person, when it does. */
  riskReasons?: string[];
}

export function ReviewWorkbench({
  engagementId,
  fields,
  facsimileDocId,
}: {
  engagementId: string;
  fields: ReviewField[];
  facsimileDocId?: string;
}) {
  const [focus, setFocus] = useState<ReviewField | null>(fields[0] ?? null);
  const [correction, setCorrection] = useState("");

  async function decide(state: "accepted" | "rejected" | "corrected") {
    if (!focus) return;
    const res = await fetch("/api/facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        extractedFieldId: focus.id,
        state,
        correction: state === "corrected" ? correction : undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Review failed");
      return;
    }
    toast.success(
      state === "accepted" ? "Accepted" : state === "corrected" ? "Correction saved" : "Rejected"
    );
    window.location.reload();
  }

  const focusIndex = focus ? fields.findIndex((f) => f.id === focus.id) : -1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      const step = e.key === "j" ? 1 : -1;
      const next = fields[Math.min(fields.length - 1, Math.max(0, focusIndex + step))];
      if (next) {
        e.preventDefault();
        setFocus(next);
        setCorrection("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fields, focusIndex]);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="rounded-lg border border-mist-200 bg-mist-100/70 p-3 lg:sticky lg:top-20">
        {facsimileDocId ? (
          <DocumentFacsimile
            documentId={facsimileDocId}
            highlight={
              focus
                ? ({
                    id: focus.id,
                    documentId: facsimileDocId,
                    field: focus.field_path,
                    display: String(focus.value_json),
                    value:
                      typeof focus.value_json === "number"
                        ? focus.value_json
                        : String(focus.value_json),
                    unit: focus.unit ?? undefined,
                    confidence: focus.confidence,
                    state: "suggested",
                    page: focus.page,
                    bbox: focus.bbox,
                    sourceText: focus.source_text,
                  } satisfies DemoFact)
                : null
            }
          />
        ) : (
          <EvidencePageViewer
            src={focus?.fileUrl ?? null}
            mimeType={focus?.mimeType}
            page={focus?.page ?? 1}
            bbox={focus?.bbox ?? null}
          />
        )}
        <p className="mt-2.5 px-1 text-xs leading-relaxed text-mist-600">
          The highlighted region is where the value was read. High-materiality fields always need a
          person&apos;s decision.
        </p>
      </div>

      <div className="space-y-4">
        {focus ? (
          <div className="rounded-lg border border-mist-200 bg-white shadow-xs">
            <div className="flex items-start justify-between gap-3 border-b border-mist-100 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-mist-500">{focus.field_path}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-mist-950 tabular">
                  {String(focus.value_json)}
                  {focus.unit ? (
                    <span className="ml-1.5 text-sm font-normal text-mist-500">{focus.unit}</span>
                  ) : null}
                </p>
              </div>
              <FieldStateBadges field={focus} />
            </div>
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-mist-600">Source text · page {focus.page}</p>
              <blockquote className="mt-1.5 rounded-md border-l-2 border-teal-500 bg-mist-50 px-3 py-2 font-mono text-xs leading-relaxed text-mist-800">
                {focus.source_text}
              </blockquote>
              <label htmlFor="correction" className="mt-4 block text-[13px] font-medium text-mist-800">
                Correction <span className="font-normal text-mist-500">(only for Correct)</span>
              </label>
              <Input
                id="correction"
                className="mt-1.5"
                placeholder="Corrected value"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void decide("accepted")}>
                  <Check />
                  Accept
                </Button>
                <Button variant="secondary" onClick={() => void decide("corrected")}>
                  <PenLine />
                  Correct
                </Button>
                <Button
                  variant="secondary"
                  className="text-red-700 hover:border-red-300 hover:bg-red-50"
                  onClick={() => void decide("rejected")}
                >
                  <X />
                  Reject
                </Button>
              </div>
              <p className="mt-3 text-xs text-mist-500">
                Accepted values move to the facts ledger.
              </p>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-mist-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-mist-100 bg-mist-50 px-4 py-2.5">
            <p className="text-xs font-medium text-mist-700 tabular">
              {fields.length} {fields.length === 1 ? "value" : "values"} awaiting review
            </p>
            <p className="hidden text-xs text-mist-500 sm:block">
              <kbd className="rounded-sm border border-mist-300 bg-white px-1 font-mono">J</kbd>{" "}
              <kbd className="rounded-sm border border-mist-300 bg-white px-1 font-mono">K</kbd> to move
            </p>
          </div>
          <ul className="max-h-[32rem] divide-y divide-mist-100 overflow-y-auto">
            {fields.map((f) => {
              const active = focus?.id === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setFocus(f);
                      setCorrection("");
                    }}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 border-l-2 px-4 py-3 text-left transition-colors",
                      active
                        ? "border-teal-600 bg-teal-50/50"
                        : "border-transparent hover:bg-mist-50"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs text-mist-500">{f.field_path}</span>
                      <span className="mt-0.5 block text-sm text-mist-900 tabular">
                        {String(f.value_json)} {f.unit}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <FieldStateBadges field={f} compact />
                      <ConfidenceMeter value={f.confidence} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function FieldStateBadges({ field, compact = false }: { field: ReviewField; compact?: boolean }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {field.state === "suggested" ? (
        <Badge tone="ai">AI-proposed</Badge>
      ) : (
        <Badge tone="draft">{field.state === "corrected" ? "Corrected" : field.state}</Badge>
      )}
      {field.inSample ? <Badge tone="ink">Review sample</Badge> : null}
      {field.triage_action === "human_review" && !compact ? (
        <span title={field.riskReasons?.join(" ") || undefined}>
          <Badge tone="draft">Needs a person</Badge>
        </span>
      ) : null}
    </span>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <span className="flex items-center gap-1.5" title={`Model confidence ${pct}%`}>
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-mist-100">
        <span
          className={cn("block h-full", pct >= 85 ? "bg-teal-600" : pct >= 60 ? "bg-amber-500" : "bg-red-500")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-xs text-mist-500 tabular">{pct}%</span>
    </span>
  );
}
