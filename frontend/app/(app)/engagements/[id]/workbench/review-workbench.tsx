"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useEffect, useMemo, useState } from "react";
import { Check, PenLine, Scissors, Sparkles, X } from "lucide-react";
import {
  CEMENT_STREAMS,
  getFiscalMonths,
  matchDateToMonthKey,
  type SourceType,
} from "@verifystack/backend/domain/calendar/index";
import { DocumentFacsimile } from "@/components/workbench/document-facsimile";
import type { DemoFact } from "@verifystack/backend/fixtures/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { EvidencePageViewer } from "@/components/workbench/evidence-page-viewer";
import { RegionDrawLayer } from "@/components/workbench/region-draw-layer";
import { useBoxReader } from "@/components/workbench/use-box-reader";
import { describeRegion, type Region } from "@verifystack/backend/domain/deskreview/snip";
import type { InputState } from "@verifystack/backend/domain/calc/run";
import { toast } from "sonner";
import { CevPanel, type CevRow } from "@/components/review/cev-panel";

export interface ReviewField {
  id: string;
  field_path: string;
  value_json: unknown;
  unit: string | null;
  confidence: number;
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  source_text: string;
  state: string;
  triage_action: string;
  document_id: string;
  fileUrl: string | null;
  mimeType: string | null;
  /** Drawn on the page and typed by a person, not read by the model. */
  snip?: boolean;
  /** In the deterministic low-risk sample that must be read before a bulk accept. */
  inSample?: boolean;
  /** Why this value always needs a person, when it does. */
  riskReasons?: string[];
}

export interface SnipDocument {
  id: string;
  name: string;
  mimeType: string;
}

export interface SnipTarget {
  path: string;
  label: string;
  defaultUnit?: string;
  /** Where this input stands in the ledger. A filled input is not added to: a second value stops a run. */
  state?: InputState;
}

/** The inputs a run still needs, in the order they should be offered. */
const isMissing = (t: SnipTarget) => t.state === "required" || t.state === "group";
// const isTaken = (t: SnipTarget) => t.state === "filled" || t.state === "conflict";

export function ReviewWorkbench({
  engagementId,
  fields,
  facsimileDocId,
  documents = [],
  targets = [],
  cevGroups = {},
  cevDocNames = {},
  cevLabels = {},
}: {
  engagementId: string;
  fields: ReviewField[];
  facsimileDocId?: string;
  /** The PDFs and images a region can be drawn on. */
  documents?: SnipDocument[];
  /** The fields a snipped value can be added to. */
  targets?: SnipTarget[];
  /** Canonical evidence values grouped by canonical_key. */
  cevGroups?: Record<string, CevRow[]>;
  /** document_id to original_filename for CEV provenance display. */
  cevDocNames?: Record<string, string>;
  /** canonical_key to human label from the registry. */
  cevLabels?: Record<string, string>;
}) {
  const { softReload, isRefreshing } = useSoftReload();
  const [focused, setFocused] = useState<ReviewField | null>(fields[0] ?? null);
  const [correction, setCorrection] = useState("");
  // The value just added is brought into view as soon as the reloaded list holds it.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const focus = (pendingFocus ? fields.find((f) => f.id === pendingFocus) : undefined) ?? focused;
  const setFocus = (field: ReviewField | null) => {
    setPendingFocus(null);
    setFocused(field);
  };

  // Snip: draw a box on a page for a value the model missed, and add it for review.
  const canSnip = documents.length > 0 && targets.length > 0 && !facsimileDocId;
  const [snipping, setSnipping] = useState(fields.length === 0 && canSnip);
  const [snipDocId, setSnipDocId] = useState(fields[0]?.document_id ?? documents[0]?.id ?? "");
  const [snipPage, setSnipPage] = useState(fields[0]?.page ?? 1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [live, setLive] = useState<Region | null>(null);
  const [tooSmall, setTooSmall] = useState(false);
  const [snipPath, setSnipPath] = useState("");
  const fiscalMonths = useMemo(() => getFiscalMonths("FY2023-24"), []);
  const [snipMonth, setSnipMonth] = useState<string>("2023-04");
  const [snipSourceType, setSnipSourceType] = useState<SourceType>("sourcing");
  const [snipStreamKey, setSnipStreamKey] = useState<string>("coal_quantity");
  const [snipValue, setSnipValue] = useState("");
  const [snipUnit, setSnipUnit] = useState("");
  const [snipText, setSnipText] = useState("");
  const [snipSaving, setSnipSaving] = useState(false);
  const snipDoc = documents.find((d) => d.id === snipDocId);
  function chooseDocumentForSnip(docId: string) {
    setSnipDocId(docId);
    setSnipPage(1);
    setNumPages(null);
    setRegion(null);
    setTooSmall(false);
    setSnipping(true);

    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;
    const name = doc.name.toLowerCase();
    const m = matchDateToMonthKey(name);
    if (m) setSnipMonth(m);

    if (name.includes("proforma") || name.includes("form-1") || name.includes("form1")) {
      setSnipSourceType("proforma");
      setSnipStreamKey("equivalent_product");
      setSnipUnit("t");
    } else if (name.includes("erp") || name.includes("scada") || name.includes("daily") || name.includes("register")) {
      setSnipSourceType("corroboration");
    } else {
      setSnipSourceType("sourcing");
    }

    if (name.includes("clinker") || name.includes("production")) {
      setSnipStreamKey("clinker_production");
      setSnipUnit("t");
    } else if (name.includes("electricity") || name.includes("power")) {
      setSnipStreamKey("grid_electricity");
      setSnipUnit("kWh");
    } else if (name.includes("lab") || name.includes("gcv")) {
      setSnipStreamKey("coal_gcv");
      setSnipUnit("kcal/kg");
    } else if (name.includes("coal") || name.includes("grn") || name.includes("delivery")) {
      setSnipStreamKey("coal_quantity");
      setSnipUnit("t");
    } else if (name.includes("petcoke")) {
      setSnipStreamKey("petcoke_quantity");
      setSnipUnit("t");
    } else if (name.includes("diesel") || name.includes("hsd")) {
      setSnipStreamKey("hsd_quantity");
      setSnipUnit("kL");
    }
  }

  const reader = useBoxReader({
    src: `/api/documents/${snipDocId}/file`,
    mimeType: snipDoc?.mimeType,
    page: snipPage,
    onText: setSnipText,
    onValue: setSnipValue,
  });

  function startSnip() {
    const targetDocId = focus?.document_id ?? documents[0]?.id ?? "";
    chooseDocumentForSnip(targetDocId);
    setSnipPage(focus?.page ?? 1);
  }

  function stopSnip() {
    reader.clear();
    setSnipping(false);
    setRegion(null);
    setLive(null);
    setTooSmall(false);
    setSnipPath("");
    setSnipValue("");
    setSnipUnit("");
    setSnipText("");
  }

  async function saveSnip() {
    if (!region || !snipDoc) return;
    const streamDef = CEMENT_STREAMS.find((s) => s.key === snipStreamKey);
    const fieldPath = snipPath || streamDef?.calcBindingPath || "quantity";
    setSnipSaving(true);
    const res = await fetch("/api/workbench/snip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        documentId: snipDoc.id,
        page: snipPage,
        bbox: region,
        fieldPath,
        streamKey: snipStreamKey,
        monthKey: snipMonth,
        sourceType: snipSourceType,
        value: snipValue,
        unit: snipUnit.trim() || streamDef?.standardUnit || null,
        sourceText: snipText.trim(),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; id?: string };
    setSnipSaving(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not add the value");
      return;
    }
    toast.success(`Saved to Calendar (${snipMonth} [${snipSourceType[0].toUpperCase()}])`);
    stopSnip();
    softReload();
  }

  const snipShown = live ?? region;
  const snipValueBad = snipValue.trim() === "" || !Number.isFinite(Number(snipValue.replace(/,/g, "")));
  const canSaveSnip = Boolean(region && snipText.trim() && !snipValueBad && !snipSaving);

  async function decide(state: "accepted" | "rejected" | "corrected") {
    if (!focus) return;
    const res = await fetch("/api/facts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        extractedFieldId: focus.id,
        state,
        correction: state === "corrected" ? correction : undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Review failed");
      return;
    }
    toast.success(
      state === "accepted" ? "Accepted" : state === "corrected" ? "Correction saved" : "Rejected"
    );
    softReload();
  }

  const focusIndex = focus ? fields.findIndex((f) => f.id === focus.id) : -1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      const step = e.key === "j" ? 1 : -1;
      const next = fields[Math.min(fields.length - 1, Math.max(0, focusIndex + step))];
      if (next) {
        e.preventDefault();
        setFocus(next);
        setCorrection("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fields, focusIndex]);

  return (
    <>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="rounded-lg border border-mist-200 bg-mist-100/70 p-3 lg:sticky lg:top-20">
        {canSnip ? (
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
            {snipping ? (
              <>
                <p className="text-[13px] font-medium text-mist-900">Draw a box around a value</p>
                <Button size="sm" variant="secondary" onClick={stopSnip}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <label className="flex min-w-0 items-center gap-2 text-xs text-mist-700">
                  Open any uploaded document
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setSnipDocId(e.target.value);
                      setSnipPage(1);
                      setNumPages(null);
                      setRegion(null);
                      setTooSmall(false);
                      setSnipping(true);
                    }}
                    className="h-8 max-w-[13rem] truncate rounded border border-mist-300 bg-white px-1.5 text-[13px]"
                  >
                    <option value="">Choose a document…</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button size="sm" variant="secondary" onClick={startSnip}>
                  <Scissors />
                  Snip a value
                </Button>
                {targets.some(isMissing) ? (
                  <span className="basis-full text-xs text-amber-800">
                    {targets.filter(isMissing).length} input{targets.filter(isMissing).length === 1 ? "" : "s"} the calculation needs not found yet.
                  </span>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {snipping && snipDoc ? (
          <>
            <div className="mb-2.5 flex flex-wrap items-center gap-3 px-1 text-[13px] text-mist-800">
              <label className="flex min-w-0 items-center gap-2">
                Document
                <select
                  value={snipDocId}
                  onChange={(e) => {
                    setSnipDocId(e.target.value);
                    setSnipPage(1);
                    setNumPages(null);
                    setRegion(null);
                  }}
                  className="h-8 max-w-[14rem] truncate rounded border border-mist-300 bg-white px-1.5 text-[13px]"
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                Page
                <Input
                  type="number"
                  min={1}
                  max={numPages ?? undefined}
                  value={snipPage}
                  onChange={(e) => {
                    const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                    setSnipPage(numPages ? Math.min(n, numPages) : n);
                    setRegion(null);
                  }}
                  className="h-8 w-20 text-[13px]"
                />
              </label>
              {numPages ? <span className="text-mist-600">of {numPages}</span> : null}
            </div>
            <EvidencePageViewer
              key={snipDocId}
              src={`/api/documents/${snipDocId}/file`}
              mimeType={snipDoc.mimeType}
              page={snipPage}
              bbox={snipShown}
              overlay={
                <RegionDrawLayer
                  onLive={setLive}
                  onDraw={(drawn) => {
                    setTooSmall(drawn === null);
                    if (drawn) {
                      setRegion(drawn);
                      void reader.read(drawn);
                    }
                  }}
                />
              }
              onPages={setNumPages}
            />
            <div className="mt-3 space-y-2.5 px-1 text-[13px] text-mist-800">
              {snipShown ? <p className="text-mist-700">Box: {describeRegion(snipShown)}.</p> : <p className="text-mist-600">Drag on the page to draw the box.</p>}
              {tooSmall ? <p className="text-amber-800">That box is too small. Drag a larger one around the value.</p> : null}
              {region ? (
              <div className="grid gap-3 sm:grid-cols-2 bg-mist-50/70 p-3 rounded-lg border border-mist-200">
                {/* 1. Stream Selection */}
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-mist-900">1. Data Type / Stream</span>
                    <span className="inline-flex items-center gap-1 text-[11px] text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded font-medium border border-teal-200">
                      <Sparkles className="h-3 w-3" /> AI Recommended
                    </span>
                  </div>
                  <select
                    value={snipStreamKey}
                    onChange={(e) => {
                      const k = e.target.value;
                      setSnipStreamKey(k);
                      const s = CEMENT_STREAMS.find((st) => st.key === k);
                      if (s) {
                        setSnipUnit(s.standardUnit);
                        setSnipPath(s.calcBindingPath);
                      }
                    }}
                    className="h-9 w-full rounded border border-mist-300 bg-white px-2 text-[13px] font-medium"
                  >
                    {["production", "solid_fuel", "liquid_fuel", "electricity", "process"].map((cat) => (
                      <optgroup key={cat} label={cat.toUpperCase().replace("_", " ")}>
                        {CEMENT_STREAMS.filter((s) => s.category === cat).map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label} ({s.standardUnit}) {s.proformaRef ? `— ${s.proformaRef}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* 2. Duration / Month */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-mist-900">2. Duration / Month</span>
                    <span className="text-[10px] text-mist-500 font-mono">12-Mo FY</span>
                  </div>
                  <select
                    value={snipMonth}
                    onChange={(e) => setSnipMonth(e.target.value)}
                    className="h-9 w-full rounded border border-mist-300 bg-white px-2 text-[13px]"
                  >
                    {fiscalMonths.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} ({m.key})
                      </option>
                    ))}
                    <option value="annual">Full Compliance Year (Annual)</option>
                  </select>
                </div>

                {/* 3. Compulsory Source Layer */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-mist-900">3. Source Layer (Mandatory)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { type: "sourcing" as const, label: "[S] Sourcing", desc: "Bill / Slip", color: "text-blue-900 bg-blue-100 border-blue-400" },
                      { type: "corroboration" as const, label: "[C] Corrob.", desc: "ERP / SCADA", color: "text-purple-900 bg-purple-100 border-purple-400" },
                      { type: "proforma" as const, label: "[P] Pro Forma", desc: "Declared Ret.", color: "text-amber-900 bg-amber-100 border-amber-400" },
                    ].map((btn) => (
                      <button
                        key={btn.type}
                        type="button"
                        onClick={() => setSnipSourceType(btn.type)}
                        className={`rounded border px-1.5 py-1 text-center transition-colors ${
                          snipSourceType === btn.type
                            ? `${btn.color} font-bold shadow-xs ring-1 ring-mist-400`
                            : "bg-white text-mist-600 border-mist-200 hover:bg-mist-50"
                        }`}
                      >
                        <div className="text-[11px] leading-tight font-semibold">{btn.label}</div>
                        <div className="text-[9px] text-mist-500 leading-tight">{btn.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  Figure
                  <Input inputMode="decimal" value={snipValue} onChange={(e) => setSnipValue(e.target.value)} className="h-9 text-[13px]" />
                </label>
                <label className="flex flex-col gap-1">
                  Unit
                  <Input value={snipUnit} onChange={(e) => setSnipUnit(e.target.value)} className="h-9 text-[13px]" />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  What is printed in the box
                  <Input value={snipText} maxLength={300} onChange={(e) => setSnipText(e.target.value)} placeholder="For example: Quantity dispatched 18,247 MT" className="h-9 text-[13px]" />
                </label>
                {reader.reading || reader.note ? (
                  <div className="sm:col-span-2" aria-live="polite">
                    <p className="text-mist-700">{reader.reading ? "Reading the box…" : reader.note}</p>
                    {reader.candidates.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {reader.candidates.map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => setSnipValue(String(c.value))}
                            className="rounded border border-mist-300 bg-white px-2 py-0.5 font-mono text-xs text-mist-900 hover:border-teal-400 hover:bg-teal-50"
                          >
                            {c.text}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              ) : null}
              {region ? (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button disabled={!canSaveSnip} onClick={() => void saveSnip()}>
                  <Scissors />
                  {snipSaving ? "Adding…" : "Save to Stream Calendar & Facts"}
                </Button>
                <p className="text-mist-600">Select the Stream, Duration, and Source Layer. It locks directly into the 12-Month Calendar with page & box provenance.</p>
              </div>
              ) : null}
            </div>
          </>
        ) : facsimileDocId ? (
          <DocumentFacsimile
            documentId={facsimileDocId}
            highlight={
              focus
                ? ({
                    id: focus.id,
                    documentId: facsimileDocId,
                    field: focus.field_path,
                    display: String(focus.value_json),
                    value:
                      typeof focus.value_json === "number"
                        ? focus.value_json
                        : String(focus.value_json),
                    unit: focus.unit ?? undefined,
                    confidence: focus.confidence,
                    state: "suggested",
                    page: focus.page,
                    bbox: focus.bbox,
                    sourceText: focus.source_text,
                  } satisfies DemoFact)
                : null
            }
          />
        ) : (
          <EvidencePageViewer
            src={focus?.fileUrl ?? null}
            mimeType={focus?.mimeType}
            page={focus?.page ?? 1}
            bbox={focus?.bbox ?? null}
          />
        )}
        {!snipping ? (
          <p className="mt-2.5 px-1 text-xs leading-relaxed text-mist-600">
            The highlighted region is where the value was read. High-materiality fields always need a
            person&apos;s decision.
          </p>
        ) : null}
      </div>

      <div className="space-y-4">
        {focus ? (
          <div className="rounded-lg border border-mist-200 bg-white shadow-xs">
            <div className="flex items-start justify-between gap-3 border-b border-mist-100 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-mist-500">{focus.field_path}</p>
                <p className="mt-1 text-xl font-semibold tracking-tight text-mist-950 tabular">
                  {String(focus.value_json)}
                  {focus.unit ? (
                    <span className="ml-1.5 text-sm font-normal text-mist-500">{focus.unit}</span>
                  ) : null}
                </p>
              </div>
              <FieldStateBadges field={focus} />
            </div>
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-mist-600">Source text · page {focus.page}</p>
              <blockquote className="mt-1.5 rounded-md border-l-2 border-teal-500 bg-mist-50 px-3 py-2 font-mono text-xs leading-relaxed text-mist-800">
                {focus.source_text}
              </blockquote>
              <label htmlFor="correction" className="mt-4 block text-[13px] font-medium text-mist-800">
                Correction <span className="font-normal text-mist-500">(only for Correct)</span>
              </label>
              <Input
                id="correction"
                className="mt-1.5"
                placeholder="Corrected value"
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={isRefreshing} onClick={() => void decide("accepted")}>
                  <Check />
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  disabled={isRefreshing}
                  onClick={() => void decide("corrected")}
                >
                  <PenLine />
                  Correct
                </Button>
                <Button
                  variant="secondary"
                  disabled={isRefreshing}
                  className="text-red-700 hover:border-red-300 hover:bg-red-50"
                  onClick={() => void decide("rejected")}
                >
                  <X />
                  Reject
                </Button>
              </div>
              <p className="mt-3 text-xs text-mist-500">
                Accepted values move to the facts ledger.
              </p>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-mist-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-mist-100 bg-mist-50 px-4 py-2.5">
            <p className="text-xs font-medium text-mist-700 tabular">
              {fields.length} {fields.length === 1 ? "value" : "values"} awaiting review
            </p>
            <p className="hidden text-xs text-mist-500 sm:block">
              <kbd className="rounded-sm border border-mist-300 bg-white px-1 font-mono">J</kbd>{" "}
              <kbd className="rounded-sm border border-mist-300 bg-white px-1 font-mono">K</kbd> to move
            </p>
          </div>
          <ul className="max-h-[32rem] divide-y divide-mist-100 overflow-y-auto">
            {fields.map((f) => {
              const active = focus?.id === f.id;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setFocus(f);
                      setCorrection("");
                    }}
                    className={cn(
                      "flex w-full items-start justify-between gap-3 border-l-2 px-4 py-3 text-left transition-colors",
                      active
                        ? "border-teal-600 bg-teal-50/50"
                        : "border-transparent hover:bg-mist-50"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs text-mist-500">{f.field_path}</span>
                      <span className="mt-0.5 block text-sm text-mist-900 tabular">
                        {String(f.value_json)} {f.unit}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <FieldStateBadges field={f} compact />
                      {f.snip ? <span className="text-xs text-mist-500">By hand</span> : <ConfidenceMeter value={f.confidence} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
    {Object.keys(cevGroups).length > 0 ? (
      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-mist-900">Canonical Evidence</h2>
        <p className="mb-3 text-[13px] text-mist-600">
          Multi-source values for each registry quantity. Accept, correct or reject proposals;
          roll up settled monthly values into an annual total; then promote to the facts ledger.
        </p>
        <CevPanel
          engagementId={engagementId}
          groups={cevGroups}
          docNames={cevDocNames}
          labels={cevLabels}
        />
      </section>
    ) : null}
    </>
  );
}

function FieldStateBadges({ field, compact = false }: { field: ReviewField; compact?: boolean }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {field.snip ? (
        <Badge tone="draft">Entered from the page</Badge>
      ) : field.state === "suggested" ? (
        <Badge tone="ai">AI-proposed</Badge>
      ) : (
        <Badge tone="draft">{field.state === "corrected" ? "Corrected" : field.state}</Badge>
      )}
      {field.inSample ? <Badge tone="ink">Review sample</Badge> : null}
      {field.triage_action === "human_review" && !compact ? (
        <span title={field.riskReasons?.join(" ") || undefined}>
          <Badge tone="draft">Needs a person</Badge>
        </span>
      ) : null}
    </span>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <span className="flex items-center gap-1.5" title={`Model confidence ${pct}%`}>
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-mist-100">
        <span
          className={cn("block h-full", pct >= 85 ? "bg-teal-600" : pct >= 60 ? "bg-amber-500" : "bg-red-500")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-xs text-mist-500 tabular">{pct}%</span>
    </span>
  );
}
