import { cn } from "@/lib/cn";

export const fieldClass =
  "w-full rounded-lg border border-mist-900/12 bg-white/80 px-3 text-sm text-mist-900 shadow-[inset_0_1px_1px_rgb(12_22_21/0.04)] transition-[border-color,box-shadow,background-color] placeholder:text-mist-400 hover:border-mist-900/25 focus:border-teal-600 focus:bg-white focus:outline-none focus:ring-3 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-mist-100/70 disabled:text-mist-500";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, "h-9", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClass, "h-9 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(fieldClass, "min-h-24 py-2 leading-relaxed", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-mist-800", className)}
      {...props}
    />
  );
}

export function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1.5 text-xs leading-relaxed text-mist-500", className)} {...props} />;
}
