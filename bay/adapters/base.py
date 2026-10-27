"""The Adapter contract: ResolvedAgent[] in, runtime config out.

An adapter must:
  * be idempotent (build twice == build once)
  * only touch files it owns, tracked in .agentbay/manifest.json
  * preserve anything the user wrote by hand (merge, never clobber)
  * write .agentbay/catalog.json so coordinators can discover agents
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

from ..model import ResolvedAgent


@dataclass
class BuildReport:
    runtime: str
    written: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@runtime_checkable
class Adapter(Protocol):
    name: str

    def build(self, agents: list[ResolvedAgent], project: Path, kit: Path) -> BuildReport: ...

    def clean(self, project: Path) -> BuildReport: ...
