import { ReportDisclaimer } from "./notices";

/**
 * Entry points for the ADEETIE report renderers.
 *
 * The route itself (`frontend/app/api/reports/route.tsx`) is owned elsewhere. It
 * dispatches on a `kind` query parameter alongside the existing `engagementId`:
 * `kind=dpr` renders the Detailed Project Report, `kind=mv` the Monitoring &
 * Verification report, and anything else falls back to `verification`, which is
 * what the sign-off screen already links to.
 */
const REPORTS = [
  { kind: "igea", label: "Download IGEA working draft" },
  { kind: "dpr", label: "Download DPR working draft" },
  { kind: "mv", label: "Download M&V working draft" },
] as const;

export function AdeetieReportLinks({ engagementId }: { engagementId: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <a
            key={r.kind}
            href={`/api/reports?engagementId=${encodeURIComponent(engagementId)}&kind=${r.kind}`}
            className="inline-flex h-9 items-center bg-white px-3 text-sm ring-1 ring-stone-300 hover:bg-stone-50"
          >
            {r.label}
          </a>
        ))}
      </div>
      <ReportDisclaimer />
    </div>
  );
}
