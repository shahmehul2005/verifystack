import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getSession, getEngagement } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadCalendarGridForEngagement } from "@verifystack/backend/lib/data/calendarStore";
import { CalendarMatrix } from "./calendar-matrix";

export const metadata = { title: "Stream Calendar & Facts Ledger" };

export default async function FactsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="The facts ledger is for verifiers and reviewers." />;
  }

  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();

  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) return <ConfigureSupabase />;

  const grid = await loadCalendarGridForEngagement(supabase, id, session.organizationId);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Audit Trail &amp; Evidence Matrix"
        title="Stream Calendar &amp; Facts Ledger"
        description="Every verified reading is locked to its Cement Stream, 12-Month Fiscal Period, and Source Layer. Deterministic annual roll-ups feed calculations with zero duplicate ambiguity."
      />

      <CalendarMatrix initialGrid={grid} engagementId={id} />
    </div>
  );
}
