"""
Small internal reference-pattern library (spec §6 Phase 3 / §8): grounding
context fed to the model when generating a tier, NOT a deterministic
template engine. The model still reasons about the specific request; these
patterns just keep it from inventing scaling folklore from nothing.
"""

REFERENCE_PATTERNS = """Reference patterns (grounding only — use judgment for
the specific request, do not apply these mechanically or all at once):

- Budget $0 or "student"/"hobby" framing: one small instance per service,
  a single shared Postgres with no replica, no CDN/load balancer, no
  managed cache unless the user explicitly asked for one, external
  dependencies kept to free tiers.
- Budget under ~$50/month: same as above, but a small managed Postgres
  (e.g. a hosted free/starter tier) is reasonable; still no horizontal
  scaling or redundancy.
- expected_users above ~100,000 or a stated high expected_rps: add a CDN
  in front of static/frontend assets, add a load balancer or API gateway
  in front of backend services, mark stateless services as
  horizontally scalable.
- expected_users above ~500,000, or availability_target 99.9% or higher:
  add a read replica for the primary database, add a cache layer (e.g.
  Redis) in front of hot read paths, consider a queue to decouple
  write-heavy or slow async work.
- availability_target 99.95% or higher, or explicit "production" /
  "enterprise" framing: add redundancy (replica + multiple service
  instances), add an explicit queue for decoupling, mark every external
  dependency's criticality (hard vs soft) explicitly, and add an
  infra_node of type "observability" (e.g. Datadog, Prometheus+Grafana)
  for logging/metrics/tracing.
- consistency_requirement = "strong": prefer a single primary relational
  database for the affected data over an eventually-consistent store; be
  cautious adding a cache without also describing an invalidation
  approach in the rationale.

- BUDGET IS A HARD CEILING, not one pattern among equals: a stated
  budget_monthly_usd overrides the availability/consistency patterns
  above, which say nothing about cost. A real 99.9%+-style redundant
  stack (replica + queue + cache + observability at once) essentially
  never fits $50-100/mo, so treat a low budget + high availability_target
  as a genuine conflict: add only the ONE or TWO highest-value pieces
  instead of everything every pattern mentions, and say so plainly in
  `summary` (what you added, what you left out, and why) rather than
  silently proposing something that costs multiples of the stated budget.
"""
