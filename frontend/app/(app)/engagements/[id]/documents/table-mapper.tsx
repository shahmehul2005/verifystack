"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Database, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { useSoftReload } from "@/lib/soft-reload";
import {
  CEMENT_STREAMS,
  getFiscalMonths,
  getStreamDefinition,
  type SourceType,
} from "@verifystack/backend/domain/calendar/index";

export interface DatasetView {
  id: string;
  kind: "spreadsheet" | "time_series";
  name: string;
  rowCount: number;
  summary: unknown;
}

export interface TargetOption {
  path: string;
  label: string;
  defaultUnit: string;
}

interface Preview {
  rows: (string | number | boolean | null)[][];
  rowCount: number;
  colCount: number;
  truncated: boolean;
}

interface TagSummary {
  tag: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  first: string;
  last: string;
  gapCount: number;
}

function colLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

interface CellRow {
  sheet: string;
  cellRef: string;
  cellValue: string;
  streamKey: string;
  monthKey: string;
  readingDate?: string;
  sourceType: SourceType;
  unit: string;
}

export function TableMapper({
  documentId,
  engagementId,
  datasets,
  targets: _targets = [],
}: {
  documentId: string;
  engagementId?: string;
  datasets: DatasetView[];
  targets?: TargetOption[];
}) {
  const { softReload } = useSoftReload();
  const sheets = datasets.filter((d) => d.kind === "spreadsheet");
  const series = datasets.find((d) => d.kind === "time_series");
  const tags = ((series?.summary as { tags?: TagSummary[] } | undefined)?.tags ?? []) as TagSummary[];
  const warnings = ((series?.summary as { warnings?: string[] } | undefined)?.warnings ?? []) as string[];
  const _offset = (series?.summary as { assumedOffsetMinutes?: number } | undefined)?.assumedOffsetMinutes;

  const fiscalMonths = useMemo(() => getFiscalMonths("FY2023-24"), []);

  const [cells, setCells] = useState<CellRow[]>([
    {
      sheet: sheets[0]?.name ?? "",
      cellRef: "",
      cellValue: "",
      streamKey: "coal_quantity",
      monthKey: "2023-04",
      sourceType: "corroboration",
      unit: "t",
    },
  ]);

  const [pending, setPending] = useState(false);

  /** Click-to-map: clicking a cell populates/updates a row */
  function pickCell(sheet: string, cellRef: string, val: string | number | boolean | null) {
    const stringVal = val === null || val === undefined ? "" : String(val);
    setCells((cur) => {
      const alreadyIndex = cur.findIndex((x) => x.sheet === sheet && x.cellRef === cellRef);
      if (alreadyIndex >= 0) {
        // Toggle off if already in list and more than 1 row
        if (cur.length > 1) {
          return cur.filter((_, idx) => idx !== alreadyIndex);
        }
        return [{ ...cur[0], cellRef: "", cellValue: "" }];
      }
      const empty = cur.findIndex((x) => !x.cellRef);
      if (empty >= 0) {
        return cur.map((x, j) =>
          j === empty ? { ...x, sheet, cellRef, cellValue: stringVal } : x
        );
      }
      return [
        ...cur,
        {
          sheet,
          cellRef,
          cellValue: stringVal,
          streamKey: "coal_quantity",
          monthKey: "2023-04",
          sourceType: "corroboration",
          unit: "t",
        },
      ];
    });
  }

  const chosen = new Set(cells.map((c) => `${c.sheet}!${c.cellRef}`));

  async function handleSaveCalendarReadings() {
    if (!engagementId) {
      toast.error("Engagement ID missing for saving calendar readings");
      return;
    }

    const validCells = cells.filter((c) => c.cellRef.trim() && c.cellValue.trim());
    if (validCells.length === 0) {
      toast.error("Please select or enter cell coordinates and values.");
      return;
    }

    setPending(true);
    try {
      const items = validCells.map((c) => {
        const streamDef = getStreamDefinition(c.streamKey);
        const numericVal = Number(c.cellValue.replace(/,/g, "").trim());
        return {
          engagementId,
          documentId,
          streamKey: c.streamKey,
          monthKey: c.monthKey,
          readingDate: c.readingDate || null,
          sourceType: c.sourceType,
          valueNumeric: isNaN(numericVal) ? 0 : numericVal,
          unit: c.unit || streamDef?.standardUnit || "t",
          provenancePage: 1,
          provenanceBbox: {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            sheet: c.sheet,
            cellRef: c.cellRef,
          },
          provenanceSourceText: `Cell ${c.cellRef} in sheet '${c.sheet}': ${c.cellValue}`,
        };
      });

      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        toast.error(json.error ?? "Failed to save calendar readings");
        return;
      }

      toast.success(
        `Saved ${json.count ?? items.length} reading(s) directly to Stream Calendar & Facts!`
      );
      softReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving cells");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6 border-t border-mist-200 bg-mist-50/70 p-4 rounded-b-lg">
      {sheets.map((d) => {
        const p = d.summary as Preview;
        return (
          <div key={d.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-mist-900">
                Sheet: <span className="font-mono text-teal-800">{d.name}</span>
                <span className="ml-2 text-xs font-normal text-mist-500">
                  ({p.rowCount} rows × {p.colCount} cols{p.truncated ? ", preview" : ""})
                </span>
              </p>
              <span className="text-[11px] text-mist-500">
                Click any cell to map it into the Stream Calendar
              </span>
            </div>

            <div className="max-h-64 overflow-auto rounded-md border border-mist-200 bg-white shadow-xs">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-mist-100 text-mist-700 z-10">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium w-10" />
                    {(p.rows[0] ?? []).map((_, c) => (
                      <th key={c} className="px-2 py-1 text-left font-mono font-medium min-w-[70px]">
                        {colLetters(c + 1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((row, r) => (
                    <tr key={r} className="border-t border-mist-100">
                      <td className="bg-mist-50 px-2 py-1 font-mono text-mist-500 select-none text-[11px]">
                        {r + 1}
                      </td>
                      {row.map((v, c) => {
                        const ref = `${colLetters(c + 1)}${r + 1}`;
                        const on = chosen.has(`${d.name}!${ref}`);
                        return (
                          <td
                            key={c}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            title={`${ref}: ${v === null ? "(empty)" : String(v)}`}
                            onClick={() => pickCell(d.name, ref, v)}
                            className={`max-w-48 cursor-pointer truncate px-2 py-1 transition-colors select-none ${
                              on
                                ? "bg-teal-100 font-semibold text-teal-950 ring-1 ring-inset ring-teal-600"
                                : "text-mist-800 hover:bg-mist-100"
                            }`}
                          >
                            {v === null ? "" : String(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {sheets.length > 0 && (
        <div className="rounded-lg border border-mist-200 bg-white p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-mist-900 flex items-center gap-1.5">
                <Database className="h-4 w-4 text-teal-600" />
                Selected Cells Data Entry (Stream Calendar &amp; Facts)
              </h4>
              <p className="text-xs text-mist-600 mt-0.5">
                Assign each selected cell to a BEE PAT-2 Stream, Duration (Month/Year), and Mandatory Source Layer.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setCells([
                  ...cells,
                  {
                    sheet: sheets[0]?.name ?? "",
                    cellRef: "",
                    cellValue: "",
                    streamKey: "coal_quantity",
                    monthKey: "2023-04",
                    sourceType: "corroboration",
                    unit: "t",
                  },
                ])
              }
              className="text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add Row
            </Button>
          </div>

          <div className="space-y-2.5">
            {cells.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-1 gap-2 rounded-lg border border-mist-200 bg-mist-50/50 p-2.5 sm:grid-cols-[6rem_5rem_6rem_1.4fr_8rem_9rem_5rem_auto] items-center"
              >
                {/* Sheet */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">Sheet</label>
                  <Select
                    value={row.sheet}
                    onChange={(e) =>
                      setCells(cells.map((x, j) => (j === i ? { ...x, sheet: e.target.value } : x)))
                    }
                    className="h-8 text-xs font-mono"
                  >
                    {sheets.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Cell Ref */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">Cell</label>
                  <Input
                    placeholder="B7"
                    value={row.cellRef}
                    onChange={(e) =>
                      setCells(
                        cells.map((x, j) =>
                          j === i ? { ...x, cellRef: e.target.value.toUpperCase() } : x
                        )
                      )
                    }
                    className="h-8 text-xs font-mono font-bold uppercase"
                  />
                </div>

                {/* Cell Value */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">Figure</label>
                  <Input
                    placeholder="Value"
                    value={row.cellValue}
                    onChange={(e) =>
                      setCells(cells.map((x, j) => (j === i ? { ...x, cellValue: e.target.value } : x)))
                    }
                    className="h-8 text-xs font-mono font-semibold"
                  />
                </div>

                {/* Stream / Data Type */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">
                    1. Data Type / Stream
                  </label>
                  <select
                    value={row.streamKey}
                    onChange={(e) => {
                      const k = e.target.value;
                      const s = CEMENT_STREAMS.find((st) => st.key === k);
                      setCells(
                        cells.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                streamKey: k,
                                unit: s?.standardUnit || x.unit,
                              }
                            : x
                        )
                      );
                    }}
                    className="h-8 w-full rounded border border-mist-300 bg-white px-2 text-xs font-medium"
                  >
                    {["production", "solid_fuel", "liquid_fuel", "electricity", "process"].map((cat) => (
                      <optgroup key={cat} label={cat.toUpperCase().replace("_", " ")}>
                        {CEMENT_STREAMS.filter((s) => s.category === cat).map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label} ({s.standardUnit})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Duration / Month */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">
                    2. Duration
                  </label>
                  <select
                    value={row.monthKey}
                    onChange={(e) =>
                      setCells(cells.map((x, j) => (j === i ? { ...x, monthKey: e.target.value } : x)))
                    }
                    className="h-8 w-full rounded border border-mist-300 bg-white px-2 text-xs font-medium"
                  >
                    {fiscalMonths.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} ({m.key})
                      </option>
                    ))}
                    <option value="annual">Full Year (Annual)</option>
                  </select>
                </div>

                {/* Source Type */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">
                    3. Source Layer
                  </label>
                  <select
                    value={row.sourceType}
                    onChange={(e) =>
                      setCells(
                        cells.map((x, j) =>
                          j === i ? { ...x, sourceType: e.target.value as SourceType } : x
                        )
                      )
                    }
                    className="h-8 w-full rounded border border-mist-300 bg-white px-2 text-xs font-semibold"
                  >
                    <option value="sourcing">[S] Sourcing (Bill/GRN)</option>
                    <option value="corroboration">[C] Corrob. (SCADA/ERP)</option>
                    <option value="proforma">[P] Pro Forma (Declared)</option>
                  </select>
                </div>

                {/* Unit */}
                <div>
                  <label className="text-[10px] font-medium text-mist-500 uppercase block mb-0.5">Unit</label>
                  <Input
                    placeholder="t"
                    value={row.unit}
                    onChange={(e) =>
                      setCells(cells.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))
                    }
                    className="h-8 text-xs"
                  />
                </div>

                {/* Remove */}
                <div className="pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={cells.length === 1}
                    onClick={() => setCells(cells.filter((_, j) => j !== i))}
                    className="h-8 w-8 p-0 text-mist-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-mist-500">
              Selected values are verified into the 12-Month Calendar Ledger with cell coordinates as provenance.
            </p>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || cells.some((c) => !c.cellRef || !c.cellValue)}
              onClick={() => void handleSaveCalendarReadings()}
              className="gap-1.5"
            >
              <Check className="h-4 w-4" />
              {pending ? "Saving..." : "Save to Stream Calendar & Facts"}
            </Button>
          </div>
        </div>
      )}

      {series && (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-mist-900">
            Time series <span className="text-xs font-normal text-mist-500">({series.rowCount} rows)</span>
          </p>
          {warnings.length > 0 && (
            <Alert tone="warn" title="Data quality" className="mb-2">
              <ul className="list-disc pl-4 text-xs">
                {warnings.slice(0, 5).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="max-h-48 overflow-auto rounded-md border border-mist-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-mist-100 text-mist-700">
                <tr>
                  {["Tag", "Readings", "Min", "Mean", "Max", "First", "Last"].map((h) => (
                    <th key={h} className="px-2 py-1 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.tag} className="border-t border-mist-100">
                    <td className="px-2 py-1 font-mono">{t.tag}</td>
                    <td className="px-2 py-1 tabular">{t.count}</td>
                    <td className="px-2 py-1 tabular">{t.min}</td>
                    <td className="px-2 py-1 tabular">{Number(t.mean.toFixed(2))}</td>
                    <td className="px-2 py-1 tabular">{t.max}</td>
                    <td className="px-2 py-1 text-[11px] text-mist-500">{t.first.slice(0, 16)}</td>
                    <td className="px-2 py-1 text-[11px] text-mist-500">{t.last.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
