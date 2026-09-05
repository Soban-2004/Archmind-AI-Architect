"use client";

import { useState, type FormEvent } from "react";
import { MessageSquare, SendHorizontal, Sparkles } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import { EmptyState, Spinner } from "./ui";

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  busy: boolean;
}

export function ChatPanel({ messages, onSend, busy }: Props) {
  const [draft, setDraft] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    const message = draft;
    setDraft("");
    await onSend(message);
  }

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
                  <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                    <MessageSquare size={13} />
                  </div>
                )}
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm ${
                    m.role === "user"
                      ? "rounded-br-sm bg-brand-600 text-white"
                      : "rounded-bl-sm border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 pl-9 text-xs text-slate-400">
                <Spinner className="h-3.5 w-3.5" />
                thinking…
              </div>
            )}
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 bg-white p-3">
        <input
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
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
