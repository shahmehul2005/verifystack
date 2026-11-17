"use client";

import { useEffect, useState } from "react";
import type { SheetView } from "@verifystack/backend/domain/intake/preview";

/** Download link shown beside every preview, and in the error state. */
export function DownloadLink({ documentId }: { documentId: string }) {
  return (
    <a
      href={`/api/documents/${documentId}/file?download=1`}
      download
      className="inline-flex items-center rounded-md border border-mist-300 bg-white px-3 py-1.5 text-xs font-medium text-mist-800 shadow-xs hover:bg-mist-50"
    >
      Download
    </a>
  );
}

interface SelectedCell {
  ref: string;
  value: string;
  formula?: string;
}

function show(value: string | number | boolean | null): string {
  return value === null ? "" : String(value);
}

/** Presentational, read-only grid. Values render as text; nothing is editable or evaluated. */
export function WorkbookGridView({
  view,
  truncated,
  onSheetChange,
  onRowStartChange,
}: {
  view: SheetView;
  truncated?: boolean;
  onSheetChange: (index: number) => void;
  onRowStartChange: (rowStart: number) => void;
}) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const { active, sheets } = view;
  const pageSize = Math.max(1, active.rows.length);
  const lastRow = active.rows.length > 0 ? active.rows[active.rows.length - 1].n : active.rowStart;

  return (
    <div className="flex h-full w-full flex-col bg-white text-xs">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-mist-200 bg-mist-50 px-2 pt-1">
        {sheets.map((s, i) => (
          <button
            key={`${i}-${s.name}`}
            type="button"
            role="tab"
            aria-selected={i === active.index}
            onClick={() => {
              setSelected(null);
              onSheetChange(i);
            }}
            className={`whitespace-nowrap rounded-t border border-b-0 px-3 py-1 ${
              i === active.index
                ? "border-mist-300 bg-white font-semibold text-mist-900"
                : "border-transparent text-mist-600 hover:text-mist-900"
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="flex min-h-8 items-center gap-2 border-b border-mist-200 px-3 py-1 font-mono text-[11px]">
        {selected ? (
          <>
            <span className="font-semibold text-mist-900">{selected.ref}</span>
            {selected.formula !== undefined && (
              <span className="text-mist-700">
                Formula: <span className="text-amber-800">={selected.formula.replace(/^=/, "")}</span>
              </span>
            )}
            <span className="text-mist-700">
              {selected.formula !== undefined ? "Cached value" : "Value"}: {selected.value}
            </span>
          </>
        ) : (
          <span className="text-mist-400">Select a cell to see its reference, formula and value.</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="border-collapse font-mono text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 border border-mist-200 bg-mist-100 px-2 py-1" />
              {active.columns.map((c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 min-w-16 border border-mist-200 bg-mist-100 px-2 py-1 font-medium text-mist-700"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.rows.map((row) => (
              <tr key={row.n}>
                <th className="sticky left-0 z-10 border border-mist-200 bg-mist-100 px-2 py-0.5 text-right font-medium text-mist-700">
                  {row.n}
                </th>
                {row.cells.map((cell, ci) => {
                  const ref = `${active.columns[ci]}${row.n}`;
                  const isSel = selected?.ref === ref;
                  return (
                    <td
                      key={ref}
                      onClick={() =>
                        setSelected({ ref, value: show(cell.value), formula: cell.formula })
                      }
                      className={`max-w-64 cursor-cell truncate whitespace-nowrap border border-mist-100 px-2 py-0.5 ${
                        isSel ? "bg-teal-50 outline outline-1 outline-teal-600" : ""
                      }`}
                      title={show(cell.value)}
                    >
                      {cell.formula !== undefined && (
                        <span className="mr-1 text-amber-700" aria-label="formula">
                          ƒ
                        </span>
                      )}
                      {show(cell.value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 border-t border-mist-200 bg-mist-50 px-3 py-1.5">
        <button
          type="button"
          disabled={active.rowStart <= 1}
          onClick={() => onRowStartChange(Math.max(1, active.rowStart - pageSize))}
          className="rounded border border-mist-300 bg-white px-2 py-0.5 disabled:opacity-40"
        >
          Previous rows
        </button>
        <span className="text-mist-600">
          Rows {active.rowStart}–{lastRow}
        </span>
        <button
          type="button"
          disabled={!active.hasMoreRows}
          onClick={() => onRowStartChange(lastRow + 1)}
          className="rounded border border-mist-300 bg-white px-2 py-0.5 disabled:opacity-40"
        >
          Next rows
        </button>
        {(truncated || active.hasMoreColumns || active.sourceTruncated) && (
          <span className="ml-auto text-amber-700">
            {active.hasMoreColumns ? "Columns beyond the first 100 are not shown. " : ""}
            {active.sourceTruncated ? "The source sheet was truncated when read." : ""}
          </span>
        )}
      </div>
    </div>
  );
}

interface SheetResponse {
  ok: boolean;
  error?: string;
  view?: SheetView;
  truncated?: boolean;
}

/** Fetches a window of the stored workbook and renders it read-only. */
export function WorkbookViewer({ documentId }: { documentId: string }) {
  const [sheet, setSheet] = useState(0);
  const [rowStart, setRowStart] = useState(1);
  // Keep the loaded data tagged with its request key so stale data is never shown for another document.
  const requestKey = `${documentId}|${sheet}|${rowStart}`;
  const [result, setResult] = useState<{
    key: string;
    view?: SheetView;
    truncated?: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ sheet: String(sheet), rowStart: String(rowStart) });
    fetch(`/api/documents/${documentId}/sheet?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as SheetResponse | null;
        if (!res.ok || !body?.ok || !body.view) {
          setResult({ key: requestKey, error: body?.error ?? `The sheet could not be loaded (HTTP ${res.status}).` });
          return;
        }
        setResult({ key: requestKey, view: body.view, truncated: body.truncated });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, error: e instanceof Error ? e.message : "The sheet could not be loaded." });
      });
    return () => controller.abort();
  }, [documentId, sheet, rowStart, requestKey]);

  const current = result?.key === requestKey ? result : null;

  if (!current) {
    return <p className="p-4 text-xs text-mist-500">Loading sheet…</p>;
  }
  if (current.error || !current.view) {
    return (
      <div className="space-y-3 p-4 text-xs">
        <p role="alert" className="text-rose-700">
          {current.error}
        </p>
        <DownloadLink documentId={documentId} />
      </div>
    );
  }
  return (
    <WorkbookGridView
      view={current.view}
      truncated={current.truncated}
      onSheetChange={(i) => {
        setSheet(i);
        setRowStart(1);
      }}
      onRowStartChange={setRowStart}
    />
  );
}
