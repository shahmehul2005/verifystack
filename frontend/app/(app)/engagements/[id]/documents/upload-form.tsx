"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";

export function UploadForm({ engagementId, disabled }: { engagementId: string; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setPending(true);
    setError(null);
    const buf = await file.arrayBuffer();
    const res = await fetch("/api/documents", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-filename": encodeURIComponent(file.name),
        "x-engagement-id": engagementId,
      },
      body: buf,
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      deduped?: boolean;
      document?: { id: string };
    };
    setPending(false);
    if (inputRef.current) inputRef.current.value = "";
    if (!res.ok || !json.ok) {
      const message = json.error ?? `Upload failed (${res.status})`;
      setError(message);
      toast.error(message);
      return;
    }
    toast.success(json.deduped ? "Already on file (same bytes)" : "Stored. Extracting fields…");
    const documentId = json.document?.id as string | undefined;
    if (documentId) {
      const extractRes = await fetch(`/api/documents/${documentId}/extract`, { method: "POST" });
      const extracted = (await extractRes.json()) as {
        ok?: boolean;
        extracted?: number;
        error?: string;
        docType?: string;
      };
      if (!extracted.ok) {
        setError(extracted.error ?? "File stored, but extraction failed. Use Extract on the row.");
        toast.error(extracted.error ?? "Extraction failed");
        window.location.reload();
        return;
      }
      if ((extracted.extracted ?? 0) > 0) {
        toast.success(`${extracted.extracted} field(s) ready for review`);
        window.location.assign(`/engagements/${engagementId}/workbench`);
        return;
      }
      toast.message(
        extracted.docType
          ? `Classified as ${extracted.docType}. No reviewable fields.`
          : "Stored, but no provenanced fields were returned."
      );
    }
    window.location.reload();
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        disabled={disabled || pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        disabled={disabled || pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? "Uploading and extracting…" : "Upload evidence"}
      </Button>
      {disabled ? (
        <p className="text-[12px] text-stone-500">Scaffold packs cannot accept evidence.</p>
      ) : null}
      {error ? <ErrorState title="Upload failed" body={error} /> : null}
    </div>
  );
}
