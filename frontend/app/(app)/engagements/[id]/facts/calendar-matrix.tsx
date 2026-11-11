"use client";

import { useState, useRef } from "react";
import Link from "next/link";
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
  ExternalLink,
  Eye,
  Copy,
} from "lucide-react";
import { useSoftReload } from "@/lib/soft-reload";
import { EvidencePageViewer } from "@/components/workbench/evidence-page-viewer";

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
    streamKey: string;
    streamLabel: string;
    unit: string;
    month: MonthCell;
  } | null>(null);
  const [drawerView, setDrawerView] = useState<"summary" | "daily">("summary");
  const [isAddingDaily, setIsAddingDaily] = useState(false);
  const [dailyDate, setDailyDate] = useState("");
  const [dailyValue, setDailyValue] = useState("");
  const [dailySourceType, setDailySourceType] = useState<"sourcing" | "corroboration">("sourcing");
  const [isSavingDaily, setIsSavingDaily] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [inspectingReading, setInspectingReading] = useState<CalendarReading | null>(null);

  // Excel Import State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<"proforma" | "template" | "auto-map">("proforma");
  const [importSourceType, setImportSourceType] = useState<"corroboration" | "sourcing">("corroboration");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSaveDailyReading(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCell || !dailyDate || !dailyValue) {
      toast.error("Please provide both date and numerical value");
      return;
    }
    const numVal = parseFloat(dailyValue.replace(/,/g, "").trim());
    if (isNaN(numVal)) {
      toast.error("Value must be a valid number");
      return;
    }

    setIsSavingDaily(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          streamKey: selectedCell.streamKey,
          monthKey: selectedCell.month.monthKey,
          readingDate: dailyDate,
          sourceType: dailySourceType,
          valueNumeric: numVal,
          unit: selectedCell.unit,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast.error(data.error || "Failed to save daily reading");
        return;
      }
      toast.success(`Saved daily reading of ${numVal} ${selectedCell.unit} for ${dailyDate}`);
      setIsAddingDaily(false);
      setDailyValue("");
      softReload();
    } catch {
      toast.error("Network error while saving daily reading");
    } finally {
      setIsSavingDaily(false);
    }
  }

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
                                      streamKey: row.stream.key,
                                      streamLabel: row.stream.label,
                                      unit: row.stream.standardUnit,
                                      month,
                                    });
                                    setDrawerView(month.dailyCount && month.dailyCount > 1 ? "daily" : "summary");
                                    setDailyDate(month.startDate);
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

                                    {/* Daily Readings Count Badge */}
                                    {month.dailyCount !== undefined && month.dailyCount > 1 && (
                                      <span
                                        className="inline-block px-1 rounded text-[8px] font-mono bg-teal-50 text-teal-800 border border-teal-200"
                                        title={`${month.dailyCount} daily readings contribute to this month's total`}
                                      >
                                        {month.dailyCount} days
                                      </span>
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

      {/* Provenance Document Inspector Modal */}
      {inspectingReading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-mist-200 bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-mist-200 bg-mist-50 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <Eye className="h-5 w-5 text-teal-600" />
                <div>
                  <h3 className="text-sm font-semibold text-mist-900">
                    Provenance Inspector &amp; Document Source
                  </h3>
                  <p className="text-xs text-mist-500 font-mono">
                    {inspectingReading.streamKey} · {inspectingReading.monthKey} [{inspectingReading.sourceType.toUpperCase()}]
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectingReading(null)}
                className="rounded p-1 text-mist-400 hover:bg-mist-200 hover:text-mist-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {inspectingReading.documentId ? (
                <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-mist-800 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-mist-600" />
                      {inspectingReading.documentName || "Source Document"}
                    </span>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/documents/${inspectingReading.documentId}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:underline font-medium"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                      <Link
                        href={`/engagements/${engagementId}/workbench?docId=${inspectingReading.documentId}&page=${inspectingReading.provenancePage || 1}`}
                        className="inline-flex items-center gap-1 text-[11px] text-teal-700 hover:underline font-semibold bg-teal-50 px-2 py-0.5 rounded border border-teal-200"
                      >
                        <ExternalLink className="h-3 w-3" /> Open in Workbench
                      </Link>
                    </div>
                  </div>

                  {inspectingReading.provenanceBbox?.cellRef ? (
                    <div className="rounded border border-amber-200 bg-amber-50/60 p-4 text-center space-y-1.5 my-2">
                      <div className="text-xs font-semibold text-amber-900">Spreadsheet Cell Reference</div>
                      <div className="text-base font-mono font-bold text-amber-950">
                        {inspectingReading.provenanceBbox.sheet ? `${inspectingReading.provenanceBbox.sheet}!` : ""}
                        {inspectingReading.provenanceBbox.cellRef}
                      </div>
                      <div className="text-xs text-amber-800">
                        Recorded figure: <span className="font-bold">{inspectingReading.valueNumeric} {inspectingReading.unit}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-auto rounded border border-mist-300 bg-white">
                      <EvidencePageViewer
                        src={`/api/documents/${inspectingReading.documentId}/file`}
                        page={inspectingReading.provenancePage ?? 1}
                        bbox={
                          inspectingReading.provenanceBbox &&
                          inspectingReading.provenanceBbox.width != null &&
                          inspectingReading.provenanceBbox.width > 0 &&
                          inspectingReading.provenanceBbox.height != null &&
                          inspectingReading.provenanceBbox.x != null &&
                          inspectingReading.provenanceBbox.y != null
                            ? {
                                x: inspectingReading.provenanceBbox.x,
                                y: inspectingReading.provenanceBbox.y,
                                width: inspectingReading.provenanceBbox.width,
                                height: inspectingReading.provenanceBbox.height,
                              }
                            : null
                        }
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-mist-200 bg-mist-50 p-4 text-center text-xs text-mist-600">
                  Manual entry without linked document.
                </div>
              )}

              <div className="rounded-lg border border-mist-200 bg-white p-3.5 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2 pb-2 border-b border-mist-100">
                  <div>
                    <span className="text-mist-500 block text-[11px]">Normalized Figure:</span>
                    <span className="font-mono font-bold text-mist-900 text-sm">
                      {inspectingReading.standardValue} {inspectingReading.standardUnit}
                    </span>
                  </div>
                  <div>
                    <span className="text-mist-500 block text-[11px]">Stated Value &amp; Unit:</span>
                    <span className="font-mono text-mist-800">
                      {inspectingReading.valueNumeric} {inspectingReading.unit}
                    </span>
                  </div>
                </div>

                {inspectingReading.provenanceSourceText && (
                  <div>
                    <span className="text-mist-500 block text-[11px] mb-0.5">Verbatim Extraction Text:</span>
                    <p className="rounded bg-mist-50 p-2 font-mono text-[11px] text-mist-800 border border-mist-100">
                      {inspectingReading.provenanceSourceText}
                    </p>
                  </div>
                )}

                {inspectingReading.inputHash && (
                  <div className="pt-1">
                    <span className="text-mist-500 block text-[11px] mb-0.5">Cryptographic Input Fingerprint:</span>
                    <div className="flex items-center justify-between rounded bg-mist-100 px-2 py-1 font-mono text-[10px] text-mist-700">
                      <span className="truncate">{inspectingReading.inputHash}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(inspectingReading.inputHash || "");
                          toast.success("SHA-256 hash copied to clipboard");
                        }}
                        className="ml-2 shrink-0 text-mist-500 hover:text-mist-900"
                        title="Copy SHA-256"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-mist-200 bg-mist-50 px-5 py-3">
              <span className="text-[11px] text-emerald-700 font-medium">
                ✓ Verified Reading (Status: {inspectingReading.state})
              </span>
              <Button variant="secondary" size="sm" onClick={() => setInspectingReading(null)}>
                Close
              </Button>
            </div>
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

          {/* Drawer Sub-Navigation: Summary vs Daily Breakdown */}
          <div className="flex border-b border-mist-200 bg-mist-50/70 px-4">
            <button
              onClick={() => setDrawerView("summary")}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                drawerView === "summary"
                  ? "border-mist-900 text-mist-900"
                  : "border-transparent text-mist-500 hover:text-mist-700"
              }`}
            >
              Layer Summary
            </button>
            <button
              onClick={() => setDrawerView("daily")}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                drawerView === "daily"
                  ? "border-teal-700 text-teal-900 font-bold"
                  : "border-transparent text-mist-500 hover:text-mist-700"
              }`}
            >
              <span>Daily Breakdown</span>
              <span className="rounded-full bg-mist-200 px-1.5 py-0.2 text-[10px] text-mist-700">
                {selectedCell.month.allReadings?.length || 0}
              </span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {drawerView === "summary" ? (
              <>
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
                    engagementId={engagementId}
                    onInspect={setInspectingReading}
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
                    engagementId={engagementId}
                    onInspect={setInspectingReading}
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
                    engagementId={engagementId}
                    onInspect={setInspectingReading}
                  />
                )}
              </>
            ) : (
              /* Daily Breakdown View */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-mist-900">
                    Day-by-Day Timeline ({selectedCell.month.allReadings?.length || 0} readings)
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAddingDaily(!isAddingDaily)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                  >
                    {isAddingDaily ? "Cancel" : "+ Add Daily Reading"}
                  </button>
                </div>

                {/* Inline Add Daily Reading Form */}
                {isAddingDaily && (
                  <form onSubmit={handleSaveDailyReading} className="rounded-lg border border-teal-200 bg-teal-50/50 p-3 space-y-3">
                    <p className="text-xs font-semibold text-teal-900">Record Single-Day Reading</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label className="block text-[11px] font-medium text-mist-700 mb-0.5">Date (YYYY-MM-DD):</label>
                        <input
                          type="date"
                          required
                          value={dailyDate}
                          onChange={(e) => setDailyDate(e.target.value)}
                          className="w-full rounded border border-mist-300 bg-white p-1 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-mist-700 mb-0.5">Value ({selectedCell.unit}):</label>
                        <input
                          type="number"
                          step="any"
                          required
                          placeholder="e.g. 150.5"
                          value={dailyValue}
                          onChange={(e) => setDailyValue(e.target.value)}
                          className="w-full rounded border border-mist-300 bg-white p-1 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-3 text-xs">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="drawerDailySource"
                            value="sourcing"
                            checked={dailySourceType === "sourcing"}
                            onChange={() => setDailySourceType("sourcing")}
                          />
                          <span>[S] Sourcing</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name="drawerDailySource"
                            value="corroboration"
                            checked={dailySourceType === "corroboration"}
                            onChange={() => setDailySourceType("corroboration")}
                          />
                          <span>[C] Corrob.</span>
                        </label>
                      </div>
                      <Button type="submit" size="sm" variant="primary" disabled={isSavingDaily} className="text-xs">
                        {isSavingDaily ? "Saving..." : "Save Reading"}
                      </Button>
                    </div>
                  </form>
                )}

                {/* List of Granular Readings */}
                {selectedCell.month.allReadings && selectedCell.month.allReadings.length > 0 ? (
                  <div className="space-y-2">
                    {selectedCell.month.allReadings.map((r, idx) => (
                      <div
                        key={r.id || idx}
                        className="rounded-lg border border-mist-200 bg-white p-3 shadow-xs hover:border-mist-300 transition-colors space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-mist-900 font-mono">
                              {r.readingDate || r.startDate || selectedCell.month.monthKey}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${
                                r.sourceType === "sourcing"
                                  ? "bg-blue-100 text-blue-800"
                                  : r.sourceType === "corroboration"
                                  ? "bg-purple-100 text-purple-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              [{r.sourceType[0].toUpperCase()}] {r.sourceType}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-mist-900">
                            {r.standardValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {selectedCell.unit}
                          </span>
                        </div>

                        {r.documentName && (
                          <div className="flex items-center justify-between text-[11px] text-mist-600 pt-1 border-t border-mist-100">
                            <button
                              type="button"
                              onClick={() => setInspectingReading(r)}
                              className="truncate max-w-[200px] text-left text-teal-800 hover:underline flex items-center gap-1 font-medium"
                              title={`Click to inspect: ${r.documentName}`}
                            >
                              📄 {r.documentName}
                            </button>
                            <div className="flex items-center gap-1">
                              {r.provenancePage && <span className="font-mono text-[10px] text-mist-500">p. {r.provenancePage}</span>}
                              <button
                                type="button"
                                onClick={() => setInspectingReading(r)}
                                className="p-0.5 text-teal-700 hover:text-teal-900"
                                title="Inspect Source"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              {r.documentId && (
                                <Link
                                  href={`/engagements/${engagementId}/workbench?docId=${r.documentId}&page=${r.provenancePage || 1}`}
                                  className="p-0.5 text-mist-500 hover:text-mist-900"
                                  title="Open in Workbench"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Link>
                              )}
                            </div>
                          </div>
                        )}

                        {r.provenanceSourceText && (
                          <div className="rounded bg-mist-50 p-1.5 text-[10px] font-mono text-mist-700 truncate border border-mist-100">
                            {r.provenanceSourceText}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-mist-500 italic py-4 text-center">
                    No individual daily readings recorded for this month yet. Use &apos;+ Add Daily Reading&apos; or Workbench to snip daily records.
                  </p>
                )}
              </div>
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
  engagementId,
  onInspect,
}: {
  title: string;
  badgeText: string;
  badgeColor: string;
  reading: CalendarReading;
  unit: string;
  engagementId: string;
  onInspect: (r: CalendarReading) => void;
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
        <div className="flex items-center justify-between text-xs pt-1 border-t border-mist-100">
          <span className="text-mist-500 flex items-center gap-1">
            <FileText className="h-3.5 w-3.5 text-mist-600" /> Source File:
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onInspect(reading)}
              className="font-medium text-teal-800 hover:text-teal-950 underline max-w-[170px] truncate text-left"
              title={`Click to inspect provenance: ${reading.documentName}`}
            >
              {reading.documentName}
            </button>
            <button
              type="button"
              onClick={() => onInspect(reading)}
              title="Inspect Provenance Facsimile"
              className="rounded p-1 text-teal-700 hover:bg-teal-50"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            {reading.documentId && (
              <Link
                href={`/engagements/${engagementId}/workbench?docId=${reading.documentId}&page=${reading.provenancePage || 1}`}
                title="Open in Review Workbench"
                className="rounded p-1 text-mist-500 hover:bg-mist-100 hover:text-mist-900"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
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
        <div className="flex items-center justify-between text-[11px] text-mist-700 font-mono bg-mist-50 p-1.5 rounded border border-mist-100">
          <span className="text-[10px] text-mist-500">
            {reading.provenanceBbox.cellRef ? '📊 Cell:' : '📍 Bounding Box:'}
          </span>
          <span className="font-semibold text-mist-900">
            {reading.provenanceBbox.cellRef
              ? `${reading.provenanceBbox.sheet ? reading.provenanceBbox.sheet + '!' : ''}${reading.provenanceBbox.cellRef}`
              : `x:${reading.provenanceBbox.x?.toFixed(2)} y:${reading.provenanceBbox.y?.toFixed(2)} [${Math.round((reading.provenanceBbox.width || 0) * 100)}% × ${Math.round((reading.provenanceBbox.height || 0) * 100)}%]`
            }
          </span>
        </div>
      )}

      {reading.inputHash && (
        <div className="flex items-center justify-between text-[10px] text-mist-400 font-mono">
          <span>SHA-256:</span>
          <span className="truncate max-w-[190px]" title={reading.inputHash}>
            {reading.inputHash.slice(0, 16)}…
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
