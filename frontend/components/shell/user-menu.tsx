"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, KeyRound, LayoutDashboard, LogOut } from "lucide-react";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

function initials(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function UserMenu({
  email,
  role,
  hideRole = false,
  showWorkbench = false,
}: {
  email: string;
  role?: MembershipRole | null;
  /** Hide the role line where the role is not known, such as the public site. */
  hideRole?: boolean;
  /** Add a link back into the workbench, for use outside the app. */
  showWorkbench?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-mist-900/5"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">
          {initials(email)}
        </span>
        <span className="hidden max-w-[14rem] truncate text-sm text-mist-700 sm:inline">{email}</span>
        <ChevronDown className="size-4 text-mist-500" />
      </button>
      {open ? (
        <div
          role="menu"
          className="glass-strong absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border shadow-lg"
        >
          <div className="border-b border-mist-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-mist-900">{email}</p>
            {hideRole ? null : (
              <p className="mt-0.5 text-xs text-mist-600">{role ? ROLE_LABEL[role] : "No role yet"}</p>
            )}
          </div>
          <div className="p-1">
            {showWorkbench ? (
              <Link
                role="menuitem"
                href="/engagements"
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-mist-700 hover:bg-mist-100"
              >
                <LayoutDashboard className="size-4 text-mist-500" />
                Open workbench
              </Link>
            ) : null}
            <Link
              role="menuitem"
              href="/update-password"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-mist-700 hover:bg-mist-100"
            >
              <KeyRound className="size-4 text-mist-500" />
              Change password
            </Link>
            <form action="/api/auth/signout" method="post">
              <button
                role="menuitem"
                type="submit"
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-mist-700 hover:bg-mist-100"
              >
                <LogOut className="size-4 text-mist-500" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
