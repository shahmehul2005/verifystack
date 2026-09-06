"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordIssue } from "@verifystack/backend/lib/auth/redirect";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ConfigureSupabase } from "@/components/states";
import { signInWithGoogle } from "@/components/auth/google";
import { rememberIntendedRole } from "@/components/auth/intended-role";

interface InvitePreview {
  email: string;
  role: MembershipRole;
  roleLabel: string;
  firmName: string;
}

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");
  const supabase = createBrowserSupabase();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteReady, setInviteReady] = useState(!inviteToken);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    void fetch(`/api/invites?token=${encodeURIComponent(inviteToken)}`)
      .then(async (res) => {
        const json = (await res.json()) as InvitePreview & { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error ?? "This invite link is invalid or has expired.");
          setInviteReady(true);
          return;
        }
        setInvite({
          email: json.email,
          role: json.role,
          roleLabel: json.roleLabel,
          firmName: json.firmName,
        });
        setEmail(json.email);
        setInviteReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load this invite.");
          setInviteReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  if (!supabase) return <ConfigureSupabase />;

  async function onGoogle() {
    setPending(true);
    setError(null);
    rememberIntendedRole("firm_admin");
    const { error: err } = await signInWithGoogle(homePathFor("firm_admin"), "firm_admin");
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
    if (inviteToken && !invite) {
      setError("This invite link is invalid or has expired.");
      return;
    }
    setPending(true);
    setError(null);
    const created = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ...(inviteToken ? { inviteToken } : {}),
      }),
    });
    const json = (await created.json()) as {
      ok?: boolean;
      error?: string;
      invited?: boolean;
      role?: MembershipRole;
    };
    if (!created.ok || !json.ok) {
      setPending(false);
      setError(json.error ?? "Could not create the account. Sign in or reset your password.");
      return;
    }

    const { error: signErr } = await supabase!.auth.signInWithPassword({ email, password });
    if (signErr) {
      setPending(false);
      setError("Account was created but sign-in failed. Try signing in with the same password.");
      return;
    }

    if (!json.invited) {
      rememberIntendedRole("firm_admin");
      await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "firm_admin" }),
      }).catch(() => undefined);
      router.push(homePathFor("firm_admin"));
    } else {
      router.push(homePathFor(json.role ?? invite?.role ?? "verifier"));
    }
    router.refresh();
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">VerifyStack</p>
      <h1 className="mt-1 text-lg font-semibold">Create account</h1>
      <p className="mt-1 text-sm text-stone-600">
        {invite
          ? `Join ${invite.firmName} as ${invite.roleLabel}. Your firm admin already chose this role.`
          : "This opens a new firm. You will be the firm admin. Team members join from an invite link, not from this page."}
      </p>
      {error ? (
        <p className="mt-4 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
      ) : null}
      <div className="mt-6" />
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
            readOnly={Boolean(invite)}
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
        <Button type="submit" disabled={pending || !inviteReady} className="w-full">
          {pending ? "Creating…" : invite ? "Join firm" : "Create account"}
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
