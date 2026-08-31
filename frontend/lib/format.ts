const IST = "Asia/Kolkata";

export function formatIn(
  n: number,
  opts: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }
) {
  return n.toLocaleString("en-IN", opts);
}

export function formatIst(iso: string | Date, withTime = true) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    dateStyle: "medium",
    timeStyle: withTime ? "short" : undefined,
  }).format(new Date(iso));
}

/** Indian financial year label, e.g. FY2025-26. Year is the April start. */
export function fyLabel(aprilStartYear: number) {
  return `FY${aprilStartYear}-${String(aprilStartYear + 1).slice(-2)}`;
}

export function currentFyLabel(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST,
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const start = month >= 4 ? year : year - 1;
  return fyLabel(start);
}

export function fyMonths(complianceYear: string): string[] {
  const m = /^FY(\d{4})-(\d{2})$/.exec(complianceYear);
  if (!m) return [];
  const start = Number(m[1]);
  const months: string[] = [];
  for (let i = 4; i <= 12; i++) {
    months.push(`${start}-${String(i).padStart(2, "0")}`);
  }
  for (let i = 1; i <= 3; i++) {
    months.push(`${start + 1}-${String(i).padStart(2, "0")}`);
  }
  return months;
}
