"use client";

import { useState } from "react";

export interface QA {
  q: string;
  a: string;
}

/**
 * Every question on the left, one answer on the right. On a phone the answer
 * opens directly under its question.
 */
export function FaqIndex({ items }: { items: readonly QA[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="grid gap-x-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <ul className="space-y-1">
        {items.map((item, i) => {
          const on = i === open;
          return (
            <li key={item.q}>
              <button
                type="button"
                aria-expanded={on}
                aria-controls={`faq-a-${i}`}
                onClick={() => setOpen(i)}
                className="flex w-full items-baseline gap-3 py-2 text-left text-[1.125rem] leading-snug"
              >
                <span aria-hidden className={`mt-[0.45em] size-2 shrink-0 rounded-full transition-colors ${on ? "bg-teal-600" : "bg-mist-400"}`} />
                <span className={`font-medium transition-colors ${on ? "text-mist-950" : "text-mist-700 hover:text-mist-950"}`}>{item.q}</span>
              </button>
              {on ? (
                <p id={`faq-a-${i}`} className="pb-3 pl-5 text-[1.125rem] leading-relaxed text-mist-800 lg:hidden">
                  {item.a}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="hidden lg:block">
        <div className="sticky top-[14vh] bg-mist-200 p-10">
          <p className="text-[1.5rem] leading-snug font-medium text-mist-950">{items[open]!.q}</p>
          <p className="mt-4 max-w-xl text-[1.125rem] leading-relaxed text-mist-800">{items[open]!.a}</p>
        </div>
      </div>
    </div>
  );
}
