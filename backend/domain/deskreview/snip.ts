/**
 * Point-and-snip: a region an auditor draws on a page when the figure cannot be
 * read by the extraction, or was not extracted at all. The region is stored in
 * the same form extraction uses (normalised to the page, origin top-left), so a
 * snipped figure and an extracted one are cited the same way.
 *
 * A snip is human provenance. It records where the auditor looked and what is
 * printed there; the figure is typed by the auditor, never read by a model.
 */

export interface Region {
  /** All four are fractions of the page, from its top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The smallest side a region may have, as a fraction of the page. Anything smaller is a stray click. */
export const MIN_SIDE = 0.005;

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function isUsableRegion(r: Region): boolean {
  const ok = (n: number) => Number.isFinite(n);
  if (![r.x, r.y, r.width, r.height].every(ok)) return false;
  if (r.x < 0 || r.y < 0 || r.width < MIN_SIDE || r.height < MIN_SIDE) return false;
  return r.x + r.width <= 1 + 1e-6 && r.y + r.height <= 1 + 1e-6;
}

/** A region from unknown input, or null. Used for what comes back from the database or the browser. */
export function parseRegion(value: unknown): Region | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const region = { x: Number(v.x), y: Number(v.y), width: Number(v.width), height: Number(v.height) };
  return isUsableRegion(region) ? region : null;
}

/**
 * The region between two pointer positions on a page shown `size` pixels wide
 * and high. The pointer may leave the page; it is held to the page edge. Null
 * when the drag is too small to be a choice.
 */
export function regionFromDrag(a: Point, b: Point, size: { width: number; height: number }): Region | null {
  if (!(size.width > 0) || !(size.height > 0)) return null;
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);
  const left = clamp(Math.min(a.x, b.x), size.width);
  const right = clamp(Math.max(a.x, b.x), size.width);
  const top = clamp(Math.min(a.y, b.y), size.height);
  const bottom = clamp(Math.max(a.y, b.y), size.height);
  const region = {
    x: round4(left / size.width),
    y: round4(top / size.height),
    width: round4((right - left) / size.width),
    height: round4((bottom - top) / size.height),
  };
  return isUsableRegion(region) ? region : null;
}

/** A page region in a phrase a reviewer can read: where on the page, and how big. */
export function describeRegion(r: Region): string {
  const col = r.x + r.width / 2 < 1 / 3 ? "left" : r.x + r.width / 2 > 2 / 3 ? "right" : "middle";
  const row = r.y + r.height / 2 < 1 / 3 ? "top" : r.y + r.height / 2 > 2 / 3 ? "bottom" : "middle";
  const place = row === "middle" && col === "middle" ? "centre" : `${row} ${col}`;
  return `${place} of the page, ${Math.round(r.width * 100)}% wide and ${Math.round(r.height * 100)}% high`;
}

/* ------------------------------------------------------------------ */
/* A snip in the review workbench                                      */
/* ------------------------------------------------------------------ */

/** Marks an extracted field as drawn on the page by a person, not read by the model. */
export const SNIP_KIND = "snip";

export interface SnipProvenance {
  kind: typeof SNIP_KIND;
  /** The user who drew the region. */
  by: string;
  at: string;
}

export function snipProvenance(by: string, at: string): SnipProvenance {
  return { kind: SNIP_KIND, by, at };
}

export function isSnipProvenance(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as { kind?: unknown }).kind === SNIP_KIND;
}
