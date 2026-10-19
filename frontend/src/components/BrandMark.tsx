interface Props {
  size?: number;
  className?: string;
}

/** ArchMind's arch-circuit mark: a structural arch contains a branching
 * system graph, joining architectural stability with machine reasoning. */
export function BrandMark({ size = 32, className = "" }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`brand-mark inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={Math.round(size * 0.72)} height={Math.round(size * 0.72)} fill="none">
        <path d="M4.5 26V15.5C4.5 8.7 9.5 4 16 4s11.5 4.7 11.5 11.5V26" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
        <path d="M16 9v7m0 0-6.2 6.2M16 16l6.2 6.2" stroke="currentColor" strokeOpacity=".72" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="9" r="2.35" className="brand-mark-signal" />
        <circle cx="9.8" cy="22.2" r="2.25" className="brand-mark-node" />
        <circle cx="22.2" cy="22.2" r="2.55" className="brand-mark-terminal" />
      </svg>
    </span>
  );
}
