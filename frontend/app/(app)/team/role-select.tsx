"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MEMBERSHIP_ROLES, ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

export function TeamRoleSelect({
  membershipId,
  role,
}: {
  membershipId: string;
  role: MembershipRole;
}) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: MembershipRole) {
    setPending(true);
    setError(null);
    const res = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId, role: next }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    setPending(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not change role.");
      setValue(role);
      return;
    }
    setValue(next);
    router.refresh();
  }

  return (
    <div>
      <select
        className="h-8 border border-stone-300 bg-white px-2 text-[12px]"
        value={value}
        disabled={pending}
        onChange={(e) => void onChange(e.target.value as MembershipRole)}
      >
        {MEMBERSHIP_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-[11px] text-red-800">{error}</p> : null}
    </div>
  );
}
