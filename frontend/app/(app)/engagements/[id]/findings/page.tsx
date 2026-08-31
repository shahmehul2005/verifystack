import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { FindingActions } from "./finding-actions";

export default async function FindingsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data: findings } = await supabase!
    .from("findings")
    .select("*")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        kicker="P6"
        title="Findings"
        description="Rules produce findings. Accept CAR means the finding stands (a block still gates sign-off). Close or Reject is what clears the gate."
      />
      {!findings?.length ? (
        <EmptyState title="No findings" body="Run a calculation to populate the findings store." />
      ) : (
        <ul className="space-y-3">
          {findings.map((f) => (
            <li key={f.id} className="border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={f.severity === "block" ? "block" : "draft"}>{f.severity}</Badge>
                <Badge>{f.state}</Badge>
                <span className="font-mono text-[11px] text-stone-500">{f.rule_id}</span>
              </div>
              <h2 className="mt-2 text-sm font-semibold">{f.heading ?? f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-stone-700">{f.body ?? f.detail}</p>
              <p className="mt-2 text-[11px] text-stone-500">{f.clause_ref}</p>
              <FindingActions findingId={f.id} engagementId={id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
