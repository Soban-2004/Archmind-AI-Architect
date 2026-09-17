"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, Check, Copy, ExternalLink, Lightbulb, MessageSquare, SendHorizontal, Sparkles, User } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { useThinkingStatus } from "@/lib/useThinkingStatus";
import type { ChatMessage } from "@/lib/types";
import { EmptyState, IconButton, Spinner, TypewriterText } from "./ui";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

/** "What's happening" status while a chat turn is in flight. When
 * `realStage` is provided (the streaming path — POST /chat/stream, see
 * lib/api.ts's sendChatMessageStream), this shows the REAL backend stage
 * as it actually starts (services/interview.py's OnStage) — not a guess.
 * Falls back to lib/useThinkingStatus's honestly-cosmetic rotating phrase
 * only when no real stage is available (the plain, non-streaming send
 * path), so this component never claims something's real that isn't. A
 * long request (production-tier redesigns especially) still gets an
 * honest elapsed timer and reassurance note either way. */
function ThinkingBubble({ active, realStage }: { active: boolean; realStage?: string | null }) {
  const { phrase, elapsedMs } = useThinkingStatus(active);
  if (!active) return null;
  const displayText = realStage || phrase;
  return (
    <div className="flex items-start gap-2 pl-9">
      <div className="flex flex-col gap-1 rounded-2xl rounded-bl-sm bg-surface px-3.5 py-2.5 text-xs text-slate-500 shadow-soft dark:bg-surface-2 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Spinner className="h-3.5 w-3.5 shrink-0" />
          <span key={displayText} className="animate-fade-in">
            {displayText}
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

/** Copy-to-clipboard on hover, with a brief "copied" confirmation instead
 * of a silent no-feedback action. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permission denied or unavailable — fail silently, not worth an error message for a copy button
    }
  }
  return (
    <IconButton onClick={handleCopy} className="h-5 w-5 opacity-0 group-hover:opacity-100" title="Copy">
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </IconButton>
  );
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  busy: boolean;
  /** Real live pipeline stage text (see ThinkingBubble above) — omit or
   * pass null/undefined to fall back to the cosmetic rotating status. */
  busyStage?: string | null;
  onConsumeAnimation: (index: number) => void;
}

export function ChatPanel({ messages, onSend, busy, busyStage, onConsumeAnimation }: Props) {
  const [draft, setDraft] = useState("");
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Force-scroll to the newest message every time one arrives, regardless
  // of where the user had scrolled to — matches how the composer being
  // focused always keeps the conversation moving forward.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  // Surface a "jump to latest" affordance while the user has deliberately
  // scrolled up to read earlier messages — the force-scroll above only
  // fires on a NEW message, so mid-conversation manual scrolling is
  // otherwise a dead end with no way back down except scrolling by hand.
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpToLatest(distanceFromBottom > 200);
  }

  function jumpToLatest() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

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
    <div className="relative flex h-full flex-col">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={22} />}
            title="Describe what you want to build"
            description={'e.g. "I want to build a stock trading app for college students"'}
          />
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`animate-fade-in group flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  // A fixed violet->pink gradient (plain Tailwind hues, not
                  // the theme-flipped --brand-*/--info-* vars used for
                  // buttons) — those invert to a PALE tint in dark mode
                  // specifically so a dark-text button stays readable,
                  // which would leave the white icon here badly low-
                  // contrast. This gradient stays the same dark-enough
                  // stops in both themes on purpose.
                  <div className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 text-white shadow-soft">
                    <MessageSquare size={13} />
                  </div>
                )}
                <div className={`flex max-w-[82%] flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                      m.role === "user"
                        ? "whitespace-pre-wrap rounded-br-sm bg-surface-3 text-slate-800 shadow-soft dark:text-slate-100"
                        : "rounded-bl-sm bg-surface text-slate-700 shadow-soft dark:bg-surface-2 dark:text-slate-200"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <TypewriterText text={m.content} active={!!m.animate} onDone={() => onConsumeAnimation(i)} />
                    ) : (
                      m.content
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                    {m.createdAt && (
                      <span className="opacity-0 transition-opacity group-hover:opacity-100" title={new Date(m.createdAt).toLocaleString()}>
                        {relativeTime(m.createdAt)}
                      </span>
                    )}
                    {m.role === "assistant" && <CopyButton text={m.content} />}
                  </div>
                  {m.role === "assistant" && m.reasoning && m.reasoning.length > 0 && (
                    // The model's own reasoning for this question/edit —
                    // real constraint(s) it's actually working from, not
                    // narration bolted on after (see backend/app/llm/
                    // prompts.py). Deliberately its own small block, not
                    // folded into the chat bubble's prose above, so it
                    // reads as "here's why", not as more of the answer.
                    <div className="flex w-full flex-col gap-1 rounded-r-lg border-l-2 border-amber-400/60 bg-amber-50/50 py-1.5 pl-2.5 pr-3 dark:border-amber-400/40 dark:bg-amber-500/[0.05]">
                      <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                        <Lightbulb size={11} /> Why
                      </div>
                      <ul className="flex flex-col gap-0.5">
                        {m.reasoning.map((point, idx) => (
                          <li key={idx} className="flex gap-1.5 text-[12px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
                            <span className="select-none text-amber-400 dark:text-amber-500">•</span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                    // Real sources services/web_search.py actually fetched
                    // and fed to this answer — a citation trail the user
                    // can verify, not just the model's own claim that it
                    // checked something current.
                    <div className="flex flex-col gap-1">
                      {m.sources.map((s) => (
                        <a
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={s.snippet}
                          className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10.5px] text-slate-500 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:border-brand-500/40 dark:hover:text-brand-300"
                        >
                          <ExternalLink size={10} className="shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {m.role === "assistant" && i === lastAssistantIndex && !busy && m.quickReplies && m.quickReplies.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.quickReplies.map((reply) => (
                        <button
                          key={reply}
                          onClick={() => handleQuickReply(reply)}
                          className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 transition duration-150 hover:-translate-y-0.5 hover:bg-brand-100 hover:shadow-soft active:scale-95 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20"
                        >
                          {reply}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {m.role === "user" && (
                  <div className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 text-white shadow-soft">
                    <User size={13} />
                  </div>
                )}
              </div>
            ))}
            <ThinkingBubble active={busy} realStage={busyStage} />
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {showJumpToLatest && (
        <button
          onClick={jumpToLatest}
          className="animate-fade-in absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-slate-600 shadow-raised transition hover:bg-slate-50 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          <ArrowDown size={12} /> Jump to latest
        </button>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-slate-200 bg-surface p-3 dark:border-slate-800">
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
          className="ease-spring flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-soft transition duration-300 hover:-translate-y-0.5 hover:bg-brand-700 active:scale-95 active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0 disabled:active:scale-100"
        >
          <SendHorizontal size={17} />
        </button>
      </form>
    </div>
  );
}
