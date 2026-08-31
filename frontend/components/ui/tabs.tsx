"use client";

import { cn } from "@/lib/cn";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 border-b border-stone-200">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "px-3 py-2 text-[12px]",
            value === item.id
              ? "border-b-2 border-stone-900 font-medium text-stone-900"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
