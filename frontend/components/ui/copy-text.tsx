"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Shows a shortened value with a button that copies the full one. */
export function CopyText({ value, visible = 12 }: { value: string; visible?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-mist-700" title={value}>
        {value.length > visible ? `${value.slice(0, visible)}…` : value}
      </span>
      <button
        type="button"
        aria-label="Copy full value"
        className="rounded-sm p-0.5 text-mist-400 hover:bg-mist-100 hover:text-mist-700"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-3.5 text-green-700" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}
