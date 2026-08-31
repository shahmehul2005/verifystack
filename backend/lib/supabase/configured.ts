/** True when public Supabase env is present. App still boots if false. */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  if (url.includes("YOUR-PROJECT")) return false;
  if (anon === "your-anon-key") return false;
  return true;
}

export function isServiceRoleConfigured(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE;
  return Boolean(key && key !== "your-service-role-key");
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY);
}

export function requireSupabasePublicEnv(): {
  url: string;
  anonKey: string;
} {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };
}
