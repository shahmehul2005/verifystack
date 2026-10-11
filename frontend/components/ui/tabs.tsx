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
    <div role="tablist" className="flex gap-1 border-b border-mist-200">
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
              active
                ? "border-teal-600 font-medium text-mist-900"
                : "border-transparent text-mist-500 hover:border-mist-300 hover:text-mist-800"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
