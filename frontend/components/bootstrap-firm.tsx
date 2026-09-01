"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { homePathFor } from "@verifystack/backend/lib/auth/capabilities";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorState } from "@/components/states";
import { RoleSelect } from "@/components/auth/role-select";
import { readIntendedRole, takeIntendedRole } from "@/components/auth/intended-role";

const NO_STORE_CHANGES = () => () => {};

/**
 * The role chosen on the login or signup screen, parked in sessionStorage
 * across the OAuth round trip.
 *
 * Read through `useSyncExternalStore` rather than in an effect: sessionStorage
 * is unreadable while rendering on the server, so the server snapshot is null
 * and React re-reads after hydration without a cascading render.
 */
function useIntendedRole(): MembershipRole | null {
  return useSyncExternalStore(
    NO_STORE_CHANGES,
    readIntendedRole,
    () => null
  );
}

export function BootstrapFirm() {
  const router = useRouter();
  const [firmName, setFirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const intendedRole = useIntendedRole();
  const [chosenRole, setChosenRole] = useState<MembershipRole | null>(null);
  const role = chosenRole ?? intendedRole ?? "lead_verifier";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    takeIntendedRole();
    const res = await fetch("/api/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firmName: firmName.trim() || undefined, role }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not create the firm.");
      return;
    }
    router.refresh();
    window.location.assign(homePathFor(role));
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-6 max-w-sm space-y-3 text-left">
      {error ? <ErrorState body={error} /> : null}
      <div>
        <Label htmlFor="firm">Firm name</Label>
        <Input
          id="firm"
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          placeholder="e.g. Aravalli Verification LLP"
        />
      </div>
      <RoleSelect value={role} onChange={setChosenRole} disabled={pending} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating…" : "Create my firm"}
      </Button>
    </form>
  );
}
