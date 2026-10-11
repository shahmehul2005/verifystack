"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordIssue } from "@verifystack/backend/lib/auth/redirect";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { AuthFooter, AuthHeading, authLinkClass } from "@/components/auth/auth-heading";
import { ConfigureSupabase } from "@/components/states";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
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
    setError(null);
    const { error: err } = await supabase!.auth.updateUser({ password });
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    await supabase!.auth.signOut();
    router.push("/login?password_updated=1");
    router.refresh();
  }

  return (
    <div>
      <AuthHeading
        title="Set a new password"
        description="Open this page from the reset email, or while signed in to change your password."
      />
      {error ? (
        <Alert tone="error" className="mt-5">
          {error}
        </Alert>
      ) : null}
      {ready && !hasSession ? (
        <Alert tone="warn" className="mt-5" title="This reset link has no active session">
          It may have expired or already been used.{" "}
          <Link href="/forgot-password" className={authLinkClass}>
            Request a new link
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
            <FieldHint>At least {MIN_PASSWORD_LENGTH} characters.</FieldHint>
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
            {pending ? "Saving…" : "Update password"}
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
