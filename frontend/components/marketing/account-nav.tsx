"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "@/components/shell/user-menu";

type Item = { href: string; label: string };

/**
 * Right-hand side of the public header.
 *
 * The server tells us who is signed in so the first paint is right. The browser
 * then confirms it, because the Back button can restore this page from a cache
 * made before sign-in, and a cached page must not claim you are signed out. The
 * session itself lives in a cookie and ends only when the user signs out.
 */
export function AccountNav({
  initialEmail,
  items,
}: {
  initialEmail: string | null;
  items: readonly Item[];
}) {
  const [email, setEmail] = useState(initialEmail);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    if (!supabase) return;

    // Fires once with the stored session, then on every sign-in and sign-out.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });

    // A page restored from the back/forward cache does not re-run effects.
    function onPageShow(e: PageTransitionEvent) {
      if (!e.persisted) return;
      void supabase!.auth.getSession().then(({ data: { session } }) => {
        setEmail(session?.user.email ?? null);
      });
    }
    window.addEventListener("pageshow", onPageShow);

    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      {email ? (
        <>
          <Link
            href="/engagements"
            className={cn(buttonVariants(), "hidden rounded-full sm:inline-flex")}
          >
            Open workbench
            <ArrowRight />
          </Link>
          <UserMenu email={email} hideRole showWorkbench />
        </>
      ) : (
        <>
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "ghost" }), "hidden rounded-full md:inline-flex")}
          >
            Sign in
          </Link>
          <Link href="/#demo" className={cn(buttonVariants(), "rounded-full")}>
            Request a demo
          </Link>
        </>
      )}
      <MobileNav items={items} signedIn={Boolean(email)} />
    </div>
  );
}
