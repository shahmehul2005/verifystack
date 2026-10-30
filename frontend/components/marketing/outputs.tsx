"use client";

import { useState } from "react";
import { OUTPUTS, OutputSheet, type OutputId } from "./fragments";

/**
 * What the product produces, as an index of documents. Pick a name and its
 * sheet appears at true size. The first is open, so the page never shows an empty stage.
 */
export function Outputs() {
  const [id, setId] = useState<OutputId>("plan");
  const current = OUTPUTS.find((o) => o.id === id)!;

  return (
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="min-w-0">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 lg:flex-col" role="tablist" aria-label="Documents the product produces">
          {OUTPUTS.map((o) => {
            const on = o.id === id;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  role="tab"
                  id={`out-tab-${o.id}`}
                  aria-selected={on}
                  aria-controls="out-panel"
                  onClick={() => setId(o.id)}
                  className={`py-1 text-left text-[clamp(1.5rem,1rem+1.6vw,2.5rem)] leading-[1.15] font-medium tracking-[-0.02em] transition-colors ${on ? "text-mist-950" : "text-mist-500 hover:text-mist-800"}`}
                >
                  {o.name}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 max-w-md text-[1.125rem] leading-relaxed text-mist-800">{current.claim}</p>
      </div>

      <div id="out-panel" role="tabpanel" aria-labelledby={`out-tab-${id}`} className="bg-field p-5 sm:p-8">
        <OutputSheet id={id} />
        <p className="mt-4 text-[14px] text-mist-800">Synthetic data.</p>
      </div>
    </div>
  );
}
