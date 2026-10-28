/**
 * Recompute a workbook's formulas in code.
 *
 * Spreadsheet files often store 0 (or nothing) as the cached result of a formula
 * that was written by a script and never opened in Excel. A reader that trusts the
 * cache reads those cells as 0. This evaluator ignores the cache: it computes every
 * formula cell from its inputs. It handles arithmetic, cell references (including
 * other sheets) and a short list of functions. Anything else yields an error for
 * that cell and never a guess.
 */

import { parseCellRef, columnLetters, type XlsxWorkbook, type XlsxSheet } from "../intake/xlsx";

export interface EvaluatedCell {
  sheet: string;
  ref: string;
  formula: string;
  /** The result stored in the file (often 0 or null for generated files). */
  cached: number | string | boolean | null;
  /** The result computed here. Null when the formula could not be evaluated. */
  value: number | null;
  error?: string;
}

export interface EvaluatedWorkbook {
  /** Numeric value of a cell after evaluating formulas. Null if blank, text or in error. */
  value(sheet: string, ref: string): number | null;
  formulaCells: EvaluatedCell[];
}

type Tok = { t: "num"; v: number } | { t: "ref"; sheet: string | null; ref: string } | { t: "op"; v: string } | { t: "id"; v: string };

const TOKEN =
  /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(])|([A-Za-z_][A-Za-z0-9_.]*)(?=\()|([-+*/^(),]))/y;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (src.slice(TOKEN.lastIndex).trim() === "") break;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Cannot read "${src.slice(TOKEN.lastIndex, TOKEN.lastIndex + 12).trim()}"`);
    if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
    else if (m[4] !== undefined) out.push({ t: "ref", sheet: m[2] ?? m[3] ?? null, ref: m[4].replace(/\$/g, "").toUpperCase() });
    else if (m[5] !== undefined) out.push({ t: "id", v: m[5].toUpperCase() });
    else out.push({ t: "op", v: m[6]! });
  }
  return out;
}

export function evaluateWorkbook(wb: XlsxWorkbook): EvaluatedWorkbook {
  const sheets = new Map<string, XlsxSheet>(wb.sheets.map((s) => [s.name, s]));
  const byRef = new Map<string, Map<string, { value: unknown; formula?: string }>>();
  for (const s of wb.sheets) {
    const m = new Map<string, { value: unknown; formula?: string }>();
    for (const c of s.cells) m.set(c.ref.toUpperCase(), { value: c.value, formula: c.formula });
    byRef.set(s.name, m);
  }

  const memo = new Map<string, { v: number | null; err?: string }>();
  const active = new Set<string>();

  function cell(sheet: string, ref: string): { v: number | null; err?: string } {
    const key = `${sheet}!${ref}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const raw = byRef.get(sheet)?.get(ref);
    let res: { v: number | null; err?: string };
    if (!sheets.has(sheet)) res = { v: null, err: `No sheet "${sheet}"` };
    else if (!raw) res = { v: 0 };
    else if (raw.formula) {
      if (active.has(key)) return { v: null, err: `Circular reference at ${key}` };
      active.add(key);
      try {
        res = { v: evalFormula(sheet, raw.formula) };
      } catch (e) {
        res = { v: null, err: e instanceof Error ? e.message : String(e) };
      } finally {
        active.delete(key);
      }
    } else if (typeof raw.value === "number") res = { v: raw.value };
    else if (raw.value === null || raw.value === "") res = { v: 0 };
    else res = { v: null, err: `${key} is text` };
    memo.set(key, res);
    return res;
  }

  function range(sheet: string, a: string, b: string): number[] {
    const p = parseCellRef(a);
    const q = parseCellRef(b);
    if (!p || !q) throw new Error(`Bad range ${a}:${b}`);
    const out: number[] = [];
    for (let r = Math.min(p.row, q.row); r <= Math.max(p.row, q.row); r++) {
      for (let c = Math.min(p.col, q.col); c <= Math.max(p.col, q.col); c++) {
        const raw = byRef.get(sheet)?.get(`${columnLetters(c)}${r}`);
        if (!raw || raw.value === null || raw.value === "") continue;
        if (typeof raw.value === "string" && !raw.formula) continue; // text is ignored by SUM
        const x = cell(sheet, `${columnLetters(c)}${r}`);
        if (x.v === null) throw new Error(x.err ?? "Unresolved cell");
        out.push(x.v);
      }
    }
    return out;
  }

  function evalFormula(sheet: string, formula: string): number {
    const toks = tokenize(formula.replace(/^=/, ""));
    let i = 0;
    const peek = () => toks[i];
    const eat = (v?: string) => {
      const t = toks[i++];
      if (v && (!t || t.t !== "op" || t.v !== v)) throw new Error(`Expected "${v}"`);
      return t;
    };

    function args(): (number | number[])[] {
      const list: (number | number[])[] = [];
      if (peek()?.t === "op" && (peek() as { v: string }).v === ")") return list;
      for (;;) {
        list.push(argument());
        const t = peek();
        if (t?.t === "op" && t.v === ",") {
          i++;
          continue;
        }
        return list;
      }
    }
    function argument(): number | number[] {
      const t = peek();
      if (t?.t === "ref" && t.ref.includes(":")) {
        i++;
        const [a, b] = t.ref.split(":");
        return range(t.sheet ?? sheet, a!, b!);
      }
      return expr();
    }
    const flat = (a: (number | number[])[]) => a.flatMap((x) => (Array.isArray(x) ? x : [x]));

    function primary(): number {
      const t = toks[i++];
      if (!t) throw new Error("Formula ended early");
      if (t.t === "num") return t.v;
      if (t.t === "ref") {
        if (t.ref.includes(":")) throw new Error("A range needs a function");
        const x = cell(t.sheet ?? sheet, t.ref);
        if (x.v === null) throw new Error(x.err ?? "Unresolved cell");
        return x.v;
      }
      if (t.t === "id") {
        eat("(");
        const a = flat(args());
        eat(")");
        switch (t.v) {
          case "SUM":
            return a.reduce((p, q) => p + q, 0);
          case "MIN":
            return Math.min(...a);
          case "MAX":
            return Math.max(...a);
          case "ABS":
            return Math.abs(a[0]!);
          case "ROUND": {
            const f = 10 ** (a[1] ?? 0);
            return Math.round(a[0]! * f) / f;
          }
          default:
            throw new Error(`Function ${t.v} is not supported`);
        }
      }
      if (t.v === "(") {
        const v = expr();
        eat(")");
        return v;
      }
      if (t.v === "-") return -power();
      if (t.v === "+") return power();
      throw new Error(`Unexpected "${t.v}"`);
    }
    function power(): number {
      const base = primary();
      const t = peek();
      if (t?.t === "op" && t.v === "^") {
        i++;
        return base ** power();
      }
      return base;
    }
    function term(): number {
      let v = power();
      for (;;) {
        const t = peek();
        if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
          i++;
          const r = power();
          if (t.v === "/" && r === 0) throw new Error("Division by zero");
          v = t.v === "*" ? v * r : v / r;
        } else return v;
      }
    }
    function expr(): number {
      let v = term();
      for (;;) {
        const t = peek();
        if (t?.t === "op" && (t.v === "+" || t.v === "-")) {
          i++;
          const r = term();
          v = t.v === "+" ? v + r : v - r;
        } else return v;
      }
    }

    const result = expr();
    if (i < toks.length) throw new Error("Unexpected text after the formula");
    if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
    return result;
  }

  const formulaCells: EvaluatedCell[] = [];
  for (const s of wb.sheets) {
    for (const c of s.cells) {
      if (!c.formula) continue;
      const r = cell(s.name, c.ref.toUpperCase());
      formulaCells.push({
        sheet: s.name,
        ref: c.ref.toUpperCase(),
        formula: c.formula,
        cached: c.value,
        value: r.v,
        ...(r.err ? { error: r.err } : {}),
      });
    }
  }

  return {
    value(sheet, ref) {
      const raw = byRef.get(sheet)?.get(ref.toUpperCase());
      if (!raw || raw.value === null || raw.value === "") return raw?.formula ? cell(sheet, ref.toUpperCase()).v : null;
      return cell(sheet, ref.toUpperCase()).v;
    },
    formulaCells,
  };
}
