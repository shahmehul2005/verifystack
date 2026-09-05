import { Badge } from "@/components/ui/badge";
import { ECM_LIBRARY_ESCALATION } from "@verifystack/backend/domain/ecm/types";

/**
 * Loud, always-visible warning. The ECM library is not production-seeded.
 * Source citations on each card are not a substitute for this banner.
 */
export function EcmLibraryNotice({
  title,
  body,
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="mb-4 border-2 border-red-500 bg-red-50 px-3 py-3 text-[12px] text-red-950">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="block">Not for production</Badge>
        <span className="font-semibold uppercase tracking-wide">
          {title ?? ECM_LIBRARY_ESCALATION.bannerTitle}
        </span>
      </div>
      <p className="mt-1.5 max-w-3xl leading-relaxed">
        {body ?? ECM_LIBRARY_ESCALATION.bannerBody}
      </p>
    </div>
  );
}
