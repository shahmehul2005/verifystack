import { ConfigureSupabase } from "@/components/states";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { EngagementWizard } from "./wizard";

export default function NewEngagementPage() {
  if (!isSupabaseConfigured()) {
    return <ConfigureSupabase />;
  }
  return <EngagementWizard />;
}
