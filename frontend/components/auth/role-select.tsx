"use client";

import { MEMBERSHIP_ROLES, ROLE_BLURB, ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";
import { FieldHint, Label, Select } from "@/components/ui/input";

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
      <Label htmlFor="role">Your role in the new firm</Label>
      <Select
        id="role"
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
      </Select>
      <FieldHint>{ROLE_BLURB[value]}</FieldHint>
    </div>
  );
}
