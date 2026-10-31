"use client";

import { useSoftReload } from "@/lib/soft-reload";

import { useEffect, useState } from "react";
import { Check, PenLine, Scissors, X } from "lucide-react";
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
const isTaken = (t: SnipTarget) => t.state === "filled" || t.state === "conflict";

export function ReviewWorkbench({
  engagementId,
  fields,
  facsimileDocId,
  documents = [],
  targets = [],
}: {
  engagementId: string;
  fields: ReviewField[];
  facsimileDocId?: string;
  /** The PDFs and images a region can be drawn on. */
  documents?: SnipDocument[];
  /** The fields a snipped value can be added to. */
  targets?: SnipTarget[];
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
  const [snipValue, setSnipValue] = useState("");
  const [snipUnit, setSnipUnit] = useState("");
  const [snipText, setSnipText] = useState("");
  const [snipSaving, setSnipSaving] = useState(false);
  const snipDoc = documents.find((d) => d.id === snipDocId);
  // Reads the text printed inside a drawn box, so the figure is confirmed and not retyped. Scans are left to type.
  const reader = useBoxReader({
    src: `/api/documents/${snipDocId}/file`,
    mimeType: snipDoc?.mimeType,
    page: snipPage,
    onText: setSnipText,
    onValue: setSnipValue,
  });

  function startSnip() {
    setSnipDocId(focus?.document_id ?? documents[0]?.id ?? "");
    setSnipPage(focus?.page ?? 1);
    setRegion(null);
    setTooSmall(false);
    setSnipping(true);
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
    if (!region || !snipDoc || !snipPath) return;
    setSnipSaving(true);
    const res = await fetch("/api/workbench/snip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        documentId: snipDoc.id,
        page: snipPage,
        bbox: region,
        fieldPath: snipPath,
        value: snipValue,
        unit: snipUnit.trim() || null,
        sourceText: snipText.trim(),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; id?: string };
    setSnipSaving(false);
    if (!res.ok || !json.ok) {
      toast.error(json.error ?? "Could not add the value");
      return;
    }
    toast.success("Added to the facts ledger.");
    stopSnip();
    softReload();
  }

  const snipShown = live ?? region;
  const snipValueBad = snipValue.trim() === "" || !Number.isFinite(Number(snipValue.replace(/,/g, "")));
  const canSaveSnip = Boolean(region && snipPath && snipText.trim() && !snipValueBad && !snipSaving);

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
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1 sm:col-span-2">
                  Field
                  <select
                    value={snipPath}
                    onChange={(e) => {
                      setSnipPath(e.target.value);
                      setSnipUnit(targets.find((t) => t.path === e.target.value)?.defaultUnit ?? "");
                    }}
                    className="h-9 rounded border border-mist-300 bg-white px-2 text-[13px]"
                  >
                    <option value="">Choose the field this value belongs to</option>
                    {targets.some(isMissing) ? (
                      <optgroup label="Not found yet">
                        {targets.filter(isMissing).map((t) => (
                          <option key={t.path} value={t.path}>
                            {t.label}
                            {t.state === "group" ? " (one of these methods is needed)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {targets.some((t) => !isMissing(t) && !isTaken(t)) ? (
                      <optgroup label="Optional (counted as zero if not added)">
                        {targets
                          .filter((t) => !isMissing(t) && !isTaken(t))
                          .map((t) => (
                            <option key={t.path} value={t.path}>
                              {t.label}
                            </option>
                          ))}
                      </optgroup>
                    ) : null}
                    {targets.some(isTaken) ? (
                      <optgroup label="Already in the ledger">
                        {targets.filter(isTaken).map((t) => (
                          <option key={t.path} value={t.path} disabled>
                            {t.label}
                            {t.state === "conflict" ? " (more than one value: fix it in the facts ledger)" : " (withdraw it in the facts ledger to replace it)"}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </label>
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
                  {snipSaving ? "Adding…" : "Add to facts ledger"}
                </Button>
                <p className="text-mist-600">Name the field and type the figure. It goes to the facts ledger with this page and box, marked as entered by you.</p>
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
