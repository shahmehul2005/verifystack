/**
 * Whether the request carries a Supabase Auth session cookie.
 *
 * Cookie names look like `sb-<ref>-auth-token` or chunked
 * `sb-<ref>-auth-token.0`. Used only to skip a network `getUser()` when the
 * visitor is clearly anonymous — signed-in traffic still validates as before.
 */
export function hasSupabaseAuthCookie(cookies: readonly { name: string }[]): boolean {
  return cookies.some((c) => c.name.includes("auth-token"));
}
