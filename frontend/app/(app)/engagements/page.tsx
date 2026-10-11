import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EngagementsTable } from "./engagements-table";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { listEngagements } from "@verifystack/backend/lib/data/engagements";
import { ENGAGEMENT_STATUSES, STATUS_LABEL } from "@verifystack/backend/domain/engagements/status";
import { formatIst } from "@/lib/format";
import { BootstrapFirm } from "@/components/auth/bootstrap-firm";

export const metadata = { title: "Engagements" };

export default async function EngagementsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <>
        <PageHeader title="Engagements" />
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
        <PageHeader title="Engagements" />
        <EmptyState
          title="You're not part of a firm yet"
          body="You're signed in, but no firm is linked to this account. Create one to start work, or ask your firm admin for an invite."
        />
        <BootstrapFirm />
      </>
    );
  }

  const rows = await listEngagements(session.organizationId);

  return (
    <>
      <PageHeader
        title="Engagements"
        description="Every verification your firm is running. The methodology pack is fixed when an engagement is opened."
        actions={
          hasCapability(session.role, "engagements.create") ? (
            <>
              {hasCapability(session.role, "engagements.import") ? (
                <Link href="/engagements/import" className={buttonVariants({ variant: "secondary" })}>
                  <Upload />
                  Import
                </Link>
              ) : null}
              <Link href="/engagements/new" className={buttonVariants()}>
                <Plus />
                New engagement
              </Link>
            </>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No engagements yet"
          body={
            hasCapability(session.role, "engagements.create")
              ? "Start a CCTS or ADEETIE engagement. All nine CCTS sectors and all fourteen ADEETIE Phase 1 sectors are runnable."
              : "No engagements in this firm yet. A lead verifier opens them."
          }
          action={
            hasCapability(session.role, "engagements.create")
              ? { href: "/engagements/new", label: "New engagement" }
              : undefined
          }
        />
      ) : (
        <EngagementsTable
          statuses={ENGAGEMENT_STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))}
          rows={rows.map((e) => ({
            id: e.id,
            clientName: e.client_name,
            plantName: e.plant_name,
            scheme: e.scheme,
            sector: e.sector_or_cluster,
            year: e.compliance_year,
            packId: e.pack_id,
            status: e.status,
            statusLabel: STATUS_LABEL[e.status],
            opened: formatIst(e.created_at),
          }))}
        />
      )}
    </>
  );
}
