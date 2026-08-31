import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-3")}>
      <div>
        {kicker ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{kicker}</p>
        ) : null}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-stone-600">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function DraftBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="mb-4 border border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
      <Badge tone="draft">Draft mode</Badge>
      <span className="ml-2">
        Unverified factors are allowed. This run is not a verification opinion and must not be filed.
      </span>
    </div>
  );
}
