"""
Declared capacity assumptions for the Simulator (spec §6 Phase 7). Every
number here is a documented guess, not measured data — the point is that
it's a FIXED, versioned, inspectable assumption, not something the LLM
invents per run. Bump CAPACITY_VERSION if these numbers change.

These are deliberately round, conservative, order-of-magnitude figures for
a single SMALL instance of each kind — a real system's actual ceiling
depends on hardware, query complexity, and tuning this tool has no way to
know. Treat every simulation output as "given these assumptions", never as
a real capacity prediction.

v2 change: that "small instance" assumption is no longer unconditional — a
node's declared `size` (see analyzer/sizing.py) scales the number by that
tier's capacity_multiplier. A node that never sets `size` defaults to
small (multiplier 1.0), so this is purely additive: every number below is
still exactly what a "small" node gets, unchanged.

v3 change: `queue` and `database:keyvalue` were fact-checked against real
published benchmarks and found to be off by 1-2 orders of magnitude, not
just "a bit conservative" — the old 2000 rps for every queue regardless of
engine was ~25-500x below real single-node RabbitMQ (50k-120k msg/s),
Kafka (100k-1M+ msg/s), and SQS (no fixed ceiling, auto-scales); the old
5000 rps for keyvalue stores was ~20-100x below real single-instance
Redis (100k+ ops/sec unpipelined). Queue capacity is now also split by
`type` (queue/pubsub/stream) the same way database capacity already
splits by `type` — a point-to-point work queue and a Kafka-shaped
pub/sub stream are genuinely different systems, not one number. Raising
a capacity ceiling can only ever keep the instance count `_instances_for`
computes the same or lower it (never raise it, since it's the divisor) —
so this correction never makes an existing project's cost estimate go up,
only removes over-provisioning the old, too-low numbers were causing for
any project busy enough to actually approach them.
"""
from __future__ import annotations

from app.analyzer.sizing import size_spec_for
from app.models.state import Node

CAPACITY_VERSION = "v3"

# requests/sec a single small instance of each kind is assumed to
# saturate at, absent any other signal from the graph
_DEFAULT_CAPACITY_RPS: dict[str, float] = {
    "service": 500,
    "queue:queue": 10_000,  # SQS/RabbitMQ-shaped point-to-point queue
    "queue:pubsub": 20_000,  # Kafka/Kinesis-shaped fan-out
    "queue:stream": 20_000,  # Kafka Streams/Kinesis Streams-shaped continuous log
    "external_dependency": 100,
    "database:relational": 200,
    "database:document": 400,
    "database:keyvalue": 30_000,
    "database:search": 500,
    "database:graph": 200,
    "infra_node:cdn": 100_000,
    "infra_node:load_balancer": 50_000,
    "infra_node:api_gateway": 20_000,
    "infra_node:object_storage": 10_000,
    "infra_node:container_runtime": 5_000,
    "infra_node:observability": 100_000,  # not request-serving in the traffic-path sense
}

FALLBACK_CAPACITY_RPS = 500.0


def capacity_for(node: Node) -> tuple[float, str]:
    """Returns (capacity_rps, basis) — basis is shown to the user so a
    capacity number is never presented as unexplained."""
    if node.node_kind in ("database", "infra_node", "queue"):
        key = f"{node.node_kind}:{node.type}"
    else:
        key = node.node_kind

    base_capacity = _DEFAULT_CAPACITY_RPS.get(key, FALLBACK_CAPACITY_RPS)
    spec = size_spec_for(node)
    capacity = base_capacity * spec.capacity_multiplier

    if key not in _DEFAULT_CAPACITY_RPS:
        basis = f"no declared default for {key}; using fallback"
    elif spec.capacity_multiplier == 1.0:
        basis = f"declared default for {key} (capacity set {CAPACITY_VERSION})"
    else:
        basis = f"declared default for {key} (capacity set {CAPACITY_VERSION}); {spec.label} instance ({spec.vcpu} vCPU / {spec.ram_gb}GB) -> {spec.capacity_multiplier:g}x"

    return float(capacity), basis
