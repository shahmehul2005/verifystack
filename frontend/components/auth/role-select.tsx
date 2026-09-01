"use client";

import { MEMBERSHIP_ROLES, ROLE_BLURB, ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { Label } from "@/components/ui/input";

export function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: MembershipRole;
  onChange: (role: MembershipRole) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor="role">Role</Label>
      <select
        id="role"
        className="h-9 w-full border border-stone-300 bg-white px-3 text-sm text-stone-900 focus:border-stone-900 focus:outline-none"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as MembershipRole)}
        required
      >
        {MEMBERSHIP_ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABEL[role]}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[12px] leading-snug text-stone-600">{ROLE_BLURB[value]}</p>
    </div>
  );
}
