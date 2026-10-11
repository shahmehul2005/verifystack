"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ExternalLink } from "lucide-react";
import { humanize } from "@/lib/format";
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
      toast.success(
        typeof body.citationState === "string" ? `Citation ${body.citationState}` : "Saved"
      );
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
      <div className="mt-4 rounded-md border border-mist-200 bg-mist-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-mist-600">Regulatory citation</p>
          {gate ? (
            <Badge tone={gate === "rejected" ? "block" : "draft"}>{humanize(gate)}</Badge>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-mist-700">{message}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <figure className="rounded-md border border-mist-200 bg-mist-50 px-4 py-3">
        <figcaption className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-mist-600">Retrieved clause, verbatim</span>
          {citation.citation_clause_ref ? (
            <span className="font-mono text-xs text-mist-500">{citation.citation_clause_ref}</span>
          ) : null}
        </figcaption>
        <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-teal-500 pl-3 text-[13px] leading-relaxed text-mist-800">
          {citation.citation_chunk_text}
        </blockquote>
        <p className="mt-3 text-xs text-mist-600">
          {citation.citation_document_title}
          {citation.citation_page_number != null ? ` · page ${citation.citation_page_number}` : ""}
        </p>
        {citation.citation_source_url ? (
          <a
            href={citation.citation_source_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 break-all text-xs text-teal-700 hover:text-teal-800 hover:underline"
          >
            Open source document
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </figure>
      <div className="rounded-md border border-mist-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-mist-600">Why it applies</p>
          {citation.citation_state ? (
            <Badge tone={citation.citation_state === "accepted" ? "ok" : citation.citation_state === "rejected" ? "block" : "draft"}>
              {humanize(citation.citation_state)}
            </Badge>
          ) : null}
        </div>
        {editing ? (
          <Textarea
            aria-label="Why the clause applies"
            className="mt-2 min-h-28"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-mist-700">
            {citation.citation_explanation}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
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
                variant="ghost"
                className="text-red-700 hover:bg-red-50 hover:text-red-800"
                onClick={() => void patch({ citationState: "rejected" })}
              >
                Reject
              </Button>
            </>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-mist-500">
          Decide the citation separately from the CAR. The clause text is retrieved from the
          source document, not written by a model.
        </p>
      </div>
    </div>
  );
}
