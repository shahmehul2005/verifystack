import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const session = configured ? await getSession() : null;
  const orgId = session?.organizationId;
  let orgName: string | null = null;
  if (session && orgId) {
    const membership = session.memberships.find((m) => m.organization_id === orgId);
    orgName = membership?.display_name ?? "Your firm";
  }

  return (
    <AppShell
      orgName={configured ? orgName ?? "Your firm" : "Not configured"}
      role={session?.role}
      userEmail={session?.user.email}
    >
      {children}
    </AppShell>
  );
}
