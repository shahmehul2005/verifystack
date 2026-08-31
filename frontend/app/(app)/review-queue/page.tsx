import Link from "next/link";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { QueueActions } from "./queue-actions";

export default async function ReviewQueuePage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data } = await supabase!
    .from("extracted_fields")
    .select("*")
    .eq("organization_id", session.organizationId)
    .eq("state", "suggested")
    .eq("triage_action", "human_review")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader
        kicker="P4 inbox"
        title="Review queue"
        description="Extracted fields that need a human before they become D4 facts: high-materiality (quantity, CV, production, energy) or confidence below 90%. Accept writes the fact; Reject drops it. The engagement workbench is the same decision with the page image and bounding box."
      />
      {!data?.length ? (
        <EmptyState
          title="Queue is clear"
          body="Nothing waiting for a human decision. New extracts land here when a field is high-materiality or low-confidence."
        />
      ) : (
        <ul className="space-y-2">
          {data.map((f) => (
            <li key={f.id} className="border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12px]">{f.field_path}</span>
                <Badge tone="draft">{Math.round(Number(f.confidence) * 100)}%</Badge>
              </div>
              <p className="mt-1 text-sm">
                {JSON.stringify(f.value_json)} {f.unit}
              </p>
              <p className="mt-1 text-[12px] text-stone-500">{f.source_text}</p>
              <QueueActions fieldId={f.id} engagementId={f.engagement_id} />
              <Link
                href={`/engagements/${f.engagement_id}/workbench`}
                className="mt-2 inline-block text-[12px] underline"
              >
                Open workbench (page + bbox)
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
