import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
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
  { kind: "igea", label: "IGEA working draft" },
  { kind: "dpr", label: "DPR working draft" },
  { kind: "mv", label: "M&V working draft" },
] as const;

export function AdeetieReportLinks({ engagementId }: { engagementId: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <a
            key={r.kind}
            href={`/api/reports?engagementId=${encodeURIComponent(engagementId)}&kind=${r.kind}`}
            className={buttonVariants({ variant: "secondary" })}
          >
            <Download />
            {r.label}
          </a>
        ))}
      </div>
      <ReportDisclaimer />
    </div>
  );
}
