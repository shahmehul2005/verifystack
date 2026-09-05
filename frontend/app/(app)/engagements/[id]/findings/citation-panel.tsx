"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FindingCitationColumns } from "@verifystack/backend/domain/citations/types";
import { NO_APPLICABLE_CLAUSE } from "@verifystack/backend/domain/citations/types";

export function CitationPanel({
  citation,
  findingId,
  engagementId,
}: {
  citation: FindingCitationColumns;
  findingId: string;
  engagementId: string;
}) {
  const hasClause = Boolean(citation.citation_chunk_text);
  const [editing, setEditing] = useState(false);
  const [explanation, setExplanation] = useState(citation.citation_explanation ?? "");

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/findings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, findingId, ...body }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) toast.error(json.error ?? "Update failed");
    else {
      toast.success(typeof body.citationState === "string" ? body.citationState : "saved");
      window.location.reload();
    }
  }

  if (!hasClause) {
    const gate = citation.citation_gate;
    const message =
      citation.citation_explanation ??
      (gate === "no_applicable_clause" ? NO_APPLICABLE_CLAUSE : null);
    if (!gate && !message) return null;
    return (
      <div className="mt-3 border border-stone-200 bg-stone-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          Regulatory citation
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {gate ? <Badge tone={gate === "rejected" ? "block" : "draft"}>{gate}</Badge> : null}
        </div>
        <p className="mt-2 text-sm text-stone-700">{message}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      <div className="border border-stone-200 bg-stone-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          Retrieved clause (verbatim)
        </p>
        {citation.citation_clause_ref ? (
          <p className="mt-1 font-mono text-[11px] text-stone-500">{citation.citation_clause_ref}</p>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-800">
          {citation.citation_chunk_text}
        </p>
        <p className="mt-3 text-[11px] text-stone-600">
          {citation.citation_document_title}
          {citation.citation_page_number != null ? ` · p. ${citation.citation_page_number}` : ""}
        </p>
        {citation.citation_source_url ? (
          <a
            href={citation.citation_source_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block break-all text-[11px] text-stone-700 underline underline-offset-2"
          >
            {citation.citation_source_url}
          </a>
        ) : null}
      </div>
      <div className="border border-stone-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
            Why it applies
          </p>
          {citation.citation_state ? <Badge tone="draft">{citation.citation_state}</Badge> : null}
        </div>
        {editing ? (
          <textarea
            className="mt-2 min-h-28 w-full border border-stone-300 bg-white p-2 text-sm text-stone-900"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-stone-700">
            {citation.citation_explanation}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                onClick={() =>
                  void patch({ citationState: "edited", citationExplanation: explanation })
                }
              >
                Save edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => void patch({ citationState: "accepted" })}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void patch({ citationState: "rejected" })}
              >
                Reject
              </Button>
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-stone-500">
          Accept, edit, or reject the citation independently of the CAR. The clause text is
          retrieved source, not model output.
        </p>
      </div>
    </div>
  );
}
