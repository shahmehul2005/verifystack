"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function EngagementNav({
  engagementId,
  links,
}: {
  engagementId: string;
  links: { slug: string; label: string }[];
}) {
  const pathname = usePathname();
  const base = `/engagements/${engagementId}`;
  const items = [{ slug: "", label: "Overview" }, ...links];
  return (
    <nav
      data-engagement-nav
      aria-label="Engagement sections"
      className="-mx-4 mb-7 overflow-x-auto border-b border-mist-200 px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max gap-1">
        {items.map((item) => {
          const href = item.slug ? `${base}/${item.slug}` : base;
          const active = item.slug
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === base;
          return (
            <li key={item.slug || "overview"}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px block border-b-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-teal-600 font-medium text-mist-950"
                    : "border-transparent text-mist-600 hover:border-mist-300 hover:text-mist-900"
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
