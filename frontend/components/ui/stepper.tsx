import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Step {
  id: string;
  label: string;
}

/**
 * Horizontal progress track. Steps before `current` are complete, `current`
 * is in progress, the rest are upcoming. Purely presentational.
 */
export function Stepper({
  steps,
  current,
  className,
  label = "Progress",
}: {
  steps: Step[];
  current: string;
  className?: string;
  label?: string;
}) {
  const at = Math.max(0, steps.findIndex((s) => s.id === current));
  return (
    <ol aria-label={label} className={cn("flex w-full items-start", className)}>
      {steps.map((step, i) => {
        const state = i < at ? "done" : i === at ? "current" : "todo";
        return (
          <li
            key={step.id}
            aria-current={state === "current" ? "step" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
          >
            {i > 0 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-3 h-px w-full -translate-y-1/2",
                  i <= at ? "bg-teal-600" : "bg-mist-200"
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-6 items-center justify-center rounded-full border text-xs font-semibold tabular",
                state === "done" && "border-teal-600 bg-teal-600 text-white",
                state === "current" && "border-teal-600 bg-white text-teal-700 ring-4 ring-teal-600/10",
                state === "todo" && "border-mist-300 bg-white text-mist-500"
              )}
            >
              {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={cn(
                "mt-2 px-1 text-xs leading-tight",
                state === "current" ? "font-semibold text-mist-900" : "text-mist-600"
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
