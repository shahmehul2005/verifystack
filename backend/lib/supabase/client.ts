"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";
import { isSupabaseConfigured } from "./configured";

export function createBrowserSupabase() {
  if (!isSupabaseConfigured()) return null;
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
