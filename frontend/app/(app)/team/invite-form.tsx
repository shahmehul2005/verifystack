"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MEMBERSHIP_ROLES, ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Check, Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input, Label, Select } from "@/components/ui/input";

export function InviteMemberForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<MembershipRole>("lead_verifier");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    setInviteUrl(null);
    setCopyState("idle");
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        role,
        displayName: displayName.trim() || undefined,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      emailed?: boolean;
      created?: boolean;
      alreadyMember?: boolean;
      inviteUrl?: string | null;
    };
    setPending(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not add that person.");
      return;
    }
    setEmail("");
    setDisplayName("");
    const message = json.alreadyMember
      ? `They already have an account on this firm as ${ROLE_LABEL[role]}.`
      : `Invite created for ${ROLE_LABEL[role]}.`;
    setInfo(
      `${message} ${
        json.emailed
          ? "We also sent this link by email."
          : "Email delivery is unavailable right now, so copy the link below and send it manually."
      }`
    );
    setInviteUrl(json.inviteUrl ?? null);
    router.refresh();
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mb-6 rounded-lg border border-mist-200 bg-white p-5 shadow-xs"
    >
      <h2 className="text-[15px] font-semibold text-mist-900">Add someone to this firm</h2>
      <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-mist-600">
        Choose their role, then send them the create-account link so they join{" "}
        <span className="font-medium text-mist-800">this</span> firm. If they sign up on their own,
        they start a separate firm instead.
      </p>
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {info ? (
        <Alert tone="ok" className="mt-4">
          {info}
        </Alert>
      ) : null}
      {inviteUrl ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-mist-200 bg-mist-50 px-3 py-2">
          <p className="min-w-0 flex-1 break-all font-mono text-xs text-mist-700">{inviteUrl}</p>
          <Button type="button" variant="secondary" size="sm" onClick={copyInviteUrl}>
            {copyState === "copied" ? <Check /> : <Copy />}
            {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy link"}
          </Button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="invite-name">Display name</Label>
          <Input
            id="invite-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label htmlFor="invite-role">Role</Label>
          <Select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
          >
            {MEMBERSHIP_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            <UserPlus />
            {pending ? "Adding…" : "Add member"}
          </Button>
        </div>
      </div>
    </form>
  );
}
