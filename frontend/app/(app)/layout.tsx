import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/session";
import { isPlatformSteward } from "@verifystack/backend/lib/auth/steward";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const session = configured ? await getSession() : null;
  // Proxy no longer calls getUser on app routes; invalid/expired cookies land here.
  if (configured && !session) {
    redirect("/login");
  }
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
      isSteward={isPlatformSteward(session?.user.email)}
    >
      {children}
    </AppShell>
  );
}
