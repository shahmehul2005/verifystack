"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ScanText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSoftReload } from "@/lib/soft-reload";
import {
  runExtraction,
  type ExtractCandidate,
  type ExtractProgress,
  type ExtractResponse,
  type ExtractSummary,
} from "@verifystack/backend/domain/extraction/extractRunner";

/**
 * One button that reads every uploaded PDF and image that has not been read yet,
 * one after another, using the same request as each file's own Extract button.
 * A file already read, or being read, is not read again. It waits out a rate
 * limit and has a Stop button; a stopped run leaves the rest for the next one.
 */
export function ExtractAllButton({
  engagementId,
  candidates,
  configured,
}: {
  engagementId: string;
  candidates: ExtractCandidate[];
  configured: boolean;
}) {
  const { softReload } = useSoftReload();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [summary, setSummary] = useState<ExtractSummary | null>(null);
  const signal = useRef({ aborted: false });

  async function send(documentId: string): Promise<ExtractResponse> {
    const res = await fetch(`/api/documents/${documentId}/extract`, { method: "POST" });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      extracted?: number;
      pages?: number;
      docType?: string;
      error?: string;
    } | null;
    if (res.ok && json?.ok) return { ok: true, extracted: json.extracted ?? 0, ...(json.pages ? { pages: json.pages } : {}), ...(json.docType ? { docType: json.docType } : {}) };
    const retryAfter = Number(res.headers.get("Retry-After"));
    return {
      ok: false,
      // A rate limit or a server fault is worth waiting out. A document the model cannot read is not.
      retryable: res.status === 429 || res.status === 503 || res.status === 502,
      ...(retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      error: json?.error ?? `The request failed (${res.status}).`,
    };
  }

  async function start() {
    signal.current = { aborted: false };
    setRunning(true);
    setSummary(null);
    const result = await runExtraction({
      candidates,
      signal: signal.current,
      onProgress: setProgress,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      send,
    });
    setRunning(false);
    setProgress(null);
    setSummary(result);
    const parts = [
      result.extracted ? `${result.fields} value(s) from ${result.extracted} file(s)` : null,
      result.noFields ? `${result.noFields} with nothing to review` : null,
      result.failed ? `${result.failed} failed` : null,
    ].filter(Boolean);
    const text = `${result.stopped ? "Stopped. " : ""}${parts.join(", ") || "Nothing to do"}.`;
    if (result.failed > 0) toast.error(text);
    else toast.success(text);
    softReload();
  }

  const firstFailure = summary?.outcomes.find((o) => o.status === "failed");

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {running ? (
          <Button size="sm" variant="secondary" onClick={() => (signal.current.aborted = true)}>
            Stop
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={running || !configured}
          onClick={() => void start()}
          title={
            configured
              ? "Reads every uploaded PDF and image that has not been read yet, one after another. Files already read are skipped."
              : "Gemini is not configured for this deployment."
          }
        >
          <ScanText className={running ? "animate-pulse" : undefined} />
          {running ? "Extracting…" : `Extract all (${candidates.length})`}
        </Button>
      </div>

      <div aria-live="polite" className="max-w-sm text-right text-[13px] text-mist-700">
        {running && progress ? (
          <>
            <progress className="mb-1 block h-1.5 w-56 accent-teal-600" value={progress.done} max={progress.total} aria-label="Documents read" />
            {progress.done} of {progress.total} files
            {progress.current ? ` · reading ${progress.current}` : ""}
            {progress.waitingSeconds ? ` · waiting ${progress.waitingSeconds}s for the model` : ""}
          </>
        ) : summary ? (
          <>
            {summary.extracted} read, {summary.fields} value(s) to review
            {summary.noFields ? `, ${summary.noFields} with nothing to review` : ""}
            {summary.failed ? `, ${summary.failed} failed` : ""}
            {summary.stopped ? ". Stopped; run it again for the rest." : "."}
            {summary.fields > 0 ? (
              <Link href={`/engagements/${engagementId}/workbench`} className="ml-1 font-medium text-teal-800 underline underline-offset-2">
                Open the workbench
              </Link>
            ) : null}
            {firstFailure && firstFailure.status === "failed" ? (
              <span className="block text-amber-800">
                {firstFailure.name}: {firstFailure.reason}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
