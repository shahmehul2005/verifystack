"use client";

import { CircleCheck, Circle, FileText } from "lucide-react";
import type { EvidenceSlot } from "@verifystack/backend/domain/packs/types";
import { evaluateChecklist } from "@verifystack/backend/domain/crosscheck/checklist";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export interface ChecklistDocument {
  id: string;
  name: string;
  slot: string | null;
}

const GATE_LABEL: Record<EvidenceSlot["gate"], string> = {
  run: "Required for calculation",
  submission: "Required for submission",
  none: "Corroborative",
};

const GATE_TONE: Record<EvidenceSlot["gate"], "block" | "draft" | "neutral"> = {
  run: "block",
  submission: "draft",
  none: "neutral",
};

/**
 * Statutory evidence checklist and coverage meter.
 * Automatically checks off slots as documents are classified into the methodology taxonomy below.
 */
export function SlotChecklist({
  engagementId,
  slots,
  documents,
}: {
  engagementId: string;
  slots: EvidenceSlot[];
  documents: ChecklistDocument[];
  canEdit?: boolean;
}) {
  const result = evaluateChecklist(
    slots,
    documents.map((d) => ({ documentId: d.id, slot: d.slot }))
  );

  const missing = result.missingForRun.length;

  return (
    <Card className="mb-6" data-engagement-checklist={engagementId}>
      <CardHeader
        title="Evidence checklist & regulatory coverage"
        description="Tracks statutory evidence required by the methodology pack. Slots are automatically checked off when you classify uploaded documents in the table below."
        actions={
          missing === 0 ? (
            <Badge tone="ok" dot>
              Ready to calculate
            </Badge>
          ) : (
            <Badge tone="block" dot>
              {missing} required item{missing === 1 ? "" : "s"} missing
            </Badge>
          )
        }
      />
      <CardBody>
        <ul className="grid gap-3 md:grid-cols-2">
          {result.slots.map(({ slot, documentIds, ticked }) => (
            <li
              key={slot.id}
              className={`rounded-md border p-3 transition-colors ${
                ticked ? "border-green-200 bg-green-50/20" : "border-mist-200 bg-white"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {ticked ? (
                  <CircleCheck aria-label="Filled" className="mt-0.5 size-4 shrink-0 text-green-700" />
                ) : (
                  <Circle aria-label="Empty" className="mt-0.5 size-4 shrink-0 text-mist-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-mist-900">{slot.label}</p>
                    <Badge tone={GATE_TONE[slot.gate]}>{GATE_LABEL[slot.gate]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-mist-600">{slot.accepts}</p>
                  <div className="mt-2.5 flex flex-col gap-1 text-xs">
                    {ticked ? (
                      <div>
                        <div className="flex items-center gap-1 font-medium text-green-800 mb-1">
                          <span>
                            {documentIds.length} {documentIds.length === 1 ? "file" : "files"} verified:
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {documents
                            .filter((d) => documentIds.includes(d.id))
                            .map((doc) => (
                              <span
                                key={doc.id}
                                className="inline-flex items-center gap-1.5 rounded-md bg-green-100/70 border border-green-300/80 px-2 py-0.5 font-mono text-[11px] text-green-950 max-w-full"
                                title={doc.name}
                              >
                                <FileText className="size-3 text-green-700 shrink-0" />
                                <span className="truncate max-w-[200px]">{doc.name}</span>
                              </span>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-mist-400 italic">No document attached yet</span>
                    )}
                    <span className="font-mono text-[10px] text-mist-400 truncate mt-1" title={slot.basis}>
                      {slot.basis}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
