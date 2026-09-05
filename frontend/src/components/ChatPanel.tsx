"use client";

import { useState, type FormEvent } from "react";
import type { ChatMessage } from "@/lib/types";

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
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            Describe what you want to build — e.g. &ldquo;I want to build a stock trading app for college
            students.&rdquo;
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-slate-400">thinking…</div>}
      </div>
      <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3 flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
