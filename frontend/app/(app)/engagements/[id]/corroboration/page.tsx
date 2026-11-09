import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getSession, getEngagement } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { registryForPack } from "@verifystack/backend/domain/registry";
import { CorroborationDrawer } from "./corroboration-drawer";

export const metadata = { title: "Corroboration drawer" };

export default async function CorroborationPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="The corroboration drawer is for verifiers and the lead verifier." />;
  }

  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();

  const registry = registryForPack(engagement.pack_id);

  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) return <ConfigureSupabase />;

  const { data: cevRows, error } = await supabase
    .from("canonical_evidence_values")
    .select("*")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Fetch source document names to show in the UI
  const docIds = [...new Set((cevRows ?? []).map((r) => r.document_id).filter(Boolean) as string[])];
  const docNames: Record<string, string> = {};
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, original_filename")
      .in("id", docIds);
    for (const d of docs ?? []) docNames[d.id] = d.original_filename;
  }

  // Build a label map from the registry (key → meaning)
  const labels: Record<string, string> = {};
  if (registry) {
    for (const entry of registry.entries) {
      labels[entry.key] = entry.meaning;
    }
  }

  // Group by canonical_key
  const groups: Record<string, (typeof cevRows)[number][]> = {};
  for (const row of cevRows ?? []) {
    const k = row.canonical_key as string;
    if (!groups[k]) groups[k] = [];
    groups[k]!.push(row);
  }

  return (
    <>
      <PageHeader
        kicker="Verification"
        title="Corroboration drawer"
        description="Canonical evidence values extracted from documents, proposed from desk-review readings, or entered manually. Each must be accepted by an auditor before it feeds desk-review checks."
      />
      <CorroborationDrawer
        engagementId={id}
        groups={groups as Record<string, Record<string, unknown>[]>}
        docNames={docNames}
        labels={labels}
      />
    </>
  );
}

