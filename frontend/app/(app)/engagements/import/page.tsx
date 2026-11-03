import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { MAX_IMPORT_ROWS } from "@verifystack/backend/domain/engagements/bulkImport";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import engagements" };

export default async function ImportEngagementsPage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!hasCapability(session?.role, "engagements.import")) {
    return <ForbiddenState body="Opening engagements is restricted to the lead verifier." />;
  }
  return (
    <>
      <PageHeader
        title="Import engagements"
        description={`Bring a portfolio in from a spreadsheet instead of opening engagements one by one. Up to ${MAX_IMPORT_ROWS} rows at a time. Each row is checked exactly as the setup wizard checks it, and nothing is created until you confirm.`}
      />
      <ImportClient />
    </>
  );
}
