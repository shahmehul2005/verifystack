"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Package, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ErrorState } from "@/components/states";
import { useSoftReload } from "@/lib/soft-reload";

interface PackResponse {
  ok?: boolean;
  error?: string;
  problems?: string[];
  imported?: { name: string }[];
  skipped?: { name: string; reason: string }[];
  declared?: number;
  warnings?: string[];
  mismatches?: { name: string; expected: string; actual: string }[];
}

interface StoreResult {
  name: string;
  ok: boolean;
  error?: string;
  deduped?: boolean;
}

/**
 * Upload stores files and nothing else. No file is read, extracted or mapped
 * here. Reading a PDF is the Extract button on its row; a spreadsheet is mapped
 * cell by cell below its row, or its totals are reviewed. Several files can be
 * chosen at once and are stored one after another.
 */
export function UploadForm({ engagementId, disabled }: { engagementId: string; disabled?: boolean }) {
  const { softReload, isRefreshing } = useSoftReload();
  const inputRef = useRef<HTMLInputElement>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function storeOne(file: File): Promise<StoreResult> {
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
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; deduped?: boolean };
    if (!res.ok || !json.ok) {
      return { name: file.name, ok: false, error: json.error ?? `Upload failed (${res.status})` };
    }
    return { name: file.name, ok: true, deduped: json.deduped };
  }

  async function uploadMany(files: File[]) {
    setPending(true);
    setError(null);
    setProblems([]);
    setNote(null);
    const results: StoreResult[] = [];
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length });
      results.push(await storeOne(files[i]!));
    }
    setProgress(null);
    setPending(false);
    if (inputRef.current) inputRef.current.value = "";

    const stored = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    if (stored.length > 0) {
      const again = stored.filter((r) => r.deduped).length;
      setNote(
        `${stored.length} file${stored.length === 1 ? "" : "s"} stored${again ? ` (${again} already on file)` : ""}. Nothing has been read yet: extract a PDF from its row, or map a spreadsheet's cells below it.`
      );
    }
    if (failed.length > 0) {
      setError(`${failed.length} of ${results.length} file${results.length === 1 ? "" : "s"} could not be stored.`);
      setProblems(failed.map((f) => `${f.name}: ${f.error}`));
      toast.error(`${failed.length} file${failed.length === 1 ? "" : "s"} not stored`);
    } else {
      toast.success(`${stored.length} file${stored.length === 1 ? "" : "s"} stored`);
    }
    softReload();
  }

  async function importPack(file: File) {
    setPending(true);
    setError(null);
    setProblems([]);
    setNote(null);
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
    const mismatches = json.mismatches ?? [];
    const warnings = json.warnings ?? [];
    setNote(
      `Imported ${json.imported?.length ?? 0} file(s)${json.declared ? ` and ${json.declared} declared value(s)` : ""}. ` +
        "Nothing has been read yet." +
        (mismatches.length
          ? ` ${mismatches.length} file(s) do not match the manifest's checksum. They are imported and flagged in the audit log: ${mismatches.map((m) => m.name).join(", ")}.`
          : "") +
        (warnings.length ? ` ${warnings.join(" ")}` : "") +
        (skipped.length ? ` Skipped ${skipped.length}: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` : "")
    );
    toast.success("Archive imported");
    softReload();
  }

  const busy = pending || isRefreshing;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          accept="application/pdf,image/png,image/jpeg,image/webp,.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          disabled={disabled || busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void uploadMany(files);
          }}
        />
        <input
          ref={packRef}
          type="file"
          className="sr-only"
          accept=".zip,application/zip"
          disabled={disabled || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importPack(file);
          }}
        />
        <Button variant="secondary" disabled={disabled || busy} onClick={() => packRef.current?.click()}>
          <Package />
          Import archive (ZIP)
        </Button>
        <Button disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          {pending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
            <Upload />
          )}
          {pending
            ? progress
              ? `Storing ${progress.done + 1} of ${progress.total}…`
              : "Working…"
            : "Upload files"}
        </Button>
      </div>
      <p className="max-w-md text-right text-xs text-mist-500">
        Choose several PDF, Excel or CSV files at once. Each is stored as it is; nothing is read until you ask.
        A ZIP can be a plain folder of plant files or a verified evidence pack with a manifest.
      </p>
      {disabled ? (
        <p className="text-xs text-mist-500">This pack is not runnable yet, so it cannot accept evidence.</p>
      ) : null}
      {note ? (
        <div className="max-w-md">
          <Alert tone="ok" title="Upload">
            {note}
          </Alert>
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
