"use client";

import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSoftReload } from "@/lib/soft-reload";
import {
  runClassification,
  type BatchResponse,
  type Candidate,
  type Progress,
  type RunSummary,
} from "@verifystack/backend/domain/extraction/classifyRunner";

/**
 * One button that suggests a type for every unassigned document. The files go to
 * the server a few at a time, sized so no call overruns the model's request cap,
 * and the run waits out a rate limit instead of failing. A type already set is
 * never changed. Stop leaves the rest for a later run.
 */
export function ClassifyAllButton({
  engagementId,
  candidates,
  configured,
}: {
  engagementId: string;
  candidates: Candidate[];
  configured: boolean;
}) {
  const { softReload } = useSoftReload();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const signal = useRef({ aborted: false });

  async function send(ids: string[]): Promise<BatchResponse> {
    const res = await fetch("/api/documents/classify-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, documentIds: ids }),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      results?: Extract<BatchResponse, { ok: true }>["results"];
      deferred?: string[];
      error?: string;
      retryable?: boolean;
      retryAfterSeconds?: number;
    } | null;
    if (res.ok && json?.ok && json.results) return { ok: true, results: json.results, deferred: json.deferred ?? [] };
    return {
      ok: false,
      retryable: json?.retryable ?? (res.status === 429 || res.status >= 500),
      ...(json?.retryAfterSeconds ? { retryAfterSeconds: json.retryAfterSeconds } : {}),
      error: json?.error ?? `The request failed (${res.status}).`,
    };
  }

  async function start() {
    signal.current = { aborted: false };
    setRunning(true);
    setSummary(null);
    const result = await runClassification({
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
      result.suggested ? `${result.suggested} suggested` : null,
      result.unknown ? `${result.unknown} unknown` : null,
      result.skipped ? `${result.skipped} left as they were` : null,
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
              ? "Sends the first page of each unassigned file to the model, a few at a time. A type that is already set is never changed."
              : "Gemini is not configured for this deployment."
          }
        >
          <Sparkles className={running ? "animate-spin" : undefined} />
          {running ? "Suggesting types…" : `Suggest types for all unassigned (${candidates.length})`}
        </Button>
      </div>

      <div aria-live="polite" className="max-w-sm text-right text-[13px] text-mist-700">
        {running && progress ? (
          <>
            <progress className="mb-1 block h-1.5 w-56 accent-teal-600" value={progress.done} max={progress.total} aria-label="Documents named" />
            {progress.done} of {progress.total} documents · batch {Math.min(progress.batch + 1, progress.batches)} of {progress.batches}
            {progress.waitingSeconds ? ` · waiting ${progress.waitingSeconds}s for the model` : ""}
          </>
        ) : summary ? (
          <>
            {summary.suggested + summary.unknown} named
            {summary.skipped ? `, ${summary.skipped} left as they were` : ""}
            {summary.failed ? `, ${summary.failed} failed` : ""}
            {summary.stopped ? ". Stopped; run it again for the rest." : "."}
            {firstFailure && firstFailure.status === "failed" ? <span className="block text-amber-800">{firstFailure.reason}</span> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
