import { cn } from "@/lib/cn";

const styles = {
  neutral: "border-stone-300 bg-stone-50 text-stone-700",
  draft: "border-amber-400 bg-amber-50 text-amber-950",
  block: "border-red-300 bg-red-50 text-red-800",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  ink: "border-stone-700 bg-stone-900 text-stone-50",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof styles;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        styles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
