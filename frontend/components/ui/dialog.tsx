"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
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
        "m-auto w-full max-w-lg rounded-lg border border-mist-200 bg-white p-0 text-mist-900 shadow-md backdrop:bg-mist-950/30",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-mist-100 px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <button
          type="button"
          aria-label="Close"
          className="rounded-md p-1 text-mist-500 hover:bg-mist-100 hover:text-mist-900"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
