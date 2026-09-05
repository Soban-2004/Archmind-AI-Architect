"""
Simulation contract (spec §6 Phase 7). This is explicitly a CONSTRAINT-BASED
HEURISTIC capacity model, not a validated discrete-event queueing simulator
— every number here comes from a declared, documented assumption
(app/analyzer/capacity.py), not measured real-world data. State that
plainly wherever this is surfaced (README, UI, demo narration) so it's
never mistaken for real load-testing (spec §11).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

LoadStatus = Literal["ok", "warning", "overloaded", "killed"]


class NodeLoad(BaseModel):
    node_id: str
    node_name: str
    incoming_rps: float
    capacity_rps: float
    utilization_pct: float
    status: LoadStatus
    basis: str  # which declared assumption produced this capacity number


class SimulationFinding(BaseModel):
    order: int  # 1 = most overloaded / first likely to fail
    node_id: str
    node_name: str
    message: str


class EdgeLoad(BaseModel):
    edge_id: str
    from_id: str
    to_id: str
    rps: float


class SimulationResult(BaseModel):
    scenario: str
    multiplier: float
    killed_node_ids: list[str]
    loads: list[NodeLoad]
    edge_loads: list[EdgeLoad]
    findings: list[SimulationFinding]


class SimulationRequest(BaseModel):
    multiplier: float = 1.0
    kill_node_ids: list[str] = []
