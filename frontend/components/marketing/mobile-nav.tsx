"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

type Item = { href: string; label: string };

/** Menu for narrow screens. The desktop nav is rendered by the layout. */
export function MobileNav({ items, signedIn = false }: { items: readonly Item[]; signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-lg text-mist-700 hover:bg-mist-900/5"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="glass-strong absolute inset-x-0 top-full mt-2 rounded-2xl border p-2 shadow-lg"
        >
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-[15px] text-mist-800 hover:bg-mist-900/5"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t border-mist-900/6 pt-1">
              <Link
                href={signedIn ? "/engagements" : "/login"}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-[15px] text-mist-800 hover:bg-mist-900/5"
              >
                {signedIn ? "Open workbench" : "Sign in"}
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
