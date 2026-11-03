import { ScrollText } from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { CopyText } from "@/components/ui/copy-text";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { formatIst, humanize } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "nav.audit")) {
    return <ForbiddenState body="The audit log is restricted to the firm admin." />;
  }
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
        kicker="Firm"
        title="Audit log"
        description="Every upload, review decision, run and sign-off, in order. The log is append-only: entries cannot be edited or deleted."
        meta={
          data?.length ? (
            <span className="text-xs text-mist-500">
              Latest {data.length} {data.length === 1 ? "event" : "events"}, times in IST
            </span>
          ) : undefined
        }
      />
      {!data?.length ? (
        <EmptyState
          icon={ScrollText}
          title="No events yet"
          body="Uploads, review decisions, runs and sign-offs appear here."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Action</Th>
              <Th>Record</Th>
              <Th>Record id</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-[13px] tabular text-mist-700">{formatIst(e.created_at)}</Td>
                <Td>
                  <span className="font-mono text-xs font-medium text-mist-900">{e.action}</span>
                </Td>
                <Td>
                  <Badge>{humanize(e.entity_type)}</Badge>
                </Td>
                <Td>{e.entity_id ? <CopyText value={e.entity_id} visible={8} /> : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
