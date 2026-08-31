"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cn(
        "w-full max-w-lg border border-stone-300 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-900/40",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button type="button" className="text-stone-500 hover:text-stone-900" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
