"use client";

import { useState } from "react";
import { CheckCircle2, Paperclip } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";

const MAX_FILES = 5;
const MAX_FILE_MB = 10;

export function RespondForm({ token }: { token: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Alert tone="ok" title="Your response has been sent">
        <p>
          Your verifier has it, together with any files you attached. This link has now closed. If
          they need more from you they will send a new one. You can close this page.
        </p>
      </Alert>
    );
  }

  function onPick(list: FileList | null) {
    const next = Array.from(list ?? []);
    if (next.length > MAX_FILES) {
      setError(`Attach at most ${MAX_FILES} files.`);
      return;
    }
    const tooBig = next.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setError(`${tooBig.name} is larger than ${MAX_FILE_MB} MB.`);
      return;
    }
    setError(null);
    setFiles(next);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    data.set("token", token);
    data.delete("files");
    for (const f of files) data.append("files", f);
    try {
      const res = await fetch("/api/respond", { method: "POST", body: data });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "The response could not be sent. Try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("The response could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" required minLength={2} maxLength={200} autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="contact">Email or phone (optional)</Label>
          <Input id="contact" name="contact" maxLength={200} autoComplete="email" />
        </div>
      </div>

      <div>
        <Label htmlFor="body">Your response</Label>
        <Textarea
          id="body"
          name="body"
          required
          minLength={5}
          maxLength={8000}
          rows={7}
          placeholder="Explain what happened, what you have corrected, and which attached document shows it."
        />
      </div>

      <div>
        <Label htmlFor="files">Supporting files (optional)</Label>
        <label
          htmlFor="files"
          className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-mist-300 bg-mist-50/60 px-3 py-3 text-sm text-mist-700 hover:border-teal-500"
        >
          <Paperclip className="size-4 text-mist-500" aria-hidden />
          {files.length === 0
            ? "Choose files"
            : files.length === 1
              ? files[0]!.name
              : `${files.length} files selected`}
        </label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv,application/pdf,image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => onPick(e.target.files)}
        />
        <FieldHint>
          PDF, image, Excel or CSV. Up to {MAX_FILES} files, {MAX_FILE_MB} MB each.
        </FieldHint>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          <CheckCircle2 aria-hidden />
          {busy ? "Sending…" : "Send response"}
        </Button>
        <p className="text-xs text-mist-500">You can send one response per link.</p>
      </div>
    </form>
  );
}
