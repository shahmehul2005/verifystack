"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, MessageCircle, SendHorizontal, X } from "lucide-react";
import type { AssistantReply, AssistantSource } from "@verifystack/backend/domain/assistant/answer";
import { STARTER_QUESTIONS } from "@verifystack/backend/domain/assistant/starters";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/cn";

const MAX_CHARS = 600;
const HISTORY_SENT = 6;

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources?: AssistantSource[];
  error?: boolean;
}

const WELCOME = "Hi, I'm the VerifyStack assistant. Ask me what VerifyStack does, how an engagement works, or which schemes it supports.";

/**
 * The website assistant. One conversation at a time, three suggested questions until the
 * first message, one link per answer, and one line of disclaimer. Everything it says comes
 * from the server; this component only shows it as text.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      const inside =
        panelRef.current?.contains(document.activeElement) ||
        document.activeElement === launcherRef.current;
      if (e.key === "Escape" && inside) {
        setOpen(false);
        launcherRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, pending, open]);

  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  function push(message: Omit<Message, "id">) {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { ...message, id }]);
  }

  async function ask(raw: string) {
    const question = raw.trim().slice(0, MAX_CHARS);
    if (!question || pending) return;

    const history = messages
      .filter((m) => !m.error)
      .slice(-HISTORY_SENT)
      .map(({ role, content }) => ({ role, content }));

    push({ role: "user", content: question });
    setDraft("");
    setPending(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data = (await res.json().catch(() => null)) as
        | (AssistantReply & { ok: true })
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !data || !data.ok) {
        push({
          role: "assistant",
          error: true,
          content:
            res.status === 429
              ? "You've asked a lot of questions in a short time. Please wait a few minutes and try again."
              : (data && !data.ok && data.error) || "I couldn't answer that just now. Please try again.",
        });
        return;
      }
      push({ role: "assistant", content: data.answer, sources: data.sources });
    } catch {
      push({
        role: "assistant",
        error: true,
        content: "I couldn't reach the server. Check your connection and try again.",
      });
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(draft);
  }

  function reset() {
    setMessages([]);
    setDraft("");
    inputRef.current?.focus();
  }

  const hasConversation = messages.length > 0;

  return (
    <div className="print:hidden">
      {open ? (
        <section
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className={cn(
            "fixed z-35 flex flex-col overflow-hidden rounded-2xl border border-mist-200 bg-white shadow-xl",
            "inset-x-3 top-3 bottom-22 sm:inset-x-auto sm:top-auto sm:right-5 sm:bottom-24",
            "sm:h-[min(600px,calc(100dvh-7rem))] sm:w-[380px]"
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-mist-200 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <LogoMark className="size-6" />
              <h2 id={titleId} className="truncate text-sm font-semibold text-mist-900">
                VerifyStack assistant
              </h2>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {hasConversation ? (
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md px-2 py-1 text-xs font-medium text-mist-600 transition-colors hover:bg-mist-100 hover:text-mist-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
                >
                  New chat
                </button>
              ) : null}
              <button
                type="button"
                onClick={close}
                aria-label="Close assistant"
                className="inline-flex size-8 items-center justify-center rounded-md text-mist-600 transition-colors hover:bg-mist-100 hover:text-mist-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-label="Conversation"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
          >
            <AssistantBubble content={WELCOME} />

            {!hasConversation ? (
              <div className="flex flex-col items-start gap-1.5">
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={pending}
                    onClick={() => void ask(q)}
                    className="rounded-lg border border-mist-200 bg-white px-3 py-2 text-left text-[13px] text-mist-800 transition-colors hover:border-teal-300 hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-teal-700 px-3.5 py-2 text-sm leading-relaxed text-white">
                    {m.content}
                  </p>
                </div>
              ) : (
                <AssistantBubble
                  key={m.id}
                  content={m.content}
                  sources={m.sources}
                  error={m.error}
                  onNavigate={() => setOpen(false)}
                />
              )
            )}

            {pending ? (
              <div className="flex" aria-label="Assistant is typing">
                <span className="inline-flex items-center gap-1 rounded-2xl rounded-bl-sm bg-mist-100 px-3.5 py-3">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="size-1.5 animate-bounce rounded-full bg-mist-400 motion-reduce:animate-none"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="shrink-0 border-t border-mist-200 px-3 pb-3 pt-3">
            <div className="flex items-center gap-2">
              <label htmlFor={`${titleId}-q`} className="sr-only">
                Your question
              </label>
              <input
                id={`${titleId}-q`}
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_CHARS}
                autoComplete="off"
                placeholder="Ask a question"
                className="h-10 min-w-0 flex-1 rounded-full border border-mist-300 bg-white px-4 text-sm text-mist-900 placeholder:text-mist-400 focus:border-teal-600 focus:outline-none focus:ring-3 focus:ring-teal-600/15"
              />
              <button
                type="submit"
                disabled={pending || !draft.trim()}
                aria-label="Send question"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:bg-mist-300"
              >
                <SendHorizontal className="size-4" />
              </button>
            </div>
            <p className="mt-2 px-1 text-[11px] leading-snug text-mist-500">
              AI can make mistakes. Don&apos;t share client or personal details.
            </p>
          </form>
        </section>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={open ? "Close VerifyStack assistant" : "Ask the VerifyStack assistant"}
        className="fixed bottom-5 right-5 z-35 inline-flex size-14 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg transition-colors hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600"
      >
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>
    </div>
  );
}

function AssistantBubble({
  content,
  sources,
  error,
  onNavigate,
}: {
  content: string;
  sources?: AssistantSource[];
  error?: boolean;
  onNavigate?: () => void;
}) {
  // One link at most. A reply should point the visitor to one place, not a list.
  const link = (sources ?? []).find((s) => s.href);
  return (
    <div className="flex">
      <div
        className={cn(
          "max-w-[88%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm leading-relaxed",
          error ? "bg-red-50 text-red-900" : "bg-mist-100 text-mist-900"
        )}
      >
        <FormattedText text={content} />
        {link ? (
          <Link
            href={link.href!}
            onClick={onNavigate}
            className="mt-2 inline-flex items-center gap-0.5 text-[13px] font-medium text-teal-700 hover:text-teal-900 hover:underline"
          >
            {link.title}
            <ArrowUpRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Plain text with optional "- " bullet lines. Rendered as text nodes, never as HTML. */
function FormattedText({ text }: { text: string }) {
  const blocks: Array<{ kind: "p"; text: string } | { kind: "ul"; items: string[] }> = [];
  for (const line of text.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]!);
      else blocks.push({ kind: "ul", items: [bullet[1]!] });
    } else {
      blocks.push({ kind: "p", text: line });
    }
  }
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-4 marker:text-teal-600">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
