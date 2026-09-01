"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordIssue } from "@verifystack/backend/lib/auth/redirect";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
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
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">VerifyStack</p>
      <h1 className="mt-1 text-lg font-semibold">Set a new password</h1>
      <p className="mt-1 text-sm text-stone-600">
        Open this page from the reset email, or while signed in to change your password.
      </p>
      {error ? (
        <p className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
      ) : null}
      {ready && !hasSession ? (
        <p className="mt-4 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
          No reset session.{" "}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-3">
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
          <Button type="submit" className="w-full" disabled={pending || !hasSession}>
            {pending ? "Saving…" : "Update password"}
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
