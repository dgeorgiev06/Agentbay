"""Contracts in code: load, validate, and resolve AgentSpecs against Layers.

The output of this module, `ResolvedAgent`, is the ONLY thing adapters see.
Adapters never read YAML or layers directly, so the spec format can evolve
without touching runtimes, and runtimes can be added without touching specs.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import yaml

try:
    import jsonschema  # optional but recommended
except ImportError:  # pragma: no cover
    jsonschema = None

ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "schemas"


class SpecError(Exception):
    pass


def _schema(name: str) -> dict:
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text())


def _validate(doc: dict, schema_name: str, where: Path) -> None:
    if jsonschema is None:
        for key in ("apiVersion", "kind", "metadata", "spec"):
            if key not in doc:
                raise SpecError(f"{where}: missing '{key}'")
        return
    errors = sorted(jsonschema.Draft202012Validator(_schema(schema_name)).iter_errors(doc), key=str)
    if errors:
        msgs = "\n  ".join(f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in errors)
        raise SpecError(f"{where}:\n  {msgs}")


def _load_yaml(path: Path) -> dict:
    try:
        doc = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        raise SpecError(f"{path}: invalid YAML: {e}") from e
    if not isinstance(doc, dict):
        raise SpecError(f"{path}: expected a mapping")
    return doc


@dataclass
class Layer:
    name: str
    tier: str
    requires: list[str]
    tools: list[str]
    mcp_servers: dict
    skills: list[str]
    clis: list[str]
    prompt: str
    path: Path


@dataclass
class ResolvedAgent:
    """Runtime-agnostic, fully merged agent. The adapter input contract."""
    name: str
    description: str
    version: str
    role: str
    model: str
    tools: list[str]
    mcp_servers: dict
    skills: dict[str, Path]          # skill name -> source folder
    clis: list[str]
    isolation: str
    budget: dict
    layers: list[str]                # fully expanded, in order
    prompt: str                      # layer fragments + agent prompt
    source: Path
    labels: dict = field(default_factory=dict)


def load_layers(layers_dir: Path) -> dict[str, Layer]:
    out: dict[str, Layer] = {}
    for f in sorted(layers_dir.glob("*/layer.yaml")):
        doc = _load_yaml(f)
        _validate(doc, "layer", f)
        m, s = doc["metadata"], doc.get("spec", {})
        if m["name"] != f.parent.name:
            raise SpecError(f"{f}: metadata.name '{m['name']}' must match folder '{f.parent.name}'")
        out[m["name"]] = Layer(
            name=m["name"], tier=m.get("tier", "domain"),
            requires=s.get("requires", []), tools=s.get("tools", []),
            mcp_servers=s.get("mcpServers", {}), skills=s.get("skills", []),
            clis=s.get("clis", []), prompt=(s.get("prompt") or "").strip(), path=f.parent,
        )
    return out


def _expand(names: list[str], layers: dict[str, Layer], trail: tuple = ()) -> list[str]:
    order: list[str] = []
    for n in names:
        if n in trail:
            raise SpecError(f"layer cycle: {' -> '.join(trail + (n,))}")
        if n not in layers:
            raise SpecError(f"unknown layer '{n}' (have: {', '.join(sorted(layers)) or 'none'})")
        for dep in _expand(layers[n].requires, layers, trail + (n,)):
            if dep not in order:
                order.append(dep)
        if n not in order:
            order.append(n)
    return order


def _union(*lists: list[str]) -> list[str]:
    seen: list[str] = []
    for lst in lists:
        for x in lst:
            if x not in seen:
                seen.append(x)
    return seen


def resolve(spec_path: Path, layers: dict[str, Layer]) -> ResolvedAgent:
    doc = _load_yaml(spec_path)
    _validate(doc, "agentspec", spec_path)
    m, s = doc["metadata"], doc["spec"]
    if m["name"] != spec_path.stem:
        raise SpecError(f"{spec_path}: metadata.name '{m['name']}' must match filename '{spec_path.stem}'")

    order = _expand(s.get("layers", []), layers)
    ls = [layers[n] for n in order]

    deny = set(s.get("denyTools", []))
    tools = [t for t in _union(*(l.tools for l in ls), s.get("tools", [])) if t not in deny]

    mcp: dict = {}
    for l in ls:
        for name, cfg in l.mcp_servers.items():
            if name in mcp and mcp[name] != cfg:
                raise SpecError(f"MCP server '{name}' defined differently by two layers")
            mcp[name] = cfg

    skills: dict[str, Path] = {}
    for l in ls:
        for sk in l.skills:
            src = l.path / "skills" / sk
            if not (src / "SKILL.md").exists():
                raise SpecError(f"layer '{l.name}' lists skill '{sk}' but {src}/SKILL.md is missing")
            skills[sk] = src
    for sk in s.get("skills", []):
        if sk not in skills:
            raise SpecError(f"{spec_path}: skill '{sk}' not provided by any of its layers")

    clis = _union(*(l.clis for l in ls), s.get("clis", []))
    if clis and "Bash" not in tools:
        raise SpecError(f"{spec_path}: declares CLIs {clis} but has no Bash tool")

    fragments = [f"<!-- layer: {l.name} -->\n{l.prompt}" for l in ls if l.prompt]
    prompt = "\n\n".join(fragments + [s["prompt"].strip()])

    return ResolvedAgent(
        name=m["name"], description=m["description"].strip(), version=m.get("version", "0.1.0"),
        role=s.get("role", "worker"), model=s["model"], tools=tools, mcp_servers=mcp,
        skills=skills, clis=clis, isolation=s.get("isolation", "none"),
        budget=s.get("budget", {}), layers=order, prompt=prompt, source=spec_path,
        labels=m.get("labels", {}),
    )


def resolve_all(specs_dir: Path, layers_dir: Path) -> list[ResolvedAgent]:
    layers = load_layers(layers_dir)
    agents = [resolve(p, layers) for p in sorted(specs_dir.glob("*.yaml"))]
    names = [a.name for a in agents]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise SpecError(f"duplicate agent names: {dupes}")
    return agents
