import { fyStartOf } from "../packs/emissionBasis";
import type { CalendarMonth } from "./types";

const MONTH_NAMES = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep",
  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"
];

/**
 * Start year of an Indian financial year label, or null when it is not one.
 * Accepts "FY2025-26", "2025-26", "FY 2025-2026" (via `fyStartOf`) and "FY25-26".
 */
export function fiscalStartYear(label: string | null | undefined): number | null {
  if (!label) return null;
  const long = fyStartOf(label);
  if (long !== null) return long;
  const m = /(?:^|[^A-Za-z0-9])FY\s*(\d{2})\s*[-\u2013/]\s*(\d{2})(?!\d)/i.exec(label);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return (start + 1) % 100 === end ? 2000 + start : null;
}

/** The 1 Apr - 31 Mar window of a financial year label, or null when it does not parse. */
export function fiscalYearWindow(
  label: string | null | undefined,
): { start: string; end: string } | null {
  const y = fiscalStartYear(label);
  if (y === null) return null;
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

/**
 * Returns the 12 compliance months for an Indian financial year (1 Apr - 31 Mar).
 * Accepts strings like "FY2023-24", "2023-24", "FY23-24".
 * Defaults to 2023-24 if unparseable (display only; use `fiscalYearWindow` for data).
 */
export function getFiscalMonths(complianceYear: string): CalendarMonth[] {
  const startYear = fiscalStartYear(complianceYear) ?? 2023;

  const endYear = startYear + 1;

  const months: CalendarMonth[] = [];

  for (let i = 0; i < 12; i++) {
    const isNextYear = i >= 9;
    const year = isNextYear ? endYear : startYear;
    // Month number 1-12: Apr is 4, May is 5, ..., Dec is 12, Jan is 1, Feb is 2, Mar is 3
    const monthNum = isNextYear ? (i - 8) : (i + 4);
    const monthPad = String(monthNum).padStart(2, "0");
    const key = `${year}-${monthPad}`;
    const label = `${MONTH_NAMES[i]} ${year}`;

    // Compute start and end dates
    const startDate = `${key}-01`;
    // Last day of the month
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${key}-${String(lastDay).padStart(2, "0")}`;

    months.push({
      key,
      label,
      monthIndex: i,
      startDate,
      endDate,
    });
  }

  return months;
}

/**
 * Matches an arbitrary date or period string to one of the 12 fiscal months.
 * e.g. "2023-08-15" -> "2023-08"
 */
export function matchDateToMonthKey(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{4})[-/](\d{2})/);
  if (m) {
    return `${m[1]}-${m[2]}`;
  }
  return null;
}

