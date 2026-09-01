"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  Files,
  Library,
  Scale,
  Shield,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import { navForRole } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { SignOutButton } from "./sign-out-button";

const NAV_ICONS = {
  "/engagements": ClipboardList,
  "/review-queue": Files,
  "/packs": Library,
  "/factors": Scale,
  "/audit": Shield,
  "/team": Users,
} as const;

export function AppShell({
  children,
  orgName,
  role,
  userEmail,
}: {
  children: React.ReactNode;
  orgName?: string | null;
  role?: MembershipRole | null;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const nav = navForRole(role);
  return (
    <div className="flex min-h-screen bg-stone-100 text-stone-900">
      <aside className="hidden w-56 shrink-0 border-r border-stone-300 bg-stone-900 text-stone-100 md:flex md:flex-col">
        <div className="border-b border-stone-700 px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400">VerifyStack</p>
          <p className="mt-1 text-sm font-semibold">Verifier workbench</p>
        </div>
        <nav className="flex-1 p-2">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = NAV_ICONS[item.href as keyof typeof NAV_ICONS];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "mb-0.5 flex items-center gap-2 px-3 py-2 text-[13px]",
                  active ? "bg-stone-800 text-white" : "text-stone-300 hover:bg-stone-800/60"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="px-4 py-3 text-[10px] text-stone-500">Desktop-first · IST · en-IN</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-stone-300 bg-white px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="border border-stone-300 bg-stone-50 px-2 py-1 text-[12px] text-stone-700">
              {orgName ?? "Organisation"}
              <span className="ml-2 text-stone-400">switcher</span>
            </span>
            {role ? <Badge tone="ink">{ROLE_LABEL[role]}</Badge> : <Badge>No role</Badge>}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {userEmail ? (
              <>
                <span
                  className="hidden max-w-[12rem] truncate text-[12px] text-stone-600 sm:inline"
                  title={userEmail}
                >
                  {userEmail}
                </span>
                <Link
                  href="/update-password"
                  className="hidden text-[12px] text-stone-500 hover:text-stone-800 sm:inline"
                >
                  Password
                </Link>
                <SignOutButton />
              </>
            ) : null}
            <Link href="/workbench" className="text-[12px] text-stone-500 hover:text-stone-800">
              Public demo
            </Link>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-stone-200 bg-white px-2 py-1 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap px-2 py-1 text-[12px] text-stone-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
