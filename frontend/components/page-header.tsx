import { cn } from "@/lib/cn";

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  meta,
  className,
}: {
  kicker?: string;
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-7 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {kicker ? <p className="text-[13px] font-medium text-teal-700">{kicker}</p> : null}
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-mist-950">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-mist-600">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
