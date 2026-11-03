"use client";

import { useState } from "react";
import { FileText, ExternalLink, Download, Eye, AlertCircle } from "lucide-react";

export function PdfInlineViewer({
  documentId,
  filename,
  pageCount,
}: {
  documentId: string;
  filename: string;
  pageCount?: number | null;
}) {
  const [loadError, setLoadError] = useState(false);
  const fileUrl = `/api/documents/${documentId}/file`;

  return (
    <div className="rounded-lg border border-mist-200 bg-white p-3 shadow-xs space-y-3">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-100 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="rounded-md bg-teal-50 p-1.5 text-teal-700 border border-teal-200">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-mist-900" title={filename}>
              {filename}
            </p>
            <p className="text-[11px] text-mist-500">
              {pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "PDF document"} • Direct statutory evidence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-mist-300 bg-white px-2.5 py-1 text-xs font-medium text-mist-700 hover:bg-mist-50 transition-colors"
          >
            <ExternalLink className="size-3.5" />
            Open in new tab
          </a>
          <a
            href={fileUrl}
            download={filename}
            className="inline-flex items-center gap-1.5 rounded-md border border-mist-300 bg-white px-2.5 py-1 text-xs font-medium text-mist-700 hover:bg-mist-50 transition-colors"
          >
            <Download className="size-3.5" />
            Download
          </a>
        </div>
      </div>

      {/* PDF View Container */}
      <div className="relative w-full overflow-hidden rounded-md border border-mist-200 bg-mist-100/50">
        {!loadError ? (
          <iframe
            src={`${fileUrl}#toolbar=1&navpanes=1`}
            className="w-full h-[620px] rounded-md border-0 bg-white"
            title={`Preview of ${filename}`}
            onError={() => setLoadError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-12 text-center space-y-3 bg-white">
            <AlertCircle className="size-8 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-mist-900">Embedded preview not supported by browser</p>
              <p className="text-xs text-mist-500 mt-1">
                You can open or download the PDF file directly to view its contents.
              </p>
            </div>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-900 transition-colors"
            >
              <Eye className="size-3.5" />
              Open PDF in browser
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
