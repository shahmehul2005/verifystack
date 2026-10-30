import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/session";
import { isPlatformSteward } from "@verifystack/backend/lib/auth/steward";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const session = configured ? await getSession() : null;
  // Proxy no longer calls getUser on app routes; invalid/expired cookies land here.
  if (configured && !session) {
    redirect("/login");
  }
  const orgId = session?.organizationId;
  let orgName: string | null = null;
  let orgKind: "acva" | "energy_auditor_firm" | null = null;
  let firmOwnerName: string | null = null;

  if (session && orgId) {
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (supabase) {
      const [{ data: org }, { data: ownerMember }] = await Promise.all([
        supabase.from("organizations").select("name, kind").eq("id", orgId).maybeSingle(),
        supabase
          .from("memberships")
          .select("display_name, role")
          .eq("organization_id", orgId)
          .in("role", ["lead_verifier", "firm_admin"])
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      orgName = org?.name ?? null;
      orgKind = (org?.kind as "acva" | "energy_auditor_firm") ?? null;
      firmOwnerName = ownerMember?.display_name ?? null;
    }
  }

  return (
    <AppShell
      orgName={configured ? orgName ?? "Your firm" : "Not configured"}
      orgKind={orgKind}
      firmOwnerName={firmOwnerName}
      role={session?.role}
      userEmail={session?.user.email}
      isSteward={isPlatformSteward(session?.user.email)}
    >
      {children}
    </AppShell>
  );
}
