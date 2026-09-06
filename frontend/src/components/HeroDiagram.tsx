// Connector paths as real `d` strings — needed because <animateMotion>'s
// `path` attribute takes the same syntax, and reused directly rather than
// duplicated so the drawn line and the particles riding it can never
// drift apart.
const PATH_STOREFRONT_GATEWAY = "M95,40 H150";
const PATH_GATEWAY_ORDERS = "M245,40 H300";
const PATH_ORDERS_DB = "M365,55 V90";
const PATH_ORDERS_CACHE = "M340,55 Q300,80 300,90";

function Particle({ path, color, dur, begin }: { path: string; color: string; dur: number; begin: number }) {
  return (
    <circle r={2.5} fill={color}>
      <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} begin={`${begin}s`} />
    </circle>
  );
}

/**
 * A real, live preview — not a static screenshot — of the same "data
 * flowing through the pipe" effect the actual product's canvas renders
 * for a live simulation (FlowEdge.tsx's <animateMotion> particles over a
 * floating bezier edge). This is a fixed illustrative layout rather than
 * a real ArchitectureState (nothing to simulate on a landing page before
 * a project exists), but the animation technique is identical, not a
 * separately-invented effect — this is what turning simulation on
 * actually looks like elsewhere in the app.
 */
export function HeroDiagram() {
  return (
    <div className="relative rounded-[10px] border border-bp-line-strong bg-bp-surface p-5 pb-4 before:pointer-events-none before:absolute before:-left-px before:-top-px before:h-2.5 before:w-2.5 before:border-l-[1.5px] before:border-t-[1.5px] before:border-bp-line-strong after:pointer-events-none after:absolute after:-bottom-px after:-right-px after:h-2.5 after:w-2.5 after:border-b-[1.5px] after:border-r-[1.5px] after:border-bp-line-strong">
      <div className="mb-3.5 flex items-baseline justify-between border-b border-dashed border-bp-line pb-3 font-plex-mono text-[10.5px] uppercase tracking-wide text-bp-muted">
        <span>Fig. 01 — reconstructed architecture</span>
        <span>Rev. A</span>
      </div>

      <svg viewBox="0 0 460 210" width="100%" height="auto" style={{ overflow: "visible" }}>
        <defs>
          <marker id="hero-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-bp-muted" />
          </marker>
        </defs>

        {/* connectors */}
        <path d={PATH_STOREFRONT_GATEWAY} className="stroke-bp-muted" strokeWidth={1.4} fill="none" markerEnd="url(#hero-arrow)" />
        <path d={PATH_GATEWAY_ORDERS} className="stroke-bp-muted" strokeWidth={1.4} fill="none" markerEnd="url(#hero-arrow)" />
        <path d={PATH_ORDERS_DB} className="stroke-bp-muted" strokeWidth={1.4} fill="none" markerEnd="url(#hero-arrow)" />
        <path d={PATH_ORDERS_CACHE} className="stroke-bp-accent-2" strokeWidth={1.4} strokeDasharray="3 3" fill="none" markerEnd="url(#hero-arrow)" />

        {/* live traffic — same <animateMotion> technique as FlowEdge.tsx */}
        <Particle path={PATH_STOREFRONT_GATEWAY} color="var(--color-bp-accent)" dur={1.8} begin={0} />
        <Particle path={PATH_STOREFRONT_GATEWAY} color="var(--color-bp-accent)" dur={1.8} begin={0.9} />
        <Particle path={PATH_GATEWAY_ORDERS} color="var(--color-bp-accent)" dur={1.6} begin={0.3} />
        <Particle path={PATH_GATEWAY_ORDERS} color="var(--color-bp-accent)" dur={1.6} begin={1.1} />
        <Particle path={PATH_ORDERS_DB} color="var(--color-bp-good)" dur={1.4} begin={0.6} />
        <Particle path={PATH_ORDERS_CACHE} color="var(--color-bp-accent-2)" dur={1.7} begin={1.3} />

        {/* Storefront */}
        <rect x={10} y={18} width={85} height={44} rx={4} className="fill-bp-accent-soft stroke-bp-accent" strokeWidth={1.2} />
        <text x={52} y={37} textAnchor="middle" fontFamily="var(--font-plex-sans)" fontSize={10.5} fontWeight={600} className="fill-bp-ink">
          Storefront
        </text>
        <text x={52} y={50} textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          SVC · frontend
        </text>

        {/* API Gateway */}
        <rect x={150} y={18} width={95} height={44} rx={4} className="fill-bp-surface stroke-bp-line-strong" strokeWidth={1.2} />
        <text x={197} y={37} textAnchor="middle" fontFamily="var(--font-plex-sans)" fontSize={10.5} fontWeight={600} className="fill-bp-ink">
          API Gateway
        </text>
        <text x={197} y={50} textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          INFRA · gateway
        </text>

        {/* Orders API */}
        <rect x={300} y={18} width={90} height={44} rx={4} className="fill-bp-accent-soft stroke-bp-accent" strokeWidth={1.2} />
        <text x={345} y={37} textAnchor="middle" fontFamily="var(--font-plex-sans)" fontSize={10.5} fontWeight={600} className="fill-bp-ink">
          Orders API
        </text>
        <text x={345} y={50} textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          SVC · service
        </text>

        {/* PostgreSQL */}
        <rect x={320} y={90} width={95} height={44} rx={4} className="fill-bp-surface stroke-bp-good" strokeWidth={1.2} />
        <text x={367} y={109} textAnchor="middle" fontFamily="var(--font-plex-sans)" fontSize={10.5} fontWeight={600} className="fill-bp-ink">
          PostgreSQL
        </text>
        <text x={367} y={122} textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          DB · primary
        </text>

        {/* Redis */}
        <rect x={205} y={90} width={85} height={44} rx={4} className="fill-bp-surface stroke-bp-accent-2" strokeWidth={1.2} strokeDasharray="3 3" />
        <text x={247} y={109} textAnchor="middle" fontFamily="var(--font-plex-sans)" fontSize={10.5} fontWeight={600} className="fill-bp-ink">
          Redis
        </text>
        <text x={247} y={122} textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          DB · cache
        </text>

        <text x={10} y={185} fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          EDGE_COUNT: 4
        </text>
        <text x={10} y={198} fontFamily="var(--font-plex-mono)" fontSize={8.5} className="fill-bp-muted">
          STATUS: <tspan className="fill-bp-good">all commands validated</tspan>
        </text>
      </svg>

      <p className="mt-3 text-center font-plex-mono text-[10.5px] tracking-wide text-bp-muted">
        Live traffic simulation — every node was proposed as a validated command, never drawn freehand.
      </p>
    </div>
  );
}
