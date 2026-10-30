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

from .model import KIT, System, schema, schema_errors

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


def check(folder: Path) -> tuple[dict, list[str]]:
    """Read and check adapters/<folder>/adapter.yaml without importing anything: (manifest, problems).
    Checks the schema, that `name` equals the folder and that `module` is a file inside the folder."""
    y = folder / "adapter.yaml"
    try:
        meta = yaml.safe_load(y.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as e:
        return {}, [f"{y}: unreadable: {e}"]
    if not isinstance(meta, dict):
        return {}, [f"{y}: must be a mapping with name, module and class"]
    errs = [f"{y}: {e}" for e in schema_errors(meta, schema("adapter"))]
    if meta.get("name") != folder.name:
        errs.append(f"{y}: name '{meta.get('name')}' must match its folder '{folder.name}'")
    mod = meta.get("module")
    if not isinstance(mod, str) or not mod:
        errs.append(f"{y}: module is required")
    else:
        path = (folder / mod).resolve()
        if not path.is_relative_to(folder.resolve()):
            errs.append(f"{y}: module '{mod}' must be inside the adapter folder")
        elif not path.is_file():
            errs.append(f"{y}: module '{mod}' does not exist")
    if not isinstance(meta.get("class"), str):
        errs.append(f"{y}: class is required")
    return meta, list(dict.fromkeys(errs))


def scan(root: Path = ADAPTERS) -> tuple[dict[str, tuple[Path, dict]], dict[str, list[str]]]:
    """Every adapters/<folder>/adapter.yaml, checked: (folder -> (path, manifest) for good entries,
    folder -> problems for bad ones). Imports nothing."""
    good: dict[str, tuple[Path, dict]] = {}
    bad: dict[str, list[str]] = {}
    for y in sorted(root.glob("*/adapter.yaml")):
        meta, errs = check(y.parent)
        if errs:
            bad[y.parent.name] = errs
        else:
            good[y.parent.name] = (y.parent, meta)
    return good, bad


def discover(root: Path = ADAPTERS, problems: list[str] | None = None) -> dict[str, Path]:
    """name -> adapter folder, for every well-formed adapters/<name>/adapter.yaml. A bad entry is left out and
    its problems appended to `problems` (when given), so one broken runtime cannot stop another's build or clean."""
    good, bad = scan(root)
    if problems is not None:
        problems += [e for errs in bad.values() for e in errs]
    return {name: folder for name, (folder, _) in good.items()}


def module_key(folder: str) -> str:
    """The sys.modules key of the adapter in adapters/<folder>/. Injective in the folder name (every character
    other than a letter or digit is escaped, `_` included), so claude-code and claude_code never share a key."""
    return "agentbay_adapter_" + "".join(c if c.isascii() and c.isalnum() else f"_{ord(c):02x}" for c in folder)


def _entry(name: str, root: Path) -> tuple[Path, dict]:
    good, bad = scan(root)
    if name in bad:
        raise ValueError(f"runtime '{name}' is not loadable:\n  - " + "\n  - ".join(bad[name]))
    if name not in good:
        raise KeyError(f"unknown runtime '{name}' (have: {', '.join(good) or 'none'}; "
                       f"add adapters/<name>/adapter.yaml)")
    return good[name]


def module(name: str, root: Path = ADAPTERS) -> ModuleType:
    """Load (once) the module of adapter <name>. Only that adapter's code is imported."""
    folder, meta = _entry(name, root)
    key = module_key(folder.name)
    if key in sys.modules:
        return sys.modules[key]
    spec = importlib.util.spec_from_file_location(key, (folder / meta["module"]).resolve())
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
    _, meta = _entry(name, root)
    cls = getattr(mod, meta["class"])
    inst = cls()
    if not isinstance(inst, Adapter) or inst.name != name:
        raise TypeError(f"adapters/{name}: {meta['class']} does not satisfy the Adapter protocol (name '{name}')")
    return inst
