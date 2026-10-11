import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("glass rounded-xl", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-mist-900/6 px-5 py-4",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-mist-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-mist-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/** Small section heading used between blocks on a page. */
export function SectionTitle({
  children,
  className,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-sm font-semibold text-mist-900">{children}</h2>
      {actions}
    </div>
  );
}
