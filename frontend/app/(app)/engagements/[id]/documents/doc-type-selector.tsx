"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Check, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSoftReload } from "@/lib/soft-reload";
import type { PackDocType } from "@verifystack/backend/domain/packs/types";
import { humanize } from "@/lib/format";

export function DocTypeSelector({
  documentId,
  currentType,
  confidence,
  taxonomy,
  canEdit,
  isTable,
}: {
  documentId: string;
  currentType: string | null;
  confidence?: number | null;
  taxonomy: PackDocType[];
  canEdit: boolean;
  isTable?: boolean;
}) {
  const { softReload } = useSoftReload();
  const [isOpen, setIsOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const matched = taxonomy.find((t) => t.id === currentType);
  const displayName = matched
    ? matched.label
    : currentType
      ? humanize(currentType)
      : isTable
        ? "Spreadsheet (unclassified)"
        : "Not classified";

  async function updateType(newType: string | null) {
    const res = await fetch(`/api/documents/${documentId}/type`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_type: newType }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not update document type");
      return;
    }
    setIsOpen(false);
    toast.success("Document classification saved");
    softReload();
  }

  async function suggestType() {
    setSuggesting(true);
    const res = await fetch(`/api/documents/${documentId}/type`, {
      method: "POST",
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      docType?: string;
      confidence?: number;
      reasoning?: string;
      error?: string;
    };
    setSuggesting(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "AI classification failed");
      return;
    }
    const label = taxonomy.find((t) => t.id === json.docType)?.label ?? json.docType;
    toast.success(`Suggested: ${label} (${Math.round((json.confidence ?? 0) * 100)}%)`);
    softReload();
  }

  return (
    <div className="relative inline-flex items-center gap-1.5">
      {canEdit ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center text-left focus:outline-none"
        >
          <Badge
            tone={currentType ? (isTable ? "ink" : "neutral") : "draft"}
            className="cursor-pointer hover:bg-mist-200 transition-colors"
          >
            <span className="max-w-[180px] truncate" title={displayName}>
              {displayName}
            </span>
            {confidence && confidence < 1.0 ? (
              <span className="ml-1 text-[10px] text-mist-500 font-mono">
                {Math.round(confidence * 100)}%
              </span>
            ) : null}
            <ChevronDown className="ml-1 size-3 text-mist-500" />
          </Badge>
        </button>
      ) : (
        <Badge tone={currentType ? (isTable ? "ink" : "neutral") : "draft"}>
          <span className="max-w-[180px] truncate" title={displayName}>
            {displayName}
          </span>
        </Badge>
      )}

      {canEdit && !isTable ? (
        <button
          type="button"
          disabled={suggesting}
          onClick={() => void suggestType()}
          title="AI suggest type from methodology pack taxonomy"
          className="rounded p-1 text-mist-400 hover:bg-mist-100 hover:text-teal-700 transition-colors disabled:opacity-50"
        >
          <Sparkles className={`size-3.5 ${suggesting ? "animate-spin text-teal-600" : ""}`} />
        </button>
      ) : null}

      {isOpen && canEdit ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-72 overflow-y-auto rounded-md border border-mist-200 bg-white p-1 shadow-lg text-xs">
            <div className="px-2 py-1 font-semibold text-mist-500 uppercase tracking-wider text-[10px]">
              {isTable ? "Spreadsheet Role" : "Pack Taxonomy"}
            </div>
            {taxonomy.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void updateType(t.id)}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-teal-50 hover:text-teal-900 ${
                  t.id === currentType ? "bg-teal-50 font-medium text-teal-900" : "text-mist-800"
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate">{t.label}</div>
                  {t.notes ? <div className="text-[10px] text-mist-500 truncate">{t.notes}</div> : null}
                </div>
                {t.id === currentType ? <Check className="size-3.5 shrink-0 text-teal-700" /> : null}
              </button>
            ))}
            <div className="border-t border-mist-100 my-1" />
            <button
              type="button"
              onClick={() => void updateType(null)}
              className="flex w-full items-center rounded px-2 py-1 text-left text-mist-500 hover:bg-mist-100"
            >
              Clear classification
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
