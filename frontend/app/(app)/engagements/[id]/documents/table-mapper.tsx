"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

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

const AGGREGATIONS = ["sum", "mean", "min", "max", "last", "count"] as const;

interface CellRow {
  sheet: string;
  cellRef: string;
  fieldPath: string;
  unit: string;
}
interface RangeRow {
  tag: string;
  start: string;
  end: string;
  aggregation: (typeof AGGREGATIONS)[number];
  fieldPath: string;
  unit: string;
}

/**
 * Map spreadsheet cells or time-series windows to proposed values. Nothing here
 * produces a number: the server re-reads the stored file and the proposals still
 * go through the review queue.
 */
export function TableMapper({
  documentId,
  datasets,
  targets,
}: {
  documentId: string;
  datasets: DatasetView[];
  targets: TargetOption[];
}) {
  const sheets = datasets.filter((d) => d.kind === "spreadsheet");
  const series = datasets.find((d) => d.kind === "time_series");
  const tags = ((series?.summary as { tags?: TagSummary[] } | undefined)?.tags ?? []) as TagSummary[];
  const warnings = ((series?.summary as { warnings?: string[] } | undefined)?.warnings ?? []) as string[];
  const offset = (series?.summary as { assumedOffsetMinutes?: number } | undefined)?.assumedOffsetMinutes;

  const [cells, setCells] = useState<CellRow[]>([
    { sheet: sheets[0]?.name ?? "", cellRef: "", fieldPath: "", unit: "" },
  ]);
  const [ranges, setRanges] = useState<RangeRow[]>([
    { tag: tags[0]?.tag ?? "", start: "", end: "", aggregation: "sum", fieldPath: "", unit: "" },
  ]);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  function pickTarget(path: string, apply: (unit: string) => void) {
    const t = targets.find((x) => x.path === path);
    if (t) apply(t.defaultUnit);
  }

  async function submit(body: unknown) {
    setPending(true);
    setProblems([]);
    const res = await fetch(`/api/documents/${documentId}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      created?: number;
      rejected?: { index: number; reason: string }[];
    };
    setPending(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? `Failed (${res.status})`);
      setProblems([json.error ?? "The request failed."]);
      return;
    }
    setProblems((json.rejected ?? []).map((r) => `Row ${r.index + 1}: ${r.reason}`));
    if ((json.created ?? 0) > 0) {
      toast.success(`${json.created} proposed value(s) added to the review queue`);
    }
    if ((json.created ?? 0) > 0 && (json.rejected ?? []).length === 0) {
      router.push("/review-queue");
    }
  }

  const paths = (
    <datalist id={`targets-${documentId}`}>
      {targets.map((t) => (
        <option key={t.path} value={t.path}>
          {t.label}
        </option>
      ))}
    </datalist>
  );

  return (
    <div className="space-y-6 border-t border-mist-100 bg-mist-50/50 px-4 py-4">
      {paths}
      {sheets.map((d) => {
        const p = d.summary as Preview;
        return (
          <div key={d.id}>
            <p className="mb-1.5 text-[13px] font-medium text-mist-900">
              Sheet <span className="font-mono">{d.name}</span>
              <span className="ml-2 text-xs font-normal text-mist-500">
                {p.rowCount} rows x {p.colCount} columns{p.truncated ? " (preview only)" : ""}
              </span>
            </p>
            <div className="max-h-64 overflow-auto rounded-md border border-mist-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-mist-100 text-mist-600">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium" />
                    {(p.rows[0] ?? []).map((_, c) => (
                      <th key={c} className="px-2 py-1 text-left font-mono font-medium">
                        {colLetters(c + 1)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((row, r) => (
                    <tr key={r} className="border-t border-mist-100">
                      <td className="bg-mist-50 px-2 py-1 font-mono text-mist-500">{r + 1}</td>
                      {row.map((v, c) => (
                        <td key={c} className="max-w-48 truncate px-2 py-1 text-mist-800">
                          {v === null ? "" : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {sheets.length > 0 ? (
        <div>
          <p className="mb-2 text-[13px] font-medium text-mist-900">Propose values from cells</p>
          <div className="space-y-2">
            {cells.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_1.4fr_5rem_auto]">
                <Select
                  aria-label="Sheet"
                  value={row.sheet}
                  onChange={(e) => setCells(cells.map((x, j) => (j === i ? { ...x, sheet: e.target.value } : x)))}
                >
                  {sheets.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Cell"
                  placeholder="B7"
                  value={row.cellRef}
                  onChange={(e) =>
                    setCells(cells.map((x, j) => (j === i ? { ...x, cellRef: e.target.value.toUpperCase() } : x)))
                  }
                />
                <Input
                  aria-label="Field path"
                  list={`targets-${documentId}`}
                  placeholder="coal.quantity"
                  value={row.fieldPath}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCells(cells.map((x, j) => (j === i ? { ...x, fieldPath: v } : x)));
                    pickTarget(v, (unit) =>
                      setCells((cur) => cur.map((x, j) => (j === i && !x.unit ? { ...x, unit } : x)))
                    );
                  }}
                />
                <Input
                  aria-label="Unit"
                  placeholder="unit"
                  value={row.unit}
                  onChange={(e) => setCells(cells.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove row"
                  disabled={cells.length === 1}
                  onClick={() => setCells(cells.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setCells([...cells, { sheet: sheets[0]?.name ?? "", cellRef: "", fieldPath: "", unit: "" }])
              }
            >
              <Plus /> Add cell
            </Button>
            <Button
              size="sm"
              disabled={pending || cells.some((c) => !c.cellRef || !c.fieldPath)}
              onClick={() =>
                void submit({
                  type: "cell",
                  items: cells.map((c) => ({ ...c, unit: c.unit || undefined })),
                })
              }
            >
              Propose for review
            </Button>
          </div>
        </div>
      ) : null}

      {series ? (
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-mist-900">
            Time series <span className="text-xs font-normal text-mist-500">{series.rowCount} rows</span>
          </p>
          {typeof offset === "number" ? (
            <p className="mb-2 text-xs text-mist-600">
              Timestamps without a zone are read as UTC{offset >= 0 ? "+" : "-"}
              {String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:
              {String(Math.abs(offset) % 60).padStart(2, "0")}. Enter window times with a zone (for example
              2025-04-01T00:00:00+05:30) to be exact.
            </p>
          ) : null}
          {warnings.length > 0 ? (
            <Alert tone="warn" title="Data quality" className="mb-3">
              <ul className="list-disc pl-4">
                {warnings.slice(0, 8).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <div className="max-h-56 overflow-auto rounded-md border border-mist-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-mist-100 text-mist-600">
                <tr>
                  {["Tag", "Readings", "Min", "Mean", "Max", "First", "Last", "Gaps"].map((h) => (
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
                    <td className="px-2 py-1 tabular">{Number(t.mean.toFixed(3))}</td>
                    <td className="px-2 py-1 tabular">{t.max}</td>
                    <td className="px-2 py-1">{t.first.slice(0, 16)}</td>
                    <td className="px-2 py-1">{t.last.slice(0, 16)}</td>
                    <td className="px-2 py-1 tabular">{t.gapCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mb-2 mt-4 text-[13px] font-medium text-mist-900">Propose values from time windows</p>
          <div className="space-y-2">
            {ranges.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 lg:grid-cols-[1fr_1.2fr_1.2fr_6rem_1.3fr_5rem_auto]">
                <Select
                  aria-label="Tag"
                  value={row.tag}
                  onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))}
                >
                  {tags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Window start"
                  placeholder="start 2025-04-01T00:00:00+05:30"
                  value={row.start}
                  onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                />
                <Input
                  aria-label="Window end"
                  placeholder="end 2025-04-30T23:59:59+05:30"
                  value={row.end}
                  onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                />
                <Select
                  aria-label="Aggregation"
                  value={row.aggregation}
                  onChange={(e) =>
                    setRanges(
                      ranges.map((x, j) =>
                        j === i ? { ...x, aggregation: e.target.value as RangeRow["aggregation"] } : x
                      )
                    )
                  }
                >
                  {AGGREGATIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Field path"
                  list={`targets-${documentId}`}
                  placeholder="electricity.activeEnergy"
                  value={row.fieldPath}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRanges(ranges.map((x, j) => (j === i ? { ...x, fieldPath: v } : x)));
                    pickTarget(v, (unit) =>
                      setRanges((cur) => cur.map((x, j) => (j === i && !x.unit ? { ...x, unit } : x)))
                    );
                  }}
                />
                <Input
                  aria-label="Unit"
                  placeholder="unit"
                  value={row.unit}
                  onChange={(e) => setRanges(ranges.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Remove row"
                  disabled={ranges.length === 1}
                  onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRanges([
                  ...ranges,
                  { tag: tags[0]?.tag ?? "", start: "", end: "", aggregation: "sum", fieldPath: "", unit: "" },
                ])
              }
            >
              <Plus /> Add window
            </Button>
            <Button
              size="sm"
              disabled={pending || ranges.some((r) => !r.tag || !r.start || !r.end || !r.fieldPath)}
              onClick={() =>
                void submit({
                  type: "range",
                  items: ranges.map((r) => ({ ...r, unit: r.unit || undefined })),
                })
              }
            >
              Propose for review
            </Button>
          </div>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <Alert tone="warn" title="Some rows were not proposed">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}
