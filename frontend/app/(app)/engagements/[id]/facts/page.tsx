import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { formatIst } from "@/lib/format";
import { SeedDemoFactsButton } from "./seed-demo-button";

export default async function FactsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data: facts } = await supabase!
    .from("facts")
    .select("*")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("accepted_at", { ascending: false });

  return (
    <>
      <PageHeader
        kicker="D4"
        title="Facts ledger"
        description="Accepted facts only. Each row carries document, page, bbox, and source text."
        actions={
          engagement.draft_mode && engagement.pack_id === "CCTS-CEMENT-v1" ? (
            <SeedDemoFactsButton engagementId={id} />
          ) : undefined
        }
      />
      {!facts?.length ? (
        <EmptyState
          title="No committed facts"
          body="Accept fields on the review workbench, or load the Aravalli synthetic set (coal 18,247 t, GCV 4,200 kcal/kg, HT 22,166.64 MWh, production 1,850,000 t) and run calculation."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Value</Th>
              <Th>Source</Th>
              <Th>Page</Th>
              <Th>Accepted</Th>
            </tr>
          </thead>
          <tbody>
            {facts.map((f) => (
              <tr key={f.id}>
                <Td className="font-mono text-[12px]">{f.field_path}</Td>
                <Td>
                  {JSON.stringify(f.value_json)} {f.unit}
                </Td>
                <Td className="max-w-xs truncate text-[12px]">{f.source_text}</Td>
                <Td className="tabular">{f.page}</Td>
                <Td className="text-[12px]">{formatIst(f.accepted_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
