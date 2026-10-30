"use client";

import { useEffect, useRef, useState } from "react";
import { EngagementFragment } from "./fragments";

export interface Step {
  title: string;
  body: string;
}

/**
 * Six statements on the left, one engagement on the right. The engagement is
 * pinned and changes state as each statement reaches the middle of the screen.
 * On a phone each statement carries its own state beneath it instead.
 */
export function HowItWorks({ steps }: { steps: readonly Step[] }) {
  const [active, setActive] = useState(0);
  const blocks = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    for (const el of blocks.current) if (el) seen.observe(el);
    return () => seen.disconnect();
  }, []);

  return (
    <div className="grid gap-x-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <ol>
        {steps.map((s, i) => (
          <li
            key={s.title}
            data-step={i}
            ref={(el) => {
              blocks.current[i] = el;
            }}
            className="flex min-h-[48svh] flex-col justify-center py-10 lg:min-h-[62svh]"
          >
            <h3 className={`text-[clamp(1.5rem,1rem+1.6vw,2.5rem)] leading-[1.1] font-medium tracking-[-0.02em] transition-colors duration-300 ${i === active ? "text-mist-950" : "text-mist-500"}`}>
              {s.title}
            </h3>
            <p className="mt-4 max-w-md text-[1.125rem] leading-relaxed text-mist-800">{s.body}</p>
            <div className="mt-8 lg:hidden">
              <div className="bg-field p-4">
                <EngagementFragment step={i} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="hidden lg:block">
        <div className="sticky top-[14vh] bg-field p-8">
          <EngagementFragment step={active} />
          <p className="mt-4 text-[14px] text-mist-800">Synthetic data. One engagement, from the plan to the signed package.</p>
        </div>
      </div>
    </div>
  );
}
