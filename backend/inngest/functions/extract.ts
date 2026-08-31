import { inngest } from "../client";
import { runDocumentExtraction } from "@verifystack/backend/domain/extraction/runDocument";

type ExtractEvent = {
  organizationId: string;
  engagementId: string;
  documentId: string;
  packId: string;
};

export const extractDocument = inngest.createFunction(
  { id: "documents-extract", triggers: [{ event: "documents/extract" }] },
  async ({ event }) => {
    const data = event.data as ExtractEvent;
    return runDocumentExtraction({
      organizationId: data.organizationId,
      engagementId: data.engagementId,
      documentId: data.documentId,
      packId: data.packId,
    });
  }
);
