import { cn } from "@/lib/cn";

/** The mark: a check resting on a stack line. Matches app/icon.svg. */
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="7" className={inverted ? "fill-white" : "fill-teal-700"} />
      <path
        d="M9.5 14.5l4.5 4.75L22.5 9.5"
        fill="none"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={inverted ? "stroke-teal-700" : "stroke-white"}
      />
      <path
        d="M9.5 23.5h13"
        fill="none"
        strokeWidth="2.75"
        strokeLinecap="round"
        className={inverted ? "stroke-teal-700/45" : "stroke-teal-200"}
      />
    </svg>
  );
}

export function Logo({
  className,
  tagline,
  inverted = false,
}: {
  className?: string;
  tagline?: string;
  inverted?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark inverted={inverted} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "text-[15px] font-semibold tracking-tight",
            inverted ? "text-white" : "text-mist-950"
          )}
        >
          VerifyStack
        </span>
        {tagline ? (
          <span className={cn("mt-1 text-xs", inverted ? "text-teal-100" : "text-mist-500")}>
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}
