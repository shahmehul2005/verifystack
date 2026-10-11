/**
 * SCADA / historian export normaliser (DFD 2.5).
 *
 * Turns a plant CSV into clean per-tag time series and a summary a reviewer can
 * read, and aggregates a window of a series for use as evidence. Everything is
 * counted rather than silently repaired: dropped non-numeric samples, duplicate
 * timestamps, out-of-order rows and gaps are reported in the summary, and the
 * original file stays the source of truth.
 *
 * Timestamps without a zone are read as `assumeOffsetMinutes` (default IST,
 * +05:30), recorded in the summary so the assumption is visible.
 */

export class TimeSeriesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeSeriesError";
  }
}

export const IST_OFFSET_MINUTES = 330;

export interface SeriesPoint {
  /** Epoch milliseconds, UTC. */
  t: number;
  v: number;
}

export interface TagSummary {
  tag: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  sum: number;
  first: string;
  last: string;
  medianIntervalSec: number | null;
  gapCount: number;
  droppedNonNumeric: number;
  duplicateTimestamps: number;
  outOfOrder: number;
}

export interface NormalisedSeries {
  layout: "wide" | "long";
  timestampColumn: string;
  assumedOffsetMinutes: number;
  series: Map<string, SeriesPoint[]>;
  summaries: TagSummary[];
  warnings: string[];
}

const TS_HEADER = /^(time\s*stamp|timestamp|date\s*time|datetime|date|time|ts)$/i;
const TAG_HEADER = /^(tag|tag\s*name|point|signal|name)$/i;
const VALUE_HEADER = /^(value|val|reading|pv)$/i;

/** Parse the timestamp shapes plant exports use. Returns epoch ms or null. */
export function parseTimestamp(raw: string, assumeOffsetMinutes: number): number | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO 8601, with or without a zone.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) {
    const [, y, mo, d, h = "0", mi = "0", sec = "0", zone] = iso;
    return build(+y!, +mo!, +d!, +h, +mi, +sec, zone, assumeOffsetMinutes);
  }
  // Day-first: DD/MM/YYYY or DD-MM-YYYY, optional time. Indian exports are day-first.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (dmy) {
    const [, d, mo, y, h = "0", mi = "0", sec = "0"] = dmy;
    return build(+y!, +mo!, +d!, +h, +mi, +sec, undefined, assumeOffsetMinutes);
  }
  return null;
}

function build(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  sec: number,
  zone: string | undefined,
  assume: number
): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  let offset = assume;
  if (zone) {
    if (zone === "Z") offset = 0;
    else {
      const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
      offset = (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3]));
    }
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec) - offset * 60_000;
  // Reject rollovers such as 31 Feb.
  const check = new Date(ms + offset * 60_000);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms;
}

function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  if (s === "" || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function normaliseTimeSeries(
  rows: string[][],
  opts: { assumeOffsetMinutes?: number } = {}
): NormalisedSeries {
  const assume = opts.assumeOffsetMinutes ?? IST_OFFSET_MINUTES;
  if (rows.length < 2) throw new TimeSeriesError("The file needs a header row and at least one data row.");
  const header = rows[0]!.map((h) => h.trim());
  const tsCol = header.findIndex((h) => TS_HEADER.test(h));
  if (tsCol < 0) {
    throw new TimeSeriesError(
      `No timestamp column found. Expected one of: Timestamp, DateTime, Date, Time. Found: ${header.join(", ")}.`
    );
  }

  const tagCol = header.findIndex((h) => TAG_HEADER.test(h));
  const valCol = header.findIndex((h) => VALUE_HEADER.test(h));
  const layout: "wide" | "long" = tagCol >= 0 && valCol >= 0 ? "long" : "wide";

  const raw = new Map<string, SeriesPoint[]>();
  const dropped = new Map<string, number>();
  let badTimestamps = 0;
  const add = (tag: string, t: number, v: number | null) => {
    if (v === null) {
      dropped.set(tag, (dropped.get(tag) ?? 0) + 1);
      return;
    }
    const list = raw.get(tag) ?? [];
    list.push({ t, v });
    raw.set(tag, list);
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const t = parseTimestamp(row[tsCol] ?? "", assume);
    if (t === null) {
      badTimestamps++;
      continue;
    }
    if (layout === "long") {
      const tag = (row[tagCol] ?? "").trim();
      if (tag) add(tag, t, parseNumber(row[valCol] ?? ""));
    } else {
      for (let c = 0; c < header.length; c++) {
        if (c === tsCol || !header[c]) continue;
        const cell = row[c] ?? "";
        if (cell.trim() === "") continue;
        add(header[c]!, t, parseNumber(cell));
      }
    }
  }

  const series = new Map<string, SeriesPoint[]>();
  const summaries: TagSummary[] = [];
  const warnings: string[] = [];
  if (badTimestamps > 0) warnings.push(`${badTimestamps} row(s) skipped: timestamp not recognised.`);

  for (const [tag, points] of raw) {
    let outOfOrder = 0;
    for (let i = 1; i < points.length; i++) if (points[i]!.t < points[i - 1]!.t) outOfOrder++;
    const sorted = [...points].sort((a, b) => a.t - b.t);

    // Same timestamp twice: keep the first reading, count the rest.
    const deduped: SeriesPoint[] = [];
    let duplicates = 0;
    for (const p of sorted) {
      if (deduped.length && deduped[deduped.length - 1]!.t === p.t) duplicates++;
      else deduped.push(p);
    }

    const intervals: number[] = [];
    for (let i = 1; i < deduped.length; i++) intervals.push((deduped[i]!.t - deduped[i - 1]!.t) / 1000);
    const med = median([...intervals].sort((a, b) => a - b));
    const gapCount = med ? intervals.filter((x) => x > med * 3).length : 0;

    const values = deduped.map((p) => p.v);
    const sum = values.reduce((s, v) => s + v, 0);
    series.set(tag, deduped);
    summaries.push({
      tag,
      count: deduped.length,
      min: deduped.length ? Math.min(...values) : 0,
      max: deduped.length ? Math.max(...values) : 0,
      mean: deduped.length ? sum / deduped.length : 0,
      sum,
      first: deduped.length ? new Date(deduped[0]!.t).toISOString() : "",
      last: deduped.length ? new Date(deduped[deduped.length - 1]!.t).toISOString() : "",
      medianIntervalSec: med,
      gapCount,
      droppedNonNumeric: dropped.get(tag) ?? 0,
      duplicateTimestamps: duplicates,
      outOfOrder,
    });
    if (gapCount > 0) warnings.push(`${tag}: ${gapCount} gap(s) longer than 3x the usual interval.`);
    if (duplicates > 0) warnings.push(`${tag}: ${duplicates} duplicate timestamp(s); first reading kept.`);
  }
  // Tags that only ever had non-numeric values.
  for (const [tag, n] of dropped) {
    if (!raw.has(tag)) warnings.push(`${tag}: all ${n} value(s) were non-numeric and were dropped.`);
  }
  if (summaries.length === 0) throw new TimeSeriesError("No numeric readings were found.");

  summaries.sort((a, b) => a.tag.localeCompare(b.tag));
  return {
    layout,
    timestampColumn: header[tsCol]!,
    assumedOffsetMinutes: assume,
    series,
    summaries,
    warnings,
  };
}

export type Aggregation = "sum" | "mean" | "min" | "max" | "first" | "last" | "count";

export interface RangeAggregate {
  value: number;
  rowCount: number;
  start: string;
  end: string;
}

/** Aggregate the points with start <= t <= end. Null when the window holds no readings. */
export function aggregateRange(
  points: SeriesPoint[],
  startIso: string,
  endIso: string,
  aggregation: Aggregation
): RangeAggregate | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new TimeSeriesError("The window needs a valid start and an end that is not before it.");
  }
  const win = points.filter((p) => p.t >= start && p.t <= end);
  if (win.length === 0) return null;
  const vs = win.map((p) => p.v);
  let value: number;
  switch (aggregation) {
    case "sum":
      value = vs.reduce((s, v) => s + v, 0);
      break;
    case "mean":
      value = vs.reduce((s, v) => s + v, 0) / vs.length;
      break;
    case "min":
      value = Math.min(...vs);
      break;
    case "max":
      value = Math.max(...vs);
      break;
    case "first":
      value = vs[0]!;
      break;
    case "last":
      value = vs[vs.length - 1]!;
      break;
    case "count":
      value = vs.length;
      break;
  }
  return { value, rowCount: win.length, start: startIso, end: endIso };
}
