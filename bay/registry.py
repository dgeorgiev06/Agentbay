"""The registry: resolved system truth as JSON, the same for every runtime.

`.agentbay/catalog.json` is how a coordinator discovers what it can call: modes, their endpoints
with resolved input/output schemas, the roles placed behind agentic steps, and the project
workflows that compose endpoints. Nothing here is specific to a runtime - an adapter writes the
file and names itself in `runtime`, but the content is a fold of the resolved System.

Endpoint schemas are inlined (`model.type_schema` already resolves `$ref`s), because the only
reader that matters cannot open mode folders: the coordinator is told to reach data solely through
`bay call`, and `bay lint` must check a workflow's `with:` against the endpoint it calls without
re-implementing type lookup.
"""
from __future__ import annotations

import json
from pathlib import Path

from .ledger import now
from .model import ResolvedRole, System

CATALOG = ".agentbay/catalog.json"


def endpoint(mode, feat, kit_root: Path) -> dict:
    """One endpoint as the registry publishes it."""
    return {
        "name": f"{mode.name}.{feat.name}",
        "description": feat.description,
        "in": feat.in_type,
        "out": feat.out_type,
        "inSchema": feat.in_schema,
        "outSchema": feat.out_schema,
        "effects": feat.effects,
        "schedule": feat.schedule,
        "review": feat.review,
        "needs": mode.needs,
        "constraints": mode.constraints,
        "steps": [{"id": s.id, "kind": s.kind, "run": s.run, "role": s.role, "subagent": s.subagent, "env": s.env}
                  for s in feat.steps],
        "playbook": str(feat.playbook_path.relative_to(kit_root))
                    if feat.playbook_path and _under(feat.playbook_path, kit_root) else None,
    }


def _under(p: Path, root: Path) -> bool:
    try:
        p.relative_to(root)
    except ValueError:
        return False
    return True


def catalog(system: System, placements: dict[str, ResolvedRole], *, runtime: str,
            workflows: dict | None = None) -> dict:
    modes = [{
        "name": m.name, "version": m.version, "origin": m.root, "purpose": m.purpose, "extends": m.extends,
        "coordinator": m.coordinator, "roles": m.roles, "constraints": m.constraints, "needs": m.needs,
        "endpoints": [endpoint(m, f, system.kit.root) for f in m.features.values()],
    } for m in system.modes.values()]
    roles = [{
        "subagent": sub, "role": r.name, "agent": r.agent, "env": r.env, "runtime": r.runtime,
        "model": r.inference.model, "effort": r.inference.effort, "description": r.description,
        "tools": r.tools, "uses": r.uses, "skills": sorted(r.skills), "clis": r.clis,
        "budget": r.budget, "modes": r.modes,
        "io": {"accepts": "TaskEnvelope/v1", "returns": "Result/v1"},
    } for sub, r in sorted(placements.items())]
    coords = [{"role": r.name, "modes": r.modes, "runtime": r.runtime}
              for r in system.roles.values() if r.runtime == "claude-code-main" and r.modes]
    out = {"runtime": runtime, "builtAt": now(), "modes": modes, "roles": roles, "coordinators": coords}
    if workflows is not None:
        out["workflows"] = workflows
    return out


def write(system: System, placements: dict[str, ResolvedRole], project: Path, *, runtime: str,
          workflows: dict | None = None) -> str:
    """Write the catalog and return its project-relative path."""
    path = project / CATALOG
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(catalog(system, placements, runtime=runtime, workflows=workflows),
                               indent=2, ensure_ascii=False) + "\n")
    return CATALOG


def load(project: Path) -> dict:
    """Read the built catalog. Raises FileNotFoundError with the command that writes it."""
    path = project / CATALOG
    if not path.exists():
        raise FileNotFoundError(f"{CATALOG} does not exist; run `bay build --project {project}` first")
    return json.loads(path.read_text())
