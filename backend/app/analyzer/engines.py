"""
Declared per-engine capacity/cost multipliers — a third, independent axis
alongside analyzer/sizing.py's `size` (which scales a node up/down) and
`storage_gb` (which is billed separately). This one scales *sideways*, by
which real engine a node's free-text `engine` field (Database/Queue only)
actually names.

Before this existed, `engine` was pure display/LLM-context text:
capacity_for()/monthly_cost_for() never read it, so `Database(type=
"relational", engine="postgres")` and `Database(type="relational",
engine="cockroachdb")` produced byte-identical numbers despite being real,
differently-priced, differently-provisioned systems — CockroachDB's
distributed-by-default architecture costs meaningfully more than a single
Postgres instance for the same declared "small" tier, and that difference
was being silently discarded.

Curated, not exhaustive — the same ~20 well-known names componentInfo.ts
already lists as real-world examples, each with a capacity/cost multiplier
layered on top of the type's base number (capacity.py/cost.py's own
tables), itself layered under `size`'s multiplier: the three compose as
base * engine_multiplier * size_multiplier. Matched by substring,
case-insensitively, against the free-text field — "PostgreSQL", "postgres
15", and "Amazon Aurora PostgreSQL" all resolve sensibly (the last one
correctly resolves to Aurora's numbers, not Postgres's, because more
specific managed/distributed variants are checked first — see the
ordering comment on ENGINE_MULTIPLIERS below). Any name that doesn't match
anything in the table — a typo, something obscure, something the LLM
invented — falls back to a neutral 1.0x/1.0x, exactly today's behavior,
with an honest basis string saying so rather than silently guessing about
a vendor this tool doesn't actually know anything about.

Bump ENGINE_VERSION if any of these numbers change.

v2: added entries for the time_series/columnar database types introduced
alongside capacity.py v5 — timescaledb, influxdb (time_series) and
snowflake, bigquery, redshift, clickhouse (columnar). The two serverless/
on-demand-billed warehouses (Snowflake, BigQuery) get a LOWER capacity
multiplier than a fixed cluster (Redshift, ClickHouse) despite costing
more per unit — they're genuinely not "one instance" the way this whole
module otherwise assumes, so the closest honest approximation is: fewer
effective concurrent-query "instances" for the same $, not more.

v3: added entries for database:vector (capacity.py v6) — pinecone,
weaviate, milvus, qdrant, chroma, and pgvector (which MUST be matched
before the plain "postgres" entry above — see its own comment). Same
managed-serverless-costs-more-per-unit pattern as v2's Snowflake/BigQuery
applies to Pinecone here.
"""
from __future__ import annotations

from dataclasses import dataclass

ENGINE_VERSION = "v3"


@dataclass(frozen=True)
class EngineSpec:
    capacity_multiplier: float
    cost_multiplier: float


NEUTRAL_ENGINE_SPEC = EngineSpec(1.0, 1.0)

# Specific managed/distributed variants are listed BEFORE their generic
# base-engine names — real free text often contains both ("Amazon Aurora
# PostgreSQL" contains "postgres" too), and the more specific variant is
# the one that actually explains a real cost/capacity difference. Matching
# stops at the first hit in this order, so this ordering is load-bearing,
# not cosmetic.
ENGINE_MULTIPLIERS: dict[str, EngineSpec] = {
    # "pgvector" MUST come before "postgres" below — free text like
    # "postgres with pgvector" contains both substrings, and matching
    # stops at the first hit in iteration order; pgvector is the more
    # specific, more informative match (a vector-search workload profile,
    # not a plain relational one) so it has to win.
    "pgvector": EngineSpec(1.1, 0.9),  # rides on existing Postgres infra — cheaper incremental cost than a dedicated vector DB
    # --- relational: managed/distributed variants before the base engines
    "aurora": EngineSpec(1.5, 1.4),  # managed, auto-scaling storage, real premium over vanilla RDS
    "cockroachdb": EngineSpec(1.2, 1.8),  # distributed-by-default; the multi-node overhead is real cost even at "small"
    "postgres": EngineSpec(1.0, 1.0),
    "postgresql": EngineSpec(1.0, 1.0),
    "mysql": EngineSpec(1.0, 1.0),
    "mariadb": EngineSpec(1.0, 0.95),
    # --- document
    "documentdb": EngineSpec(1.0, 1.3),  # AWS's Mongo-compatible managed service
    "firestore": EngineSpec(1.3, 1.2),  # serverless auto-scaling, different billing shape than a fixed instance
    "mongodb": EngineSpec(1.0, 1.0),
    # --- keyvalue
    "dynamodb": EngineSpec(3.0, 2.5),  # on-demand/provisioned-capacity billing, not really "one instance" at all
    "memcached": EngineSpec(1.1, 0.9),  # pure cache, no persistence overhead, typically cheaper than Redis
    "redis": EngineSpec(1.0, 1.0),
    # --- search
    "opensearch": EngineSpec(1.0, 0.95),
    "algolia": EngineSpec(0.8, 1.6),  # managed SaaS search API, not a self-hosted cluster
    "elasticsearch": EngineSpec(1.0, 1.0),
    # --- graph
    "neo4j": EngineSpec(1.0, 1.0),
    # --- vector (embedding similarity search) — managed/serverless before self-hosted, same pattern as columnar above
    "pinecone": EngineSpec(0.7, 2.0),  # managed serverless SaaS, billed per-unit not per-instance — same shape as Snowflake/BigQuery above
    "weaviate": EngineSpec(0.9, 1.1),  # self-hostable but a heavier resource footprint than a bare index
    "milvus": EngineSpec(0.8, 1.3),  # distributed architecture (even standalone mode carries real overhead), more moving parts than the others here
    "qdrant": EngineSpec(1.0, 1.0),  # self-hosted baseline this table's vector default (docker_images.py) is built around
    "chroma": EngineSpec(1.1, 0.8),  # lightweight, embedded-friendly, cheapest of this group at "small"
    # --- time_series
    "timescaledb": EngineSpec(1.0, 1.0),
    "influxdb": EngineSpec(1.0, 1.0),
    # --- columnar / data warehouse: managed serverless-billed variants before self-hosted
    "snowflake": EngineSpec(0.7, 2.2),  # serverless, billed by compute-second — few "instances", high $/unit
    "bigquery": EngineSpec(0.7, 1.8),  # same shape as Snowflake: on-demand query billing, not a fixed instance
    "redshift": EngineSpec(1.2, 1.5),  # fixed-cluster, more "instance"-shaped than the two above
    "clickhouse": EngineSpec(1.5, 1.0),  # self-hosted-friendly, genuinely fast at this tier, no serverless premium
    # --- queues (type="queue", point-to-point)
    "rabbitmq": EngineSpec(2.0, 1.3),  # real single-node RabbitMQ clears the base "queue" assumption by a wide margin
    "sqs": EngineSpec(1.0, 1.0),
    # --- pub/sub + streams (type="pubsub"/"stream")
    "kinesis": EngineSpec(1.0, 1.2),  # managed Kafka-alternative, comparable throughput, AWS-managed premium
    "kafka": EngineSpec(1.0, 1.0),
    "pubsub": EngineSpec(1.0, 1.1),  # Google Cloud Pub/Sub
}


def engine_spec_for(node: object) -> tuple[EngineSpec, str | None]:
    """Returns (spec, matched_name) — matched_name is None when nothing in
    the curated table matched (spec is then the neutral 1.0x/1.0x
    default). `getattr` rather than an isinstance check, same as
    sizing.py's size_spec_for: node kinds with no `engine` field at all
    (service/external_dependency/infra_node) just fall through to
    neutral, unaffected by this module."""
    engine = getattr(node, "engine", None)
    if not engine:
        return NEUTRAL_ENGINE_SPEC, None
    normalized = engine.strip().lower()
    for name, spec in ENGINE_MULTIPLIERS.items():
        if name in normalized:
            return spec, name
    return NEUTRAL_ENGINE_SPEC, None
