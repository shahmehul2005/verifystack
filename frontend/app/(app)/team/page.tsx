import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";

export default async function TeamPage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data } = await supabase!
    .from("memberships")
    .select("*")
    .eq("organization_id", session.organizationId);

  return (
    <>
      <PageHeader
        kicker="Access"
        title="Team / roles"
        description="firm_admin, lead_verifier, verifier, independent_reviewer. Maker-checker requires a distinct independent reviewer."
      />
      {!data?.length ? (
        <EmptyState title="No members" body="Invite colleagues from your Supabase Auth project." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>User</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <Td>{m.display_name ?? "—"}</Td>
                <Td className="font-mono text-[12px]">{m.user_id.slice(0, 8)}…</Td>
                <Td>
                  <Badge tone="ink">{ROLE_LABEL[m.role]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
