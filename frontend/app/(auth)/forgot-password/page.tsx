"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfigureSupabase } from "@/components/states";

export default function ForgotPasswordPage() {
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  if (!supabase) return <ConfigureSupabase />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const origin = window.location.origin;
    await supabase!.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/update-password`,
    });
    setPending(false);
    setSent(true);
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">VerifyStack</p>
      <h1 className="mt-1 text-lg font-semibold">Reset password</h1>
      <p className="mt-1 text-sm text-stone-600">
        We will email a reset link if that address has an account. The message does not say whether
        the account exists.
      </p>
      {sent ? (
        <p className="mt-6 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
          If an account exists for {email}, check that inbox (and spam) for the reset link. It
          expires after about an hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-[12px] text-stone-500">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
