import { inngest } from "../client";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { loadPack } from "@verifystack/backend/domain/packs";
import { chooseRoute } from "@verifystack/backend/domain/extraction/digital";
import { documentPageInserts } from "@verifystack/backend/domain/extraction/pages";
import { isGeminiConfigured } from "@verifystack/backend/lib/supabase/configured";

type Uploaded = {
  organizationId: string;
  engagementId: string;
  documentId: string;
  sha256: string;
  mimeType: string;
  packId: string;
};

export const intakeDocument = inngest.createFunction(
  { id: "documents-intake", triggers: [{ event: "documents/uploaded" }] },
  async ({ event, step }) => {
    const data = event.data as Uploaded;
    const admin = createServiceClient();
    if (!admin) {
      return { ok: false, error: "Supabase service role is not configured" };
    }

    const pageCount = await step.run("split-pages", async () => {
      const { data: doc } = await admin
        .from("documents")
        .select("*")
        .eq("id", data.documentId)
        .single();
      if (!doc) return 1;

      const pages = Math.max(1, doc.page_count ?? 1);
      await admin.from("document_pages").upsert(
        documentPageInserts(data.organizationId, data.documentId, pages, doc.storage_path),
        { onConflict: "document_id,page_number" }
      );
      await admin
        .from("documents")
        .update({ page_count: pages })
        .eq("id", data.documentId);
      return pages;
    });

    const jobId = await step.run("enqueue-extract", async () => {
      const mime = data.mimeType;
      const route = chooseRoute(mime === "application/pdf" ? 0 : 0, mime);
      const { data: job, error } = await admin
        .from("extraction_jobs")
        .insert({
          organization_id: data.organizationId,
          document_id: data.documentId,
          status: "queued",
          route,
        })
        .select("id")
        .single();
      if (error || !job) throw new Error(error?.message ?? "job insert failed");
      return job.id;
    });

    await step.sendEvent("kick-extract", {
      name: "documents/extract",
      data: { ...data, jobId, pageCount, gemini: isGeminiConfigured() },
    });

    return { ok: true, pageCount, jobId, pack: loadPack(data.packId).pack_id };
  }
);
