"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfigureSupabase, ErrorState } from "@/components/states";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/engagements";
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!supabase) {
    return <ConfigureSupabase />;
  }

  async function afterAuth() {
    await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => undefined);
    router.push(next);
    router.refresh();
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
    if (err) {
      setPending(false);
      setError(err.message);
      return;
    }
    await afterAuth();
  }

  async function onSignUp() {
    setPending(true);
    setError(null);
    setInfo(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setPending(false);
      setError(json.error ?? "Could not create the account.");
      return;
    }
    const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
    if (err) {
      setPending(false);
      setError(err.message);
      return;
    }
    await afterAuth();
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">VerifyStack</p>
      <h1 className="mt-1 text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-stone-600">Verifier firms only. Not for the obligated entity.</p>
      {error ? <div className="mt-4"><ErrorState body={error} /></div> : null}
      {info ? <p className="mt-4 text-sm text-stone-700">{info}</p> : null}
      <form onSubmit={onPassword} className="mt-6 space-y-3">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          Sign in
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={pending || !email || password.length < 8}
          onClick={onSignUp}
        >
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[12px] text-stone-500">
        Accounts are created without a confirmation email so we do not hit the
        Supabase mail cap. Invited?{" "}
        <Link href="/invite" className="underline">
          Accept invite
        </Link>
      </p>
    </div>
  );
}
