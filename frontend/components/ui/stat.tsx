import { cn } from "@/lib/cn";

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "warn" | "block" | "ok";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-mist-200 bg-white px-4 py-3.5 shadow-xs", className)}>
      <p className="text-xs font-medium text-mist-600">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular",
          tone === "neutral" && "text-mist-900",
          tone === "warn" && "text-amber-700",
          tone === "block" && "text-red-700",
          tone === "ok" && "text-green-700"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-mist-500">{hint}</p> : null}
    </div>
  );
}

export function DefinitionList({
  items,
  className,
  columns = 2,
}: {
  items: { term: string; value: React.ReactNode }[];
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-8 gap-y-3 text-sm",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.term} className="min-w-0">
          <dt className="text-xs text-mist-500">{item.term}</dt>
          <dd className="mt-0.5 truncate text-mist-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
