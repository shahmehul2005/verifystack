"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ClipboardList,
  Inbox,
  Library,
  Menu,
  Scale,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/logo";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import { APP_NAV, navForRole } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { UserMenu } from "./user-menu";

const NAV_ICONS = {
  "/engagements": ClipboardList,
  "/review-queue": Inbox,
  "/packs": Library,
  "/factors": Scale,
  "/audit": ScrollText,
  "/team": Users,
} as const;

const NAV_GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "Work", hrefs: ["/engagements", "/review-queue"] },
  { label: "Library", hrefs: ["/packs", "/factors"] },
  { label: "Firm", hrefs: ["/team", "/audit"] },
];

type NavItem = (typeof APP_NAV)[number];

function NavLinks({
  nav,
  pathname,
  onNavigate,
}: {
  nav: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pathWhenPending, setPathWhenPending] = useState(pathname);
  const [isPending, startTransition] = useTransition();

  if (pendingHref != null && pathname !== pathWhenPending) {
    setPathWhenPending(pathname);
    setPendingHref(null);
  }

  return (
    <>
      {NAV_GROUPS.map((group) => {
        const items = group.hrefs
          .map((href) => nav.find((item) => item.href === href))
          .filter((item): item is NavItem => Boolean(item));
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="mb-5">
            <p className="mb-1 px-3 text-xs font-medium text-mist-500">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const pathActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const active =
                  pendingHref != null
                    ? pendingHref === item.href || pendingHref.startsWith(`${item.href}/`)
                    : pathActive;
                const Icon = NAV_ICONS[item.href as keyof typeof NAV_ICONS];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      aria-busy={active && isPending ? true : undefined}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                          onNavigate?.();
                          return;
                        }
                        e.preventDefault();
                        if (pathActive && pendingHref == null) {
                          onNavigate?.();
                          return;
                        }
                        setPendingHref(item.href);
                        setPathWhenPending(pathname);
                        onNavigate?.();
                        startTransition(() => {
                          router.push(item.href);
                        });
                      }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-white font-medium text-teal-900 shadow-[0_0_0_1px_rgb(12_22_21/0.06),0_2px_6px_-2px_rgb(12_22_21/0.1)]"
                          : "text-mist-700 hover:bg-mist-900/5 hover:text-mist-900",
                        active && isPending && "opacity-80"
                      )}
                    >
                      <Icon
                        className={cn("size-4", active ? "text-teal-700" : "text-mist-500")}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function FirmBlock({
  orgName,
  role,
}: {
  orgName?: string | null;
  role?: MembershipRole | null;
}) {
  return (
    <div className="glass mx-3 mb-5 rounded-lg px-3 py-2.5">
      <p className="truncate text-sm font-medium text-mist-900" title={orgName ?? undefined}>
        {orgName ?? "Your firm"}
      </p>
      <p className="mt-0.5 text-xs text-mist-600">{role ? ROLE_LABEL[role] : "No role yet"}</p>
    </div>
  );
}

export function AppShell({
  children,
  orgName,
  role,
  userEmail,
  isSteward = false,
}: {
  children: React.ReactNode;
  orgName?: string | null;
  role?: MembershipRole | null;
  userEmail?: string | null;
  isSteward?: boolean;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nav = navForRole(role);
  const factorsItem = APP_NAV.find((item) => item.href === "/factors");
  if (isSteward && factorsItem && !nav.some((item) => item.href === "/factors")) {
    const packsAt = nav.findIndex((item) => item.href === "/packs");
    nav.splice(packsAt + 1, 0, factorsItem);
  }
  return (
    <div className="flex min-h-screen text-mist-900">
      <aside className="glass-strong sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center px-4">
          <Link href="/" aria-label="VerifyStack home page" className="rounded-md">
            <Logo />
          </Link>
        </div>
        <div className="mt-2 flex-1 overflow-y-auto">
          <FirmBlock orgName={orgName} role={role} />
          <nav aria-label="Main" className="px-2">
            <NavLinks nav={nav} pathname={pathname} />
          </nav>
        </div>
        <div className="border-t border-mist-900/6 px-4 py-3 text-xs text-mist-500">
          <Link href="/privacy" className="hover:text-mist-800">
            Privacy and data
          </Link>
        </div>
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-mist-950/30 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="glass-strong absolute inset-y-0 left-0 flex w-72 flex-col shadow-lg">
            <div className="flex h-14 items-center justify-between px-4">
              <Link href="/" aria-label="VerifyStack home page" className="rounded-md">
                <Logo />
              </Link>
              <button
                type="button"
                aria-label="Close menu"
                className="rounded-md p-1.5 text-mist-600 hover:bg-mist-100"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-2 flex-1 overflow-y-auto">
              <FirmBlock orgName={orgName} role={role} />
              <nav aria-label="Main" className="px-2">
                <NavLinks nav={nav} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-app-header
          className="glass-strong sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b px-4 md:px-8"
        >
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              aria-label="Open menu"
              className="rounded-md p-1.5 text-mist-700 hover:bg-mist-100"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <Link href="/" aria-label="VerifyStack home page" className="rounded-md">
              <Logo />
            </Link>
          </div>
          <p className="hidden truncate text-sm text-mist-600 md:block">
            {orgName ?? "Your firm"}
          </p>
          {userEmail ? <UserMenu email={userEmail} role={role} /> : <span />}
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
