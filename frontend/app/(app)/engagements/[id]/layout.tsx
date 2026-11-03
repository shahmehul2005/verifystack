import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EngagementNav } from "@/components/shell/engagement-nav";
import { getSession } from "@/lib/session";
import { engagementLinksForRole } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@/lib/session";

export default async function EngagementLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) return children;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return children;
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) return children;

  return (
    <>
      <div className="mb-4">
        <Breadcrumbs
          items={[
            { label: "Engagements", href: "/engagements" },
            { label: engagement.client_name },
          ]}
        />
      </div>
      <EngagementNav
        engagementId={id}
        links={engagementLinksForRole(session.role).map(({ slug, label }) => ({ slug, label }))}
      />
      {children}
    </>
  );
}
