"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@verifystack/backend/lib/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordIssue } from "@verifystack/backend/lib/auth/redirect";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { MailCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { AuthFooter, AuthHeading, authLinkClass } from "@/components/auth/auth-heading";
import { cn } from "@/lib/cn";
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
  const [emailSent, setEmailSent] = useState(false);

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

  // Self-serve signup: show confirmation-email sent screen.
  if (emailSent) {
    return (
      <div>
        <span className="flex size-11 items-center justify-center rounded-full bg-teal-50 text-teal-700">
          <MailCheck className="size-5" />
        </span>
        <div className="mt-5">
          <AuthHeading
            title="Check your email"
            description={
              <>
                We sent a confirmation link to{" "}
                <span className="font-medium text-mist-900">{email}</span>. Open that email and
                click the link to verify your address and activate your account.
              </>
            }
          />
        </div>
        <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "mt-7 w-full")}>
          Go to sign in
        </Link>
        <p className="mt-6 text-[13px] text-mist-500">
          Didn&apos;t receive it? Check your spam folder, or{" "}
          <button
            type="button"
            className={authLinkClass}
            onClick={() => {
              setEmailSent(false);
              setError(null);
            }}
          >
            try again
          </button>
          .
        </p>
      </div>
    );
  }

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
      requiresEmailConfirmation?: boolean;
      role?: MembershipRole;
    };
    if (!created.ok || !json.ok) {
      setPending(false);
      setError(json.error ?? "Could not create the account. Sign in or reset your password.");
      return;
    }

    // Self-serve signup: user is unconfirmed. Show "check your inbox" instead
    // of attempting signInWithPassword (which would fail on an unconfirmed account).
    if (json.requiresEmailConfirmation) {
      setPending(false);
      setEmailSent(true);
      return;
    }

    // Invite path: user is pre-confirmed — sign in immediately.
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
      <AuthHeading
        title={invite ? `Join ${invite.firmName}` : "Create your firm's account"}
        description={
          invite
            ? `You're joining as ${invite.roleLabel}. Your firm admin chose this role.`
            : "This opens a new firm with you as its admin. Colleagues join later from an invite link, not from this page."
        }
      />
      {error ? (
        <Alert tone="error" className="mt-5">
          {error}
        </Alert>
      ) : null}
      <div className="mt-7" />
      <form onSubmit={onSubmit} className="space-y-4">
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
        <Button type="submit" size="lg" disabled={pending || !inviteReady} className="w-full">
          {pending ? "Creating…" : invite ? "Join firm" : "Create account"}
        </Button>
      </form>
      <AuthFooter>
        Already have an account?{" "}
        <Link href="/login" className={authLinkClass}>
          Sign in
        </Link>
      </AuthFooter>
    </div>
  );
}
