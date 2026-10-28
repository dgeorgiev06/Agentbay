"""Migrations of user content across framework versions.

`plan()` is a dry run: it returns the changes and a unified diff and writes
nothing. `apply()` performs exactly the planned changes. Each migration is a
function (kit) -> list[Change]; add one per contract change and register it
in MIGRATIONS with the version it migrates to.

0.2.0: v0.1 AgentSpec (specs/*.yaml) -> Role (roles/*.yaml); v0.1 Layer
       folders (layers/*) are removed; their tools map to capability
       interfaces bound in framework envs.
"""
from __future__ import annotations

import difflib
import shutil
from dataclasses import dataclass, asdict
from pathlib import Path

import yaml

from . import __version__

LAYER_CAPS = {  # v0.1 layer -> v0.2 capability interfaces
    "base": ["workspace.read/v1"],
    "code": ["workspace.read/v1", "workspace.write/v1"],
    "research": ["workspace.read/v1", "web.research/v1"],
    "review": ["workspace.read/v1", "git.read/v1"],
}


@dataclass
class Change:
    op: str            # create | delete | update
    path: str          # relative to kit
    content: str = ""  # new content for create/update
    note: str = ""


def _v1_specs_to_roles(kit: Path) -> tuple[list[Change], list[str]]:
    changes, notes = [], []
    for f in sorted((kit / "specs").glob("*.yaml")):
        doc = yaml.safe_load(f.read_text()) or {}
        if doc.get("kind") != "AgentSpec":
            continue
        m, s = doc.get("metadata", {}), doc.get("spec", {})
        name = m.get("name", f.stem)
        if s.get("role") == "coordinator":
            changes.append(Change("delete", _rel(kit, f), note="coordinator specs are replaced by the Chief of Staff "
                                                              "and mode coordinator roles"))
            continue
        uses: list[str] = []
        for layer in s.get("layers", []) or ["base"]:
            for cap in LAYER_CAPS.get(layer, []):
                if cap not in uses:
                    uses.append(cap)
            if layer not in LAYER_CAPS:
                notes.append(f"{name}: layer '{layer}' has no v0.2 capability mapping; add an interface + env binding")
        role = {
            "apiVersion": "agentbay/v2", "kind": "Role",
            "metadata": {"name": name, "description": " ".join(str(m.get("description", "TODO")).split())},
            "spec": {
                "agent": "worker", "uses": uses,
                **({"inference": {"model": s["model"]}} if s.get("model") not in (None, "inherit") else {}),
                **({"isolation": s["isolation"]} if s.get("isolation", "none") != "none" else {}),
                **({"budget": s["budget"]} if s.get("budget") else {}),
                "prompt": s.get("prompt", "TODO"),
                "doneWhen": ["TODO a checkable statement (migrated from v0.1)"],
            },
        }
        target = kit / "roles" / f"{name}.yaml"
        fw = kit / "framework" / "roles" / f"{name}.yaml"
        if fw.exists():
            changes.append(Change("delete", _rel(kit, f), note=f"framework role '{name}' replaces this spec"))
            continue
        if target.exists():
            notes.append(f"{name}: roles/{name}.yaml already exists; left specs/{f.name} alone")
            continue
        changes.append(Change("create", f"roles/{name}.yaml", yaml.safe_dump(role, sort_keys=False, width=100),
                              note=f"AgentSpec {name} -> Role {name}"))
        changes.append(Change("delete", _rel(kit, f), note=f"replaced by roles/{name}.yaml"))
    for f in sorted((kit / "layers").glob("*/layer.yaml")):
        changes.append(Change("delete", _rel(kit, f.parent), note="v0.1 Layer removed; capabilities come from "
                                                                 "interfaces bound in an env"))
    return changes, notes


MIGRATIONS = [("0.2.0", _v1_specs_to_roles)]


def _rel(kit: Path, p: Path) -> str:
    return str(p.relative_to(kit))


def _diff(kit: Path, changes: list[Change]) -> str:
    out = []
    for c in changes:
        p = kit / c.path
        if c.op == "delete":
            old = "".join(x.read_text() for x in sorted(p.rglob("*")) if x.is_file()) if p.is_dir() else (
                p.read_text() if p.exists() else "")
            new = ""
        else:
            old = p.read_text() if p.exists() else ""
            new = c.content
        out += difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                                    f"a/{c.path}" if old else "/dev/null", f"b/{c.path}" if new else "/dev/null")
    return "".join(out)


def _collect(kit: Path, to: str | None):
    to = to or __version__
    changes, notes = [], []
    for ver, fn in MIGRATIONS:
        if _vt(ver) <= _vt(to):
            c, n = fn(kit)
            changes += c
            notes += n
    return changes, notes


def _vt(v: str) -> tuple:
    return tuple(int(x) for x in v.split("."))


def plan(kit: Path, to: str | None = None) -> dict:
    changes, notes = _collect(kit, to)
    return {"changes": [{"op": c.op, "path": c.path, "note": c.note} for c in changes],
            "diff": _diff(kit, changes), "notes": notes}


def apply(kit: Path, to: str | None = None) -> dict:
    changes, notes = _collect(kit, to)
    for c in changes:
        p = kit / c.path
        if c.op == "delete":
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(c.content)
    for d in ("specs", "layers"):
        if (kit / d).is_dir() and not any((kit / d).iterdir()):
            (kit / d).rmdir()
    return {"changes": [{"op": c.op, "path": c.path, "note": c.note} for c in changes],
            "applied": len(changes), "notes": notes}


__all__ = ["plan", "apply", "Change", "asdict"]
