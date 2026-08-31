import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { formatIst } from "@/lib/format";

export default async function AuditPage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const supabase = await createServerSupabase();
  const { data } = await supabase!
    .from("audit_events")
    .select("*")
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <>
      <PageHeader
        kicker="D7"
        title="Audit log"
        description="Append-only. Inserts go through append_audit_event. No updates or deletes."
      />
      {!data?.length ? (
        <EmptyState title="No events yet" body="Uploads, review decisions, runs, and sign-offs appear here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When (IST)</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Id</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-[12px]">{formatIst(e.created_at)}</Td>
                <Td className="font-mono text-[12px]">{e.action}</Td>
                <Td>{e.entity_type}</Td>
                <Td className="font-mono text-[11px]">{e.entity_id}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
