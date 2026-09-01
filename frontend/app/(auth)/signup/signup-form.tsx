"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordIssue } from "@verifystack/backend/lib/auth/redirect";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfigureSupabase } from "@/components/states";
import { AuthDivider, GoogleButton } from "@/components/auth/google-button";
import { signInWithGoogle } from "@/components/auth/google";
import { RoleSelect } from "@/components/auth/role-select";
import { rememberIntendedRole } from "@/components/auth/intended-role";

export function SignupForm() {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<MembershipRole>("lead_verifier");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!supabase) return <ConfigureSupabase />;

  async function onGoogle() {
    setPending(true);
    setError(null);
    rememberIntendedRole(role);
    const { error: err } = await signInWithGoogle(homePathFor(role), role);
    if (err) {
      setPending(false);
      setError("Could not start Google sign-in. Check that Google is enabled in Supabase Auth.");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const issue = passwordIssue(password, confirm);
    if (issue) {
      setError(issue);
      return;
    }
    setPending(true);
    setError(null);
    rememberIntendedRole(role);
    const origin = window.location.origin;
    const { data, error: err } = await supabase!.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(homePathFor(role))}`,
        data: { intended_role: role },
      },
    });
    if (err) {
      setPending(false);
      setError("Could not create the account. Sign in or reset your password.");
      return;
    }
    if (data.session) {
      await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }).catch(() => undefined);
      router.push(homePathFor(role));
      router.refresh();
      return;
    }
    router.push("/login?check_email=1");
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">VerifyStack</p>
      <h1 className="mt-1 text-lg font-semibold">Create account</h1>
      <p className="mt-1 text-sm text-stone-600">
        Choose the DFD role you will work as. A firm admin can change this later on Team.
      </p>
      {error ? (
        <p className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
      ) : null}
      <div className="mt-6">
        <RoleSelect value={role} onChange={setRole} disabled={pending} />
      </div>
      <div className="mt-4">
        <GoogleButton pending={pending} onClick={onGoogle} label="Sign up with Google" />
      </div>
      <AuthDivider />
      <form onSubmit={onSubmit} className="space-y-3">
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
        <div>
          <Label htmlFor="password">Password</Label>
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
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-center text-[12px] text-stone-500">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
