"""Project/kit files and the reference graph (artifacts.read/v1).

Nodes are agentbay concepts (modes, endpoints, roles, agents, envs, connectors, interfaces, data schemas,
mode types, skills, mode config keys) and Python modules and definitions. A node's `refs` counts what
references it: graph edges (mode -> role, mode -> env, mode -> agent profile, env -> connector, ...), Python name/attribute uses
(AST) and mentions in code, config or playbooks. Docs (docs/, README) never count as references.
"""
from __future__ import annotations

import ast
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

SKIP_DIRS = {".git", "__pycache__", ".agentbay", ".claude", "node_modules", ".venv", "venv", ".mypy_cache",
             ".pytest_cache", ".tox", "dist", "build"}
TEXT_EXT = {".py", ".yaml", ".yml", ".json", ".md", ".tmpl", ".sh", ".txt", ".toml", ".cfg"}
ENTRY_FILES = {"conftest.py", "__init__.py", "setup.py", "__main__.py"}
KEEP_NAMES = {"setUp", "tearDown"}


def kind_of(rel: str) -> str:
    p = Path(rel)
    parts, name = p.parts, p.name
    if "tests" in parts or name.startswith("test_") or name == "conftest.py":
        return "test"
    if name == "mode.yaml":
        return "mode"
    if name == "playbook.md":
        return "playbook"
    if name == "rules.yaml" or (len(parts) >= 2 and parts[-2] == "rules" and name.endswith(".yaml")):
        return "rules"
    if name == "SKILL.md":
        return "skill"
    if name == "connector.yaml":
        return "connector"
    if name.endswith(".schema.json"):
        return "type" if "types" in parts else "schema"
    for folder, k in (("roles", "role"), ("agents", "agent"), ("envs", "env"), ("interfaces", "interface")):
        if folder in parts and name.endswith(".yaml") and parts[-2] == folder:
            return k
    if name.endswith(".py") or name.endswith(".tmpl"):
        return "python"
    if parts and parts[0] == "docs" or name.endswith(".md"):
        return "doc"
    if name.endswith((".yaml", ".yml", ".json", ".toml", ".cfg")):
        return "config"
    return "other"


def walk(root: Path) -> list[Path]:
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.endswith(".egg-info"))
        for f in sorted(fns):
            p = Path(dp) / f
            if p.is_file() and not p.is_symlink():
                out.append(p)
    return out


def files(root: Path) -> list[dict]:
    out = []
    for p in walk(root):
        rel = p.relative_to(root).as_posix()
        size = p.stat().st_size
        lines = None
        if p.suffix in TEXT_EXT and size < 2_000_000:
            try:
                lines = p.read_text(encoding="utf-8").count("\n") + 1
            except (UnicodeDecodeError, OSError):
                lines = None
        out.append({"path": rel, "kind": kind_of(rel), "size": size, **({"lines": lines} if lines else {})})
    return out


def is_doc(rel: str) -> bool:
    return rel.startswith("docs/") or rel in ("README.md", "CHANGELOG.md")


@dataclass
class Graph:
    root: Path
    nodes: dict = field(default_factory=dict)        # id -> {id, kind, name, path, line?, refs}
    edges: list = field(default_factory=list)        # (from, to, kind)
    texts: dict = field(default_factory=dict)        # rel -> text (non-doc text files)
    py: dict = field(default_factory=dict)           # rel -> ast.Module

    def node(self, nid: str, kind: str, name: str, path: str | None, line: int | None = None) -> None:
        self.nodes.setdefault(nid, {"id": nid, "kind": kind, "name": name, "path": path, "line": line, "refs": 0})

    def edge(self, a: str, b: str, kind: str) -> None:
        if b in self.nodes and a != b:
            self.edges.append((a, b, kind))

    def as_dict(self) -> dict:
        return {"nodes": [{k: v for k, v in n.items() if v is not None} for n in self.nodes.values()],
                "edges": [{"from": a, "to": b, "kind": k} for a, b, k in self.edges]}


def _mentioned(g: Graph, name: str, own: set[str]) -> int:
    rx = re.compile(rf"(?<![\w-]){re.escape(name)}(?![\w-])")
    return sum(1 for rel, text in g.texts.items() if rel not in own and rx.search(text))


def build(root: Path, kit: Path | None = None) -> Graph:
    root = Path(root)
    g = Graph(root)
    for p in walk(root):
        rel = p.relative_to(root).as_posix()
        if p.suffix not in TEXT_EXT or is_doc(rel) or p.stat().st_size > 2_000_000:
            continue
        try:
            g.texts[rel] = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if p.suffix == ".py":
            try:
                g.py[rel] = ast.parse(g.texts[rel])
            except SyntaxError:
                pass
    if kit is not None and Path(kit).resolve() == root.resolve():
        _concepts(g, Path(kit))
    _python(g)
    for a, b, _ in g.edges:
        g.nodes[b]["refs"] += 1
    return g


# ----------------------------------------------------------------------------- agentbay concepts
def _concepts(g: Graph, kit: Path) -> None:
    from .. import model
    k = model.Kit(kit)
    rel = lambda p: Path(p).resolve().relative_to(kit.resolve()).as_posix()   # noqa: E731
    _concept_nodes(g, k, kit, rel)
    profile = k.profile()[1]                  # the agent profile that runs every role
    for name, d in k.docs["Mode"].items():
        _mode(g, name, d, profile, rel)
    _binding_edges(g, k, model.connectors_of)
    _schema_ref_edges(g, k, kit)
    _mention_edges(g)


def _data_schemas(kit: Path):
    """(node id, path) of each schemas/data/<name>.v<N>.schema.json."""
    for p in sorted((kit / "schemas" / "data").glob("*.schema.json")):
        base, _, ver = p.name.removesuffix(".schema.json").rpartition(".")
        yield f"schema:{base}/{ver}", p


def _concept_nodes(g: Graph, k, kit: Path, rel) -> None:
    """Interfaces, data schemas, roles, agent profiles, envs, connectors and role skills."""
    for name, d in k.docs["Interface"].items():
        g.node(f"interface:{name}", "interface", name, rel(d.path))
    for nid, p in _data_schemas(kit):
        g.node(nid, "schema", nid.removeprefix("schema:"), rel(p))
    for kind, prefix in (("Role", "role"), ("Agent", "agent"), ("Environment", "env"), ("Connector", "connector")):
        for name, d in k.docs[kind].items():
            g.node(f"{prefix}:{name}", prefix, name, rel(d.path))
    for name, d in k.docs["Role"].items():
        for sk in d.spec.get("skills", []):
            g.node(f"skill:{sk}", "skill", sk, rel(d.dir / "skills" / sk / "SKILL.md"))
            g.edge(f"role:{name}", f"skill:{sk}", "uses-skill")


def _mode(g: Graph, name: str, d, profile: str, rel) -> None:
    """A mode's nodes (mode, skills, types, config keys, endpoints) and the edges from it."""
    g.node(f"mode:{name}", "mode", name, rel(d.path))
    for sk in sorted((d.dir / "skills").glob("*/SKILL.md")):
        g.node(f"skill:{sk.parent.name}", "skill", sk.parent.name, rel(sk))
        g.edge(f"mode:{name}", f"skill:{sk.parent.name}", "mode-skill")
    for t in sorted((d.dir / "types").glob("*.schema.json")):
        tn = t.name.removesuffix(".schema.json")
        g.node(f"type:{name}/{tn}", "type", tn, rel(t))
    cfg = d.spec.get("config")
    if cfg:
        for cp in d.config_files:                      # the schema chain along extends; a child only adds keys
            if cp.exists():
                for key in (json.loads(cp.read_text()).get("properties") or {}):
                    g.node(f"config:{name}.{key}", "config-key", key, rel(cp))
    for rn, env in (d.spec.get("roles") or {}).items():
        g.edge(f"mode:{name}", f"role:{rn}", "role")
        if env:
            g.edge(f"mode:{name}", f"env:{env}", "role-env")
    g.edge(f"mode:{name}", f"agent:{profile}", "agent")
    if d.spec.get("coordinator"):
        g.edge(f"mode:{name}", f"role:{d.spec['coordinator']}", "coordinator")
    for iface in d.spec.get("needs", []):
        g.edge(f"mode:{name}", f"interface:{iface}", "needs")
    for ep, e in d.spec["endpoints"].items():
        eid = f"endpoint:{name}.{ep}"
        g.node(eid, "endpoint", f"{name}.{ep}", rel(d.path))
        g.edge(f"mode:{name}", eid, "endpoint")
        _endpoint_edges(g, name, eid, e, d.spec["workflows"].get(e["workflow"], []), bool(cfg))


def _endpoint_edges(g: Graph, mode: str, eid: str, e: dict, steps: list, has_config: bool) -> None:
    for t in (e.get("in"), e.get("out")):
        if t:
            g.edge(eid, f"type:{mode}/{t}", "type")
    if (e.get("review") or {}).get("role"):
        g.edge(eid, f"role:{e['review']['role']}", "review")
    for env in (e.get("roles") or {}).values():
        g.edge(eid, f"env:{env}", "role-env")
    for st in steps:
        for env in (st.get("roles") or {}).values():
            g.edge(eid, f"env:{env}", "role-env")
        if st.get("role"):
            g.edge(eid, f"role:{st['role']}", "step")
        if st.get("out"):
            g.edge(eid, f"type:{mode}/{st['out']}", "type")
        if st.get("run"):
            g.edge(eid, f"interface:{st['run'].rsplit('.', 1)[0]}", "run")
    if has_config:
        for key in [n.split(".", 1)[1] for n in g.nodes if n.startswith(f"config:{mode}.")]:
            if f"$config.{key}" in json.dumps(steps):
                g.edge(eid, f"config:{mode}.{key}", "reads-config")


def _binding_edges(g: Graph, k, connectors_of) -> None:
    """env -> interface/connector (bind), env substitution, connector -> interface (implements, needs)."""
    for name, d in k.docs["Environment"].items():
        if d.spec.get("substitutes"):
            g.edge(f"env:{name}", f"env:{d.spec['substitutes']}", "substitutes")
            g.edge(f"env:{d.spec['substitutes']}", f"env:{name}", "substituted-by")
        for iface, b in d.spec["bind"].items():
            g.edge(f"env:{name}", f"interface:{iface}", "binds")
            for c in connectors_of(b):
                g.edge(f"env:{name}", f"connector:{c}", "binds")
    for name, d in k.docs["Connector"].items():
        impl = d.spec["implements"]
        for iface in [impl] if isinstance(impl, str) else impl:
            g.edge(f"connector:{name}", f"interface:{iface}", "implements")
        for iface in d.spec.get("needs", {}).get("capabilities", []):
            g.edge(f"connector:{name}", f"interface:{iface}", "needs")


def _schema_ref_edges(g: Graph, k, kit: Path) -> None:
    for name, d in k.docs["Interface"].items():
        for ref in set(re.findall(r"\$ref['\"]?\s*:\s*['\"]?([a-z][a-z0-9.-]*/v[0-9]+)", d.path.read_text())):
            g.edge(f"interface:{name}", f"schema:{ref}", "ref")
    for nid, p in _data_schemas(kit):
        for ref in set(re.findall(r"\"\$ref\"\s*:\s*\"([a-z][a-z0-9.-]*/v[0-9]+)\"", p.read_text())):
            g.edge(nid, f"schema:{ref}", "ref")


def _mention_edges(g: Graph) -> None:
    """Code, config and playbooks that name a concept also reference it (dispatcher constants, tests, prompts)."""
    for nid, n in list(g.nodes.items()):
        if n["kind"] in ("endpoint", "schema", "connector", "interface", "env", "skill", "role", "agent"):
            for _ in range(_mentioned(g, n["name"], {n["path"]})):
                g.edges.append((f"text:{n['kind']}", nid, "mention"))
        elif n["kind"] == "config-key":
            py_hits = sum(1 for rel, t in g.texts.items() if rel.endswith(".py") and re.search(
                rf"['\"]{re.escape(n['name'])}['\"]", t))
            for _ in range(py_hits):
                g.edges.append(("text:python", nid, "reads-config"))


# ----------------------------------------------------------------------------- python
def _names(tree: ast.Module) -> set[str]:
    """Names this module references in code (AST only: names, attributes, imports). Strings, comments and
    docstrings never count."""
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Name):
            out.add(n.id)
        elif isinstance(n, ast.Attribute):
            out.add(n.attr)
        elif isinstance(n, ast.alias):
            out.add((n.asname or n.name).split(".")[-1])
            out.update(n.name.split("."))
        elif isinstance(n, ast.ImportFrom) and n.module:
            out.update(n.module.split("."))
    return out


def _defs(rel: str, tree: ast.Module):
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            yield n.name, n.lineno, n.name, n
            if isinstance(n, ast.ClassDef):
                for m in n.body:
                    if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        yield f"{n.name}.{m.name}", m.lineno, m.name, m


def is_script(tree: ast.Module) -> bool:
    """Has an `if __name__ == "__main__":` block (run by path: a root)."""
    for n in tree.body:
        if isinstance(n, ast.If) and isinstance(n.test, ast.Compare) and isinstance(n.test.left, ast.Name) \
                and n.test.left.id == "__name__":
            return True
    return False


def connector_entries(g: Graph) -> dict[str, set[str]]:
    """Connector entry modules (loaded by path from connector.yaml: roots) -> the endpoint names their
    classes implement (called by the dispatcher via getattr: roots too), plus `create`."""
    ifaces: dict[str, set[str]] = {}
    conns: list[tuple[str, dict]] = []
    for rel, t in g.texts.items():
        if not rel.endswith(".yaml") or "kind:" not in t:
            continue
        try:
            doc = yaml.safe_load(t)
        except yaml.YAMLError:
            continue
        if not isinstance(doc, dict) or not isinstance(doc.get("spec"), dict):
            continue
        if doc.get("kind") == "Interface":
            name = f"{(doc.get('metadata') or {}).get('name')}/v{doc['spec'].get('version')}"
            ifaces[name] = set((doc["spec"].get("endpoints") or {}).keys())
        elif doc.get("kind") == "Connector":
            conns.append((rel, doc["spec"]))
    out: dict[str, set[str]] = {}
    for rel, spec in conns:
        entry = (Path(rel).parent / str(spec.get("entry", ""))).as_posix()
        impl = spec.get("implements") or []
        eps = {"create"}
        for i in [impl] if isinstance(impl, str) else impl:
            eps |= ifaces.get(i, set())
        out[entry] = eps
    return out


def _python(g: Graph) -> None:
    """Python definitions and modules count as referenced only through the AST of other code. Roots: tests,
    scripts with a __main__ block, package/pytest files, connector entry modules with their endpoint methods."""
    names_by_file = {rel: _names(t) for rel, t in g.py.items()}
    entries = connector_entries(g)
    for rel, tree in g.py.items():
        mid = f"py:{rel}"
        g.node(mid, "module", rel, rel, 1)
        if kind_of(rel) == "test":
            continue
        used = set().union(*names_by_file.values())
        roots = entries.get(rel, set())
        for qual, line, short, _ in _defs(rel, tree):
            nid = f"fn:{rel}:{qual}"
            g.node(nid, "function", qual, rel, line)
            if short in used or short in roots or short in KEEP_NAMES or short.startswith(("test_", "visit_", "__")):
                g.edges.append(("ref:python", nid, "name"))
    for rel, tree in g.py.items():
        p = Path(rel)
        if kind_of(rel) == "test" or p.name in ENTRY_FILES or is_script(tree) or rel in entries:
            g.edges.append(("ref:entry", f"py:{rel}", "entry"))
        elif any(p.stem in names for other, names in names_by_file.items() if other != rel):
            g.edges.append(("ref:import", f"py:{rel}", "import"))

