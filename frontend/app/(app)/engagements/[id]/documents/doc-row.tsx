"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoftReload } from "@/lib/soft-reload";

export function DocRow({
  documentId,
  filename,
  columns,
  hasMapper,
  isPdf,
  canDelete,
  children,
  actions,
  mapper,
  pdfViewer,
}: {
  documentId: string;
  filename: string;
  columns: number;
  hasMapper?: boolean;
  isPdf?: boolean;
  canDelete: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  mapper?: React.ReactNode;
  pdfViewer?: React.ReactNode;
}) {
  const { softReload } = useSoftReload();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE",
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setDeleting(false);
    setConfirmDelete(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Failed to delete document");
      return;
    }
    toast.success(`Removed ${filename}`);
    softReload();
  }

  return (
    <>
      <tr className="group hover:bg-mist-50/50 transition-colors">
        {children}
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            {actions}

            {hasMapper ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setExpanded(!expanded)}
                className="text-xs"
              >
                {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {expanded ? "Hide sheets" : "Inspect sheets"}
              </Button>
            ) : null}

            {isPdf ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setExpanded(!expanded)}
                className="text-xs"
              >
                {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {expanded ? "Hide PDF" : "View PDF"}
              </Button>
            ) : null}

            {canDelete ? (
              confirmDelete ? (
                <div className="inline-flex items-center gap-1 bg-red-50 p-1 rounded border border-red-200">
                  <span className="text-[11px] text-red-700 font-medium px-1">Delete?</span>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void handleDelete()}
                    className="text-[11px] px-1.5 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 font-medium"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setConfirmDelete(false)}
                    className="text-[11px] px-1.5 py-0.5 text-mist-600 hover:bg-mist-100 rounded"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title={`Remove ${filename}`}
                  onClick={() => setConfirmDelete(true)}
                  className="rounded p-1.5 text-mist-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              )
            ) : null}
          </div>
        </td>
      </tr>

      {hasMapper && expanded && mapper ? (
        <tr>
          <td colSpan={columns} className="p-0 border-b border-mist-200 bg-mist-50/30">
            <div className="p-4">{mapper}</div>
          </td>
        </tr>
      ) : null}

      {isPdf && expanded && pdfViewer ? (
        <tr>
          <td colSpan={columns} className="p-0 border-b border-mist-200 bg-mist-50/30">
            <div className="p-4">{pdfViewer}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
