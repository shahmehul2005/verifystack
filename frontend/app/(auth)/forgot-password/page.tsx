"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { AuthFooter, AuthHeading, authLinkClass } from "@/components/auth/auth-heading";
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
      <AuthHeading
        title="Reset your password"
        description="Enter your work email. If it has an account, we'll send a reset link."
      />
      {sent ? (
        <Alert tone="ok" className="mt-7" title="Check your inbox">
          If an account exists for {email}, a reset link is on its way. Look in spam too. The link
          expires after about an hour.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="mt-7 space-y-4">
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
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <AuthFooter>
        <Link href="/login" className={authLinkClass}>
          Back to sign in
        </Link>
      </AuthFooter>
    </div>
  );
}
