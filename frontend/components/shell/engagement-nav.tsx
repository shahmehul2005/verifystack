"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

export function EngagementNav({
  engagementId,
  links,
}: {
  engagementId: string;
  links: { slug: string; label: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pathWhenPending, setPathWhenPending] = useState(pathname);
  const [isPending, startTransition] = useTransition();
  const base = `/engagements/${engagementId}`;
  const items = [{ slug: "", label: "Overview" }, ...links];

  // Drop the optimistic highlight once the URL has caught up (render-time adjust).
  if (pendingHref != null && pathname !== pathWhenPending) {
    setPathWhenPending(pathname);
    setPendingHref(null);
  }

  return (
    <nav
      data-engagement-nav
      aria-label="Engagement sections"
      className="-mx-4 mb-7 overflow-x-auto border-b border-mist-200 px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {items.map((item) => {
          const href = item.slug ? `${base}/${item.slug}` : base;
          const pathActive = item.slug
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === base;
          const active = pendingHref != null ? pendingHref === href : pathActive;
          return (
            <li key={item.slug || "overview"}>
              <Link
                href={href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                aria-busy={active && isPending ? true : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  if (pathActive && pendingHref == null) return;
                  setPendingHref(href);
                  setPathWhenPending(pathname);
                  startTransition(() => {
                    router.push(href);
                  });
                }}
                className={cn(
                  "-mb-px block border-b-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-teal-600 font-medium text-mist-950"
                    : "border-transparent text-mist-600 hover:border-mist-300 hover:text-mist-900",
                  active && isPending && "opacity-80"
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
