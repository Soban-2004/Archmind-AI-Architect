import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Small shared design-system primitives so every panel (chat, analyzer,
// compare, simulate) reads as one product instead of four separately
// styled screens. Every primitive carries its own dark: variants so
// callers never have to think about theme.

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900";
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm" };
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20",
    secondary:
      "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700",
    ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />;
}

export function IconButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition duration-150 hover:bg-slate-100 hover:text-slate-600 active:scale-90 disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 dark:focus-visible:ring-offset-slate-900 ${className}`}
      {...props}
    />
  );
}

const BADGE_TONES = {
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  brand: "bg-brand-50 text-brand-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  green: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
} as const;

export function Badge({ tone = "slate", children, className = "" }: { tone?: keyof typeof BADGE_TONES; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { id: T; label: string; icon?: ReactNode }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
            active === t.id
              ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = score >= 85 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth={5} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-800 dark:text-slate-100">{score}</div>
    </div>
  );
}

/** Shared animated progress bar — callers own the color (a score bar
 * wants high=green, a load/cost bar wants high=red, so the semantics
 * can't be baked in here), this just owns the fill animation and track
 * styling so every bar in the app moves and looks the same. */
export function ProgressBar({ pct, colorClassName = "bg-brand-500" }: { pct: number; colorClassName?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${colorClassName}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">{icon}</div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description && <p className="text-xs text-slate-400 dark:text-slate-500">{description}</p>}
    </div>
  );
}

/**
 * Reveals `text` progressively rather than all at once. Our LLM calls
 * return one structured JSON object, not a token stream (see README —
 * that's a deliberate consequence of the mutation-command contract, not
 * an oversight), so this is a typewriter reveal of the final response
 * rather than literal token-by-token streaming from the model. It gets
 * the smooth, alive feel users expect from a chat UI without pretending
 * the generation itself was streamed.
 */
// Chat responses are asked (llm/prompts.py) to format like a real
// assistant reply — short verdict up front, bullets for multi-part
// reasoning, bold for the key term/number — not one dense paragraph. That
// only reads as intended if it's actually rendered as markdown instead of
// literal asterisks/dashes, which is what this renders it as. Styling is
// intentionally compact (small margins, no oversized headings) to match
// the chat bubble's own 13px/leading-relaxed text rather than a
// full-size document — a heading in a chat reply should read as "this is
// the important line", not jump to document-title scale.
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0 marker:text-slate-400 dark:marker:text-slate-500">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0 marker:text-slate-400 dark:marker:text-slate-500">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <p className="mb-1 mt-1.5 text-[13px] font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-1.5 text-[13px] font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-1.5 text-[13px] font-semibold first:mt-0">{children}</p>,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] dark:bg-slate-700">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-brand-600 underline underline-offset-2 dark:text-indigo-300">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-300 pl-2 italic text-slate-500 dark:border-slate-600 dark:text-slate-400">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-slate-200 dark:border-slate-700" />,
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

export function TypewriterText({ text, active, onDone }: { text: string; active: boolean; onDone?: () => void }) {
  // Lazy initial state — a message's `text`/`active` never change after
  // this component mounts (only whether it's still animating does, via
  // onDone), so the whole reveal is driven by one interval started once.
  const [shown, setShown] = useState(() => (active ? 0 : text.length));

  useEffect(() => {
    if (!active) return; // already showing full text via the lazy init above
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 40)); // ~40 reveal ticks regardless of length
    const id = setInterval(() => {
      i += step;
      if (i >= text.length) {
        setShown(text.length);
        clearInterval(id);
        onDone?.();
      } else {
        setShown(i);
      }
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-parses the growing prefix as markdown every tick — an unterminated
  // marker (an opening "**" not yet closed) just renders as a literal
  // character until the reveal catches up to its match, the same
  // graceful-degradation streaming markdown UIs rely on elsewhere; it
  // never throws on a truncated string.
  return <ChatMarkdown text={text.slice(0, shown)} />;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
