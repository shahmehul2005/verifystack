import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { isServiceRoleConfigured, isSupabaseConfigured } from "./configured";

/** Tenant data after the caller is authenticated. Bypasses the RLS deadlock. */
export function createDataClient() {
  return createServiceClient();
}

/** Server-only. Never import from a Client Component. */
export function createServiceClient() {
  if (!isSupabaseConfigured() || !isServiceRoleConfigured()) return null;
  // Node 20 has no native WebSocket; the admin client never uses Realtime.
  if (typeof globalThis.WebSocket === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = class {
      close() {}
      send() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
