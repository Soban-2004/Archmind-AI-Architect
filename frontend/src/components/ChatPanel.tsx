"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, SendHorizontal, Sparkles } from "lucide-react";
import { useThinkingStatus } from "@/lib/useThinkingStatus";
import type { ChatMessage } from "@/lib/types";
import { EmptyState, Spinner, TypewriterText } from "./ui";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

/** Rotating "what's happening" status while a chat turn is in flight — see
 * lib/useThinkingStatus for why this is client-side perceived progress
 * rather than real backend steps (a single blocking LLM call has no
 * progress channel to report). A long request (production-tier redesigns
 * especially) gets an honest elapsed timer and reassurance note instead of
 * just sitting on a static "thinking…" with nothing else for minutes. */
function ThinkingBubble({ active }: { active: boolean }) {
  const { phrase, elapsedMs } = useThinkingStatus(active);
  if (!active) return null;
  return (
    <div className="flex items-start gap-2 pl-9">
      <div className="flex flex-col gap-1 rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3.5 py-2.5 text-xs text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          <span key={phrase} className="animate-fade-in">
            {phrase}
          </span>
        </div>
        {elapsedMs > 20000 && (
          <p className="max-w-[220px] text-[10.5px] text-slate-400 dark:text-slate-500">
            {formatElapsed(elapsedMs)} elapsed — detailed requests can take a minute or two, still working.
          </p>
        )}
      </div>
    </div>
  );
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  busy: boolean;
  onConsumeAnimation: (index: number) => void;
}

export function ChatPanel({ messages, onSend, busy, onConsumeAnimation }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Force-scroll to the newest message every time one arrives, regardless
  // of where the user had scrolled to — matches how the composer being
  // focused always keeps the conversation moving forward.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    const message = draft;
    setDraft("");
    await onSend(message);
  }

  async function handleQuickReply(reply: string) {
    if (busy) return;
    await onSend(reply);
  }

  const lastAssistantIndex = [...messages].map((m) => m.role).lastIndexOf("assistant");

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={22} />}
            title="Describe what you want to build"
            description={'e.g. "I want to build a stock trading app for college students"'}
          />
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:text-indigo-300">
                    <MessageSquare size={13} />
                  </div>
                )}
                <div className="flex max-w-[82%] flex-col gap-2">
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "rounded-br-sm bg-brand-600 text-white"
                        : "rounded-bl-sm border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <TypewriterText text={m.content} active={!!m.animate} onDone={() => onConsumeAnimation(i)} />
                    ) : (
                      m.content
                    )}
                  </div>
                  {m.role === "assistant" && i === lastAssistantIndex && !busy && m.quickReplies && m.quickReplies.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.quickReplies.map((reply) => (
                        <button
                          key={reply}
                          onClick={() => handleQuickReply(reply)}
                          className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
                        >
                          {reply}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <ThinkingBubble active={busy} />
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <input
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-800 dark:focus:ring-brand-500/20"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          <SendHorizontal size={17} />
        </button>
      </form>
    </div>
  );
}
