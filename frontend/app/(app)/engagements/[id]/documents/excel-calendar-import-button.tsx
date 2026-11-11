"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoftReload } from "@/lib/soft-reload";

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

  async function handleImport() {
    setIsProcessing(true);
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
        toast.error(json.error ?? "Excel extraction failed");
        return;
      }

      toast.success(
        `Extracted and saved ${json.savedCount ?? json.extractedCount} readings directly to Calendar!`
      );
      setIsOpen(false);
      softReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsOpen(true)}
        className="text-xs gap-1.5 text-teal-800 hover:text-teal-950 border-teal-200 bg-teal-50/50 hover:bg-teal-100"
      >
        <FileSpreadsheet className="size-3.5 text-teal-600" />
        Process to Calendar
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-mist-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-mist-100 pb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-teal-600" />
                <div>
                  <h3 className="text-base font-semibold text-mist-900">
                    Process Spreadsheet to Stream Calendar
                  </h3>
                  <p className="text-xs text-mist-500 font-mono truncate max-w-sm">
                    {documentName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-mist-400 hover:bg-mist-100 hover:text-mist-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="text-xs font-semibold text-mist-700 block">
                Select Processing Method:
              </label>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {/* Method 1: PAT-2 Proforma / Standard Template */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setMode("proforma");
                    setSourceType("proforma");
                  }}
                  className={`cursor-pointer rounded-lg border p-3.5 text-xs transition-all ${
                    mode === "proforma"
                      ? "border-teal-600 bg-teal-50/60 text-teal-950 ring-1 ring-teal-600"
                      : "border-mist-200 bg-mist-50/70 hover:bg-mist-100 text-mist-700"
                  }`}
                >
                  <div className="font-bold text-amber-800 text-sm">
                    Method 1: BEE PAT-2 Sector Proforma
                  </div>
                  <p className="text-[11px] text-mist-600 mt-1 leading-relaxed">
                    Deterministic parser for official Form-Sb &amp; Form 1 (.xls/.xlsx). Extracts clinker,
                    equivalent cement, coal, petcoke, power, GCVs, and calcination CO2.
                  </p>
                  <span className="inline-block mt-2 font-semibold text-[10px] text-amber-700 uppercase tracking-wide">
                    → Locks to [P] Pro Forma Layer
                  </span>
                </div>

                {/* Method 2: Plant SCADA / ERP Auto-Mapper */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setMode("auto-map");
                    setSourceType("corroboration");
                  }}
                  className={`cursor-pointer rounded-lg border p-3.5 text-xs transition-all ${
                    mode === "auto-map"
                      ? "border-teal-600 bg-teal-50/60 text-teal-950 ring-1 ring-teal-600"
                      : "border-mist-200 bg-mist-50/70 hover:bg-mist-100 text-mist-700"
                  }`}
                >
                  <div className="font-bold text-teal-800 text-sm">
                    Method 2: Plant SCADA/ERP Auto-Mapper
                  </div>
                  <p className="text-[11px] text-mist-600 mt-1 leading-relaxed">
                    Flexible mapper for arbitrary plant spreadsheets. Auto-detects date columns and
                    cement stream headers across rows and sheets.
                  </p>
                  <span className="inline-block mt-2 font-semibold text-[10px] text-teal-700 uppercase tracking-wide">
                    → Locks to [C] Corroboration / [S] Sourcing
                  </span>
                </div>
              </div>

              {/* Source Layer Selection if Auto-Map */}
              {mode === "auto-map" && (
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-mist-700">Source Layer:</label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label
                      className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${
                        sourceType === "corroboration"
                          ? "bg-purple-50 border-purple-300 text-purple-900 font-semibold"
                          : "bg-white border-mist-200 text-mist-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="btnSourceType"
                        value="corroboration"
                        checked={sourceType === "corroboration"}
                        onChange={() => setSourceType("corroboration")}
                        className="sr-only"
                      />
                      <span>[C] Corroboration (ERP/SCADA)</span>
                    </label>

                    <label
                      className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${
                        sourceType === "sourcing"
                          ? "bg-blue-50 border-blue-300 text-blue-900 font-semibold"
                          : "bg-white border-mist-200 text-mist-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="btnSourceType"
                        value="sourcing"
                        checked={sourceType === "sourcing"}
                        onChange={() => setSourceType("sourcing")}
                        className="sr-only"
                      />
                      <span>[S] Primary Sourcing (Invoices/Bills)</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-mist-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isProcessing}
                  onClick={() => void handleImport()}
                  className="gap-1.5"
                >
                  <ArrowRight className="h-4 w-4" />
                  {isProcessing ? "Processing..." : "Extract & Ingest to Calendar"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
