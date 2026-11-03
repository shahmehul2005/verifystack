import type { User } from "@supabase/supabase-js";

/** The name a person is recorded under: profile name, else email. Never empty. */
export function displayNameOf(user: Pick<User, "email" | "user_metadata">): string {
  const meta = user.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    user.email ||
    "Unnamed user";
  return name.slice(0, 200);
}
