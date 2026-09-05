import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import { TeamRoleSelect } from "./role-select";
import { InviteMemberForm } from "./invite-form";

export default async function TeamPage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "nav.team")) {
    return <ForbiddenState body="Team and role assignment are restricted to the firm admin." />;
  }
  const admin = createServiceClient();
  const supabase = admin ?? (await createServerSupabase());
  const { data } = await supabase!
    .from("memberships")
    .select("*")
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: true });
  const canManage = hasCapability(session.role, "team.manage");

  const emailByUser = new Map<string, string>();
  if (admin && data?.length) {
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of listed?.users ?? []) {
      if (u.email) emailByUser.set(u.id, u.email);
    }
  }

  return (
    <>
      <PageHeader
        kicker="Access"
        title="Team / roles"
        description="Add colleagues with a role and send them the create-account link. That link joins this firm. Opening Create account on their own would start a different organisation."
      />
      {canManage ? <InviteMemberForm /> : null}
      {!data?.length ? (
        <EmptyState title="No members" body="Add a lead verifier above." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <Td>{m.display_name ?? "—"}</Td>
                <Td className="text-[12px]">{emailByUser.get(m.user_id) ?? `${m.user_id.slice(0, 8)}…`}</Td>
                <Td>
                  {canManage ? (
                    <TeamRoleSelect membershipId={m.id} role={m.role} />
                  ) : (
                    <Badge tone="ink">{ROLE_LABEL[m.role]}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
