"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { publicAuthMessage, safeNextPath } from "@verifystack/backend/lib/auth/redirect";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfigureSupabase } from "@/components/states";
import { AuthDivider, GoogleButton } from "@/components/auth/google-button";
import { signInWithGoogle } from "@/components/auth/google";
import { LoginNotice } from "@/components/auth/login-notice";
import { RoleSelect } from "@/components/auth/role-select";
import { rememberIntendedRole } from "@/components/auth/intended-role";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next");
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<MembershipRole>("firm_admin");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const noticeError = error ?? publicAuthMessage(params.get("error"));

  if (!supabase) {
    return <ConfigureSupabase />;
  }

  async function afterAuth() {
    rememberIntendedRole(role);
    const boot = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }).catch(() => undefined);
    const json = (boot
      ? ((await boot.json()) as { role?: MembershipRole; alreadyMember?: boolean })
      : null) ?? {};
    const actual = json.alreadyMember ? json.role : role;
    const dest = safeNextPath(nextParam, homePathFor(actual ?? role));
    router.push(dest);
    router.refresh();
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
    if (err) {
      setPending(false);
      setError("Email or password is incorrect.");
      return;
    }
    await afterAuth();
  }

  async function onGoogle() {
    setPending(true);
    setError(null);
    rememberIntendedRole(role);
    const dest = safeNextPath(nextParam, homePathFor(role));
    const { error: err } = await signInWithGoogle(dest, role);
    if (err) {
      setPending(false);
      setError("Could not start Google sign-in. Check that Google is enabled in Supabase Auth.");
    }
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">VerifyStack</p>
      <h1 className="mt-1 text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-stone-600">
        Verifier firms only. The role dropdown applies only when you are opening a new firm.
        Invited members keep the role the firm admin assigned.
      </p>
      <LoginNotice
        error={noticeError}
        checkEmail={params.get("check_email") === "1"}
        passwordUpdated={params.get("password_updated") === "1"}
        signedOut={params.get("signed_out") === "1"}
      />
      <div className="mt-6">
        <RoleSelect value={role} onChange={setRole} disabled={pending} />
      </div>
      <div className="mt-4">
        <GoogleButton pending={pending} onClick={onGoogle} />
      </div>
      <AuthDivider />
      <form onSubmit={onPassword} className="space-y-3">
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
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor="password" className="mb-0">
              Password
            </Label>
            <Link href="/forgot-password" className="text-[12px] text-stone-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-[12px] text-stone-500">
        New firm?{" "}
        <Link href="/signup" className="underline">
          Create an account
        </Link>
        {" · "}
        Invited? Open the create-account link your admin sent.
      </p>
    </div>
  );
}
