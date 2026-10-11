import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { Comparison, ComparisonStatus } from "@verifystack/backend/domain/compare/declared";

const STATUS: Record<ComparisonStatus, { label: string; tone: BadgeTone }> = {
  match: { label: "Agrees", tone: "ok" },
  within_tolerance: { label: "Agrees (rounding)", tone: "ok" },
  mismatch: { label: "Differs", tone: "block" },
  unit_mismatch: { label: "Unit problem", tone: "draft" },
  not_comparable: { label: "Not comparable", tone: "draft" },
  no_evidence: { label: "No evidence yet", tone: "neutral" },
  no_declaration: { label: "Not declared", tone: "neutral" },
};

function show(v: unknown, unit?: string | null): string {
  if (v === null || v === undefined) return "—";
  const base = typeof v === "object" ? JSON.stringify(v) : String(v);
  return unit ? `${base} ${unit}` : base;
}

/** What the entity declared against what the evidence says, field by field. */
export function ComparisonTable({ rows }: { rows: Comparison[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-mist-200">
      <table className="min-w-full text-[13px]">
        <thead className="bg-mist-50 text-left text-xs text-mist-600">
          <tr>
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Declared</th>
            <th className="px-3 py-2 font-medium">Evidence</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="px-3 py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = STATUS[r.status];
            return (
              <tr key={`${r.fieldPath}-${i}`} className="border-t border-mist-100 align-top">
                <td className="px-3 py-2 font-mono text-xs">{r.fieldPath}</td>
                <td className="px-3 py-2 tabular">{show(r.declared?.value, r.declared?.unit)}</td>
                <td className="px-3 py-2 tabular">{show(r.evidence?.value, r.evidence?.unit)}</td>
                <td className="px-3 py-2">
                  <Badge tone={s.tone}>{s.label}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-mist-600">{r.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
