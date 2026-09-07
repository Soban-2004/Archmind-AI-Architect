"""
Declared instance-size tiers — a companion dataset to capacity.py/cost.py,
same philosophy: fixed, versioned, inspectable numbers, never something the
LLM (or this module) computes or invents per run.

Before this existed, capacity_for()/monthly_cost_for() assumed every node
of a given kind was identically "one small instance" — the only thing that
ever varied was how MANY instances a node's declared load needed (v2 of
cost.py). There was no way to represent a node as deliberately bigger or
smaller than that, and nowhere in the UI to see or set one.

A node's `size` (see models/state.py's InstanceSize) is a t-shirt tier —
small/medium/large/xlarge — not a specific vendor instance type. That's
deliberate: real cloud pricing depends on region, vendor, and commitment
level this tool has no way to know (see cost.py's own module docstring),
and naming a specific SKU ("t3.medium") would quietly imply an accuracy
this doesn't have, while also tying a vendor-agnostic tool to one vendor's
naming. The vCPU/RAM figures below are representative of that tier, not a
claim about any real machine.

Bigger tiers scale capacity linearly with their multiplier (a "large"
instance really does absorb 4x the traffic a "small" one does, by
assumption) but cost slightly SUB-linearly — the real-world pattern where
a bigger box costs a bit less per unit of capacity than the same capacity
spread across more small boxes, so sizing up is a genuine, sometimes-
favorable tradeoff against provisioning more instances, not a wash.

Bump SIZING_VERSION if any of these numbers change.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.models.state import InstanceSize

SIZING_VERSION = "v1"

# Rough monthly USD per GB of provisioned database storage — independent of
# `size` above (storage is about data volume, not request throughput).
# One flat rate across engines, same "single declared assumption" spirit
# as everything else here; a real bill varies by storage class (e.g. SSD
# vs. HDD-backed) this tool has no way to know.
STORAGE_COST_PER_GB_USD = 0.12


@dataclass(frozen=True)
class SizeSpec:
    label: str
    vcpu: int
    ram_gb: int
    capacity_multiplier: float
    cost_multiplier: float


SIZE_SPECS: dict[InstanceSize, SizeSpec] = {
    InstanceSize.small: SizeSpec("Small", vcpu=1, ram_gb=2, capacity_multiplier=1.0, cost_multiplier=1.0),
    InstanceSize.medium: SizeSpec("Medium", vcpu=2, ram_gb=4, capacity_multiplier=2.0, cost_multiplier=1.8),
    InstanceSize.large: SizeSpec("Large", vcpu=4, ram_gb=8, capacity_multiplier=4.0, cost_multiplier=3.4),
    InstanceSize.xlarge: SizeSpec("XLarge", vcpu=8, ram_gb=16, capacity_multiplier=8.0, cost_multiplier=6.4),
}


def size_spec_for(node: object) -> SizeSpec:
    """Reads a node's declared `size` (defaulting to small for any node
    kind that doesn't carry the field at all — external_dependency,
    infra_node — so their capacity/cost are completely unaffected by this
    module; `getattr` rather than an isinstance check keeps this module
    from needing to import every node type)."""
    size = getattr(node, "size", InstanceSize.small)
    return SIZE_SPECS.get(size, SIZE_SPECS[InstanceSize.small])
