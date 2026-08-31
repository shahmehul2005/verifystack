"use client";

import { useState } from "react";
import { DocumentFacsimile } from "@/app/workbench/DocumentFacsimile";
import type { DemoFact } from "@verifystack/backend/demo/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    toast.success(state);
    window.location.reload();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="border border-stone-200 bg-stone-100 p-3">
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
        <p className="mt-2 text-[11px] text-stone-500">
          Click a field. The source region is highlighted. High-materiality fields always require a
          human decision.
        </p>
      </div>
      <div className="border border-stone-200 bg-white">
        <ul className="divide-y divide-stone-100">
          {fields.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setFocus(f)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-stone-50"
              >
                <span>
                  <span className="font-mono text-[12px] text-stone-500">{f.field_path}</span>
                  <span className="mt-0.5 block text-sm">
                    {String(f.value_json)} {f.unit}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Badge tone={f.triage_action === "human_review" ? "draft" : "neutral"}>
                    {f.state}
                  </Badge>
                  <span className="tabular text-[11px] text-stone-500">
                    {(f.confidence * 100).toFixed(0)}%
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {focus ? (
          <div className="border-t border-stone-200 p-3 text-[12px]">
            <p className="font-mono text-stone-500">{focus.source_text}</p>
            <input
              className="mt-2 h-8 w-full border border-stone-300 px-2"
              placeholder="Correction (optional)"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void decide("accepted")}>
                Accept → D4
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void decide("corrected")}>
                Correct
              </Button>
              <Button size="sm" variant="danger" onClick={() => void decide("rejected")}>
                Reject
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
