"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MEMBERSHIP_ROLES, ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Select } from "@/components/ui/input";

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
      <Select
        aria-label="Role"
        className="h-8 w-auto min-w-44 text-[13px]"
        value={value}
        disabled={pending}
        onChange={(e) => void onChange(e.target.value as MembershipRole)}
      >
        {MEMBERSHIP_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
