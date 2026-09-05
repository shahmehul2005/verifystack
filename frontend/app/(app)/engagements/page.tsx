import Link from "next/link";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { listEngagements } from "@verifystack/backend/lib/data/engagements";
import { STATUS_LABEL } from "@verifystack/backend/domain/engagements/status";
import { formatIst } from "@/lib/format";
import { BootstrapFirm } from "@/components/bootstrap-firm";

export default async function EngagementsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader kicker="D1" title="Engagements" />
        <ConfigureSupabase />
      </>
    );
  }

  const session = await getSession();
  if (!session) {
    return <ForbiddenState body="Sign in to view engagements." />;
  }
  if (!session.organizationId) {
    return (
      <>
        <PageHeader kicker="D1" title="Engagements" />
        <EmptyState
          title="No organisation yet"
          body="You are signed in but not attached to a firm. Create one to start work."
        />
        <BootstrapFirm />
      </>
    );
  }

  const rows = await listEngagements(session.organizationId);

  return (
    <>
      <PageHeader
        kicker="D1"
        title="Engagements"
        description="Pack is bound at creation and cannot be changed."
        actions={
          hasCapability(session.role, "engagements.create") ? (
            <Link href="/engagements/new">
              <Button>New engagement</Button>
            </Link>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No engagements yet"
          body={
            hasCapability(session.role, "engagements.create")
              ? "Start a CCTS or ADEETIE engagement. All nine CCTS sectors and all fourteen ADEETIE Phase 1 sectors are runnable."
              : "No engagements in this firm yet. A lead verifier opens them (P1)."
          }
          action={
            hasCapability(session.role, "engagements.create")
              ? { href: "/engagements/new", label: "New engagement" }
              : undefined
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Client / plant</Th>
              <Th>Year</Th>
              <Th>Pack</Th>
              <Th>Status</Th>
              <Th>Opened</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <Td>
                  <Link href={`/engagements/${e.id}`} className="font-medium hover:underline">
                    {e.client_name}
                  </Link>
                  <div className="text-[12px] text-stone-500">{e.plant_name}</div>
                </Td>
                <Td className="tabular">{e.compliance_year}</Td>
                <Td>
                  <span className="font-mono text-[12px]">{e.pack_id}</span>
                </Td>
                <Td>
                  <Badge>{STATUS_LABEL[e.status]}</Badge>
                </Td>
                <Td className="text-[12px] text-stone-500">{formatIst(e.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
