"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordIssue } from "@verifystack/backend/lib/auth/redirect";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { AuthFooter, AuthHeading, authLinkClass } from "@/components/auth/auth-heading";
import { ConfigureSupabase } from "@/components/states";

/**
 * Leftover path for old Supabase invite emails that still land a recovery
 * session. New invites open /signup?invite=… so the password is stored at
 * account creation.
 */
export default function InvitePage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setReady(true);
    });
  }, [supabase]);

  if (!supabase) return <ConfigureSupabase />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const issue = passwordIssue(password, confirm);
    if (issue) {
      setError(issue);
      return;
    }
    setPending(true);
    const { error: err } = await supabase!.auth.updateUser({ password });
    setPending(false);
    if (err) setError(err.message);
    else {
      router.push("/engagements");
      router.refresh();
    }
  }

  return (
    <div>
      <AuthHeading
        title="Set your password"
        description={
          <>
            New invites open <span className="font-medium text-mist-800">Create account</span> with
            a link from your firm admin. Use this page only if you still have an older invite
            email session.
          </>
        }
      />
      {error ? (
        <Alert tone="error" className="mt-5">
          {error}
        </Alert>
      ) : null}
      {ready && !hasSession ? (
        <Alert tone="warn" className="mt-5" title="No invite session in this browser">
          Ask your firm admin for a new create-account link, or{" "}
          <Link href="/login" className={authLinkClass}>
            sign in
          </Link>
          .
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pending || !hasSession}>
            {pending ? "Saving…" : "Save password"}
          </Button>
        </form>
      )}
      <AuthFooter>
        <Link href="/signup" className={authLinkClass}>
          Create account
        </Link>
        <span className="mx-2 text-mist-300">·</span>
        <Link href="/login" className={authLinkClass}>
          Sign in
        </Link>
      </AuthFooter>
    </div>
  );
}
