import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@verifystack/backend/lib/supabase/types";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { ensureWebSocketShim } from "@verifystack/backend/lib/supabase/admin";

/** Checks an account's password against Supabase Auth without setting any session cookie. */
export async function passwordMatches(email: string, password: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  ensureWebSocketShim();
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return !error && Boolean(data.user);
}
