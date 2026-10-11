"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExtractButton({
  documentId,
  engagementId,
}: {
  documentId: string;
  engagementId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    const res = await fetch(`/api/documents/${documentId}/extract`, { method: "POST" });
    const json = (await res.json()) as {
      ok?: boolean;
      extracted?: number;
      dropped?: number;
      pages?: number;
      docType?: string;
      error?: string;
    };
    setPending(false);
    if (!json.ok) {
      toast.error(json.error ?? "Extraction failed");
      return;
    }
    if ((json.extracted ?? 0) === 0) {
      toast.message(
        json.docType
          ? `Classified as ${json.docType}. No reviewable fields.`
          : "No fields with provenance were returned."
      );
      return;
    }
    toast.success(
      json.pages && json.pages > 1
        ? `${json.extracted} field(s) from ${json.pages} pages ready for review`
        : `${json.extracted} field(s) ready for review`
    );
    router.push(`/engagements/${engagementId}/workbench`);
  }

  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => void onClick()}>
      {pending ? (
        <span className="size-3.5 animate-spin rounded-full border-2 border-mist-200 border-t-teal-600" />
      ) : (
        <ScanText />
      )}
      {pending ? "Extracting…" : "Extract"}
    </Button>
  );
}
