import { cn } from "@/lib/cn";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto border border-stone-200 bg-white">
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-stone-500",
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-b border-stone-100 px-3 py-2.5 align-top", className)} {...props} />;
}
