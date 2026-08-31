import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { ReviewWorkbench, type ReviewField } from "./review-workbench";
import type { Json } from "@verifystack/backend/lib/supabase/types";

function asBBox(raw: Json) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const o = raw as Record<string, unknown>;
  return {
    x: Number(o.x ?? 0),
    y: Number(o.y ?? 0),
    width: Number(o.width ?? 0),
    height: Number(o.height ?? 0),
  };
}

export default async function AppWorkbenchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [{ data: fields }, { data: docs }] = await Promise.all([
    supabase!
      .from("extracted_fields")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .in("state", ["suggested", "corrected"]),
    supabase!
      .from("documents")
      .select("id, storage_path, mime_type")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId),
  ]);

  const docById = new Map((docs ?? []).map((d) => [d.id, d]));

  const mapped: ReviewField[] = (fields ?? []).map((f) => {
    const doc = docById.get(f.document_id);
    return {
      id: f.id,
      field_path: f.field_path,
      value_json: f.value_json,
      unit: f.unit,
      confidence: Number(f.confidence),
      page: f.page,
      bbox: asBBox(f.bbox),
      source_text: f.source_text,
      state: f.state,
      triage_action: f.triage_action,
      document_id: f.document_id,
      fileUrl: doc?.storage_path ? `/api/documents/${f.document_id}/file` : null,
      mimeType: doc?.mime_type ?? null,
    };
  });

  return (
    <>
      <PageHeader
        kicker="P4"
        title="Verification workbench"
        description="Accept, reject, or correct. Only accepted fields become D4 facts."
      />
      {mapped.length === 0 ? (
        <EmptyState
          title="Nothing in review"
          body={
            (docs ?? []).length > 0
              ? "A file is stored, but no fields have been extracted yet. Open Documents and click Extract on the row. That splits every PDF page, reads it with Gemini, and writes suggested facts with bounding boxes."
              : "Upload a PDF or image on Documents, wait for extract, then return here to accept or reject each field."
          }
          action={{
            href: `/engagements/${id}/documents`,
            label: (docs ?? []).length > 0 ? "Extract on Documents" : "Upload evidence",
          }}
        />
      ) : (
        <ReviewWorkbench engagementId={id} fields={mapped} />
      )}
    </>
  );
}
