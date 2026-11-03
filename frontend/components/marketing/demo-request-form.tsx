"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

const SCHEMES = [
  { value: "CCTS", label: "CCTS" },
  { value: "ADEETIE", label: "ADEETIE" },
  { value: "Both", label: "Both schemes" },
] as const;

export function DemoRequestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [firm, setFirm] = useState("");
  const [scheme, setScheme] = useState<(typeof SCHEMES)[number]["value"]>("CCTS");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/demo-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        firm,
        scheme,
        message: message.trim() || undefined,
        website: website || undefined,
      }),
    }).catch(() => null);
    const json = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }) : {};
    setPending(false);
    if (!res || !res.ok || !json.ok) {
      setError(json.error ?? "We could not send your request. Please try again in a few minutes.");
      return;
    }
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <div role="status" data-ui className="bg-mist-50 p-8 text-mist-900">
        <CircleCheck aria-hidden className="size-6 text-teal-700" />
        <h3 className="mt-4 text-lg font-semibold text-mist-950">Thanks, your request is in</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-mist-600">
          We&apos;ll reply to <span className="font-medium text-mist-900">{sentTo}</span> to find a
          time for a walkthrough.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      data-ui
      className="bg-mist-50 p-6 text-mist-900 sm:p-8"
      aria-describedby={error ? "demo-error" : undefined}
    >
      {error ? (
        <div id="demo-error" className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="demo-name">Your name</Label>
          <Input
            id="demo-name"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="demo-email">Work email</Label>
          <Input
            id="demo-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="demo-firm">Firm</Label>
          <Input
            id="demo-firm"
            autoComplete="organization"
            maxLength={160}
            value={firm}
            onChange={(e) => setFirm(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="demo-scheme">Scheme</Label>
          <Select
            id="demo-scheme"
            value={scheme}
            onChange={(e) => setScheme(e.target.value as typeof scheme)}
          >
            {SCHEMES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="demo-message">What would you like to see?</Label>
          <Textarea
            id="demo-message"
            rows={4}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Optional. For example, the sectors you verify or the size of your team."
          />
        </div>
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="demo-website">Website</label>
          <input
            id="demo-website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={pending} className="rounded-none px-6">
          {pending ? "Sending…" : "Request a demo"}
        </Button>
        <FieldHint className="mt-0">
          We use these details only to reply to you. Nothing is stored in the app.
        </FieldHint>
      </div>
    </form>
  );
}
