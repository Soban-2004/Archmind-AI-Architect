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

v4 change: a node's real, declared `engine` (analyzer/engines.py) now also
scales the number — before this, "postgres" and "cockroachdb", or "redis"
and "dynamodb", produced identical capacity despite being genuinely
different systems; `engine` was stored and shown but never actually read
by this calculation. Composes with `size`: base * size_multiplier *
engine_multiplier. A node whose engine doesn't match anything in the
curated table gets a neutral 1.0x, same as today.
"""
from __future__ import annotations

from app.analyzer.engines import engine_spec_for
from app.analyzer.sizing import size_spec_for
from app.models.state import Node

CAPACITY_VERSION = "v4"

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
    size = size_spec_for(node)
    engine, engine_name = engine_spec_for(node)
    capacity = base_capacity * size.capacity_multiplier * engine.capacity_multiplier

    if key not in _DEFAULT_CAPACITY_RPS:
        return float(capacity), f"no declared default for {key}; using fallback"

    basis = f"declared default for {key} (capacity set {CAPACITY_VERSION})"
    if size.capacity_multiplier != 1.0:
        basis += f"; {size.label} instance ({size.vcpu} vCPU / {size.ram_gb}GB) -> {size.capacity_multiplier:g}x"
    if engine_name is not None and engine.capacity_multiplier != 1.0:
        basis += f"; {engine_name} engine -> {engine.capacity_multiplier:g}x"

    return float(capacity), basis
