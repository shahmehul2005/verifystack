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
import { AuthFooter, AuthHeading, authLinkClass } from "@/components/auth/auth-heading";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

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
  const [newFirm, setNewFirm] = useState(false);

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
      <AuthHeading
        title="Sign in"
        description="Welcome back. Sign in to your firm's verification workspace."
      />
      <LoginNotice
        error={noticeError}
        checkEmail={params.get("check_email") === "1"}
        passwordUpdated={params.get("password_updated") === "1"}
        signedOut={params.get("signed_out") === "1"}
      />
      <div className="mt-7">
        <GoogleButton pending={pending} onClick={onGoogle} />
      </div>
      <AuthDivider />
      <form onSubmit={onPassword} className="space-y-4">
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
          <div className="mb-1.5 flex items-center justify-between">
            <Label htmlFor="password" className="mb-0">
              Password
            </Label>
            <Link href="/forgot-password" className={cn(authLinkClass, "text-[13px]")}>
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
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-6 rounded-lg border border-mist-200">
        <button
          type="button"
          aria-expanded={newFirm}
          aria-controls="new-firm-role"
          onClick={() => setNewFirm((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left text-[13px] font-medium text-mist-800 hover:bg-mist-50"
        >
          Opening a new firm?
          <ChevronDown
            aria-hidden
            className={cn("size-4 text-mist-500 transition-transform", newFirm && "rotate-180")}
          />
        </button>
        {newFirm ? (
          <div id="new-firm-role" className="border-t border-mist-100 px-4 pb-4 pt-3">
            <p className="mb-3 text-xs leading-relaxed text-mist-600">
              Choose your role before you sign in, and only if this sign-in opens a new firm.
              Invited members keep the role their firm admin assigned.
            </p>
            <RoleSelect value={role} onChange={setRole} disabled={pending} />
          </div>
        ) : null}
      </div>

      <AuthFooter>
        New firm?{" "}
        <Link href="/signup" className={authLinkClass}>
          Create an account
        </Link>
        <span className="mt-1 block text-xs">
          Invited by your firm? Open the create-account link your admin sent.
        </span>
      </AuthFooter>
    </div>
  );
}
