import { cn } from "@/lib/cn";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto rounded-lg border border-mist-200 bg-white shadow-xs">
      <table
        className={cn(
          "w-full border-collapse text-left text-sm [&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-mist-50/70",
          className
        )}
        {...props}
      />
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-mist-200 bg-mist-50 px-4 py-2.5 text-xs font-medium text-mist-600",
        className
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-mist-100 px-4 py-3 align-top text-mist-800", className)} {...props} />
  );
}
