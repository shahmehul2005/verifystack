"use client";

import { useState } from "react";
import { Check } from "lucide-react";

/**
 * The hero's live fragment: a page of a coal tax invoice with three values a
 * model has proposed. Press a value to read it, accept it, or correct it.
 * Nothing here is real data. It shows the one rule the product is built on:
 * a proposed value becomes a fact only when a named person decides.
 */

type Status = "proposed" | "accepted" | "corrected";

interface Reading {
  id: string;
  key: string;
  label: string;
  printed: string;
  value: number;
  unit: string;
}

const READINGS: Reading[] = [
  { id: "qty", key: "fuel.coal.quantity", label: "Quantity dispatched", printed: "18,247 MT", value: 18247, unit: "t" },
  { id: "gcv", key: "fuel.coal.gcv", label: "Gross calorific value", printed: "4,200 kcal/kg", value: 4200, unit: "kcal/kg" },
  { id: "moist", key: "fuel.coal.moisture", label: "Total moisture", printed: "11.4 %", value: 11.4, unit: "%" },
];

const REVIEWER = "A. Rao";

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** A short stable identifier for a fact, so a changed value shows a changed id. */
function factId(key: string, value: number): string {
  let h = 5381;
  for (const ch of `${key}:${value}`) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return `f_${h.toString(16).padStart(8, "0")}`;
}

export function HeroReader() {
  const [selected, setSelected] = useState<string>("qty");
  const [status, setStatus] = useState<Record<string, Status>>({ qty: "proposed", gcv: "proposed", moist: "proposed" });
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(READINGS.map((r) => [r.id, r.value])));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const current = READINGS.find((r) => r.id === selected)!;
  const state = status[selected]!;
  const decided = READINGS.filter((r) => status[r.id] !== "proposed").length;

  function pick(id: string) {
    setSelected(id);
    setEditing(false);
  }

  function accept() {
    setStatus((s) => ({ ...s, [selected]: "accepted" }));
  }

  function saveCorrection() {
    const n = Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(n) || draft.trim() === "") return;
    setValues((v) => ({ ...v, [selected]: n }));
    setStatus((s) => ({ ...s, [selected]: "corrected" }));
    setEditing(false);
  }

  function reset() {
    setStatus((s) => ({ ...s, [selected]: "proposed" }));
    setValues((v) => ({ ...v, [selected]: current.value }));
    setEditing(false);
  }

  return (
    <figure aria-label="A value on an invoice page, traced to its source" className="w-full">
      <div data-ui className="bg-white text-[14px] text-mist-800">
        <div className="flex items-center justify-between gap-4 border-b border-mist-900/10 px-5 py-3">
          <span className="font-medium text-mist-900">Coal tax invoice</span>
          <span className="text-mist-500">Page 1 of 2</span>
        </div>

        <div className="px-5 py-5">
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 text-mist-600">
            <dt>Supplier</dt>
            <dd className="text-right text-mist-800">Mahanadi Coal Traders</dd>
            <dt>Invoice</dt>
            <dd className="text-right text-mist-800">INV/24-25/0412 · 14 Apr 2024</dd>
            <dt>Grade</dt>
            <dd className="text-right text-mist-800">G-10</dd>
          </dl>

          <ul className="mt-4 space-y-2">
            {READINGS.map((r) => {
              const on = r.id === selected;
              const st = status[r.id]!;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(r.id)}
                    className={`flex w-full items-center justify-between gap-4 px-2.5 py-2 text-left transition-colors ${
                      on ? "bg-amber-100 outline-2 outline-amber-400" : "hover:bg-mist-100"
                    }`}
                  >
                    <span className="text-mist-800">{r.label}</span>
                    <span className="flex items-center gap-2.5">
                      <span className="tabular font-medium text-mist-900">{r.printed}</span>
                      <span
                        aria-label={st === "proposed" ? "Proposed" : st === "accepted" ? "Accepted" : "Corrected"}
                        className={`flex size-5 items-center justify-center ${
                          st === "proposed" ? "bg-violet-100 text-violet-800" : "bg-green-100 text-green-800"
                        }`}
                      >
                        {st === "proposed" ? <span aria-hidden className="size-1.5 rounded-full bg-violet-500" /> : <Check aria-hidden className="size-3.5" />}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="border-t border-mist-900/10 bg-mist-50 px-5 py-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[14px] text-mist-600">{current.key}</span>
            {state === "proposed" ? (
              <span className="bg-violet-100 px-2 py-0.5 text-[14px] font-medium text-violet-800">AI-proposed</span>
            ) : (
              <span className="bg-green-100 px-2 py-0.5 text-[14px] font-medium text-green-800">
                {state === "accepted" ? "Fact" : "Fact, corrected"}
              </span>
            )}
          </div>

          <p className="tabular mt-2 text-[1.5rem] leading-none font-medium tracking-[-0.02em] text-mist-950">
            {fmt(values[selected]!)} <span className="text-[1rem] font-normal text-mist-500">{current.unit}</span>
          </p>
          <p className="mt-2 text-mist-600">
            Read from page 1: “{current.label} {current.printed}”
          </p>

          {state === "proposed" && !editing ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={accept}
                className="inline-flex h-10 items-center gap-2 bg-teal-600 px-4 font-medium text-white transition-colors hover:bg-teal-700 active:translate-y-px"
              >
                <Check aria-hidden className="size-4" />
                Accept
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(String(current.value));
                  setEditing(true);
                }}
                className="inline-flex h-10 items-center border border-mist-900/20 px-4 font-medium text-mist-800 transition-colors hover:bg-mist-200 active:translate-y-px"
              >
                Correct
              </button>
              <span className="text-mist-500">Needs a named reviewer</span>
            </div>
          ) : null}

          {editing ? (
            <form
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveCorrection();
              }}
            >
              <label className="flex flex-col gap-1 text-mist-600">
                <span>Corrected value ({current.unit})</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="tabular h-10 w-44 border border-mist-900/25 bg-white px-3 text-[1rem] text-mist-900 outline-offset-2"
                />
              </label>
              <button type="submit" className="inline-flex h-10 items-center bg-teal-600 px-4 font-medium text-white hover:bg-teal-700">
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex h-10 items-center px-3 font-medium text-mist-700 hover:bg-mist-200"
              >
                Cancel
              </button>
            </form>
          ) : null}

          {state !== "proposed" ? (
            <div className="mt-4">
              <p className="text-mist-800">
                {state === "accepted" ? "Accepted" : `Corrected from ${fmt(current.value)} to ${fmt(values[selected]!)}`} by{" "}
                <span className="font-medium">{REVIEWER}</span>, verifier · 14:32 IST
              </p>
              <p className="mt-1 font-mono text-[14px] text-mist-500">{factId(current.key, values[selected]!)}</p>
              <button type="button" onClick={reset} className="mt-2 font-medium text-teal-700 underline-offset-4 hover:underline">
                Put it back to proposed
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <figcaption className="mt-3 text-[14px] text-mist-600">
        {decided === READINGS.length
          ? "All three values have a name on them. Only now can they feed a calculation."
          : `${decided} of ${READINGS.length} values are facts. None reaches the calculation until a person decides.`}{" "}
        <span className="text-mist-500">Synthetic data.</span>
      </figcaption>
    </figure>
  );
}
