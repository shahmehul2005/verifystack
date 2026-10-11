"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Package, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ErrorState } from "@/components/states";

interface PackResponse {
  ok?: boolean;
  error?: string;
  problems?: string[];
  imported?: { name: string }[];
  skipped?: { name: string; reason: string }[];
  declared?: number;
}

export function UploadForm({ engagementId, disabled }: { engagementId: string; disabled?: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [packNote, setPackNote] = useState<string | null>(null);

  async function upload(file: File) {
    setPending(true);
    setError(null);
    setProblems([]);
    setPackNote(null);
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
      kind?: "page" | "spreadsheet" | "csv";
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
    // Spreadsheets and CSV files are mapped by a person; only pages are read by extraction.
    if (json.kind && json.kind !== "page") {
      toast.success(
        json.deduped
          ? "Already on file (same bytes)"
          : "Stored. Map its cells or time-series windows into proposed values below."
      );
      window.location.reload();
      return;
    }
    toast.success(json.deduped ? "Already on file (same bytes)" : "Stored. Extracting fields…");
    const documentId = json.document?.id as string | undefined;
    if (documentId) {
      setPending(true);
      const extractRes = await fetch(`/api/documents/${documentId}/extract`, { method: "POST" });
      const extracted = (await extractRes.json().catch(() => ({}))) as {
        ok?: boolean;
        extracted?: number;
        error?: string;
        docType?: string;
      };
      setPending(false);
      if (!extracted.ok) {
        setError(extracted.error ?? "File stored, but extraction failed. Use Extract on the row.");
        toast.error(extracted.error ?? "Extraction failed");
        window.location.reload();
        return;
      }
      if ((extracted.extracted ?? 0) > 0) {
        toast.success(`${extracted.extracted} field(s) ready for review`);
        router.push(`/engagements/${engagementId}/workbench`);
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

  async function importPack(file: File) {
    setPending(true);
    setError(null);
    setProblems([]);
    setPackNote(null);
    const buf = await file.arrayBuffer();
    const res = await fetch("/api/documents/pack", {
      method: "POST",
      headers: { "Content-Type": "application/zip", "x-engagement-id": engagementId },
      body: buf,
    });
    const json = (await res.json().catch(() => ({}))) as PackResponse;
    setPending(false);
    if (packRef.current) packRef.current.value = "";
    if (!res.ok || !json.ok) {
      setError(json.error ?? `Import failed (${res.status})`);
      setProblems(json.problems ?? []);
      toast.error(json.error ?? "Import failed");
      return;
    }
    const skipped = json.skipped ?? [];
    setPackNote(
      `Imported ${json.imported?.length ?? 0} file(s) and ${json.declared ?? 0} declared value(s).` +
        (skipped.length ? ` Skipped ${skipped.length}: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : "")
    );
    toast.success("Evidence pack imported");
    if (skipped.length === 0) window.location.reload();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="application/pdf,image/png,image/jpeg,image/webp,.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={disabled || pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <input
          ref={packRef}
          type="file"
          className="sr-only"
          accept=".zip,application/zip"
          disabled={disabled || pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importPack(file);
          }}
        />
        <Button variant="secondary" disabled={disabled || pending} onClick={() => packRef.current?.click()}>
          <Package />
          Import evidence pack
        </Button>
        <Button disabled={disabled || pending} onClick={() => inputRef.current?.click()}>
          {pending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <Upload />
          )}
          {pending ? "Working…" : "Upload evidence"}
        </Button>
      </div>
      {disabled ? (
        <p className="text-xs text-mist-500">This pack is not runnable yet, so it cannot accept evidence.</p>
      ) : null}
      {packNote ? (
        <div className="max-w-md">
          <Alert tone="ok" title="Evidence pack">{packNote}</Alert>
        </div>
      ) : null}
      {error ? (
        <div className="max-w-md">
          <ErrorState title="Upload failed" body={error} />
          {problems.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-mist-600">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
