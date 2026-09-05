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
