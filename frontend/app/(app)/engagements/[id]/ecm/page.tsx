import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { EcmSuggestions } from "@/components/ecm/suggestions";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { suggestEcmsForEngagement } from "@verifystack/backend/lib/data/ecm";

export const metadata = { title: "ECM suggestions" };

export default async function EcmPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "adeetie.view")) {
    return <ForbiddenState body="ECM suggestions are for verifiers and reviewers." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const payload = await suggestEcmsForEngagement(id, session.organizationId, { style: true });
  if (!payload) notFound();

  return (
    <>
      <PageHeader
        kicker={`${engagement.scheme} · ${engagement.sector_or_cluster}`}
        title="Energy conservation measures"
        description="Measures from the curated library that match this facility's equipment and its calculated intensity gap."
      />
      <EcmSuggestions payload={payload} />
    </>
  );
}
