import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { EngagementWizard } from "./wizard";

export const metadata = { title: "New engagement" };

export default async function NewEngagementPage() {
  if (!isSupabaseConfigured()) {
    return <ConfigureSupabase />;
  }
  const session = await getSession();
  if (!hasCapability(session?.role, "engagements.create")) {
    return <ForbiddenState body="Opening an engagement is restricted to the lead verifier." />;
  }
  return <EngagementWizard />;
}
