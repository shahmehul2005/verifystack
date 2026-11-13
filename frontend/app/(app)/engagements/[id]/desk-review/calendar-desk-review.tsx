"use client";

import { useState } from "react";
import {
  CalendarGridData,
  StreamCalendarRow,
} from "@verifystack/backend/domain/calendar/index";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  CheckCircle2,
  AlertTriangle,
  Search,
  Layers,
  Split,
  Eye,
  FileText,
  Download,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

interface CalendarDeskReviewProps {
  grid: CalendarGridData;
  engagementId: string;
  documents: { id: string; name: string; mimeType?: string | null; slot?: string | null }[];
}

export function CalendarDeskReview({
  grid,
  engagementId,
  documents,
}: CalendarDeskReviewProps) {
  const [activeTab, setActiveTab] = useState<"variance" | "completeness" | "rollup" | "preview" | "binder">("variance");
  const [selectedStreamKey, setSelectedStreamKey] = useState<string>("all");
  const [previewDocId, setPreviewDocId] = useState<string>(documents[0]?.id ?? "");

  // Flatten rows across categories
  const allRows: StreamCalendarRow[] = grid.categories.flatMap((c) => c.rows);
  const activeRows = allRows.filter((r) =>
    r.annualRollup.value !== null || r.months.some((m) => m.sourcing || m.corroboration || m.proforma)
  );

  const filteredRows = activeRows.filter(
    (r) => selectedStreamKey === "all" || r.stream.key === selectedStreamKey
  );

  // Statistics
  const totalMonthsExpected = activeRows.length * 12;
  const totalMonthsFilled = activeRows.reduce(
    (acc, r) => acc + r.annualRollup.completedMonthsCount,
    0
  );
  const completenessPercent =
    totalMonthsExpected > 0 ? Math.round((totalMonthsFilled / totalMonthsExpected) * 100) : 100;

  const streamsWithVarianceAlert = activeRows.filter(
    (r) =>
      r.months.some((m) => m.hasVarianceAlert) ||
      (r.annualRollup.varianceToProformaPercent !== null &&
        r.annualRollup.varianceToProformaPercent !== undefined &&
        r.annualRollup.varianceToProformaPercent > 5)
  );

  return (
    <div className="space-y-6">
      {/* 4 Audit Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-mist-500">
              Coverage &amp; Completeness
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold ${
                  completenessPercent === 100 ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {completenessPercent}%
              </span>
              <span className="text-xs text-mist-500">
                ({totalMonthsFilled}/{totalMonthsExpected} mo)
              </span>
            </div>
          </CardBody>
        </Card>

        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-mist-500">
              Cross-Checks Evaluated
            </p>
            <p className="mt-1 text-2xl font-bold text-mist-900">
              {grid.summary.totalReadingsCount}{" "}
              <span className="text-xs font-normal text-mist-500">evidence points</span>
            </p>
          </CardBody>
        </Card>

        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-mist-500">
              Variance Findings (&gt;5%)
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold ${
                  streamsWithVarianceAlert.length > 0 ? "text-rose-600" : "text-emerald-600"
                }`}
              >
                {streamsWithVarianceAlert.length}
              </span>
              <span className="text-xs text-mist-500">
                {streamsWithVarianceAlert.length === 0 ? "Zero material variance" : "Streams need inquiry"}
              </span>
            </div>
          </CardBody>
        </Card>

        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-mist-500">
              Annual Roll-Up Checks
            </p>
            <p className="mt-1 text-2xl font-bold text-teal-700">
              {activeRows.filter((r) => r.annualRollup.value !== null).length}{" "}
              <span className="text-xs font-normal text-mist-500">verified annuals</span>
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Audit Navigation Tabs */}
      <div className="flex border-b border-mist-200">
        <button
          onClick={() => setActiveTab("variance")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "variance"
              ? "border-mist-900 text-mist-900"
              : "border-transparent text-mist-500 hover:text-mist-800"
          }`}
        >
          <Layers className="h-4 w-4" />
          1. Cross-Checks &amp; Source Variance
        </button>

        <button
          onClick={() => setActiveTab("completeness")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "completeness"
              ? "border-mist-900 text-mist-900"
              : "border-transparent text-mist-500 hover:text-mist-800"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          2. 12-Month Completeness Checks
        </button>

        <button
          onClick={() => setActiveTab("rollup")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "rollup"
              ? "border-mist-900 text-mist-900"
              : "border-transparent text-mist-500 hover:text-mist-800"
          }`}
        >
          <Split className="h-4 w-4" />
          3. Annual Pro Forma Reconciliation
        </button>

        <button
          onClick={() => setActiveTab("preview")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "preview"
              ? "border-mist-900 text-mist-900"
              : "border-transparent text-mist-500 hover:text-mist-800"
          }`}
        >
          <Eye className="h-4 w-4" />
          4. Side-by-Side Pro Forma Preview
        </button>

        <button
          onClick={() => setActiveTab("binder")}
          className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "binder"
              ? "border-mist-900 text-mist-900"
              : "border-transparent text-mist-500 hover:text-mist-800"
          }`}
        >
          <FileText className="h-4 w-4" />
          5. Sealed Audit Binder
        </button>

        <div className="ml-auto flex items-center pr-2">
          <a
            href={`/api/desk-review/binder?engagementId=${engagementId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-mist-300 bg-white px-3 py-1.5 text-xs font-medium text-mist-800 shadow-xs hover:bg-mist-50"
          >
            <Download className="h-3.5 w-3.5 text-mist-600" />
            Download Binder (PDF)
          </a>
        </div>
      </div>

      {/* Tab 1: Cross-Checks & Source Variance */}
      {activeTab === "variance" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-mist-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 bg-mist-50 border-b border-mist-200 flex justify-between items-center">
              <div>
                <h4 className="text-xs font-semibold text-mist-900">
                  Cross-Source Multi-Layer Variance Checks
                </h4>
                <p className="text-[11px] text-mist-500">
                  Compares primary sourcing bills [S] against internal plant logs [C] and pro forma return [P].
                  Variance ≤1% passes; 1%–5% advisory; &gt;5% requires auditor inquiry.
                </p>
              </div>

              <select
                value={selectedStreamKey}
                onChange={(e) => setSelectedStreamKey(e.target.value)}
                className="rounded border border-mist-300 bg-white px-2 py-1 text-xs"
              >
                <option value="all">All active streams</option>
                {activeRows.map((r) => (
                  <option key={r.stream.key} value={r.stream.key}>
                    {r.stream.label}
                  </option>
                ))}
              </select>
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-mist-200 bg-mist-100/60 font-medium text-mist-700">
                  <th className="p-3">Stream / Period</th>
                  <th className="p-3 text-right">Primary Sourcing [S]</th>
                  <th className="p-3 text-right">Internal Log [C]</th>
                  <th className="p-3 text-right">Pro Forma [P]</th>
                  <th className="p-3 text-center">Variance %</th>
                  <th className="p-3 text-center">Audit Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {filteredRows.map((row) => (
                  <tr key={row.stream.key} className="hover:bg-mist-50/50">
                    <td className="p-3">
                      <div className="font-semibold text-mist-900">{row.stream.label}</div>
                      <div className="text-[11px] text-mist-500">
                        {row.stream.standardUnit} · {row.stream.proformaRef ?? row.stream.category}
                      </div>
                    </td>

                    {/* Sourcing */}
                    <td className="p-3 text-right font-mono">
                      {row.annualRollup.value !== null ? (
                        <span className="font-medium text-blue-900">
                          {row.annualRollup.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}{" "}
                          {row.stream.standardUnit}
                        </span>
                      ) : (
                        <span className="text-mist-400">—</span>
                      )}
                    </td>

                    {/* Corroboration */}
                    <td className="p-3 text-right font-mono text-purple-900">
                      {row.months.some((m) => m.corroboration) ? (
                        <span>
                          {row.months
                            .reduce((sum, m) => sum + (m.corroboration?.standardValue ?? 0), 0)
                            .toLocaleString("en-IN", { maximumFractionDigits: 1 })}{" "}
                          {row.stream.standardUnit}
                        </span>
                      ) : (
                        <span className="text-mist-400">—</span>
                      )}
                    </td>

                    {/* Pro Forma */}
                    <td className="p-3 text-right font-mono text-amber-900">
                      {row.annualRollup.proformaAnnual !== null && row.annualRollup.proformaAnnual !== undefined ? (
                        <span>
                          {row.annualRollup.proformaAnnual.toLocaleString("en-IN", { maximumFractionDigits: 1 })}{" "}
                          {row.stream.standardUnit}
                        </span>
                      ) : (
                        <span className="text-mist-400">—</span>
                      )}
                    </td>

                    {/* Variance */}
                    <td className="p-3 text-center font-mono">
                      {row.annualRollup.varianceToProformaPercent !== null &&
                      row.annualRollup.varianceToProformaPercent !== undefined ? (
                        <span
                          className={`font-semibold ${
                            row.annualRollup.varianceToProformaPercent > 5
                              ? "text-rose-700"
                              : row.annualRollup.varianceToProformaPercent > 1
                              ? "text-amber-700"
                              : "text-emerald-700"
                          }`}
                        >
                          {row.annualRollup.varianceToProformaPercent}%
                        </span>
                      ) : (
                        <span className="text-mist-400">0.0%</span>
                      )}
                    </td>

                    {/* Verdict */}
                    <td className="p-3 text-center">
                      {row.annualRollup.varianceToProformaPercent !== null &&
                      row.annualRollup.varianceToProformaPercent !== undefined &&
                      row.annualRollup.varianceToProformaPercent > 5 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                          <AlertTriangle className="h-3 w-3" /> Inquiry Required
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" /> Reconciled
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: 12-Month Completeness Checks */}
      {activeTab === "completeness" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-mist-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 bg-mist-50 border-b border-mist-200">
              <h4 className="text-xs font-semibold text-mist-900">
                12-Month Industrial Evidence Completeness Audit
              </h4>
              <p className="text-[11px] text-mist-500">
                Indian BEE PAT-2 compliance requires uninterrupted 12-month evidence for baseline &amp; monitoring years.
              </p>
            </div>

            <div className="divide-y divide-mist-200">
              {activeRows.map((row) => (
                <div key={row.stream.key} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="font-semibold text-sm text-mist-900">{row.stream.label}</h5>
                      <p className="text-xs text-mist-500">
                        Binding: <code className="font-mono text-mist-700">{row.stream.calcBindingPath}</code> ·
                        Target unit: <code className="font-mono text-mist-700">{row.stream.standardUnit}</code>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded text-xs font-semibold ${
                          row.annualRollup.isComplete
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {row.annualRollup.completedMonthsCount} of 12 Months Accounted
                      </span>
                    </div>
                  </div>

                  {/* 12 Month Dots Grid */}
                  <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 pt-1">
                    {row.months.map((m) => {
                      const hasS = Boolean(m.sourcing);
                      const hasC = Boolean(m.corroboration);
                      const hasP = Boolean(m.proforma);
                      const isFilled = hasS || hasC || hasP;

                      return (
                        <div
                          key={m.monthKey}
                          className={`rounded border p-2 text-center text-xs ${
                            isFilled
                              ? "bg-emerald-50/60 border-emerald-300 text-emerald-900"
                              : "bg-rose-50/40 border-dashed border-rose-300 text-rose-700"
                          }`}
                        >
                          <div className="font-medium text-[10px]">{m.label.split(" ")[0]}</div>
                          <div className="mt-1 text-[11px] font-mono font-bold">
                            {isFilled ? "✓" : "MISSING"}
                          </div>
                          {hasS && <span className="text-[9px] text-blue-700 font-semibold">[S]</span>}
                          {hasC && <span className="text-[9px] text-purple-700 font-semibold">[C]</span>}
                          {hasP && <span className="text-[9px] text-amber-700 font-semibold">[P]</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Annual Pro Forma Reconciliation */}
      {activeTab === "rollup" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-mist-200 bg-white shadow-sm overflow-hidden">
            <div className="p-3 bg-mist-50 border-b border-mist-200">
              <h4 className="text-xs font-semibold text-mist-900">
                Annual Roll-Up &amp; Form 1 Return Reconciliation
              </h4>
              <p className="text-[11px] text-mist-500">
                Verifies that the sum of 12 monthly primary bills reconciles with the declared figure in the Form 1 return.
              </p>
            </div>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-mist-200 bg-mist-100/60 font-medium text-mist-700">
                  <th className="p-3">Stream</th>
                  <th className="p-3">Aggregation Type</th>
                  <th className="p-3 text-right">Calculated 12-Mo Roll-Up</th>
                  <th className="p-3 text-right">Form 1 Declared Return</th>
                  <th className="p-3 text-center">Variance %</th>
                  <th className="p-3 text-center">Ready for Calc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {activeRows.map((row) => (
                  <tr key={row.stream.key} className="hover:bg-mist-50/50">
                    <td className="p-3">
                      <div className="font-semibold text-mist-900">{row.stream.label}</div>
                      <div className="text-[11px] text-mist-500">{row.stream.proformaRef}</div>
                    </td>
                    <td className="p-3 font-mono capitalize text-mist-600">
                      {row.stream.aggregation.replace("_", " ")}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-mist-900">
                      {row.annualRollup.value !== null
                        ? `${row.annualRollup.value.toLocaleString("en-IN", {
                            maximumFractionDigits: 2,
                          })} ${row.stream.standardUnit}`
                        : "—"}
                    </td>
                    <td className="p-3 text-right font-mono text-mist-700">
                      {row.annualRollup.proformaAnnual !== null && row.annualRollup.proformaAnnual !== undefined
                        ? `${row.annualRollup.proformaAnnual.toLocaleString("en-IN", {
                            maximumFractionDigits: 2,
                          })} ${row.stream.standardUnit}`
                        : "—"}
                    </td>
                    <td className="p-3 text-center font-mono">
                      {row.annualRollup.varianceToProformaPercent !== null &&
                      row.annualRollup.varianceToProformaPercent !== undefined
                        ? `${row.annualRollup.varianceToProformaPercent}%`
                        : "0.0%"}
                    </td>
                    <td className="p-3 text-center">
                      {row.annualRollup.isComplete ? (
                        <span className="text-emerald-700 font-semibold">✓ Verified</span>
                      ) : (
                        <span className="text-amber-700 font-semibold">⚠️ Partial</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Side-by-Side Pro Forma Preview */}
      {activeTab === "preview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card className="border-mist-200">
            <CardHeader
              title="Document Selector"
              actions={
                <select
                  value={previewDocId}
                  onChange={(e) => setPreviewDocId(e.target.value)}
                  className="rounded border border-mist-300 bg-white px-2 py-1 text-xs max-w-[260px] truncate"
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.slot ? `(${d.slot})` : ""}
                    </option>
                  ))}
                </select>
              }
            />
            <CardBody className="p-0">
              <div className="h-[650px] w-full bg-mist-100 flex items-center justify-center">
                {previewDocId ? (
                  <iframe
                    src={`/api/documents/${previewDocId}/file`}
                    className="w-full h-full border-0"
                    title="Document Preview"
                  />
                ) : (
                  <p className="text-xs text-mist-500">Select a document to preview</p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card className="border-mist-200">
            <CardHeader
              title="Auditor Cross-Check Reference"
            />
            <CardBody className="p-4 space-y-3">
              <p className="text-xs text-mist-600 leading-relaxed">
                Use this side-by-side inspection view to verify cell references against the uploaded PAT-2 Proforma or primary evidence PDFs.
              </p>

              <div className="rounded border border-mist-200 bg-mist-50 p-3 space-y-2">
                <span className="text-xs font-bold text-mist-800">Quick Navigation:</span>
                <ul className="text-xs space-y-1 text-mist-700">
                  <li>• Form 1: Total Equivalent Product (denominator for SEC)</li>
                  <li>• Form-Sb Section A: Clinker &amp; Cement Production</li>
                  <li>• Form-Sb Section C: Grid HT Electricity &amp; WHRS Generation</li>
                  <li>• Form-Sb Section D: Indian Coal, Petcoke, Imported Coal Quantities &amp; GCV</li>
                  <li>• Form-Sb Section E: Furnace Oil &amp; Diesel Consumption</li>
                </ul>
              </div>

              <div className="pt-2">
                <Link
                  href={`/engagements/${engagementId}/workbench`}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:underline"
                >
                  <Search className="h-3.5 w-3.5" />
                  Need to snip or correct a value from this document? Open Review Workbench →
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Tab 5: Sealed Audit Binder */}
      {activeTab === "binder" && (
        <div className="space-y-4">
          <Card className="border-mist-200">
            <CardHeader
              title="Sealed Desk Review Audit Binder"
              description="Statutory Evidence Dossier"
              actions={
                <a
                  href={`/api/desk-review/binder?engagementId=${engagementId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-mist-900 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-mist-800"
                >
                  <Download className="h-4 w-4" />
                  Download Sealed Binder (PDF)
                </a>
              }
            />
            <CardBody className="p-5 space-y-4 text-xs text-mist-700 leading-relaxed">
              <p>
                The audit binder is a deterministic, regulator-ready PDF compilation that binds together every piece of evidence cited during desk review into an immutable dossier.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-mist-900">
                    <ShieldCheck className="h-4 w-4 text-teal-600" />
                    1. Lead Tie-Out Schedule
                  </div>
                  <p className="text-[11px] text-mist-600 leading-normal">
                    Mathematical reconciliation of Scope 1, Scope 2, and production totals against declared pro forma returns, evaluated against the 2% aggregate materiality threshold.
                  </p>
                </div>

                <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-mist-900">
                    <Layers className="h-4 w-4 text-teal-600" />
                    2. Statutory Register Findings
                  </div>
                  <p className="text-[11px] text-mist-600 leading-normal">
                    Formal audit findings with citations to specific regulatory register clauses, documented verifier decisions, and mandatory auditee responses.
                  </p>
                </div>

                <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-mist-900">
                    <FileText className="h-4 w-4 text-teal-600" />
                    3. SHA-256 Verified Evidence
                  </div>
                  <p className="text-[11px] text-mist-600 leading-normal">
                    Exact PDF pages with auditor bounding-box snips drawn on-page, stamped with cryptographic content digests and file hashes.
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3.5 flex items-start gap-3 mt-3">
                <CheckCircle2 className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
                <div className="text-xs text-teal-900">
                  <span className="font-semibold block mb-0.5">Regulator Invariant: Fully Reproducible Digest</span>
                  The SHA-256 of the binder and each cited document hash are permanently recorded in the immutable audit event log, allowing accreditation bodies (BEE, NABCB) to independently verify the audit trail.
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
