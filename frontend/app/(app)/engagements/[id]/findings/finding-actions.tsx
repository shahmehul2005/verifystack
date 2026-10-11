"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CircleCheck,
  FileSignature,
  Link2,
  Link2Off,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyText } from "@/components/ui/copy-text";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import {
  DEFAULT_RESPONSE_DAYS,
  allowedTransitions,
  type IssueSeverity,
  type IssueState,
} from "@verifystack/backend/domain/issues/lifecycle";

type Payload = {
  state?: IssueState;
  action?: "newLink" | "revokeLink" | "recordResponse";
  dueAt?: string;
  responseBody?: string;
  responderName?: string;
  polish?: boolean;
};

const DONE: Partial<Record<IssueState, string>> = {
  accepted: "CAR accepted",
  open: "Issue opened with the entity",
  verified: "Response verified",
  closed: "Issue closed",
  rejected: "Issue rejected",
};

function defaultDue(): string {
  return new Date(Date.now() + DEFAULT_RESPONSE_DAYS * 86_400_000).toISOString().slice(0, 10);
}

async function send(engagementId: string, findingId: string, payload: Payload) {
  const res = await fetch("/api/findings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engagementId, findingId, ...payload }),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; error?: string; polished?: boolean; responseLink?: string | null }
    | null;
  if (!res.ok || !json?.ok) {
    toast.error(json?.error ?? "Update failed");
    return null;
  }
  return json;
}

export function FindingActions({
  findingId,
  engagementId,
  state,
  severity,
  dueAt,
  hasLiveLink,
}: {
  findingId: string;
  engagementId: string;
  state: IssueState;
  severity: IssueSeverity;
  dueAt: string | null;
  hasLiveLink: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [due, setDue] = useState(dueAt ? dueAt.slice(0, 10) : defaultDue());
  const [link, setLink] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [who, setWho] = useState("");
  const [said, setSaid] = useState("");

  const allowed = allowedTransitions(state, severity);
  // A drafted issue may be opened or closed in one click: the route takes the two steps.
  const drafted = state === "suggested";
  const canOpen = allowed.includes("open") || drafted;
  const canClose = allowed.includes("closed") || (drafted && severity !== "block");
  const canReject = allowed.includes("rejected");
  const canAccept = allowed.includes("accepted");
  const canVerify = allowed.includes("verified");

  async function run(payload: Payload, { reload = true }: { reload?: boolean } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      const json = await send(engagementId, findingId, payload);
      if (!json) return;
      if (payload.polish) {
        toast.success(json.polished ? "CAR drafted from the finding's own facts" : "Template wording kept");
      } else if (payload.action === "newLink") toast.success("New response link issued");
      else if (payload.action === "revokeLink") toast.success("Response link revoked");
      else if (payload.action === "recordResponse") toast.success("Response recorded");
      else if (payload.state) toast.success(DONE[payload.state] ?? "Updated");

      if (json.responseLink) {
        // The signed link is not stored anywhere; this is the only time it is shown.
        setLink(json.responseLink);
        return;
      }
      if (reload) window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const dueIso = () => new Date(`${due}T23:59:59`).toISOString();

  if (state === "closed" || state === "rejected") {
    return (
      <p className="text-xs text-mist-500">
        {state === "closed" ? "This issue is closed." : "This issue was rejected."} Nothing more to do here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(drafted || state === "accepted" || state === "edited") && (
          <Button size="sm" variant="subtle" disabled={busy} onClick={() => void run({ polish: true })}>
            <Sparkles />
            Draft CAR
          </Button>
        )}
        {canAccept && drafted && (
          <Button size="sm" disabled={busy} onClick={() => void run({ state: "accepted" })}>
            <FileSignature />
            Accept CAR
          </Button>
        )}
        {canVerify && (
          <Button size="sm" disabled={busy} onClick={() => void run({ state: "verified" })}>
            <ShieldCheck />
            Verify response
          </Button>
        )}
        {canClose && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ state: "closed" })}>
            <CircleCheck />
            Close issue
          </Button>
        )}
        {state === "open" && (
          <>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run({ action: "newLink" }, { reload: false })}>
              <Link2 />
              {hasLiveLink ? "New response link" : "Issue response link"}
            </Button>
            {hasLiveLink && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "revokeLink" })}>
                <Link2Off />
                Revoke link
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRecording((v) => !v)}>
              <MessageSquarePlus />
              Record a response
            </Button>
          </>
        )}
        {canReject && (
          <Button
            size="sm"
            variant="ghost"
            className="text-red-700 hover:bg-red-50 hover:text-red-800"
            disabled={busy}
            onClick={() => void run({ state: "rejected" })}
          >
            <X />
            Reject
          </Button>
        )}
      </div>

      {canOpen && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-mist-200 bg-white p-3">
          <div>
            <Label htmlFor={`due-${findingId}`}>Response due</Label>
            <Input
              id={`due-${findingId}`}
              type="date"
              value={due}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDue(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !due}
            onClick={() => void run({ state: "open", dueAt: dueIso() }, { reload: false })}
          >
            {state === "responded" || state === "verified" ? <RotateCcw /> : <Send />}
            {state === "responded" || state === "verified" ? "Re-open with entity" : "Open with entity"}
          </Button>
          <FieldHint className="mt-0 basis-full sm:basis-auto">
            Opening mints a one-time link for the entity. It is shown once, here.
          </FieldHint>
        </div>
      )}

      {link ? (
        <Alert
          tone="ok"
          title="Send this link to the entity"
          actions={
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
              Done
            </Button>
          }
        >
          <p className="mb-1.5">
            It opens only this issue, needs no account, works once, and is not shown again. Issue a new
            link if it is lost.
          </p>
          <CopyText value={link} visible={64} />
        </Alert>
      ) : null}

      {recording && state === "open" && (
        <div className="space-y-3 rounded-md border border-mist-200 bg-white p-3">
          <div>
            <Label htmlFor={`who-${findingId}`}>Who answered</Label>
            <Input id={`who-${findingId}`} value={who} onChange={(e) => setWho(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label htmlFor={`said-${findingId}`}>What they said</Label>
            <Textarea
              id={`said-${findingId}`}
              value={said}
              onChange={(e) => setSaid(e.target.value)}
              maxLength={8000}
              placeholder="Record the answer received by phone, email or in person."
            />
          </div>
          <Button
            size="sm"
            disabled={busy || said.trim().length < 5}
            onClick={() =>
              void run({
                action: "recordResponse",
                responseBody: said.trim(),
                ...(who.trim().length >= 2 ? { responderName: who.trim() } : {}),
              })
            }
          >
            Save response
          </Button>
        </div>
      )}

      {state === "open" && (
        <p className="text-xs text-mist-500">
          Waiting on the entity. A block issue stays open for sign-off until it is answered, verified and closed.
        </p>
      )}
      {state === "responded" && (
        <p className="text-xs text-mist-500">
          Read the response and its files, then verify it, or re-open if it does not settle the issue.
        </p>
      )}
    </div>
  );
}

/** For issues that may close from where they are. Block issues go through the full path on the findings page. */
export function CloseFindingButton({
  findingId,
  engagementId,
}: {
  findingId: string;
  engagementId: string;
}) {
  async function close() {
    const json = await send(engagementId, findingId, { state: "closed" });
    if (json) {
      toast.success("Issue closed");
      window.location.reload();
    }
  }
  return (
    <Button size="sm" variant="secondary" onClick={() => void close()}>
      <CircleCheck />
      Close
    </Button>
  );
}
