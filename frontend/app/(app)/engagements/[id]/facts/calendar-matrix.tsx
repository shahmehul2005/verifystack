"use client";

import { useState, useRef } from "react";
import {
  CalendarGridData,
  MonthCell,
  CalendarReading,
} from "@verifystack/backend/domain/calendar/index";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Check,
  AlertTriangle,
  Calculator,
  FileText,
  X,
  FileSpreadsheet,
  Download,
  Upload,
} from "lucide-react";
import { useSoftReload } from "@/lib/soft-reload";

interface CalendarMatrixProps {
  initialGrid: CalendarGridData;
  engagementId: string;
}

export function CalendarMatrix({ initialGrid, engagementId }: CalendarMatrixProps) {
  const { softReload } = useSoftReload();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showSourcing, setShowSourcing] = useState(true);
  const [showCorroboration, setShowCorroboration] = useState(true);
  const [showProforma, setShowProforma] = useState(true);
  const [selectedCell, setSelectedCell] = useState<{
    streamLabel: string;
    unit: string;
    month: MonthCell;
  } | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  // Excel Import State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"proforma" | "template" | "auto-map">("proforma");
  const [importSourceType, setImportSourceType] = useState<"corroboration" | "sourcing">("corroboration");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCommitRollups() {
    setIsCommitting(true);
    try {
      const res = await fetch("/api/calendar/rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "Failed to commit rollups");
        return;
      }
      toast.success(
        `Committed ${data.committed} verified annual roll-up(s) to calculation facts ledger!`
      );
      softReload();
    } catch {
      toast.error("Network error while committing rollups");
    } finally {
      setIsCommitting(false);
    }
  }

  function handleDownloadTemplate() {
    window.open(`/api/calendar/excel/template?year=${initialGrid.complianceYear}`, "_blank");
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      toast.error("Please select a file to import");
      return;
    }

    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("engagementId", engagementId);
      formData.append("mode", importMode);
      formData.append("complianceYear", initialGrid.complianceYear);
      formData.append("sourceType", importSourceType);

      const res = await fetch("/api/calendar/excel", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        toast.error(data.error || "Excel extraction failed");
        return;
      }

      toast.success(
        `Successfully extracted ${data.extractedCount} readings (${data.savedCount} saved to calendar)!`
      );
      setIsImportModalOpen(false);
      setSelectedFile(null);
      softReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error uploading Excel");
    } finally {
      setIsImporting(false);
    }
  }

  const filteredCategories = initialGrid.categories.filter((cat) =>
    selectedCategory === "all" ? true : cat.category === selectedCategory
  );

  return (
    <div className="space-y-6">
      {/* Top Stat Tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium text-mist-500 uppercase tracking-wider">Tracked Streams</p>
            <p className="mt-1 text-2xl font-semibold text-mist-900">
              {initialGrid.summary.activeStreamsCount}{" "}
              <span className="text-xs font-normal text-mist-500">/ {initialGrid.summary.totalStreams} defined</span>
            </p>
          </CardBody>
        </Card>

        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium text-mist-500 uppercase tracking-wider">12-Month Completeness</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-teal-700">
                {initialGrid.summary.complete12MonthStreams}
              </span>
              <span className="text-xs text-mist-600">streams 100% filled</span>
            </div>
          </CardBody>
        </Card>

        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium text-mist-500 uppercase tracking-wider">Total Readings</p>
            <p className="mt-1 text-2xl font-semibold text-mist-900">
              {initialGrid.summary.totalReadingsCount}{" "}
              <span className="text-xs font-normal text-mist-500">evidence points</span>
            </p>
          </CardBody>
        </Card>

        <Card className="border-mist-200">
          <CardBody className="p-4">
            <p className="text-xs font-medium text-mist-500 uppercase tracking-wider">Variance Alerts (&gt;5%)</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-semibold ${
                  initialGrid.summary.varianceAlertsCount > 0 ? "text-rose-600" : "text-emerald-600"
                }`}
              >
                {initialGrid.summary.varianceAlertsCount}
              </span>
              <span className="text-xs text-mist-600">
                {initialGrid.summary.varianceAlertsCount === 0 ? "Cross-checks agree" : "Needs review"}
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Control Bar: Categories Filter, Source Layer Toggles, and Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-mist-200 bg-mist-50/70 p-3">
        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-mist-500">Stream:</span>
          {[
            { id: "all", label: "All Streams" },
            { id: "production", label: "Production" },
            { id: "solid_fuel", label: "Solid Fuels" },
            { id: "liquid_fuel", label: "Liquid Fuels" },
            { id: "electricity", label: "Electricity" },
            { id: "process", label: "Process CO₂" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedCategory === cat.id
                  ? "bg-mist-900 text-white shadow-sm"
                  : "bg-white text-mist-700 border border-mist-200 hover:bg-mist-100"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Source Layer Toggles & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-mist-500">Sources:</span>
          <button
            onClick={() => setShowSourcing(!showSourcing)}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
              showSourcing
                ? "bg-blue-50 border-blue-300 text-blue-800"
                : "bg-mist-100 border-mist-200 text-mist-400 line-through"
            }`}
          >
            <span className="font-bold">[S]</span> Sourcing
          </button>

          <button
            onClick={() => setShowCorroboration(!showCorroboration)}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
              showCorroboration
                ? "bg-purple-50 border-purple-300 text-purple-800"
                : "bg-mist-100 border-mist-200 text-mist-400 line-through"
            }`}
          >
            <span className="font-bold">[C]</span> Corroboration
          </button>

          <button
            onClick={() => setShowProforma(!showProforma)}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
              showProforma
                ? "bg-amber-50 border-amber-300 text-amber-800"
                : "bg-mist-100 border-mist-200 text-mist-400 line-through"
            }`}
          >
            <span className="font-bold">[P]</span> Pro Forma
          </button>

          <div className="h-4 w-px bg-mist-300 mx-1" />

          {/* Download Template */}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleDownloadTemplate}
            className="gap-1 text-xs bg-white"
            title="Download clean 12-month spreadsheet template"
          >
            <Download className="h-3.5 w-3.5" />
            Template
          </Button>

          {/* Import Excel Button */}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsImportModalOpen(true)}
            className="gap-1 text-xs bg-white text-teal-800 border-teal-300 hover:bg-teal-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-teal-600" />
            Import Excel
          </Button>

          {/* Commit Rollups */}
          <Button
            size="sm"
            variant="primary"
            onClick={handleCommitRollups}
            disabled={isCommitting}
            className="gap-1.5 text-xs shadow-sm"
          >
            <Calculator className="h-3.5 w-3.5" />
            {isCommitting ? "Committing..." : "Commit Roll-ups"}
          </Button>
        </div>
      </div>

      {/* 12-Month Calendar Grid Matrix */}
      <div className="overflow-x-auto rounded-lg border border-mist-200 bg-white shadow-sm">
        <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-mist-200 bg-mist-100/70 font-semibold text-mist-800">
              <th className="sticky left-0 z-10 bg-mist-100/95 p-3 min-w-[220px]">
                Stream &amp; PAT-2 Proforma Ref
              </th>
              {initialGrid.months.map((m) => (
                <th key={m.key} className="p-2 text-center min-w-[72px] border-l border-mist-200">
                  {m.label.split(" ")[0]}
                  <span className="block text-[10px] font-normal text-mist-500">
                    &apos;{m.label.split(" ")[1]?.slice(2)}
                  </span>
                </th>
              ))}
              <th className="p-3 text-right min-w-[150px] border-l-2 border-mist-300 bg-mist-100">
                Annual Roll-Up (Verified)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mist-200">
            {filteredCategories.map((cat) => (
              <tr key={cat.category} className="bg-transparent">
                <td colSpan={14} className="p-0">
                  <div className="bg-mist-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-mist-700 border-y border-mist-200">
                    {cat.label}
                    <span className="ml-2 text-[10px] font-normal text-mist-500">
                      ({cat.scope.replace("_", " ")})
                    </span>
                  </div>

                  <table className="w-full border-collapse">
                    <tbody>
                      {cat.rows.map((row) => (
                        <tr
                          key={row.stream.key}
                          className="hover:bg-mist-50/60 transition-colors border-b border-mist-100 last:border-b-0"
                        >
                          {/* Stream Name & Info */}
                          <td className="sticky left-0 z-10 bg-white hover:bg-mist-50 p-2.5 min-w-[220px] max-w-[220px] border-r border-mist-200">
                            <div className="font-medium text-mist-900 truncate" title={row.stream.label}>
                              {row.stream.label}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-mist-500">
                              <span className="font-mono bg-mist-100 px-1 py-0.2 rounded text-[10px]">
                                {row.stream.standardUnit}
                              </span>
                              {row.stream.proformaRef && (
                                <span className="truncate text-[10px] text-mist-400">
                                  {row.stream.proformaRef}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 12 Monthly Cells */}
                          {row.months.map((month) => {
                            const hasS = Boolean(month.sourcing) && showSourcing;
                            const hasC = Boolean(month.corroboration) && showCorroboration;
                            const hasP = Boolean(month.proforma) && showProforma;
                            const hasAny = hasS || hasC || hasP;

                            return (
                              <td
                                key={month.monthKey}
                                onClick={() => {
                                  if (hasAny) {
                                    setSelectedCell({
                                      streamLabel: row.stream.label,
                                      unit: row.stream.standardUnit,
                                      month,
                                    });
                                  }
                                }}
                                className={`p-1.5 text-center border-l border-mist-100 min-w-[72px] transition-colors ${
                                  hasAny ? "cursor-pointer hover:bg-teal-50/40" : "bg-mist-50/30"
                                }`}
                              >
                                {hasAny ? (
                                  <div className="flex flex-col gap-0.5 items-center">
                                    {/* Primary Sourcing */}
                                    {hasS && month.sourcing && (
                                      <div
                                        className="text-[11px] font-mono font-medium text-blue-900 bg-blue-50/90 rounded px-1 w-full truncate text-center"
                                        title={`Sourcing: ${month.sourcing.standardValue} ${row.stream.standardUnit}`}
                                      >
                                        {formatCompact(month.sourcing.standardValue)}
                                      </div>
                                    )}

                                    {/* Corroboration */}
                                    {hasC && month.corroboration && (
                                      <div
                                        className="text-[10px] font-mono text-purple-900 bg-purple-50/90 rounded px-1 w-full truncate text-center"
                                        title={`Corroboration: ${month.corroboration.standardValue} ${row.stream.standardUnit}`}
                                      >
                                        {formatCompact(month.corroboration.standardValue)}
                                      </div>
                                    )}

                                    {/* Pro Forma */}
                                    {hasP && month.proforma && (
                                      <div
                                        className="text-[10px] font-mono text-amber-900 bg-amber-50/90 rounded px-1 w-full truncate text-center"
                                        title={`Pro Forma: ${month.proforma.standardValue} ${row.stream.standardUnit}`}
                                      >
                                        {formatCompact(month.proforma.standardValue)}
                                      </div>
                                    )}

                                    {/* Variance Tag if applicable */}
                                    {month.variancePercent !== null && month.variancePercent !== undefined && (
                                      <span
                                        className={`inline-block px-1 rounded text-[9px] font-mono ${
                                          month.hasVarianceAlert
                                            ? "bg-rose-100 text-rose-800 font-semibold"
                                            : "bg-emerald-50 text-emerald-700"
                                        }`}
                                      >
                                        Δ{month.variancePercent}%
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-mist-300 font-mono text-[10px]">·</span>
                                )}
                              </td>
                            );
                          })}

                          {/* Annual Roll-Up Column */}
                          <td className="p-2.5 text-right border-l-2 border-mist-300 bg-mist-50/40 min-w-[150px]">
                            {row.annualRollup.value !== null ? (
                              <div>
                                <div className="font-mono font-semibold text-mist-900 text-[13px]">
                                  {row.annualRollup.value.toLocaleString("en-IN", {
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  <span className="text-[10px] font-normal text-mist-500">
                                    {row.annualRollup.unit}
                                  </span>
                                </div>
                                <div className="flex items-center justify-end gap-1.5 mt-0.5">
                                  <span
                                    className={`inline-flex items-center px-1 rounded text-[10px] font-medium ${
                                      row.annualRollup.isComplete
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                    }`}
                                  >
                                    {row.annualRollup.completedMonthsCount}/12 mo
                                  </span>
                                  {row.annualRollup.varianceToProformaPercent !== null &&
                                    row.annualRollup.varianceToProformaPercent !== undefined && (
                                      <span
                                        className={`text-[10px] font-mono ${
                                          row.annualRollup.varianceToProformaPercent > 5
                                            ? "text-rose-700 font-medium"
                                            : "text-emerald-700"
                                        }`}
                                        title={`Declared Pro Forma: ${row.annualRollup.proformaAnnual}`}
                                      >
                                        vs PF: {row.annualRollup.varianceToProformaPercent}%
                                      </span>
                                    )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-mist-400 italic text-xs">No readings</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Excel / Proforma Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-mist-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-mist-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                <h3 className="text-base font-semibold text-mist-900">
                  Import Spreadsheet Data
                </h3>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="rounded p-1 text-mist-400 hover:bg-mist-100 hover:text-mist-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="space-y-4">
              {/* Option Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-mist-700">Choose Extraction Mode:</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label
                    className={`cursor-pointer rounded-lg border p-3 text-xs transition-all ${
                      importMode === "proforma"
                        ? "border-teal-600 bg-teal-50/60 text-teal-950 font-medium ring-1 ring-teal-600"
                        : "border-mist-200 bg-mist-50 hover:bg-mist-100 text-mist-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="proforma"
                      checked={importMode === "proforma"}
                      onChange={() => setImportMode("proforma")}
                      className="sr-only"
                    />
                    <div className="font-bold text-amber-700">Option 1A: BEE PAT-2</div>
                    <div className="text-[11px] text-mist-500 mt-1">Official Form-Sb &amp; Form 1 (.xls)</div>
                  </label>

                  <label
                    className={`cursor-pointer rounded-lg border p-3 text-xs transition-all ${
                      importMode === "template"
                        ? "border-teal-600 bg-teal-50/60 text-teal-950 font-medium ring-1 ring-teal-600"
                        : "border-mist-200 bg-mist-50 hover:bg-mist-100 text-mist-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="template"
                      checked={importMode === "template"}
                      onChange={() => setImportMode("template")}
                      className="sr-only"
                    />
                    <div className="font-bold text-teal-700">Option 1B: Standard</div>
                    <div className="text-[11px] text-mist-500 mt-1">12-Mo Calendar Template</div>
                  </label>

                  <label
                    className={`cursor-pointer rounded-lg border p-3 text-xs transition-all ${
                      importMode === "auto-map"
                        ? "border-teal-600 bg-teal-50/60 text-teal-950 font-medium ring-1 ring-teal-600"
                        : "border-mist-200 bg-mist-50 hover:bg-mist-100 text-mist-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="importMode"
                      value="auto-map"
                      checked={importMode === "auto-map"}
                      onChange={() => setImportMode("auto-map")}
                      className="sr-only"
                    />
                    <div className="font-bold text-purple-700">Option 2: Auto-Map</div>
                    <div className="text-[11px] text-mist-500 mt-1">Custom Plant SCADA / MIS</div>
                  </label>
                </div>
              </div>

              {/* Source Layer Selection (for Template or Auto-Map) */}
              {importMode !== "proforma" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-mist-700">Assign Evidence Source Layer:</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-mist-800 cursor-pointer">
                      <input
                        type="radio"
                        name="importSourceType"
                        value="corroboration"
                        checked={importSourceType === "corroboration"}
                        onChange={() => setImportSourceType("corroboration")}
                      />
                      <span>[C] Internal Corroboration (ERP/SCADA logs)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-mist-800 cursor-pointer">
                      <input
                        type="radio"
                        name="importSourceType"
                        value="sourcing"
                        checked={importSourceType === "sourcing"}
                        onChange={() => setImportSourceType("sourcing")}
                      />
                      <span>[S] Sourcing (External bills)</span>
                    </label>
                  </div>
                </div>
              )}

              {/* File Upload Zone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer rounded-lg border-2 border-dashed border-mist-300 p-6 text-center hover:border-teal-500 hover:bg-teal-50/30 transition-colors"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xls,.xlsx,.csv"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <Upload className="mx-auto h-8 w-8 text-mist-400" />
                <p className="mt-2 text-xs font-semibold text-mist-800">
                  {selectedFile ? selectedFile.name : "Click to select or drag spreadsheet here"}
                </p>
                <p className="text-[11px] text-mist-500 mt-0.5">Supports .xls, .xlsx, .csv</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-mist-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsImportModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={!selectedFile || isImporting}
                  className="gap-1.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  {isImporting ? "Processing..." : "Extract & Ingest"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cell Evidence Drawer */}
      {selectedCell && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-white shadow-2xl border-l border-mist-200">
          <div className="flex items-center justify-between border-b border-mist-200 px-4 py-3 bg-mist-50">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-mist-500">
                Cell Evidence Explorer
              </p>
              <h3 className="text-base font-semibold text-mist-900">
                {selectedCell.streamLabel} ({selectedCell.month.label})
              </h3>
            </div>
            <button
              onClick={() => setSelectedCell(null)}
              className="rounded-md p-1.5 text-mist-500 hover:bg-mist-200 hover:text-mist-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Variance Header Card if multiple sources exist */}
            {selectedCell.month.variancePercent !== null && (
              <div
                className={`rounded-lg border p-3 ${
                  selectedCell.month.hasVarianceAlert
                    ? "bg-rose-50 border-rose-200 text-rose-900"
                    : "bg-emerald-50 border-emerald-200 text-emerald-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  {selectedCell.month.hasVarianceAlert ? (
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                  ) : (
                    <Check className="h-4 w-4 text-emerald-600" />
                  )}
                  <span className="font-semibold text-xs">
                    Cross-Source Variance: {selectedCell.month.variancePercent}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed">
                  {selectedCell.month.hasVarianceAlert
                    ? "Discrepancy exceeds 5% between uploaded evidence sources. Auditor review required."
                    : "Sources agree within acceptable industrial verification tolerance (≤5%)."}
                </p>
              </div>
            )}

            {/* Sourcing Evidence */}
            {selectedCell.month.sourcing && (
              <ReadingEvidenceCard
                title="Primary Sourcing"
                badgeText="Sourcing"
                badgeColor="bg-blue-100 text-blue-800"
                reading={selectedCell.month.sourcing}
                unit={selectedCell.unit}
              />
            )}

            {/* Corroboration Evidence */}
            {selectedCell.month.corroboration && (
              <ReadingEvidenceCard
                title="Internal Operational Record"
                badgeText="Corroboration"
                badgeColor="bg-purple-100 text-purple-800"
                reading={selectedCell.month.corroboration}
                unit={selectedCell.unit}
              />
            )}

            {/* Pro Forma Evidence */}
            {selectedCell.month.proforma && (
              <ReadingEvidenceCard
                title="Declared Pro Forma"
                badgeText="Pro Forma"
                badgeColor="bg-amber-100 text-amber-800"
                reading={selectedCell.month.proforma}
                unit={selectedCell.unit}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadingEvidenceCard({
  title,
  badgeText,
  badgeColor,
  reading,
  unit,
}: {
  title: string;
  badgeText: string;
  badgeColor: string;
  reading: CalendarReading;
  unit: string;
}) {
  return (
    <div className="rounded-lg border border-mist-200 bg-white p-3.5 shadow-sm space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-mist-900">{title}</span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${badgeColor}`}>
          [{badgeText[0]}] {badgeText}
        </span>
      </div>

      <div className="flex items-baseline justify-between border-b border-mist-100 pb-2">
        <span className="text-xs text-mist-500">Value Recorded:</span>
        <span className="font-mono text-base font-bold text-mist-900">
          {reading.standardValue.toLocaleString("en-IN", { maximumFractionDigits: 3 })} {unit}
          {reading.unit !== unit && (
            <span className="ml-1 text-[11px] font-normal text-mist-500">
              (as stated: {reading.valueNumeric} {reading.unit})
            </span>
          )}
        </span>
      </div>

      {reading.documentName && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-mist-500 flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> Source File:
          </span>
          <span className="font-medium text-mist-800 max-w-[240px] truncate" title={reading.documentName}>
            {reading.documentName}
          </span>
        </div>
      )}

      {reading.provenancePage && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-mist-500">Document Page:</span>
          <span className="font-mono text-mist-800">Page {reading.provenancePage}</span>
        </div>
      )}

      {reading.provenanceSourceText && (
        <div className="space-y-1">
          <span className="text-[11px] font-medium text-mist-500">Verbatim Source Text:</span>
          <div className="rounded bg-mist-50 p-2 font-mono text-[11px] text-mist-800 border border-mist-100">
            {reading.provenanceSourceText}
          </div>
        </div>
      )}

      {reading.provenanceBbox && (
        <div className="flex items-center justify-between text-[10px] text-mist-400 font-mono">
          <span>Bounding Box:</span>
          <span>
            x:{reading.provenanceBbox.x.toFixed(2)} y:{reading.provenanceBbox.y.toFixed(2)} w:
            {reading.provenanceBbox.width.toFixed(2)} h:{reading.provenanceBbox.height.toFixed(2)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-mist-500 pt-1 border-t border-mist-100">
        <span>Auditor Status:</span>
        <span className="font-medium text-emerald-700 capitalize">✓ {reading.state}</span>
      </div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1000000) {
    return (n / 1000000).toFixed(1) + "M";
  }
  if (Math.abs(n) >= 1000) {
    return (n / 1000).toFixed(1) + "k";
  }
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
