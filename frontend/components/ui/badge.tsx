import { cn } from "@/lib/cn";

const styles = {
  neutral: "border-mist-200 bg-mist-50 text-mist-700",
  draft: "border-amber-200 bg-amber-50 text-amber-800",
  block: "border-red-200 bg-red-50 text-red-700",
  ok: "border-green-200 bg-green-50 text-green-800",
  ink: "border-teal-200 bg-teal-50 text-teal-800",
  ai: "border-violet-200 bg-violet-50 text-violet-800",
};

const dots = {
  neutral: "bg-mist-400",
  draft: "bg-amber-500",
  block: "bg-red-600",
  ok: "bg-green-600",
  ink: "bg-teal-600",
  ai: "bg-violet-500",
};

export type BadgeTone = keyof typeof styles;

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium leading-5",
        styles[tone],
        className
      )}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", dots[tone])} /> : null}
      {children}
    </span>
  );
}
