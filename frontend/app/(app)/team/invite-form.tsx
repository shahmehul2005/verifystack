"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MEMBERSHIP_ROLES, ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

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
      className="mb-6 border border-stone-200 bg-white p-4"
    >
      <h2 className="text-sm font-semibold">Add to this firm</h2>
      <p className="mt-1 text-[12px] text-stone-600">
        Choose their role, then send them the create-account link. They join{" "}
        <span className="font-medium">this</span> firm. Do not tell them to open Create account on
        their own — that would start a separate firm.
      </p>
      {error ? (
        <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>
      ) : null}
      {info ? (
        <p className="mt-3 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800">{info}</p>
      ) : null}
      {inviteUrl ? (
        <div className="mt-2 flex items-start gap-2">
          <p className="min-w-0 flex-1 break-all font-mono text-[11px] text-stone-600">{inviteUrl}</p>
          <Button type="button" variant="secondary" size="sm" onClick={copyInviteUrl}>
            {copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy"}
          </Button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <select
            id="invite-role"
            className="h-9 w-full border border-stone-300 bg-white px-3 text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
          >
            {MEMBERSHIP_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Adding…" : "Add member"}
          </Button>
        </div>
      </div>
    </form>
  );
}
