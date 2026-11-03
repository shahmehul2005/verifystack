const IST = "Asia/Kolkata";

export function formatIn(
  n: number,
  opts: Intl.NumberFormatOptions = { maximumFractionDigits: 2 }
) {
  return n.toLocaleString("en-IN", opts);
}

/** Rupees with Indian grouping, e.g. ₹12,50,000. */
export function formatInr(n: number, maximumFractionDigits = 0) {
  return n.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits,
  });
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatIn(bytes / 1024, { maximumFractionDigits: 0 })} KB`;
  return `${formatIn(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

/** `electricity_bill` → `Electricity bill`. Display only. */
export function humanize(value: string | null | undefined) {
  if (!value) return "";
  const s = value.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
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
