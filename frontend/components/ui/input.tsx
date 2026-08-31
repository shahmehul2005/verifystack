import { cn } from "@/lib/cn";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full border border-stone-300 bg-white px-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-900 focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-500", className)}
      {...props}
    />
  );
}
