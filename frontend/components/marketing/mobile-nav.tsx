"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

type Item = { href: string; label: string };

/** Menu for narrow screens. The desktop nav is rendered by the layout. */
export function MobileNav({ items, signedIn = false }: { items: readonly Item[]; signedIn?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="flex size-10 items-center justify-center text-mist-800 hover:bg-mist-900/5"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="absolute inset-x-0 top-full bg-mist-50 p-2 shadow-md"
        >
          <ul>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-3 text-[1rem] text-mist-800 hover:bg-mist-200"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="mt-1 pt-1">
              <Link
                href={signedIn ? "/engagements" : "/login"}
                onClick={() => setOpen(false)}
                className="block px-3 py-3 text-[1rem] text-mist-800 hover:bg-mist-200"
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
