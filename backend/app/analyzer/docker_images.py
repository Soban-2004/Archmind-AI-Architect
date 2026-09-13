"""
Declared, curated mapping from a node's real `engine` (or, failing that,
its `type`) to a real, runnable Docker image — the same "substring match,
specific-before-generic, curated-not-exhaustive, honest fallback" shape as
engines.py, applied to a different question: not "how much does this cost"
but "what container actually stands this up locally".

This exists for services/starter_kit.py's docker-compose.yml generation.
The guiding rule throughout: NEVER invent an image or a working local
stand-in for something that doesn't have an honest one. A managed,
serverless, or cloud-only service (DynamoDB, Snowflake, a CDN, a service
mesh that only means something at the Kubernetes cluster level) gets NO
entry here on purpose — the generator emits a clearly-commented note
instead of a fake, non-functional service block. A database/cache/queue/
search engine that genuinely has a real open-source image, on the other
hand, gets one — that's most of them, and it's what makes the generated
compose file something you can actually `docker-compose up`, not just a
list of names.

Three infra_node types get a deliberate, explicitly-noted STAND-IN rather
than the "real" managed product, because the stand-in is what people
actually run locally for that role and is worth being explicit about:
- load_balancer / api_gateway -> nginx (a real, common local dev proxy —
  not what you'd run in front of an ALB/API Gateway in prod, but the
  honest local equivalent of "something routing requests")
- object_storage -> MinIO (S3-API-compatible, exactly what it's for)
- secrets_manager -> Vault in dev mode (real secrets storage, not
  persistent/production-hardened — noted as such)
- observability -> Grafana (a real starting point; wiring up real
  metrics/log sources is left to the person building this out)

Bump DOCKER_IMAGES_VERSION if any of these change.

v2: added entries for database:vector (state.py's newest database type) —
pgvector (must be matched before "postgres"/"postgresql", same reason as
engines.py's own pgvector entry), qdrant (also this type's TYPE_FALLBACK
default — self-hosted, single-container, genuinely simple to run),
weaviate, chroma, and two matched-but-deliberately-no-image cases:
pinecone (managed SaaS, no local image at all — Qdrant stands in) and
milvus (a real open-source engine, but its standalone mode needs etcd +
MinIO alongside it, too much for a single-service stand-in here).
"""
from __future__ import annotations

from dataclasses import dataclass, field

DOCKER_IMAGES_VERSION = "v2"


@dataclass(frozen=True)
class DockerImageSpec:
    image: str
    port: int
    # Env vars the CONTAINER ITSELF needs to boot (root password, auth
    # token, ...) — separate from the connection-string env vars a
    # *consuming service* needs, which starter_kit.py's .env.example
    # builds from the graph's real edges, not from this table.
    env: dict[str, str] = field(default_factory=dict)
    note: str = ""  # shown as a comment above the compose service block
    # In-container path to mount a named volume at, for anything that's
    # actually meant to persist data across restarts. None (the default)
    # means no volume — correct for a cache (redis/memcached: ephemeral by
    # nature) or an explicitly-dev-mode/in-memory stand-in (Vault dev
    # mode, DynamoDB Local), not an oversight.
    data_dir: str | None = None


# Specific/managed variants before generic base engines — same ordering
# discipline as engines.py's ENGINE_MULTIPLIERS, for the same reason (free
# text like "Amazon Aurora PostgreSQL" contains "postgres" too).
_ENGINE_IMAGES: dict[str, DockerImageSpec] = {
    # "pgvector" MUST come before "postgres"/"postgresql" below — same
    # substring-ordering reason as engines.py's own pgvector entry.
    "pgvector": DockerImageSpec("pgvector/pgvector:pg16", 5432, {"POSTGRES_PASSWORD": "changeme"}, "Postgres with the pgvector extension pre-installed", data_dir="/var/lib/postgresql/data"),
    "cockroachdb": DockerImageSpec("cockroachdb/cockroach:latest-v23.2", 26257, note="single-node --insecure dev mode, not how you'd run it in production", data_dir="/cockroach/cockroach-data"),
    "timescaledb": DockerImageSpec("timescale/timescaledb:latest-pg16", 5432, {"POSTGRES_PASSWORD": "changeme"}, data_dir="/var/lib/postgresql/data"),
    "aurora": DockerImageSpec("postgres:16-alpine", 5432, {"POSTGRES_PASSWORD": "changeme"}, "Aurora is AWS-managed and Postgres/MySQL-compatible; plain postgres stands in for local dev", data_dir="/var/lib/postgresql/data"),
    "postgres": DockerImageSpec("postgres:16-alpine", 5432, {"POSTGRES_PASSWORD": "changeme"}, data_dir="/var/lib/postgresql/data"),
    "postgresql": DockerImageSpec("postgres:16-alpine", 5432, {"POSTGRES_PASSWORD": "changeme"}, data_dir="/var/lib/postgresql/data"),
    "mariadb": DockerImageSpec("mariadb:11", 3306, {"MARIADB_ROOT_PASSWORD": "changeme"}, data_dir="/var/lib/mysql"),
    "mysql": DockerImageSpec("mysql:8", 3306, {"MYSQL_ROOT_PASSWORD": "changeme"}, data_dir="/var/lib/mysql"),
    "documentdb": DockerImageSpec("mongo:7", 27017, note="DocumentDB is AWS-managed and Mongo-wire-compatible; plain mongo stands in for local dev", data_dir="/data/db"),
    "firestore": DockerImageSpec("mongo:7", 27017, note="no real local equivalent for Firestore's model; mongo is the closest documented-store stand-in for local dev, expect real differences", data_dir="/data/db"),
    "mongodb": DockerImageSpec("mongo:7", 27017, data_dir="/data/db"),
    "dynamodb": DockerImageSpec("amazon/dynamodb-local:latest", 8000, note="AWS's own official local emulator, not a real DynamoDB"),
    "memcached": DockerImageSpec("memcached:1.6-alpine", 11211),
    "redis": DockerImageSpec("redis:7-alpine", 6379),
    "opensearch": DockerImageSpec("opensearchproject/opensearch:2.17.0", 9200, {"discovery.type": "single-node", "DISABLE_SECURITY_PLUGIN": "true"}, data_dir="/usr/share/opensearch/data"),
    "algolia": DockerImageSpec("opensearchproject/opensearch:2.17.0", 9200, {"discovery.type": "single-node", "DISABLE_SECURITY_PLUGIN": "true"}, "Algolia is a managed SaaS search API with no local image; a self-hosted OpenSearch stands in for local dev, indexing behavior will differ", data_dir="/usr/share/opensearch/data"),
    "elasticsearch": DockerImageSpec("docker.elastic.co/elasticsearch/elasticsearch:8.15.0", 9200, {"discovery.type": "single-node", "xpack.security.enabled": "false"}, data_dir="/usr/share/elasticsearch/data"),
    "neo4j": DockerImageSpec("neo4j:5", 7474, {"NEO4J_AUTH": "neo4j/changeme"}, data_dir="/data"),
    "pinecone": DockerImageSpec("qdrant/qdrant:latest", 6333, note="Pinecone is a managed serverless SaaS vector DB with no local image; self-hosted Qdrant stands in for local dev, indexing/query behavior will differ", data_dir="/qdrant/storage"),
    "weaviate": DockerImageSpec("semitechnologies/weaviate:1.26.1", 8080, {"QUERY_DEFAULTS_LIMIT": "25", "AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED": "true"}, data_dir="/var/lib/weaviate"),
    "qdrant": DockerImageSpec("qdrant/qdrant:latest", 6333, data_dir="/qdrant/storage"),
    "chroma": DockerImageSpec("chromadb/chroma:latest", 8000, data_dir="/chroma/chroma"),
    "influxdb": DockerImageSpec("influxdb:2", 8086, data_dir="/var/lib/influxdb2"),
    "clickhouse": DockerImageSpec("clickhouse/clickhouse-server:24", 8123, data_dir="/var/lib/clickhouse"),
    "snowflake": DockerImageSpec("clickhouse/clickhouse-server:24", 8123, note="Snowflake is a managed SaaS warehouse with no local image; self-hosted ClickHouse stands in for local dev, query behavior will differ", data_dir="/var/lib/clickhouse"),
    "bigquery": DockerImageSpec("clickhouse/clickhouse-server:24", 8123, note="BigQuery is a managed SaaS warehouse with no local image; self-hosted ClickHouse stands in for local dev, query behavior will differ", data_dir="/var/lib/clickhouse"),
    "redshift": DockerImageSpec("clickhouse/clickhouse-server:24", 8123, note="Redshift is a managed cluster with no local image; self-hosted ClickHouse stands in for local dev, query behavior will differ", data_dir="/var/lib/clickhouse"),
    "rabbitmq": DockerImageSpec("rabbitmq:3-management", 5672),
    "sqs": DockerImageSpec("softwaremill/elasticmq-native:latest", 9324, note="ElasticMQ, an SQS-API-compatible local emulator, not real SQS"),
    "kinesis": DockerImageSpec("localstack/localstack:latest", 4566, {"SERVICES": "kinesis"}, "LocalStack's Kinesis emulator, not real Kinesis"),
    "kafka": DockerImageSpec("bitnami/kafka:3.7", 9092, {"KAFKA_CFG_NODE_ID": "0", "KAFKA_CFG_PROCESS_ROLES": "controller,broker", "KAFKA_CFG_CONTROLLER_QUORUM_VOTERS": "0@kafka:9093"}, "single-node KRaft mode, not a real multi-broker cluster"),
    "pubsub": DockerImageSpec("gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators", 8085, note="Google's own Pub/Sub emulator, not real Pub/Sub"),
}

# A handful of engine names that ARE recognized but deliberately have NO
# entry in _ENGINE_IMAGES — checked after it (see docker_image_for), so a
# genuine match here still falls through to the node's TYPE-level default
# below, with an honest, specific note explaining why THIS engine
# specifically didn't get one, rather than the generic "not recognized"
# message an actually-unmatched engine gets.
_ENGINE_NO_IMAGE_NOTES: dict[str, str] = {
    "milvus": "Milvus standalone needs etcd + MinIO running alongside it — too much for a single-service stand-in here; see Milvus's own docker-compose reference for a real local setup",
}

# Fallback when `engine` is unset/unmatched — keyed by the node's `type`
# instead, so there's still a real default rather than a bare comment.
_TYPE_FALLBACK_IMAGES: dict[str, DockerImageSpec] = {
    "database:relational": _ENGINE_IMAGES["postgres"],
    "database:document": _ENGINE_IMAGES["mongodb"],
    "database:keyvalue": _ENGINE_IMAGES["redis"],
    "database:search": _ENGINE_IMAGES["elasticsearch"],
    "database:graph": _ENGINE_IMAGES["neo4j"],
    "database:time_series": _ENGINE_IMAGES["influxdb"],
    "database:columnar": _ENGINE_IMAGES["clickhouse"],
    "database:vector": _ENGINE_IMAGES["qdrant"],
    "queue:queue": _ENGINE_IMAGES["rabbitmq"],
    "queue:pubsub": _ENGINE_IMAGES["kafka"],
    "queue:stream": _ENGINE_IMAGES["kafka"],
}

# infra_node types with a real, honest local stand-in — see the module
# docstring for why these four and not the others.
_INFRA_TYPE_IMAGES: dict[str, DockerImageSpec] = {
    "load_balancer": DockerImageSpec("nginx:alpine", 80, note="a real local dev proxy standing in for a managed load balancer — not what you'd run in front of it in production"),
    "api_gateway": DockerImageSpec("nginx:alpine", 80, note="a real local dev proxy standing in for a managed API gateway — add routing/auth config as you build it out"),
    "object_storage": DockerImageSpec("minio/minio:latest", 9000, {"MINIO_ROOT_USER": "minioadmin", "MINIO_ROOT_PASSWORD": "changeme123"}, "MinIO, a real S3-API-compatible object store for local dev", data_dir="/data"),
    "secrets_manager": DockerImageSpec("hashicorp/vault:latest", 8200, {"VAULT_DEV_ROOT_TOKEN_ID": "dev-only-token"}, "Vault in dev mode — in-memory, NOT persistent, for local dev only"),
    "observability": DockerImageSpec("grafana/grafana:11.2.0", 3000, note="a real starting point — wire up your actual metrics/log sources as you build"),
}

# infra_node types with deliberately NO local stand-in — cloud/edge/
# cluster-level concepts that don't mean anything inside a single-host
# docker-compose file. Listed explicitly (rather than just "not in the
# dict above") so starter_kit.py can emit an honest, specific reason.
_INFRA_TYPE_NOTES: dict[str, str] = {
    "cdn": "CDNs are edge/cloud infrastructure with no meaningful local equivalent — document your CDN provider's config separately.",
    "dns": "DNS routing is provider-level (Route 53, Cloudflare, ...) — nothing to run locally.",
    "firewall_waf": "WAFs operate at the edge/cloud-provider level — nothing meaningful to run locally.",
    "container_runtime": "docker-compose IS the local container runtime here; this node represents your PRODUCTION orchestrator (e.g. Kubernetes) — not something to containerize itself.",
    "service_mesh": "service meshes (Istio, Linkerd, ...) operate at the Kubernetes-cluster level — not meaningful inside a single-host docker-compose file.",
}


def docker_image_for(node: object) -> tuple[DockerImageSpec | None, str | None]:
    """Returns (spec, note). spec is None when there's genuinely no honest
    local stand-in (note then explains why, for a comment in the generated
    file) — never a fabricated image for something that doesn't have one.
    `engine` is tried first (substring match, same discipline as
    engines.py), then a type-based fallback, then the infra_node-specific
    tables above."""
    node_kind = getattr(node, "node_kind", None)
    node_type = getattr(node, "type", None)
    node_type = getattr(node_type, "value", node_type)  # unwrap an Enum if that's what was passed

    engine = getattr(node, "engine", None)
    no_image_reason: str | None = None
    if engine:
        normalized = engine.strip().lower()
        for name, spec in _ENGINE_IMAGES.items():
            if name in normalized:
                return spec, spec.note or None
        for name, reason in _ENGINE_NO_IMAGE_NOTES.items():
            if name in normalized:
                no_image_reason = reason  # a RECOGNIZED engine with deliberately no image — falls through to the type default below with an honest, specific reason, not a generic "not recognized"
                break

    if node_kind in ("database", "queue") and node_type:
        spec = _TYPE_FALLBACK_IMAGES.get(f"{node_kind}:{node_type}")
        if spec is not None:
            if no_image_reason:
                note = f"{no_image_reason} — {spec.image} used as the default for {node_kind}:{node_type} instead"
            elif spec.note:
                note = spec.note
            elif engine:
                note = f"engine '{engine}' not recognized — {spec.image} used as the default for {node_kind}:{node_type}"
            else:
                note = f"no engine declared — {spec.image} used as the default for {node_kind}:{node_type}"
            return spec, note

    if node_kind == "infra_node" and node_type:
        spec = _INFRA_TYPE_IMAGES.get(node_type)
        if spec is not None:
            return spec, spec.note or None
        return None, _INFRA_TYPE_NOTES.get(node_type, "no local stand-in for this infra type")

    if engine:
        return None, f"no known local image for engine '{engine}' — replace with the real image before running"

    return None, None
