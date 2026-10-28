"use client";

import { toast } from "sonner";
import { CircleCheck, Circle } from "lucide-react";
import type { EvidenceSlot } from "@verifystack/backend/domain/packs/types";
import { evaluateChecklist } from "@verifystack/backend/domain/crosscheck/checklist";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useSoftReload } from "@/lib/soft-reload";

export interface ChecklistDocument {
  id: string;
  name: string;
  slot: string | null;
}

const GATE_LABEL: Record<EvidenceSlot["gate"], string> = {
  run: "Required for calculation",
  submission: "Required for submission",
  none: "Optional",
};

const GATE_TONE: Record<EvidenceSlot["gate"], "block" | "draft" | "neutral"> = {
  run: "block",
  submission: "draft",
  none: "neutral",
};

/**
 * Evidence checklist. Each label is ticked once one document sits under it;
 * several documents may share a label. Calculation waits for the labels marked
 * "Required for calculation". Assignment is a person's choice, not a guess from
 * the filename.
 */
export function SlotChecklist({
  engagementId,
  slots,
  documents,
  canEdit,
}: {
  engagementId: string;
  slots: EvidenceSlot[];
  documents: ChecklistDocument[];
  canEdit: boolean;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const result = evaluateChecklist(
    slots,
    documents.map((d) => ({ documentId: d.id, slot: d.slot }))
  );

  async function assign(documentId: string, slot: string | null) {
    const res = await fetch(`/api/documents/${documentId}/slot`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not assign the document");
      return;
    }
    softReload();
  }

  const missing = result.missingForRun.length;

  return (
    <Card className="mb-6" data-engagement-checklist={engagementId}>
      <CardHeader
        title="Evidence checklist"
        description="Each label is ticked once one document sits under it. Several documents can share a label, such as three electricity bills. Calculation waits for the labels marked as required."
        actions={
          missing === 0 ? (
            <Badge tone="ok" dot>
              Ready to calculate
            </Badge>
          ) : (
            <Badge tone="block" dot>
              {missing} required label{missing === 1 ? "" : "s"} empty
            </Badge>
          )
        }
      />
      <CardBody className="space-y-6">
        <ul className="grid gap-3 md:grid-cols-2">
          {result.slots.map(({ slot, documentIds, ticked }) => (
            <li key={slot.id} className="rounded-md border border-mist-200 bg-white p-3">
              <div className="flex items-start gap-2.5">
                {ticked ? (
                  <CircleCheck aria-label="Filled" className="mt-0.5 size-4 shrink-0 text-green-700" />
                ) : (
                  <Circle aria-label="Empty" className="mt-0.5 size-4 shrink-0 text-mist-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-mist-900">{slot.label}</p>
                  <p className="mt-0.5 text-xs text-mist-600">{slot.accepts}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={GATE_TONE[slot.gate]}>{GATE_LABEL[slot.gate]}</Badge>
                    <span className="text-mist-500">
                      {documentIds.length} document{documentIds.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-mist-500">{slot.basis}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {documents.length > 0 ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-mist-900">Assign each document to a label</p>
            <ul className="divide-y divide-mist-100 rounded-md border border-mist-200 bg-white">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm text-mist-800">{d.name}</span>
                  <Select
                    aria-label={`Label for ${d.name}`}
                    className="h-8 w-auto min-w-56 text-[13px]"
                    value={d.slot ?? ""}
                    disabled={!canEdit || isRefreshing}
                    onChange={(e) => void assign(d.id, e.target.value || null)}
                  >
                    <option value="">Not assigned</option>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
