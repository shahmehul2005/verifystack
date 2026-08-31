import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@verifystack/backend/lib/auth/getSession";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@verifystack/backend/lib/data/engagements";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { canStartWork, loadPack } from "@verifystack/backend/domain/packs";
import { formatIn, formatIst } from "@/lib/format";
import { UploadForm } from "./upload-form";
import { ExtractButton } from "./extract-button";

export default async function DocumentsPage({
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
  const pack = loadPack(engagement.pack_id);
  const supabase = createServiceClient() ?? (await createServerSupabase());
  const { data: docs } = await supabase!
    .from("documents")
    .select("*")
    .eq("engagement_id", id)
    .eq("organization_id", session.organizationId)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        kicker="D2"
        title="Document library"
        description={
          engagement.scheme === "ADEETIE" && engagement.adeetie_phase
            ? `Uploads in this phase are tagged ${engagement.adeetie_phase}. Baseline SEC reads IGEA evidence; post-implementation SEC reads M&V evidence.`
            : "Upload stores the file. Extract splits every PDF page, reads fields with page and bounding-box provenance, then they appear on the workbench."
        }
        actions={
          <UploadForm engagementId={id} disabled={!canStartWork(pack)} />
        }
      />
      {!docs?.length ? (
        <EmptyState
          title="No evidence yet"
          body="Upload a PDF or image. Classification and extraction queue after hash+store."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Type</Th>
              <Th>Pages</Th>
              <Th>Pass</Th>
              <Th>SHA-256</Th>
              <Th>Size</Th>
              <Th>Received</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <Td>{d.original_filename}</Td>
                <Td>
                  <Badge>{d.doc_type ?? "unclassified"}</Badge>
                </Td>
                <Td className="tabular">{d.page_count ?? "—"}</Td>
                <Td>
                  <Badge>{d.adeetie_phase ?? (engagement.scheme === "ADEETIE" ? "untagged" : "—")}</Badge>
                </Td>
                <Td className="font-mono text-[11px]">{d.sha256.slice(0, 16)}…</Td>
                <Td className="tabular">{formatIn(d.byte_size, { maximumFractionDigits: 0 })} B</Td>
                <Td className="text-[12px]">{formatIst(d.created_at)}</Td>
                <Td>
                  <ExtractButton documentId={d.id} engagementId={id} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
