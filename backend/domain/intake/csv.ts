/**
 * CSV parsing for plant exports (DFD 2.4 / 2.5).
 *
 * RFC 4180 quoting, a BOM strip, and delimiter detection, because Indian
 * plant exports routinely use semicolons or tabs. Bounded: a row and cell cap
 * stops a pathological upload from exhausting memory.
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export interface CsvLimits {
  maxRows: number;
  maxColumns: number;
}

export const DEFAULT_CSV_LIMITS: CsvLimits = { maxRows: 500_000, maxColumns: 256 };

export type Delimiter = "," | ";" | "\t" | "|";

/** Pick the delimiter that appears most consistently in the first lines, outside quotes. */
export function detectDelimiter(text: string): Delimiter {
  const candidates: Delimiter[] = [",", ";", "\t", "|"];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 10);
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map((line) => {
      let n = 0;
      let inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === d && !inQ) n++;
      }
      return n;
    });
    if (counts.length === 0 || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = (consistent ? 1000 : 0) + counts[0]!;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export function parseCsv(
  input: string,
  opts: { delimiter?: Delimiter; limits?: CsvLimits } = {}
): { delimiter: Delimiter; rows: string[][] } {
  const limits = opts.limits ?? DEFAULT_CSV_LIMITS;
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = opts.delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
    if (row.length > limits.maxColumns) {
      throw new CsvError(`More than ${limits.maxColumns} columns.`);
    }
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    if (rows.length > limits.maxRows) {
      throw new CsvError(`More than ${limits.maxRows} rows.`);
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new CsvError("Unterminated quoted field.");
  if (field !== "" || row.length > 0) endRow();
  return { delimiter, rows };
}

/** Quote a field for output when it contains a delimiter, quote or newline. Guards CSV injection. */
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // A cell starting with = + - @ is executed by spreadsheet apps; neutralise it.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
}
