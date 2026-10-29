"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Play,
  Save,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Search,
  Filter,
  Layers,
  FileSpreadsheet,
} from "lucide-react";
import type { DeskOutcome, DeskStatus, ManualReadingSpec, DeskRule } from "@verifystack/backend/domain/deskreview";
import type { ProformaReading } from "@verifystack/backend/domain/proforma/reader";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { useSoftReload } from "@/lib/soft-reload";

export interface SavedReading {
  key: string;
  value: number;
  documentId: string | null;
  page: number | null;
}

export interface SlotDoc {
  id: string;
  name: string;
  slot: string | null;
}

export interface ProposedReadingItem {
  key: string;
  label: string;
  value: number;
  unit: string;
  documentId: string;
  documentName: string;
  page?: number;
  confidence: number;
  sourceText: string;
  note?: string;
}

const STATUS_CONFIG: Record<DeskStatus, { label: string; tone: BadgeTone; icon: typeof CheckCircle2 }> = {
  pass: { label: "Agrees", tone: "ok", icon: CheckCircle2 },
  fail: { label: "Disagrees", tone: "block", icon: XCircle },
  pending: { label: "Waiting for readings", tone: "draft", icon: Clock },
  not_applicable: { label: "Cannot be decided", tone: "neutral", icon: AlertTriangle },
};

/** Which desk review rule IDs are tied to a pro-forma cell key. */
const CELL_TO_RULES_MAP: Record<string, string[]> = {
  "pf.clinker_t": ["scada_clinker_vs_mpr", "clinker_mass_balance", "coverage_clinker"],
  "pf.opc_t": ["scada_opc_vs_mpr", "sap_opc_vs_scada", "clinker_mass_balance"],
  "pf.ppc_t": ["scada_ppc_vs_mpr", "sap_ppc_vs_scada", "clinker_mass_balance"],
  "pf.psc_t": ["scada_psc_vs_mpr", "sap_psc_vs_scada", "clinker_mass_balance"],
  "pf.cf_opc": ["clinker_mass_balance"],
  "pf.cf_ppc": ["clinker_mass_balance"],
  "pf.cf_psc": ["clinker_mass_balance"],
  "pf.eq_product_t": ["form1_eq_product", "petcoke_cell"],
  "pf.cpp_kwh": ["coverage_cpp", "cpp_report_vs_proforma"],
  "pf.grid_kwh": ["coverage_grid"],
  "pf.coal_t": ["coverage_coal", "coal_log_vs_po"],
  "pf.gcv_coal": ["gcv_rule"],
  "pf.direct_co2": ["form1_direct"],
  "pf.indirect_co2": ["form1_indirect"],
  "pf.petcoke_t": ["petcoke_cell"],
  "pf.renewable_excl": ["renewable_claim"],
};

/** Downstream leverage explanations for sensitive input cells. */
const LEVERAGE_TAGS: Record<string, string> = {
  "pf.gcv_coal": "Dual-Leverage: Feeds Sheet 2 (SEC) & Sheet 3 (GHG)",
  "pf.grid_kwh": "Dual-Leverage: Feeds Sheet 2 (SEC) & Sheet 3 (Indirect)",
  "pf.clinker_t": "Denominator Pivot: Drives Equivalent Product & GEI Intensity",
  "pf.direct_co2": "Form 1 Undertaking: Feeds Form 1 Claim Directly",
  "pf.indirect_co2": "Form 1 Undertaking: Feeds Form 1 Claim Directly",
  "pf.petcoke_t": "Structural Gap Risk: Must have dedicated emission line",
};

interface DeskReviewStudioProps {
  engagementId: string;
  packId: string;
  rules: DeskRule[];
  manualSpecs: ManualReadingSpec[];
  initialResults: DeskOutcome[];
  initialNotes: string[];
  savedReadings: SavedReading[];
  docs: SlotDoc[];
  proforma: ProformaReading | null;
  proformaFileName: string | null;
  lastRunAt: string | null;
  canDecide: boolean;
}

export function DeskReviewStudio({
  engagementId,
  manualSpecs,
  initialResults,
  initialNotes,
  savedReadings,
  docs,
  proforma,
  proformaFileName,
  canDecide,
}: DeskReviewStudioProps) {
  const { softReload, isRefreshing } = useSoftReload();

  // Local state
  const [results] = useState<DeskOutcome[]>(initialResults);
  const [running, setRunning] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [suggestions, setSuggestions] = useState<ProposedReadingItem[]>([]);
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DeskStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetFilter, setSheetFilter] = useState<string>("all");
  const [showReadingsDrawer, setShowReadingsDrawer] = useState(false);

  // Readings form state
  const byKey = useMemo(() => new Map(savedReadings.map((s) => [s.key, s])), [savedReadings]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of manualSpecs) {
      if (s.kind === "daily") {
        init[s.key] = savedReadings
          .filter((r) => r.key.startsWith(`${s.key}@`))
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((r) => `${r.key.slice(s.key.length + 1)} ${r.value}`)
          .join("\n");
      } else {
        const r = byKey.get(s.key);
        init[s.key] = r ? String(r.value) : "";
      }
    }
    return init;
  });

  const [docOf, setDocOf] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of manualSpecs) {
      const r = savedReadings.find((x) => x.key === s.key || x.key.startsWith(`${s.key}@`));
      init[s.key] = r?.documentId ?? "";
    }
    return init;
  });

  const [pageOf, setPageOf] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of manualSpecs) {
      const r = savedReadings.find((x) => x.key === s.key || x.key.startsWith(`${s.key}@`));
      init[s.key] = r?.page ? String(r.page) : "";
    }
    return init;
  });

  const [savingReadings, setSavingReadings] = useState(false);

  // Results indexing
  const resultsById = useMemo(() => new Map(results.map((r) => [r.id, r])), [results]);

  // Pro-forma cell tie-out statuses
  const cellStatusMap = useMemo(() => {
    const map = new Map<string, { status: DeskStatus; passCount: number; failCount: number; pendingCount: number }>();
    if (!proforma) return map;

    for (const draft of proforma.drafts) {
      if (!draft.fieldPath) continue;
      const ruleIds = CELL_TO_RULES_MAP[draft.fieldPath] ?? [];
      const cellRules = ruleIds.map((id) => resultsById.get(id)).filter((r): r is DeskOutcome => r !== undefined);

      if (cellRules.length === 0) {
        map.set(draft.fieldPath, { status: "not_applicable", passCount: 0, failCount: 0, pendingCount: 0 });
        continue;
      }

      const failCount = cellRules.filter((r) => r.status === "fail").length;
      const pendingCount = cellRules.filter((r) => r.status === "pending").length;
      const passCount = cellRules.filter((r) => r.status === "pass").length;

      let status: DeskStatus = "pass";
      if (failCount > 0) status = "fail";
      else if (pendingCount > 0) status = "pending";

      map.set(draft.fieldPath, { status, passCount, failCount, pendingCount });
    }
    return map;
  }, [proforma, resultsById]);

  // Filtered rules
  const filteredRules = useMemo(() => {
    return results.filter((r) => {
      // Cell filter
      if (activeCellKey) {
        const allowedRuleIds = CELL_TO_RULES_MAP[activeCellKey] ?? [];
        if (!allowedRuleIds.includes(r.id)) return false;
      }
      // Status filter
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesLabel = r.label.toLowerCase().includes(q);
        const matchesSection = r.section.toLowerCase().includes(q);
        const matchesDetail = r.detail.toLowerCase().includes(q);
        if (!matchesLabel && !matchesSection && !matchesDetail) return false;
      }
      return true;
    });
  }, [results, activeCellKey, statusFilter, searchQuery]);

  // Group filtered rules by section
  const sections = useMemo(() => [...new Set(filteredRules.map((r) => r.section))], [filteredRules]);

  // Pro-forma sheets
  const proformaSheets = useMemo(() => {
    if (!proforma) return [];
    const sheets = new Set(proforma.drafts.map((d) => d.sheet).filter((s): s is string => s !== null));
    return Array.from(sheets);
  }, [proforma]);

  // Filtered pro-forma drafts
  const filteredDrafts = useMemo(() => {
    if (!proforma) return [];
    if (sheetFilter === "all") return proforma.drafts;
    return proforma.drafts.filter((d) => d.sheet === sheetFilter);
  }, [proforma, sheetFilter]);

  // Actions
  async function runDeskReview() {
    setRunning(true);
    const res = await fetch("/api/desk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setRunning(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not run the desk review");
      return;
    }
    toast.success("Desk review executed successfully");
    softReload();
  }

  async function fetchSuggestions() {
    setProposing(true);
    const res = await fetch("/api/desk-review/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; suggestions?: ProposedReadingItem[]; error?: string };
    setProposing(false);
    if (!res.ok || !json.ok || !json.suggestions) {
      toast.error(json.error ?? "Could not scan documents for suggestions");
      return;
    }
    setSuggestions(json.suggestions);
    if (json.suggestions.length > 0) {
      toast.success(`Found ${json.suggestions.length} candidate readings from evidence documents`);
      setShowReadingsDrawer(true);
    } else {
      toast.info("No automatic readings detected from current evidence documents");
    }
  }

  function applySuggestion(item: ProposedReadingItem) {
    setValues((prev) => ({ ...prev, [item.key]: String(item.value) }));
    setDocOf((prev) => ({ ...prev, [item.key]: item.documentId }));
    if (item.page) {
      setPageOf((prev) => ({ ...prev, [item.key]: String(item.page) }));
    }
    toast.success(`Applied ${item.label}: ${item.value} ${item.unit}`);
  }

  function applyAllSuggestions() {
    if (suggestions.length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const item of suggestions) next[item.key] = String(item.value);
      return next;
    });
    setDocOf((prev) => {
      const next = { ...prev };
      for (const item of suggestions) next[item.key] = item.documentId;
      return next;
    });
    setPageOf((prev) => {
      const next = { ...prev };
      for (const item of suggestions) {
        if (item.page) next[item.key] = String(item.page);
      }
      return next;
    });
    toast.success(`Applied all ${suggestions.length} suggestions`);
  }

  async function saveReadings(andRun = false) {
    setSavingReadings(true);
    const readingsPayload: Array<{
      key: string;
      value: number | null;
      documentId?: string | null;
      page?: number | null;
    }> = [];

    for (const spec of manualSpecs) {
      if (spec.kind === "daily") {
        const text = values[spec.key] ?? "";
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          const match = /^(\d{4}-\d{2}-\d{2})\s*[,:\s]\s*(-?\d+(?:\.\d+)?)$/.exec(line);
          if (match) {
            readingsPayload.push({
              key: `${spec.key}@${match[1]}`,
              value: Number(match[2]),
              documentId: docOf[spec.key] || null,
              page: pageOf[spec.key] ? Number(pageOf[spec.key]) : null,
            });
          }
        }
      } else {
        const valStr = values[spec.key]?.trim() ?? "";
        readingsPayload.push({
          key: spec.key,
          value: valStr === "" ? null : Number(valStr),
          documentId: docOf[spec.key] || null,
          page: pageOf[spec.key] ? Number(pageOf[spec.key]) : null,
        });
      }
    }

    const res = await fetch("/api/desk-review/readings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, readings: readingsPayload }),
    });

    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSavingReadings(false);

    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not save readings");
      return;
    }

    toast.success("Readings saved to audit ledger");
    if (andRun) {
      await runDeskReview();
    } else {
      softReload();
    }
  }

  const count = (s: DeskStatus) => results.filter((r) => r.status === s).length;

  return (
    <div className="space-y-5">
      {/* Studio Header & Stats */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <StatTile label="Agrees" value={count("pass")} tone="ok" />
          <StatTile label="Variance" value={count("fail")} tone={count("fail") ? "block" : "neutral"} />
          <StatTile label="Waiting" value={count("pending")} tone={count("pending") ? "warn" : "neutral"} />
          <StatTile label="Total Checks" value={results.length} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchSuggestions()}
            disabled={proposing || isRefreshing}
            className="border-mist-300"
          >
            <Sparkles className="text-amber-500" />
            {proposing ? "Scanning evidence…" : "Auto-Suggest from Evidence"}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowReadingsDrawer((prev) => !prev)}
            className="border-mist-300"
          >
            <FileText />
            {showReadingsDrawer ? "Hide Readings Drawer" : `Corroboration Readings (${manualSpecs.length})`}
          </Button>

          {canDecide ? (
            <Button
              onClick={() => void runDeskReview()}
              disabled={running || isRefreshing}
              size="sm"
            >
              <Play />
              {running ? "Running checks…" : "Run Desk Review"}
            </Button>
          ) : null}
        </div>
      </div>

      {initialNotes.length > 0 ? (
        <Alert tone="warn" title="Desk Review Execution Notes">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {initialNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* Suggested Readings Drawer (Collapsible) */}
      {showReadingsDrawer ? (
        <Card className="border-mist-300 bg-mist-50/50 shadow-sm">
          <CardHeader
            title="Corroboration Readings & Evidence Inputs"
            description="Figures read from primary evidence (MPR, DPR, NABL certs, SAP, Bills). AI suggests candidate values; auditor verification is mandatory."
            actions={
              suggestions.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={applyAllSuggestions}>
                  <Sparkles className="text-amber-500" />
                  Apply All Suggestions ({suggestions.length})
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {manualSpecs.map((spec) => {
                const suggestion = suggestions.find((s) => s.key === spec.key);
                const currentVal = values[spec.key] ?? "";
                const isDaily = spec.kind === "daily";

                return (
                  <div
                    key={spec.key}
                    className="flex flex-col justify-between rounded-md border border-mist-200 bg-white p-3 shadow-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-mono text-[11px] font-semibold text-mist-600">{spec.key}</span>
                        <Badge tone="neutral" className="text-[10px]">
                          {spec.slot}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium text-mist-900">{spec.label}</p>
                      {spec.hint ? <p className="text-[11px] text-mist-500 italic">{spec.hint}</p> : null}

                      {/* AI Suggestion Banner */}
                      {suggestion ? (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50/70 px-2 py-1 text-xs text-amber-900">
                          <div className="min-w-0">
                            <span className="font-semibold">Detected:</span> {suggestion.value} {suggestion.unit}
                            <span className="block truncate text-[10px] text-amber-800">
                              via {suggestion.documentName} (p. {suggestion.page ?? 1})
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => applySuggestion(suggestion)}
                          >
                            Apply
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 space-y-2">
                      {isDaily ? (
                        <textarea
                          rows={4}
                          value={currentVal}
                          onChange={(e) => setValues({ ...values, [spec.key]: e.target.value })}
                          placeholder="2023-11-01 400.0&#10;2023-11-02 435.4"
                          className="w-full rounded border border-mist-300 p-1.5 font-mono text-xs text-mist-900 focus:outline-hidden focus:ring-1 focus:ring-mist-500"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            step="any"
                            value={currentVal}
                            onChange={(e) => setValues({ ...values, [spec.key]: e.target.value })}
                            placeholder={`Value in ${spec.unit}`}
                            className="h-8 text-xs"
                          />
                          <span className="text-xs text-mist-500 whitespace-nowrap">{spec.unit}</span>
                        </div>
                      )}

                      {/* Document and Page assignment for Provenance */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <select
                          value={docOf[spec.key] ?? ""}
                          onChange={(e) => setDocOf({ ...docOf, [spec.key]: e.target.value })}
                          className="h-7 truncate rounded border border-mist-300 px-1 text-[11px] text-mist-800 bg-white"
                        >
                          <option value="">(Select Doc)</option>
                          {docs
                            .filter((d) => d.slot === spec.slot)
                            .map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                        </select>
                        <Input
                          type="number"
                          placeholder="Page #"
                          value={pageOf[spec.key] ?? ""}
                          onChange={(e) => setPageOf({ ...pageOf, [spec.key]: e.target.value })}
                          className="h-7 text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-mist-200">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void saveReadings(false)}
                disabled={savingReadings || isRefreshing}
              >
                <Save />
                Save Readings Only
              </Button>
              <Button
                size="sm"
                onClick={() => void saveReadings(true)}
                disabled={savingReadings || running || isRefreshing}
              >
                <Play />
                Save Readings & Run Desk Review
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* Main Dual-Panel Layout: Pro-forma Hub (Left) & Tie-Out Rules (Right) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
        {/* LEFT PANE: Pro-forma Sheet Hub (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="border-mist-200 shadow-xs">
            <CardHeader
              title="Pro-forma Sheet Hub"
              description={
                proformaFileName ? `Tied to ${proformaFileName}` : "Assign sector pro-forma workbook in Documents"
              }
              actions={
                activeCellKey ? (
                  <Button size="sm" variant="secondary" onClick={() => setActiveCellKey(null)} className="h-7 text-xs">
                    Clear Cell Filter
                  </Button>
                ) : undefined
              }
            />
            <CardBody className="p-0">
              {/* Sheet selector tabs */}
              {proformaSheets.length > 0 ? (
                <div className="flex flex-wrap gap-1 border-b border-mist-100 bg-mist-50/50 p-2">
                  <button
                    onClick={() => setSheetFilter("all")}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      sheetFilter === "all" ? "bg-white text-mist-900 shadow-xs" : "text-mist-600 hover:text-mist-900"
                    }`}
                  >
                    All Sheets
                  </button>
                  {proformaSheets.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSheetFilter(s)}
                      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                        sheetFilter === s ? "bg-white text-mist-900 shadow-xs" : "text-mist-600 hover:text-mist-900"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}

              {!proforma ? (
                <div className="p-6 text-center text-sm text-mist-600">
                  <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-mist-400" />
                  <p className="font-medium text-mist-800">No Pro-forma workbook attached</p>
                  <p className="mt-1 text-xs text-mist-500">
                    Upload and assign the sector pro-forma in the Documents tab to unlock live spreadsheet cell tie-outs.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-mist-100 max-h-[700px] overflow-y-auto">
                  {filteredDrafts.map((draft) => {
                    const isSelected = activeCellKey === draft.fieldPath;
                    const cellTie = draft.fieldPath ? cellStatusMap.get(draft.fieldPath) : null;
                    const leverage = draft.fieldPath ? LEVERAGE_TAGS[draft.fieldPath] : null;
                    const statusInfo = cellTie ? STATUS_CONFIG[cellTie.status] : null;

                    return (
                      <div
                        key={draft.index}
                        onClick={() => {
                          if (draft.fieldPath) {
                            setActiveCellKey(isSelected ? null : draft.fieldPath);
                          }
                        }}
                        className={`cursor-pointer p-3 transition-colors hover:bg-mist-50/80 ${
                          isSelected ? "bg-mist-100/70 border-l-4 border-mist-900" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-semibold text-mist-700">
                                {draft.cellRef ?? "Cell"}
                              </span>
                              <span className="text-xs font-medium text-mist-900">{draft.label}</span>
                            </div>
                            <span className="text-[11px] text-mist-500">{draft.sheet ?? "Sheet"}</span>
                          </div>

                          {statusInfo ? (
                            <Badge tone={statusInfo.tone} dot className="text-[10px]">
                              {statusInfo.label}
                            </Badge>
                          ) : (
                            <Badge tone="neutral" className="text-[10px]">
                              {draft.status}
                            </Badge>
                          )}
                        </div>

                        <div className="mt-2 flex items-baseline justify-between text-xs">
                          <span className="font-mono font-medium text-mist-900">
                            {draft.value !== null ? draft.value.toLocaleString() : "—"}{" "}
                            <span className="text-mist-500 font-normal">{draft.unit}</span>
                          </span>
                          {draft.formula ? (
                            <span className="truncate max-w-[180px] font-mono text-[10px] text-mist-500" title={draft.formula}>
                              f: {draft.formula}
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-700 font-medium">Yellow Input</span>
                          )}
                        </div>

                        {/* Downstream leverage warning pill */}
                        {leverage ? (
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-indigo-700 font-medium">
                            <Layers className="h-3 w-3 shrink-0" />
                            <span className="truncate">{leverage}</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* RIGHT PANE: Tie-Out Verification Rules & Inspection (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-2 rounded-lg border border-mist-200 bg-white p-3 shadow-xs md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant={statusFilter === "all" ? "primary" : "secondary"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setStatusFilter("all")}
              >
                All ({results.length})
              </Button>
              <Button
                variant={statusFilter === "pass" ? "primary" : "secondary"}
                size="sm"
                className="h-7 text-xs text-emerald-700"
                onClick={() => setStatusFilter("pass")}
              >
                Agrees ({count("pass")})
              </Button>
              <Button
                variant={statusFilter === "fail" ? "primary" : "secondary"}
                size="sm"
                className="h-7 text-xs text-red-700"
                onClick={() => setStatusFilter("fail")}
              >
                Variance ({count("fail")})
              </Button>
              <Button
                variant={statusFilter === "pending" ? "primary" : "secondary"}
                size="sm"
                className="h-7 text-xs text-amber-700"
                onClick={() => setStatusFilter("pending")}
              >
                Waiting ({count("pending")})
              </Button>
            </div>

            <div className="relative min-w-[180px]">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-mist-400" />
              <input
                type="text"
                placeholder="Search rule or metric…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-full rounded border border-mist-300 pl-8 pr-2 text-xs text-mist-900 focus:outline-hidden focus:ring-1 focus:ring-mist-500"
              />
            </div>
          </div>

          {activeCellKey ? (
            <div className="flex items-center justify-between rounded-md bg-mist-100 px-3 py-2 text-xs text-mist-900">
              <span>
                Filtering rules tied to pro-forma key: <strong className="font-mono">{activeCellKey}</strong>
              </span>
              <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => setActiveCellKey(null)}>
                Clear Filter
              </Button>
            </div>
          ) : null}

          {/* Verification Rule Cards Grouped by Section */}
          {filteredRules.length === 0 ? (
            <Card>
              <CardBody className="py-8 text-center text-sm text-mist-600">
                <Filter className="mx-auto mb-2 h-6 w-6 text-mist-400" />
                No checks match the current filter.
              </CardBody>
            </Card>
          ) : (
            sections.map((section) => {
              const inSection = filteredRules.filter((r) => r.section === section);
              return (
                <Card key={section} className="border-mist-200 shadow-xs">
                  <CardHeader title={section} description={`${inSection.length} tie-out verification checks`} />
                  <CardBody className="p-0">
                    <ul className="divide-y divide-mist-100">
                      {inSection.map((r) => {
                        const s = STATUS_CONFIG[r.status];
                        const Icon = s.icon;
                        const isFail = r.status === "fail";
                        const isPending = r.status === "pending";

                        return (
                          <li key={r.id} className="p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5">
                                <Icon
                                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                                    r.status === "pass"
                                      ? "text-emerald-600"
                                      : isFail
                                      ? "text-red-600"
                                      : isPending
                                      ? "text-amber-500"
                                      : "text-mist-400"
                                  }`}
                                />
                                <div>
                                  <h4 className="text-sm font-semibold text-mist-900">{r.label}</h4>
                                  <span className="font-mono text-[10px] text-mist-500">ID: {r.id}</span>
                                </div>
                              </div>

                              <Badge tone={s.tone} dot>
                                {s.label}
                              </Badge>
                            </div>

                            {/* Mathematical & Variance Comparison Panel */}
                            {r.actual !== undefined && r.expected !== undefined ? (
                              <div className="grid grid-cols-3 gap-2 rounded bg-mist-50 p-2.5 font-mono text-xs">
                                <div>
                                  <span className="block text-[10px] text-mist-500">Evidence Actual</span>
                                  <span className="font-semibold text-mist-900">{r.actual.toLocaleString()}</span>
                                </div>
                                <div>
                                  <span className="block text-[10px] text-mist-500">Pro-forma Target</span>
                                  <span className="font-semibold text-mist-900">{r.expected.toLocaleString()}</span>
                                </div>
                                <div>
                                  <span className="block text-[10px] text-mist-500">Variance (Delta)</span>
                                  <span
                                    className={`font-semibold ${
                                      r.diff && Math.abs(r.diff) > 0 ? "text-red-700" : "text-emerald-700"
                                    }`}
                                  >
                                    {r.diff !== undefined ? (r.diff > 0 ? `+${r.diff}` : r.diff) : "0"}
                                  </span>
                                </div>
                              </div>
                            ) : null}

                            {/* Rule detail description */}
                            <p className="text-xs text-mist-700 leading-relaxed">
                              {isPending ? (
                                <span className="text-amber-800">
                                  <strong>Waiting for primary readings:</strong> {r.missing?.join(", ")}
                                </span>
                              ) : (
                                r.detail
                              )}
                            </p>

                            {r.thresholdSource ? (
                              <p className="text-[11px] text-mist-500 italic">
                                Regulatory / Methodology Band: {r.thresholdSource}
                              </p>
                            ) : null}

                            {/* Contextual actions */}
                            {isFail ? (
                              <div className="flex items-center justify-between border-t border-red-100 pt-2 text-xs">
                                <span className="text-red-700 font-medium">Discrepancy exceeds tolerance</span>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 text-xs border-red-200 text-red-800 hover:bg-red-50"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `CAR Finding: ${r.label}\nDetail: ${r.detail}\nThreshold: ${r.thresholdSource ?? "Standard"}`
                                    );
                                    toast.success("Copied finding text to clipboard for Findings log");
                                  }}
                                >
                                  Copy CAR Draft
                                </Button>
                              </div>
                            ) : isPending ? (
                              <div className="flex items-center justify-between border-t border-amber-100 pt-2 text-xs">
                                <span className="text-amber-800">Needs readings in Corroboration Drawer</span>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setShowReadingsDrawer(true)}
                                >
                                  Open Drawer to Fill
                                </Button>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </CardBody>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// Preserve backwards-compatible exports for existing callers
export function RunDeskReviewButton({ engagementId }: { engagementId: string }) {
  const { softReload, isRefreshing } = useSoftReload();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/desk-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not run the desk review");
      return;
    }
    toast.success("Desk review run");
    softReload();
  }

  return (
    <Button onClick={() => void run()} disabled={busy || isRefreshing}>
      <Play />
      Run desk review
    </Button>
  );
}

export function ReadingsForm({
  engagementId,
  specs,
  saved,
  docs,
}: {
  engagementId: string;
  specs: ManualReadingSpec[];
  saved: SavedReading[];
  docs: SlotDoc[];
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const byKey = new Map(saved.map((s) => [s.key, s]));
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) {
      if (s.kind === "daily") {
        init[s.key] = saved
          .filter((r) => r.key.startsWith(`${s.key}@`))
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((r) => `${r.key.slice(s.key.length + 1)} ${r.value}`)
          .join("\n");
      } else {
        const r = byKey.get(s.key);
        init[s.key] = r ? String(r.value) : "";
      }
    }
    return init;
  });
  const [docOf, setDocOf] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) {
      const r = saved.find((x) => x.key === s.key || x.key.startsWith(`${s.key}@`));
      init[s.key] = r?.documentId ?? "";
    }
    return init;
  });
  const [pageOf, setPageOf] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of specs) {
      const r = saved.find((x) => x.key === s.key || x.key.startsWith(`${s.key}@`));
      init[s.key] = r?.page ? String(r.page) : "";
    }
    return init;
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const readings: { key: string; value: number | null; documentId?: string | null; page?: number | null }[] = [];
    for (const s of specs) {
      if (s.kind === "daily") {
        const raw = values[s.key] ?? "";
        for (const line of raw.split("\n")) {
          const m = /^(\d{4}-\d{2}-\d{2})\s*[,:\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line);
          if (!m) continue;
          readings.push({
            key: `${s.key}@${m[1]}`,
            value: Number(m[2]),
            documentId: docOf[s.key] || null,
            page: pageOf[s.key] ? Number(pageOf[s.key]) : null,
          });
        }
      } else {
        const v = values[s.key];
        const num = v === "" || v === undefined ? null : Number(v);
        readings.push({
          key: s.key,
          value: num,
          documentId: docOf[s.key] || null,
          page: pageOf[s.key] ? Number(pageOf[s.key]) : null,
        });
      }
    }
    const res = await fetch("/api/desk-review/readings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, readings }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; saved?: number; removed?: number };
    setBusy(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not save readings");
      return;
    }
    toast.success(`Saved ${json.saved ?? 0} reading(s)`);
    softReload();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {specs.map((s) => (
          <div key={s.key} className="space-y-1">
            <label className="text-xs font-medium text-mist-800" htmlFor={s.key}>
              {s.label} ({s.unit})
            </label>
            {s.hint ? <p className="text-[11px] text-mist-500">{s.hint}</p> : null}
            {s.kind === "daily" ? (
              <textarea
                id={s.key}
                rows={4}
                value={values[s.key] ?? ""}
                onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                placeholder="2023-11-01 400.0"
                className="w-full rounded border border-mist-300 p-2 font-mono text-xs text-mist-900 focus:outline-hidden focus:ring-1 focus:ring-mist-500"
              />
            ) : (
              <Input
                id={s.key}
                type="number"
                step="any"
                value={values[s.key] ?? ""}
                onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
              />
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <select
                aria-label={`Document for ${s.label}`}
                value={docOf[s.key] ?? ""}
                onChange={(e) => setDocOf({ ...docOf, [s.key]: e.target.value })}
                className="rounded border border-mist-300 px-2 py-1 text-xs text-mist-900"
              >
                <option value="">Document (none)</option>
                {docs
                  .filter((d) => d.slot === s.slot)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
              <Input
                type="number"
                min={1}
                max={10000}
                placeholder="Page"
                value={pageOf[s.key] ?? ""}
                onChange={(e) => setPageOf({ ...pageOf, [s.key]: e.target.value })}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || isRefreshing}>
          <Save />
          Save readings
        </Button>
      </div>
    </form>
  );
}
