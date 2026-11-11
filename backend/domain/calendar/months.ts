import type { CalendarMonth } from "./types";

const MONTH_NAMES = [
  "Apr", "May", "Jun", "Jul", "Aug", "Sep",
  "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"
];

/**
 * Returns the 12 compliance months for an Indian financial year (1 Apr - 31 Mar).
 * Accepts strings like "FY2023-24", "2023-24", "FY23-24", "2023", etc.
 * Defaults to 2023-24 if unparseable.
 */
export function getFiscalMonths(complianceYear: string): CalendarMonth[] {
  let startYear = 2023;
  const match = complianceYear.match(/(\d{4})/);
  if (match) {
    startYear = parseInt(match[1], 10);
  } else {
    const shortMatch = complianceYear.match(/FY(\d{2})/i);
    if (shortMatch) {
      startYear = 2000 + parseInt(shortMatch[1], 10);
    }
  }

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

