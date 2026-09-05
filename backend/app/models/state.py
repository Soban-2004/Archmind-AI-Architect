"""
Architecture State schema (spec §3.1 / §3.2).

This is the single shared representation everything else in the system reads
from and writes to. The LLM never emits this directly — it only ever emits
MutationCommands (see commands.py), which are validated and applied to
produce a new ArchitectureState version.
"""
from __future__ import annotations

import uuid
from enum import Enum
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field


def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Node types
# ---------------------------------------------------------------------------

class ServiceType(str, Enum):
    gateway = "gateway"
    service = "service"
    worker = "worker"
    frontend = "frontend"
    edge_cdn = "edge_cdn"


class ScalingMode(str, Enum):
    stateless = "stateless"
    stateful = "stateful"


class Service(BaseModel):
    id: str
    node_kind: Literal["service"] = "service"
    name: str
    type: ServiceType
    language: Optional[str] = None
    responsibilities: Optional[str] = None
    scaling_mode: ScalingMode = ScalingMode.stateless


class DatabaseType(str, Enum):
    relational = "relational"
    document = "document"
    keyvalue = "keyvalue"
    search = "search"
    graph = "graph"


class DatabaseRole(str, Enum):
    primary = "primary"
    replica = "replica"
    cache = "cache"


class Database(BaseModel):
    id: str
    node_kind: Literal["database"] = "database"
    name: str
    type: DatabaseType
    engine: str
    role: DatabaseRole = DatabaseRole.primary


class QueueType(str, Enum):
    queue = "queue"
    pubsub = "pubsub"
    stream = "stream"


class Queue(BaseModel):
    id: str
    node_kind: Literal["queue"] = "queue"
    name: str
    type: QueueType
    engine: str


class ExternalDependencyType(str, Enum):
    third_party_api = "third_party_api"
    payment = "payment"
    market_data = "market_data"
    auth_provider = "auth_provider"
    storage = "storage"


class Criticality(str, Enum):
    hard = "hard"
    soft = "soft"


class ExternalDependency(BaseModel):
    id: str
    node_kind: Literal["external_dependency"] = "external_dependency"
    name: str
    type: ExternalDependencyType
    criticality: Criticality = Criticality.soft


class InfraType(str, Enum):
    cdn = "cdn"
    load_balancer = "load_balancer"
    api_gateway = "api_gateway"
    object_storage = "object_storage"
    container_runtime = "container_runtime"


class InfraNode(BaseModel):
    id: str
    node_kind: Literal["infra_node"] = "infra_node"
    name: str
    type: InfraType


Node = Annotated[
    Union[Service, Database, Queue, ExternalDependency, InfraNode],
    Field(discriminator="node_kind"),
]

NODE_KIND_TO_MODEL = {
    "service": Service,
    "database": Database,
    "queue": Queue,
    "external_dependency": ExternalDependency,
    "infra_node": InfraNode,
}


# ---------------------------------------------------------------------------
# Edges
# ---------------------------------------------------------------------------

class Protocol(str, Enum):
    http = "http"
    grpc = "grpc"
    queue = "queue"
    sql = "sql"
    cache = "cache"


class SyncAsync(str, Enum):
    sync = "sync"
    async_ = "async"


class Edge(BaseModel):
    id: str
    from_id: str
    to_id: str
    protocol: Protocol
    sync_async: SyncAsync
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

class ConstraintType(str, Enum):
    budget_monthly_usd = "budget_monthly_usd"
    expected_users = "expected_users"
    expected_rps = "expected_rps"
    availability_target = "availability_target"
    consistency_requirement = "consistency_requirement"
    latency_target_ms = "latency_target_ms"


class Constraint(BaseModel):
    type: ConstraintType
    value: str  # stored as string; interpretation depends on `type`


# ---------------------------------------------------------------------------
# ADRs
# ---------------------------------------------------------------------------

class TriggeredBy(str, Enum):
    user_request = "user_request"
    ai_recommendation = "ai_recommendation"
    simulation_finding = "simulation_finding"


class ADR(BaseModel):
    id: str
    decision: str
    rationale: str
    triggered_by: TriggeredBy
    superseded_by: Optional[str] = None


# ---------------------------------------------------------------------------
# The state itself
# ---------------------------------------------------------------------------

class ArchitectureState(BaseModel):
    """The full semantic graph for one version. No layout/position data lives
    here — presentation metadata (node x/y) is stored separately per version
    so the LLM can never influence it (see db/schema.sql `layout` column)."""

    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    constraints: list[Constraint] = Field(default_factory=list)
    adrs: list[ADR] = Field(default_factory=list)

    def node_ids(self) -> set[str]:
        return {n.id for n in self.nodes}

    def get_node(self, node_id: str):
        for n in self.nodes:
            if n.id == node_id:
                return n
        return None

    def get_edge(self, edge_id: str) -> Optional[Edge]:
        for e in self.edges:
            if e.id == edge_id:
                return e
        return None


def empty_state() -> ArchitectureState:
    return ArchitectureState()
