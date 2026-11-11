import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getSession, getEngagement } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadCalendarGridForEngagement } from "@verifystack/backend/lib/data/calendarStore";
import { CalendarDeskReview } from "./calendar-desk-review";

export const metadata = { title: "Desk Review & Pro Forma Cross-Checks" };

export default async function DeskReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="Desk review is for verifiers and the lead verifier." />;
  }

  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();

  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) return <ConfigureSupabase />;

  const [grid, { data: docRows }] = await Promise.all([
    loadCalendarGridForEngagement(supabase, id, session.organizationId),
    supabase
      .from("documents")
      .select("id, original_filename, slot, mime_type")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: true }),
  ]);

  const documents = (docRows ?? []).map((d) => ({
    id: d.id,
    name: d.original_filename,
    slot: d.slot,
    mimeType: d.mime_type,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Audit Verification &amp; Reconciliations"
        title="Desk Review &amp; Pro Forma Cross-Checks"
        description="Comprehensive cross-checks between declared sector pro-forma inputs and 12-month primary evidence. Completeness checks, variance thresholds (≤5%), and annual roll-up reconciliations."
      />

      <CalendarDeskReview grid={grid} engagementId={id} documents={documents} />
    </div>
  );
}
