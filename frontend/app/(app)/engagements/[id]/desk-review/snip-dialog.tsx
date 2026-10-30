"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EvidencePageViewer } from "@/components/workbench/evidence-page-viewer";
import { describeRegion, regionFromDrag, type Point, type Region } from "@verifystack/backend/domain/deskreview/snip";

export interface SnipResult {
  page: number;
  region: Region;
  /** What is printed in the box, as the auditor read it. */
  sourceText: string;
  /** The figure, when the auditor typed it here. Null leaves the form's value as it is. */
  value: number | null;
}

/**
 * Draw a box on the page a figure was read from. The box and what is printed in
 * it are kept with the value, so a reviewer can see exactly where the auditor
 * looked. The figure is typed by a person; nothing here reads it for them.
 *
 * The caller mounts this only while it is open, so each opening starts from
 * what the form holds.
 */
export function SnipDialog({
  open,
  onClose,
  mode,
  documentId,
  mimeType,
  documentName,
  label,
  unit,
  initialPage,
  initialRegion,
  initialText,
  initialValue,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  mode: "draw" | "view";
  documentId: string;
  mimeType: string | null;
  documentName: string;
  label: string;
  unit: string;
  initialPage: number;
  initialRegion: Region | null;
  initialText: string;
  initialValue: string;
  onUse: (result: SnipResult) => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [region, setRegion] = useState<Region | null>(initialRegion);
  const [text, setText] = useState(initialText);
  const [value, setValue] = useState(initialValue);
  const [live, setLive] = useState<Region | null>(null);
  const [tooSmall, setTooSmall] = useState(false);
  const start = useRef<Point | null>(null);
  const size = useRef({ width: 0, height: 0 });

  const point = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    size.current = { width: r.width, height: r.height };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const overlay =
    mode === "draw" ? (
      <div
        className="absolute inset-0 z-20 cursor-crosshair touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = point(e);
          setTooSmall(false);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          setLive(regionFromDrag(start.current, point(e), size.current));
        }}
        onPointerUp={(e) => {
          if (!start.current) return;
          const drawn = regionFromDrag(start.current, point(e), size.current);
          start.current = null;
          setLive(null);
          setTooSmall(drawn === null);
          if (drawn) setRegion(drawn);
        }}
        onPointerCancel={() => {
          start.current = null;
          setLive(null);
        }}
      />
    ) : null;

  const shown = live ?? region;
  const numeric = value.trim() === "" ? null : Number(value.replace(/,/g, ""));
  const valueBad = numeric !== null && !Number.isFinite(numeric);
  const canUse = region !== null && text.trim().length > 0 && !valueBad;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "draw" ? `Snip: ${label}` : `Region for ${label}`}
      className="max-w-3xl"
    >
      <div className="space-y-3">
        <p className="text-[13px] text-mist-700">
          {documentName}
          {mode === "draw" ? ". Drag a box around the figure on the page." : "."}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-mist-800">
            Page
            <Input
              type="number"
              min={1}
              max={numPages ?? undefined}
              value={page}
              disabled={mode === "view"}
              onChange={(e) => {
                const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                setPage(numPages ? Math.min(n, numPages) : n);
                setRegion(null);
              }}
              className="h-8 w-20 text-[13px]"
            />
          </label>
          {numPages ? <span className="text-[13px] text-mist-600">of {numPages}</span> : null}
          {shown ? <span className="text-[13px] text-mist-700">Box: {describeRegion(shown)}</span> : null}
        </div>

        <div className="max-h-[60vh] overflow-auto bg-mist-200 p-3">
          <EvidencePageViewer
            src={`/api/documents/${documentId}/file`}
            mimeType={mimeType}
            page={page}
            bbox={shown}
            overlay={overlay}
            onPages={setNumPages}
          />
        </div>

        {mode === "draw" ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <label className="flex flex-col gap-1 text-[13px] text-mist-800">
              What is printed in the box
              <Input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="For example: Quantity dispatched 18,247 MT" className="h-9 text-[13px]" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-mist-800">
              Figure ({unit})
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 text-[13px]" />
            </label>
          </div>
        ) : text ? (
          <p className="text-[13px] text-mist-800">Printed in the box: “{text}”</p>
        ) : null}

        {tooSmall ? <p className="text-[13px] text-amber-800">That box is too small. Drag a larger one around the figure.</p> : null}
        {mode === "draw" ? (
          <p className="text-[13px] text-mist-600">
            Drawing needs a pointer. Without one, type the figure and its page in the form and leave the box empty.
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {mode === "draw" ? "Cancel" : "Close"}
          </Button>
          {mode === "draw" ? (
            <Button
              disabled={!canUse}
              onClick={() => {
                if (!region) return;
                onUse({ page, region, sourceText: text.trim(), value: numeric });
              }}
            >
              Use this region
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
