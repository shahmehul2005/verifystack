"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileSpreadsheet, X, ArrowRight, CheckCircle2, AlertCircle, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoftReload } from "@/lib/soft-reload";

interface IngestResult {
  ok: boolean;
  mode: string;
  extractedCount: number;
  savedCount: number;
  mappings?: Record<string, string>;
  unmapped?: string[];
  error?: string;
}

export function ExcelCalendarImportButton({
  documentId,
  documentName,
  engagementId,
}: {
  documentId: string;
  documentName: string;
  engagementId: string;
}) {
  const { softReload } = useSoftReload();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"proforma" | "template" | "auto-map">(
    /pro-?forma|form-?1|form-?sb/i.test(documentName) ? "proforma" : "auto-map"
  );
  const [sourceType, setSourceType] = useState<"sourcing" | "corroboration" | "proforma">(
    /pro-?forma|form-?1|form-?sb/i.test(documentName) ? "proforma" : "corroboration"
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function resetState() {
    setResult(null);
    setErrorMessage(null);
    setIsProcessing(false);
  }

  async function handleImport() {
    setIsProcessing(true);
    setErrorMessage(null);
    setResult(null);
    try {
      const res = await fetch("/api/calendar/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          documentId,
          mode,
          sourceType,
          complianceYear: "2023-24",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        const err = json.error ?? "Excel processing failed";
        setErrorMessage(typeof err === "string" ? err : JSON.stringify(err));
        toast.error("Excel processing failed. Check details below.");
        return;
      }

      setResult(json as IngestResult);
      toast.success(
        `Extracted and saved ${json.savedCount ?? json.extractedCount} readings directly to Calendar!`
      );
      softReload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error during extraction";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          resetState();
          setIsOpen(true);
        }}
        className="text-xs gap-1.5 text-teal-800 hover:text-teal-950 border-teal-200 bg-teal-50/50 hover:bg-teal-100"
      >
        <FileSpreadsheet className="size-3.5 text-teal-600" />
        Process to Calendar
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl border border-mist-200 bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-mist-100 bg-mist-50/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-teal-100/70 text-teal-700">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-mist-900 leading-tight">
                    Process Spreadsheet to Stream Calendar
                  </h3>
                  <p className="text-xs text-mist-500 font-mono truncate max-w-md mt-0.5" title={documentName}>
                    {documentName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-mist-400 hover:bg-mist-200 hover:text-mist-700 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              {result ? (
                /* Success View */
                <div className="space-y-4 py-2">
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                    <div>
                      <h4 className="font-semibold text-emerald-950">Ingest Completed Successfully!</h4>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        Extracted {result.extractedCount} values and persisted {result.savedCount} verified readings into the 12-Month Calendar Ledger.
                      </p>
                    </div>
                  </div>

                  {result.mappings && Object.keys(result.mappings).length > 0 && (
                    <div className="rounded-lg border border-mist-200 bg-mist-50/50 p-3 space-y-2">
                      <span className="text-xs font-semibold text-mist-700 block">
                        Mapped Cement Streams ({Object.keys(result.mappings).length}):
                      </span>
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        {Object.entries(result.mappings).map(([stream, col]) => (
                          <div key={stream} className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 border border-mist-200">
                            <span className="font-mono text-mist-600 text-[11px] truncate">{col}</span>
                            <span className="font-semibold text-teal-800 text-[11px]">→ {stream}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-mist-100">
                    <Button variant="secondary" size="sm" onClick={() => setIsOpen(false)}>
                      Close
                    </Button>
                    <Link
                      href={`/engagements/${engagementId}/facts`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-teal-800"
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      View Stream Calendar
                    </Link>
                  </div>
                </div>
              ) : isProcessing ? (
                /* Processing Spinner */
                <div className="py-12 text-center space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin text-teal-600 mx-auto" />
                  <h4 className="font-semibold text-mist-900">Extracting &amp; Normalizing Data...</h4>
                  <p className="text-xs text-mist-500 max-w-sm mx-auto">
                    Executing Pydantic AI Extraction Engine and mapping stream readings to the 12-Month Calendar Ledger.
                  </p>
                </div>
              ) : (
                /* Method Selection Form */
                <>
                  {errorMessage && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900 text-xs">
                      <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="font-semibold block">Processing Error</span>
                        <p className="font-mono text-[11px] leading-relaxed break-words">{errorMessage}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-wider text-mist-500 block">
                      Choose Extraction Method:
                    </label>

                    {/* Method 1: Official BEE PAT-2 Sector Proforma */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setMode("proforma");
                        setSourceType("proforma");
                      }}
                      className={`cursor-pointer rounded-xl border p-4 text-xs transition-all space-y-2 select-none ${
                        mode === "proforma"
                          ? "border-amber-600 bg-amber-50/50 ring-1 ring-amber-600"
                          : "border-mist-200 bg-white hover:border-mist-300 hover:bg-mist-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-amber-900 text-[13px]">
                            Method 1: BEE PAT-2 Sector Proforma (.xls)
                          </span>
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            Deterministic
                          </span>
                        </div>
                        <input
                          type="radio"
                          name="procMode"
                          checked={mode === "proforma"}
                          onChange={() => {
                            setMode("proforma");
                            setSourceType("proforma");
                          }}
                          className="text-amber-600 focus:ring-amber-500"
                        />
                      </div>
                      <p className="text-xs text-mist-600 leading-relaxed">
                        Deterministic extractor for official Bureau of Energy Efficiency Form 1 &amp; Form-Sb workbooks.
                        Extracts production (clinker, cement), coal, petcoke, grid power, GCVs, and derived calcination emissions.
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="rounded bg-amber-100/80 px-2 py-0.5 text-[10px] font-bold text-amber-900 uppercase">
                          Target Layer: [P] Pro Forma (Declared)
                        </span>
                      </div>
                    </div>

                    {/* Method 2: Plant SCADA / ERP Auto-Mapper */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setMode("auto-map");
                        setSourceType("corroboration");
                      }}
                      className={`cursor-pointer rounded-xl border p-4 text-xs transition-all space-y-2 select-none ${
                        mode === "auto-map"
                          ? "border-teal-600 bg-teal-50/50 ring-1 ring-teal-600"
                          : "border-mist-200 bg-white hover:border-mist-300 hover:bg-mist-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-teal-900 text-[13px]">
                            Method 2: Plant SCADA/ERP Column Auto-Mapper
                          </span>
                          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                            Flexible
                          </span>
                        </div>
                        <input
                          type="radio"
                          name="procMode"
                          checked={mode === "auto-map"}
                          onChange={() => {
                            setMode("auto-map");
                            setSourceType("corroboration");
                          }}
                          className="text-teal-600 focus:ring-teal-500"
                        />
                      </div>
                      <p className="text-xs text-mist-600 leading-relaxed">
                        Flexible AI &amp; heuristic parser for arbitrary plant spreadsheets (monthly MIS, SCADA exports, daily registers).
                        Auto-detects date/month columns and matches headers to cement streams.
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="rounded bg-teal-100/80 px-2 py-0.5 text-[10px] font-bold text-teal-900 uppercase">
                          Target Layer: [{sourceType[0].toUpperCase()}] {sourceType}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Source Layer Selection if Auto-Map */}
                  {mode === "auto-map" && (
                    <div className="rounded-lg border border-mist-200 bg-mist-50/60 p-3.5 space-y-2">
                      <label className="text-xs font-semibold text-mist-800 block">
                        Select Target Source Layer:
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <label
                          className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            sourceType === "corroboration"
                              ? "bg-purple-50 border-purple-300 text-purple-950 font-semibold shadow-xs"
                              : "bg-white border-mist-200 text-mist-700 hover:bg-mist-50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="btnSourceType"
                            value="corroboration"
                            checked={sourceType === "corroboration"}
                            onChange={() => setSourceType("corroboration")}
                            className="text-purple-600 focus:ring-purple-500"
                          />
                          <div>
                            <span className="block font-semibold">[C] Corroboration</span>
                            <span className="block text-[10px] text-mist-500 font-normal">Internal ERP / SCADA Log</span>
                          </div>
                        </label>

                        <label
                          className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            sourceType === "sourcing"
                              ? "bg-blue-50 border-blue-300 text-blue-950 font-semibold shadow-xs"
                              : "bg-white border-mist-200 text-mist-700 hover:bg-mist-50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="btnSourceType"
                            value="sourcing"
                            checked={sourceType === "sourcing"}
                            onChange={() => setSourceType("sourcing")}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          <div>
                            <span className="block font-semibold">[S] Primary Sourcing</span>
                            <span className="block text-[10px] text-mist-500 font-normal">Third-Party Bills / Invoices</span>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-4 border-t border-mist-100">
                    <Button variant="secondary" size="sm" onClick={() => setIsOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleImport()}
                      className="gap-1.5"
                    >
                      <ArrowRight className="h-4 w-4" />
                      Extract &amp; Ingest to Calendar
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
