"""The Adapter contract: a resolved System in, runtime config out. Adapters are discovered by folder.

Each runtime is a folder adapters/<name>/ holding adapter.yaml (name, module, class) and its module.
There is no registry to edit: a new runtime is a new folder.

An adapter must:
  * be idempotent (build twice == build once)
  * only touch files it owns, tracked in .agentbay/manifest.json
  * preserve anything the user wrote by hand (merge, never clobber)
  * write the registry (bay.registry.write) so coordinators can discover modes, endpoints,
    roles and project workflows. The catalog's content is runtime-neutral system truth; an
    adapter supplies only its own `runtime` name, it does not decide what goes in.
"""
from __future__ import annotations

import importlib.util
import sys
from dataclasses import dataclass, field
from pathlib import Path
from types import ModuleType
from typing import Protocol, runtime_checkable

import yaml

from .model import KIT, System

ADAPTERS = KIT / "adapters"


@dataclass
class BuildReport:
    runtime: str
    written: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@runtime_checkable
class Adapter(Protocol):
    name: str

    def build(self, system: System, project: Path, kit: Path) -> BuildReport: ...

    def clean(self, project: Path) -> BuildReport: ...


def discover(root: Path = ADAPTERS) -> dict[str, Path]:
    """name -> adapter folder, for every adapters/<name>/adapter.yaml."""
    out: dict[str, Path] = {}
    for y in sorted(root.glob("*/adapter.yaml")):
        meta = yaml.safe_load(y.read_text()) or {}
        name = meta.get("name") or y.parent.name
        if name != y.parent.name:
            raise ValueError(f"{y}: name '{name}' must match its folder '{y.parent.name}'")
        out[name] = y.parent
    return out


def module(name: str, root: Path = ADAPTERS) -> ModuleType:
    """Load (once) the module of adapter <name>."""
    found = discover(root)
    if name not in found:
        raise KeyError(f"unknown runtime '{name}' (have: {', '.join(found) or 'none'}; add adapters/<name>/adapter.yaml)")
    folder = found[name]
    meta = yaml.safe_load((folder / "adapter.yaml").read_text()) or {}
    path = (folder / meta["module"]).resolve()
    if not path.is_relative_to(folder.resolve()):
        raise ValueError(f"{folder}/adapter.yaml: module must be inside the adapter folder")
    key = f"agentbay_adapter_{name.replace('-', '_')}"
    if key in sys.modules:
        return sys.modules[key]
    spec = importlib.util.spec_from_file_location(key, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[key] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(key, None)
        raise
    return mod


def get(name: str, root: Path = ADAPTERS) -> Adapter:
    """A new instance of adapter <name>, found by folder."""
    mod = module(name, root)
    folder = discover(root)[name]
    meta = yaml.safe_load((folder / "adapter.yaml").read_text()) or {}
    cls = getattr(mod, meta["class"])
    inst = cls()
    if not isinstance(inst, Adapter) or inst.name != name:
        raise TypeError(f"adapters/{name}: {meta['class']} does not satisfy the Adapter protocol (name '{name}')")
    return inst
