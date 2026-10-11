import { AlertTriangle, CheckCircle2, Info, Sparkles, XOctagon } from "lucide-react";
import { cn } from "@/lib/cn";

const tones = {
  info: { box: "border-teal-200 bg-teal-50/60 text-teal-950", icon: Info, iconClass: "text-teal-700" },
  warn: {
    box: "border-amber-200 bg-amber-50 text-amber-950",
    icon: AlertTriangle,
    iconClass: "text-amber-600",
  },
  error: { box: "border-red-200 bg-red-50 text-red-950", icon: XOctagon, iconClass: "text-red-600" },
  ok: { box: "border-green-200 bg-green-50 text-green-950", icon: CheckCircle2, iconClass: "text-green-700" },
  ai: { box: "border-violet-200 bg-violet-50 text-violet-950", icon: Sparkles, iconClass: "text-violet-600" },
};

export type AlertTone = keyof typeof tones;

export function Alert({
  tone = "info",
  title,
  children,
  actions,
  className,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-4 py-3 text-[13px] leading-relaxed", t.box, className)}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.iconClass)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5 opacity-90" : undefined)}>{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
