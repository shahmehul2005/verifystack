"use client";

import { useRef } from "react";
import { regionFromDrag, type Point, type Region } from "@verifystack/backend/domain/deskreview/snip";

/**
 * A transparent layer over a page that turns a pointer drag into a region
 * normalised to the page. Put it in the `overlay` slot of `EvidencePageViewer`.
 * `onLive` follows the drag; `onDraw` fires on release with the region, or null
 * when the drag was too small to be a choice.
 */
export function RegionDrawLayer({
  onLive,
  onDraw,
}: {
  onLive?: (region: Region | null) => void;
  onDraw: (region: Region | null) => void;
}) {
  const start = useRef<Point | null>(null);
  const size = useRef({ width: 0, height: 0 });

  const point = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    size.current = { width: r.width, height: r.height };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div
      className="absolute inset-0 z-20 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onLive?.(regionFromDrag(start.current, point(e), size.current));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const drawn = regionFromDrag(start.current, point(e), size.current);
        start.current = null;
        onLive?.(null);
        onDraw(drawn);
      }}
      onPointerCancel={() => {
        start.current = null;
        onLive?.(null);
      }}
    />
  );
}
