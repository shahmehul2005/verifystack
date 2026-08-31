/**
 * Model output rarely matches the provenanced Zod shape on the first try.
 * This pass rescues common drift without inventing numbers: missing wrappers
 * get a full-page bbox and low confidence so a human still reviews them.
 */

const FULL_PAGE = { x: 0, y: 0, width: 1, height: 1 };

const STRUCTURAL = new Set([
  "value",
  "confidence",
  "provenance",
  "bbox",
  "unitAsPrinted",
  "unit",
  "page",
  "sourceText",
  "x",
  "y",
  "width",
  "height",
]);

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isDateKey(key: string) {
  return /date|periodstart|periodend|validuntil/i.test(key);
}

function isMoneyOrQtyKey(key: string) {
  return /amount|total|value|rate|quantity|qty|cgst|sgst|igst|demand|energy/i.test(key);
}

function isStringyKey(key: string) {
  return /name|gstin|hsn|number|description|code|text|pan|tin/i.test(key);
}

export function coerceIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const named = s.match(/^(\d{1,2})[-/.\s]+([A-Za-z]{3,9})[-/.\s]+(\d{2,4})$/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    const year = expandYear(Number(named[3]));
    if (month && day >= 1 && day <= 31 && year) return iso(year, month, day);
  }

  const numeric = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = expandYear(Number(numeric[3]));
    if (!year) return null;
    // Indian documents are DD-MM-YYYY. Only accept when the day is unambiguous
    // or both parts are valid months would still prefer day-first when a > 12.
    if (a > 12 && b >= 1 && b <= 12) return iso(year, b, a);
    if (a >= 1 && a <= 12 && b > 12 && b <= 31) return iso(year, a, b);
    return null;
  }
  return null;
}

function expandYear(y: number): number | null {
  if (y >= 1000 && y <= 2100) return y;
  if (y >= 0 && y <= 99) return y < 50 ? 2000 + y : 1900 + y;
  return null;
}

function iso(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function coerceNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").replace(/[₹$]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function softenBBox(bbox: unknown) {
  if (!bbox || typeof bbox !== "object" || Array.isArray(bbox)) return FULL_PAGE;
  const o = bbox as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const width = Number(o.width);
  const height = Number(o.height);
  if ([x, y, width, height].some((n) => !Number.isFinite(n) || n > 1)) return FULL_PAGE;
  return { x: clamp01(x), y: clamp01(y), width: clamp01(width), height: clamp01(height) };
}

function sourceText(value: unknown, explicit?: unknown) {
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  if (value === null || value === undefined) return "unlocated";
  const s = String(value).trim();
  return s || "unlocated";
}

function wrap(
  value: unknown,
  page: number,
  opts?: { unitAsPrinted?: string; sourceText?: string; confidence?: number }
) {
  const node: Record<string, unknown> = {
    value,
    confidence: opts?.confidence ?? 0.45,
    provenance: {
      page,
      bbox: FULL_PAGE,
      sourceText: sourceText(value, opts?.sourceText),
    },
  };
  if (opts?.unitAsPrinted !== undefined) node.unitAsPrinted = opts.unitAsPrinted;
  return node;
}

function unitOf(o: Record<string, unknown>): string {
  if (typeof o.unitAsPrinted === "string") return o.unitAsPrinted;
  if (typeof o.unit === "string") return o.unit;
  return "";
}

function looksLikeFieldObject(o: Record<string, unknown>) {
  return Object.keys(o).every((k) => STRUCTURAL.has(k));
}

function isProvenanced(o: Record<string, unknown>) {
  return typeof o.confidence === "number" && o.provenance !== null && typeof o.provenance === "object";
}

function softenProvenanced(o: Record<string, unknown>, page: number, key: string) {
  const prov = (o.provenance ?? {}) as Record<string, unknown>;
  let value = o.value;
  if (isDateKey(key)) value = coerceIsoDate(value) ?? value;
  else if (isMoneyOrQtyKey(key) || "unitAsPrinted" in o || "unit" in o) {
    value = coerceNumber(value) ?? value;
  } else if (isStringyKey(key) && typeof value === "number") {
    value = String(value);
  }

  const out: Record<string, unknown> = {
    value,
    confidence: clamp01(Number(o.confidence)),
    provenance: {
      page: typeof prov.page === "number" && prov.page > 0 ? prov.page : page,
      bbox: softenBBox(prov.bbox),
      sourceText: sourceText(value, prov.sourceText),
    },
  };
  if ("unitAsPrinted" in o || "unit" in o || isMoneyOrQtyKey(key)) {
    out.unitAsPrinted = unitOf(o);
  }
  return out;
}

function wrapLeaf(key: string, raw: unknown, page: number, unit?: string) {
  if (raw === null || raw === undefined) return null;
  if (isDateKey(key)) {
    const isoDate = coerceIsoDate(raw);
    return isoDate ? wrap(isoDate, page, { sourceText: String(raw) }) : null;
  }
  if (isMoneyOrQtyKey(key) || unit !== undefined) {
    const n = coerceNumber(raw);
    if (n === null) return null;
    return wrap(n, page, { unitAsPrinted: unit ?? "", sourceText: String(raw) });
  }
  if (typeof raw === "number" && isStringyKey(key)) {
    return wrap(String(raw), page);
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return wrap(raw, page);
  }
  return raw;
}

function walk(node: unknown, page: number, key: string): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((item) => walk(item, page, key));
  if (typeof node !== "object") return wrapLeaf(key, node, page);

  const o = node as Record<string, unknown>;
  if (isProvenanced(o)) return softenProvenanced(o, page, key);
  if (looksLikeFieldObject(o) && "value" in o) {
    return wrapLeaf(key, o.value, page, "unitAsPrinted" in o || "unit" in o ? unitOf(o) : undefined);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = walk(v, page, k);
  }
  return out;
}

export function softenExtraction(payload: unknown, pageNumber: number): unknown {
  const walked = walk(payload, pageNumber, "");
  if (walked && typeof walked === "object" && !Array.isArray(walked)) {
    const o = walked as Record<string, unknown>;
    if (!Array.isArray(o.lines)) o.lines = [];
  }
  return walked;
}
