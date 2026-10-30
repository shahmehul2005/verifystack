import { Users } from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ROLE_LABEL } from "@verifystack/backend/lib/auth/roles";
import { formatIst } from "@/lib/format";
import { TeamRoleSelect } from "./role-select";
import { InviteMemberForm } from "./invite-form";

export const metadata = { title: "Team" };

function initials(nameOrEmail: string): string {
  const base = nameOrEmail.split("@")[0] ?? nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}

export default async function TeamPage() {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "nav.team")) {
    return <ForbiddenState body="Team and role assignment are restricted to the firm admin." />;
  }
  const admin = createServiceClient();
  const supabase = admin ?? (await createServerSupabase());
  const [{ data }, { data: org }] = await Promise.all([
    supabase!
      .from("memberships")
      .select("*")
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: true }),
    supabase!
      .from("organizations")
      .select("name, kind, created_at")
      .eq("id", session.organizationId)
      .maybeSingle(),
  ]);
  const firmOwner = data?.find((m) => m.role === "lead_verifier" || m.role === "firm_admin");
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
        kicker="Firm"
        title="Team"
        description="Add colleagues with a role and send them the create-account link. That link joins this firm; signing up on their own would start a different organisation."
        meta={data?.length ? <Badge>{data.length} {data.length === 1 ? "member" : "members"}</Badge> : undefined}
      />

      <div className="mb-6 rounded-lg border border-mist-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-mist-950">{org?.name ?? "Auditing Firm"}</h2>
              <Badge tone="ok">{org?.kind === "acva" ? "BEE ACVA Accredited" : "Energy Auditor Firm"}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-mist-500">
              Accredited carbon verification agency and authorized auditing entity
            </p>
          </div>
          {firmOwner ? (
            <div className="rounded-md bg-mist-50 px-3 py-1.5 border border-mist-200 text-xs">
              <span className="text-mist-500">Firm Owner / Lead Verifier:</span>{" "}
              <strong className="font-semibold text-mist-900">
                {firmOwner.display_name ?? emailByUser.get(firmOwner.user_id) ?? "Lead Verifier"}
              </strong>
            </div>
          ) : null}
        </div>
      </div>
      {canManage ? <InviteMemberForm /> : null}
      {!data?.length ? (
        <EmptyState icon={Users} title="No members yet" body="Add a lead verifier above." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Added</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => {
              const email = emailByUser.get(m.user_id);
              const label = m.display_name ?? email ?? m.user_id;
              const isYou = m.user_id === session.user.id;
              return (
                <tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800"
                      >
                        {initials(label)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[13px] font-medium text-mist-900">
                          {m.display_name ?? "—"}
                          {isYou ? <Badge tone="ink">You</Badge> : null}
                          {m.id === firmOwner?.id ? <Badge tone="ok">Firm Owner</Badge> : null}
                        </div>
                        <div className="truncate text-xs text-mist-500">
                          {email ?? `${m.user_id.slice(0, 8)}…`}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {canManage ? (
                      <TeamRoleSelect membershipId={m.id} role={m.role} />
                    ) : (
                      <Badge tone="ink">{ROLE_LABEL[m.role]}</Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-mist-500">{formatIst(m.created_at)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
