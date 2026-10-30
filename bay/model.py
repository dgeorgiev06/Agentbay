"""Load and resolve the agentbay model.

    Mode -> endpoint (feature) -> workflow step -> Role, in the env the mode's `roles:` map names -> Connector
    Agent profile: one per LLM product (runtime per kind of role, tier -> model), the `profile:` of a runtime
    adapter (adapters/<name>/adapter.yaml), selected once in agentbay.config.yaml (`agent:`, default claude-code)

Each distinct (role, mode, env) a mode uses compiles to its own unit (`<role>--<mode>`, plus `--<env>` when
the mode runs that role in several envs): its own subagent, use shim, guard policy and store access.

Two roots are loaded: `framework/` (shipped with the kit, never edited by users)
and the kit root (user content). Both have the same layout:

    interfaces/<name>.v<N>.yaml   modes/<name>/mode.yaml   envs/<name>.yaml
    connectors/<name>/connector.yaml

Roles (roles/<name>.yaml) exist only under framework/; a user file of that kind is an error.

`resolve(kit)` walks every endpoint and fails with ALL gaps at once, each one a
human-readable sentence naming the concept and what to fix. The `System` it
returns is the only thing adapters and the dispatcher consume.
"""
from __future__ import annotations

import copy
import fnmatch
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None

from . import playbook as pbk
from . import rules as rulesmod

KIT = Path(__file__).resolve().parent.parent
SCHEMAS = KIT / "schemas"
KINDS = {  # kind -> (folder, glob, schema)
    "Interface": ("interfaces", "*.yaml", "interface"),
    "Mode": ("modes", "*/mode.yaml", "mode"),
    "Role": ("roles", "*.yaml", "role"),
    "Environment": ("envs", "*.yaml", "environment"),
    "Connector": ("connectors", "*/connector.yaml", "connector"),
}
EFFECTS = ["read", "write", "network", "spend", "delete"]
DEFAULT_AGENT = "claude-code"          # the agent profile when agentbay.config.yaml sets no `agent:`
AGENT_SAFE_EFFECTS = {"read"}          # connector endpoints a role may call via its use shim
READ_TOOL_EFFECTS = {"read", "network"}  # tools capabilities every role may get; others need `access: write`
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}   # file-writing tools: `access: write` roles only
READ_ONLY_CLIS = ("git status", "git diff", "git log", "git show")   # the only CLIs a read-only capability may bind
USER_FRAMEWORK_ENVS = ("workspace", "research")   # the framework envs a user mode may put roles in
LEVEL_RANK = {"should": 1, "must": 2, "must_not": 2}
PROTECTED = ("framework", "bay", "schemas", "adapters")   # kit paths only forge.extend may write
FRAMEWORK_EXTENDER = "forge.extend"
USER_ROLE = ("roles are framework-level; customize behaviour in your mode's playbooks/skills, or propose a new "
             "role via forge.extend")
# Kinds loaded from framework/ only; user space is modes/, envs/, connectors/ (and interfaces/).
FRAMEWORK_ONLY = {"Role": USER_ROLE}
ROOT_COORDINATOR = "cos"      # the mode whose coordinator owns the main thread; its playbook is the preamble


class SpecError(Exception):
    """A file is malformed (schema, YAML, naming)."""


class ResolveError(Exception):
    """The model is well-formed but does not wire up. `gaps` lists every problem."""

    def __init__(self, gaps: list[str]):
        self.gaps = gaps
        super().__init__("resolution failed:\n  - " + "\n  - ".join(gaps))


# ----------------------------------------------------------------- loading
def schema(name: str) -> dict:
    return json.loads((SCHEMAS / f"{name}.schema.json").read_text())


def data_schema(ref: str) -> dict:
    """'post/v1' -> schemas/data/post.v1.schema.json"""
    name, _, ver = ref.partition("/")
    p = SCHEMAS / "data" / f"{name}.{ver}.schema.json"
    if not p.exists():
        raise SpecError(f"unknown data schema '{ref}' (expected {p.relative_to(KIT)})")
    return json.loads(p.read_text())


VERSIONED = re.compile(r"^[a-z][a-z0-9.-]*/v[0-9]+$")   # `<name>/v<N>`: interfaces and item kinds (B-6)


def item_kinds(kit: Path = KIT) -> dict[str, set[int]]:
    """Known item kinds (content types): `<kind>/v<N>` data schemas that extend item/v1. kind -> versions."""
    out: dict[str, set[int]] = {}
    for f in sorted((kit / "schemas" / "data").glob("*.v*.schema.json")):
        try:
            doc = json.loads(f.read_text())
        except ValueError:
            continue
        if any(isinstance(a, dict) and a.get("$ref") == "item/v1" for a in doc.get("allOf", [])):
            name, _, ver = doc.get("title", "").partition("/v")
            if name and ver.isdigit():
                out.setdefault(name, set()).add(int(ver))
    return out


def mode_envs(md: Doc) -> list[str]:
    """Every env a mode's `roles:` maps (mode-wide and per endpoint), in order."""
    s, out = md.spec, []
    for m in [s.get("roles"), *((ep or {}).get("roles") for ep in (s.get("endpoints") or {}).values())]:
        if isinstance(m, dict):
            out += [e for e in m.values() if isinstance(e, str)]
    return list(dict.fromkeys(out))


def ruleset(kit: Path, name: str) -> list[dict]:
    """framework/rules/<name>.yaml rules (e.g. conformance), for reviewer plans."""
    p = kit / "framework" / "rules" / f"{name}.yaml"
    if not p.exists():
        raise SpecError(f"unknown rule set '{name}' (expected {rel(p)})")
    doc = load_yaml(p) or {}
    return [{k: r[k] for k in ("id", "level", "statement", "check") if k in r} for r in doc.get("rules") or []]


def inline_refs(s):
    """Replace {"$ref": "item/v1"} with the data schema, recursively."""
    if isinstance(s, dict):
        ref = s.get("$ref")
        if isinstance(ref, str) and not ref.startswith("#") and "/v" in ref:
            sub = dict(data_schema(ref))
            sub.pop("$schema", None)
            sub.pop("$id", None)
            return inline_refs(sub)
        return {k: inline_refs(v) for k, v in s.items()}
    if isinstance(s, list):
        return [inline_refs(x) for x in s]
    return s


def schema_errors(instance, sch: dict) -> list[str]:
    if jsonschema is None:
        return []
    v = jsonschema.Draft202012Validator(sch, format_checker=jsonschema.FormatChecker())
    return [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
            for e in sorted(v.iter_errors(instance), key=lambda e: list(map(str, e.absolute_path)))]


def load_yaml(path: Path):
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise SpecError(f"{path}: invalid YAML: {e}") from e
    return doc


@dataclass
class Doc:
    kind: str
    name: str
    root: str            # "framework" | "user"
    path: Path
    meta: dict
    spec: dict
    lineage: list = field(default_factory=list)   # Mode: own folder, then each ancestor's (extends), nearest first
    parent: str | None = None                      # Mode: the mode it extends
    config_files: list = field(default_factory=list)   # Mode: config schemas, root ancestor first (each extends the last)

    @property
    def dir(self) -> Path:
        return self.path.parent

    @property
    def dirs(self) -> list[Path]:
        return self.lineage or [self.dir]

    @property
    def rel(self) -> str:
        try:
            return str(self.path.relative_to(KIT))
        except ValueError:
            return str(self.path)


class Kit:
    """Everything on disk, plus the project's agentbay.config.yaml. No wiring checks."""

    def __init__(self, kit: Path = KIT, project: Path | None = None, config: dict | None = None):
        self.root = kit
        self.roots = {"framework": kit / "framework", "user": kit}
        self.project = project
        self.docs: dict[str, dict[str, Doc]] = {k: {} for k in KINDS}
        self.collisions: list[str] = []
        self.errors: list[str] = []
        for root_name, base in self.roots.items():
            for kind, (folder, glob, sch) in KINDS.items():
                for f in sorted((base / folder).glob(glob)):
                    if root_name == "user" and kind in FRAMEWORK_ONLY:
                        self.errors.append(f"{rel(f)}: {FRAMEWORK_ONLY[kind]}")
                        continue
                    try:
                        self._load(kind, root_name, f, sch)
                    except SpecError as e:
                        self.errors.append(str(e))
        self._apply_extends()
        from . import config as cfgmod
        self.config = copy.deepcopy(cfgmod.load(project) if config is None else config)
        if self.config.get("offline") is True:
            self._go_offline()

    def _apply_extends(self) -> None:
        """Resolve `extends:` at load time, so the resolver, lint, conformance and improve always see a complete
        mode. A mode whose parent is missing or whose chain loops is reported and dropped."""
        modes = self.docs["Mode"]
        done: dict[str, bool] = {}

        def resolve(name: str, trail: list[str]) -> None:
            if name in done:
                if not done[name]:
                    raise SpecError(f"{modes[name].rel}: extends a mode that does not resolve")
                return
            d = modes[name]
            parent = d.spec.get("extends")
            own = d.spec.get("config")
            if not parent:
                d.config_files = [d.dir / own] if own else []
                done[name] = True
                return
            if parent == name or parent in trail:
                loop = trail[trail.index(parent):] if parent in trail else []
                chain = " -> ".join([*loop, name, parent])
                raise SpecError(f"{d.rel}: mode inheritance cycle: {chain}; remove one `extends`")
            if parent not in modes:
                raise SpecError(f"{d.rel}: extends unknown mode '{parent}' (have: {', '.join(sorted(modes)) or 'none'})")
            resolve(parent, [*trail, name])
            p = modes[parent]
            d.spec = merge_mode(p.spec, d.spec, p.dir, d.dir)
            own_path = d.dir / own if own else None
            d.config_files = [*p.config_files, *([own_path] if own_path and own_path not in p.config_files else [])]
            d.lineage, d.parent = [d.dir, *p.dirs], parent
            full = {"apiVersion": "agentbay/v2", "kind": "Mode", "metadata": d.meta,
                    "spec": {k: v for k, v in d.spec.items() if k != "extends"}}
            errs = schema_errors(full, schema("mode"))
            if errs:
                raise SpecError(f"{d.rel} (after extends {parent}):\n    " + "\n    ".join(errs))
            done[name] = True

        for name in sorted(modes):
            try:
                resolve(name, [])
            except SpecError as e:
                done[name] = False
                self.errors.append(str(e))
        for name, ok in done.items():
            if not ok:
                modes.pop(name, None)

    def _go_offline(self) -> None:
        """agentbay.config.yaml `offline: true`: every env with an `offline:` block binds what the block lists
        over its own bindings, and has no network and no secrets, whatever the block says (lint refuses a block
        that lists any). Envs without the block are unchanged."""
        for env in self.docs["Environment"].values():
            off = env.spec.get("offline")
            if not off:
                continue
            env.spec["bind"] = {**env.spec["bind"], **off["bind"]}
            env.spec["network"] = {"allow": []}
            if "secrets" in env.spec:
                env.spec["secrets"] = {**env.spec["secrets"], "allow": []}

    def profiles(self) -> dict[str, dict]:
        """Every agent profile: the `profile:` of each adapters/<name>/adapter.yaml that has one, by adapter name."""
        out: dict[str, dict] = {}
        for y in sorted((self.root / "adapters").glob("*/adapter.yaml")):
            try:
                meta = yaml.safe_load(y.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, yaml.YAMLError):
                continue                   # lint_adapters reports an unreadable adapter.yaml
            if isinstance(meta, dict) and isinstance(meta.get("profile"), dict):
                out[y.parent.name] = meta["profile"]
        return out

    def profile(self) -> tuple[dict | None, str]:
        """(the agent profile that runs every role, its name): agentbay.config.yaml `agent:`, else claude-code."""
        name = self.config.get("agent") or DEFAULT_AGENT
        return self.profiles().get(name), name

    def _load(self, kind: str, root_name: str, f: Path, sch: str) -> None:
        doc = load_yaml(f)
        where = rel(f)
        if not isinstance(doc, dict):
            raise SpecError(f"{where}: expected a mapping")
        if doc.get("kind") != kind:
            raise SpecError(f"{where}: kind must be {kind} (found {doc.get('kind')!r})")
        sch_doc = schema(sch)
        if kind == "Mode" and isinstance(doc.get("spec"), dict) and doc["spec"].get("extends"):
            # a child declares only what it overrides; the merged spec is checked in full after extends
            sch_doc = copy.deepcopy(sch_doc)
            sch_doc["properties"]["spec"]["properties"]["endpoints"]["additionalProperties"].pop("required", None)
        errs = schema_errors(doc, sch_doc)
        if errs:
            raise SpecError(f"{where}:\n    " + "\n    ".join(errs))
        meta, spec = doc["metadata"], doc["spec"]
        if kind == "Interface":
            name = f"{meta['name']}/v{spec['version']}"
            want = f"{meta['name']}.v{spec['version']}.yaml"
            if f.name != want:
                raise SpecError(f"{where}: interface {name} must be in a file named {want}")
        else:
            name = meta["name"]
            expect = f.parent.name if f.name in ("mode.yaml", "connector.yaml") else f.stem
            if name != expect:
                raise SpecError(f"{where}: metadata.name '{name}' must match '{expect}'")
        if name in self.docs[kind]:
            other = self.docs[kind][name]
            self.collisions.append(
                f"{kind} '{name}' is defined by both the framework ({other.rel}) and you ({where}); "
                f"rename yours - framework names are reserved")
            return
        self.docs[kind][name] = Doc(kind, name, root_name, f, meta, spec, lineage=[f.parent] if kind == "Mode" else [])

    # convenience
    def get(self, kind: str, name: str) -> Doc | None:
        return self.docs[kind].get(name)



def rel(p: Path) -> str:
    """Kit-relative path for messages (absolute if outside the kit)."""
    try:
        return str(p.relative_to(KIT))
    except ValueError:
        return str(p)


def merge_mode(parent: dict, child: dict, pdir: Path, cdir: Path) -> dict:
    """A child mode spec over its parent's. Endpoints merge key by key (a child may override review, in/out,
    workflow, playbook, rules, ...; an endpoint's `roles` merges entry by entry); workflows are replaced per
    workflow; `roles` (role -> env), constraints and configDefaults merge entry by entry; needs are unioned;
    anything else the child sets replaces the parent's. Paths the child inherits
    (playbook, rules, config) are rebased so they still resolve from the child's folder. `abstract` is not
    inherited."""
    def rebase(p: str) -> str:
        return os.path.normpath(os.path.relpath(os.path.normpath(pdir / p), cdir))

    out = copy.deepcopy(parent)
    out.pop("abstract", None)
    out.pop("extends", None)
    for ep in out.get("endpoints", {}).values():
        for k in ("playbook", "rules"):
            if ep.get(k):
                ep[k] = rebase(ep[k])
    if out.get("config"):
        out["config"] = rebase(out["config"])
    for k, v in child.items():
        if k == "endpoints":
            eps = out.setdefault("endpoints", {})
            for name, e in v.items():
                merged = {**eps.get(name, {}), **copy.deepcopy(e)}
                if isinstance(e.get("roles"), dict) and isinstance(eps.get(name, {}).get("roles"), dict):
                    merged["roles"] = {**eps[name]["roles"], **e["roles"]}
                eps[name] = merged
        elif k == "workflows":
            out.setdefault("workflows", {}).update(copy.deepcopy(v))
        elif k in ("constraints", "configDefaults") or (k == "roles" and isinstance(v, dict)
                                                         and isinstance(out.get(k), dict)):
            out[k] = {**out.get(k, {}), **copy.deepcopy(v)}
        elif k == "needs":
            out[k] = list(dict.fromkeys([*out.get(k, []), *v]))
        else:
            out[k] = copy.deepcopy(v)
    return out


def type_file(dirs, tname: str) -> Path:
    """types/<Name>.schema.json from the mode's folder, else the nearest ancestor that has it (extends)."""
    dirs = [dirs] if isinstance(dirs, Path) else list(dirs)
    for d in dirs:
        p = d / "types" / f"{tname}.schema.json"
        if p.exists():
            return p
    return dirs[0] / "types" / f"{tname}.schema.json"


# ----------------------------------------------------------------- resolved model
@dataclass
class Inference:
    model: str
    effort: str
    tier: str = ""


@dataclass
class RoleDef:
    """A role as written: the job. No env and no LLM product (those come from the mode and the profile)."""
    name: str
    description: str
    root: str
    path: Path
    prompt: str
    done_when: list[str]
    rules: list[str]
    access: str                      # "read" | "write"
    tier: str
    effort: str
    skills: dict[str, Path]
    isolation: str
    budget: dict
    modes: list[str] = field(default_factory=list)


@dataclass
class ResolvedRole:
    """One compiled unit: a role in one mode and one env. `unit` is its unique name (subagent, shim, guard)."""
    name: str                        # the role
    unit: str                        # <role>--<mode>[--<env>]
    mode: str
    env: str
    kind: str                        # "coordinator" | "worker"
    runtime: str
    agent: str                       # the agent profile
    description: str
    root: str
    prompt: str
    done_when: list[str]
    rules: list[str]
    uses: list[str]                  # what the mode's needs grant it in this env (capabilities and endpoints)
    inference: Inference             # the role's default tier and effort on the profile
    tools: list[str]
    clis: list[str]
    bay_uses: list[str]              # "items.store/v1.sql": dispatcher-mediated reads
    skills: dict[str, Path]          # skill name in the runtime (`<mode>--<skill>`, `<role>--<skill>`) -> folder
    isolation: str
    budget: dict
    access: str = "read"             # the role's access: only "write" gets file-writing tools and write paths
    skill_names: dict[str, str] = field(default_factory=dict)   # short name (playbooks, prompts) -> runtime name


@dataclass
class Step:
    id: str
    kind: str                         # "code" | "role" | "review" | "gate"
    run: str | None = None            # "items.store/v1.sync"
    role: str | None = None
    agent: str | None = None
    env: str | None = None
    inference: Inference | None = None
    effects: list[str] = field(default_factory=list)
    with_: dict = field(default_factory=dict)
    when: str | None = None
    task: str = ""
    out: str | None = None
    connector: str | None = None
    approves: str | None = None       # gate: "$in.<field>", the file whose exact content the gate approves
    resolved: "ResolvedRole | None" = None    # the compiled unit this step runs (role, mode, env)

    @property
    def subagent(self) -> str | None:
        """Claude Code subagent name: the unit's name, for worker roles."""
        r = self.resolved
        return r.unit if r is not None and r.runtime == "claude-code-subagent" else None


@dataclass
class Feature:
    """One endpoint of a mode: interface (in/out/effects), workflow, playbook, rules, review."""
    mode: str
    name: str
    workflow: str
    steps: list[Step]
    effects: list[str]
    in_type: str | None
    out_type: str | None
    in_schema: dict
    out_schema: dict
    playbook_path: Path | None
    playbook_text: str
    dod: list[pbk.DodItem]
    rules: list[rulesmod.Rule]
    review: dict | None               # {role, when, tier?, effort?, rulesets?} or None
    schedule: str | None = None
    description: str = ""


@dataclass
class ResolvedMode:
    name: str
    version: str
    root: str
    purpose: str
    path: Path
    coordinator: str | None
    roles: dict                       # role -> env (after agentbay.config.yaml `envs:` substitution)
    features: dict[str, Feature]
    constraints: dict
    needs: list[str]
    playbook: str
    skills: dict[str, Path]           # runtime name `<mode>--<skill>` -> folder (own, then inherited via extends)
    config: dict                      # effective agentbay.config.yaml modes.<name> (minus features)
    dirs: list = field(default_factory=list)   # mode folder, then ancestors' (extends): types are looked up here
    extends: str | None = None
    coordinator_unit: ResolvedRole | None = None


@dataclass
class System:
    kit: Kit
    modes: dict[str, ResolvedMode]
    roles: dict[str, RoleDef]
    uninstalled: dict = field(default_factory=dict)   # "<mode>.<endpoint>" -> why it is not installed here
    warnings: list = field(default_factory=list)      # non-fatal findings (bay validate prints them)
    agent: str = DEFAULT_AGENT                        # the agent profile

    def env(self, name: str) -> Doc:
        return self.kit.docs["Environment"][name]

    def interface(self, name: str) -> Doc:
        return self.kit.docs["Interface"][name]

    def for_project(self, project: Path | None) -> "System":
        """The system as installed into `project`. forge.extend (and the units only it uses, framework-dev) is
        installed only when the project is the agentbay checkout; everywhere else it does not exist."""
        if project is not None and Path(project).resolve() == self.kit.root.resolve():
            return self
        mode, _, ep = FRAMEWORK_EXTENDER.partition(".")
        if mode not in self.modes or ep not in self.modes[mode].features:
            return self
        modes = copy.deepcopy(self.modes)              # unit names change below; the kit-wide system keeps its own
        modes[mode].features = {k: v for k, v in modes[mode].features.items() if k != ep}
        name_units(modes)                              # e.g. builder--forge, not builder--forge--local-authoring
        why = (f"{FRAMEWORK_EXTENDER} is installed only when the project is the agentbay checkout "
               f"(./bay.sh build --project {self.kit.root})")
        return System(self.kit, modes, self.roles, {**self.uninstalled, FRAMEWORK_EXTENDER: why}, self.warnings,
                      self.agent)

    def units(self) -> dict[str, ResolvedRole]:
        """Every compiled unit of the installed features, keyed by unit name: the mode coordinators and each
        (role, mode, env) a step runs."""
        out: dict[str, ResolvedRole] = {}
        for m in self.modes.values():
            if m.coordinator_unit:
                out.setdefault(m.coordinator_unit.unit, m.coordinator_unit)
            for f in m.features.values():
                for st in f.steps:
                    if st.resolved:
                        out.setdefault(st.resolved.unit, st.resolved)
        return out

    def subagents(self) -> dict[str, ResolvedRole]:
        """The units that run as generated subagents (workers), keyed by subagent name."""
        return {k: r for k, r in self.units().items() if r.runtime == "claude-code-subagent"}

    def feature(self, target: str) -> tuple[ResolvedMode, Feature]:
        if target in self.uninstalled:
            raise ResolveError([self.uninstalled[target]])
        mode, _, ep = target.partition(".")
        if mode not in self.modes:
            raise ResolveError([f"unknown mode '{mode}' (have: {', '.join(sorted(self.modes))})"])
        m = self.modes[mode]
        if ep not in m.features:
            raise ResolveError([f"mode {mode} has no endpoint '{ep}' (have: {', '.join(m.features)})"])
        return m, m.features[ep]


# ----------------------------------------------------------------- resolution
def _bound(env: Doc, iface: str):
    return env.spec.get("bind", {}).get(iface)


def connectors_of(binding) -> list[str]:
    if isinstance(binding, str):
        return [binding]
    if isinstance(binding, list):
        return list(binding)
    return []


def host_allowed(host: str, allow: list[str]) -> bool:
    return any(a == "*" or fnmatch.fnmatchcase(host, a) for a in allow)


def path_within(path: str, allowed: list[str]) -> bool:
    p = Path(path)
    for a in allowed:
        if a == "." or p == Path(a) or Path(a) in p.parents:
            return True
    return False


def endpoint_effects(kit: Kit, iface: str, endpoint: str | None) -> list[str]:
    doc = kit.get("Interface", iface)
    if doc is None:
        return []
    eps = doc.spec["endpoints"]
    if endpoint is None:
        return sorted({e for ep in eps.values() for e in ep["effects"]}, key=EFFECTS.index)
    return list(eps.get(endpoint, {}).get("effects", []))


def check_connector(kit: Kit, env: Doc, conn_name: str, iface: str, gaps: list[str], seen: set) -> None:
    key = (env.name, conn_name, iface)
    if key in seen:
        return
    seen.add(key)
    c = kit.get("Connector", conn_name)
    if c is None:
        gaps.append(f"env {env.name}: binds {iface} to unknown connector '{conn_name}' "
                    f"(have: {', '.join(sorted(kit.docs['Connector'])) or 'none'})")
        return
    impl = c.spec["implements"]
    impl = [impl] if isinstance(impl, str) else impl
    if iface not in impl:
        gaps.append(f"env {env.name}: connector {conn_name} is bound to {iface} but implements {', '.join(impl)}")
    if not (c.dir / c.spec["entry"]).exists():
        gaps.append(f"connector {conn_name}: entry {c.spec['entry']} not found in {rel(c.dir)}")
    needs = c.spec.get("needs", {})
    allow_net = env.spec.get("network", {}).get("allow", [])
    for host in needs.get("network", []):
        if not host_allowed(host, allow_net):
            gaps.append(f"env {env.name}: connector {conn_name} needs network host {host}, "
                        f"which is not in network.allow {allow_net}")
    allow_sec = env.spec.get("secrets", {}).get("allow", [])
    for pat in needs.get("secrets", []):
        if not any(fnmatch.fnmatchcase(s, pat) for s in allow_sec):
            gaps.append(f"env {env.name}: connector {conn_name} needs secret {pat}, "
                        f"which is not in secrets.allow {allow_sec}")
    fs = env.spec.get("fs", {})
    for mode_ in ("read", "write"):
        for p in needs.get("fs", {}).get(mode_, []):
            if not path_within(p, fs.get(mode_, [])):
                gaps.append(f"env {env.name}: connector {conn_name} needs fs.{mode_} {p}, "
                            f"which is outside env fs.{mode_} {fs.get(mode_, [])}")
    for sub in needs.get("capabilities", []):
        b = _bound(env, sub)
        if b is None:
            gaps.append(f"env {env.name}: connector {conn_name} needs capability {sub}, which env {env.name} does not bind")
            continue
        for cn in connectors_of(b):
            check_connector(kit, env, cn, sub, gaps, seen)
        for e in endpoint_effects(kit, sub, None):
            if e not in env.spec["effects"]:
                gaps.append(f"env {env.name}: connector {conn_name} uses {sub} with effect '{e}', "
                            f"which env {env.name} does not allow (allows: {', '.join(env.spec['effects'])})")


def _split_use(use: str) -> tuple[str, str | None]:
    m = re.match(r"^(.+/v[0-9]+)(?:\.([a-z][a-z0-9-]*))?$", use)
    return (m.group(1), m.group(2)) if m else (use, None)


def resolve_role_def(kit: Kit, name: str, gaps: list[str]) -> RoleDef | None:
    """The role on its own: the job (prompt, doneWhen, rules, skills, tier, access). What it may read comes
    from the mode it works in (`needs`), checked per (role, mode, env) unit."""
    r = kit.get("Role", name)
    s = r.spec
    skills: dict[str, Path] = {}
    for sk in s.get("skills", []):
        src = r.dir / "skills" / sk
        if not (src / "SKILL.md").exists():
            gaps.append(f"role {name}: skill '{sk}' not found ({rel(src)}/SKILL.md)")
            return None
        skills[sk] = src
    return RoleDef(name=name, description=r.meta["description"].strip(), root=r.root, path=r.path,
                   prompt=s["prompt"].strip(), done_when=s["doneWhen"], rules=s.get("rules", []),
                   access=s.get("access", "read"), tier=s["tier"], effort=s.get("effort", "medium"),
                   skills=skills, isolation=s.get("isolation", "none"), budget=dict(s.get("budget", {})))


def role_env(spec: dict, ep: dict | None, st: dict | None, role: str) -> str | None:
    """The env `role` works in for one step: the step's `roles:`, else the feature's, else the mode's."""
    for layer in (st, ep, spec):
        m = (layer or {}).get("roles")
        if isinstance(m, dict) and m.get(role):
            return m[role]
    return None


def step_role(st: dict, ep: dict) -> str | None:
    """The role a workflow step runs: its `role`, or the review role at a `{review: here}` marker."""
    if "role" in st:
        return st["role"]
    rv = ep.get("review") or {}
    if "review" in st and rv.get("when") == "always":
        return rv.get("role")
    return None


def role_env_problems(md: Doc) -> list[tuple[str | None, str | None, str]]:
    """(feature, step id, message) for every problem with a mode's role -> env maps: a step's role the mode
    does not list, a role with no env, two envs for one step, overrides of roles the mode does not list, and
    `roles:` on code or gate steps. `bay lint` reports them with file:line, resolve as gaps."""
    s, name = md.spec, md.name
    roles = s.get("roles")
    if not roles:
        return []
    out: list[tuple[str | None, str | None, str]] = []
    have = ", ".join(roles) or "none"
    used: set[str] = set()

    def check(rn, where, ep_name, sid, ep, st):
        used.add(rn)
        if rn not in roles:
            out.append((ep_name, sid, f"{where}: role {rn} is not in mode {name} `roles:` ({have}); "
                                      f"add `{rn}: <env>` there"))
        elif role_env(s, ep, st, rn) is None:
            out.append((ep_name, sid, f"{where}: role {rn} has no env; give it one in mode {name} `roles:` "
                                      f"(`{rn}: <env>`)"))

    coord = s.get("coordinator")
    if coord:
        check(coord, f"mode {name} coordinator", None, None, None, None)
    for ep_name, ep in (s.get("endpoints") or {}).items():
        for rn in (ep.get("roles") or {}):
            if rn not in roles:
                out.append((ep_name, None, f"{name}.{ep_name}: `roles:` gives role {rn} an env, but mode {name} "
                                           f"does not list {rn} in its `roles:` ({have})"))
        rv = ep.get("review") or {}
        steps = (s.get("workflows") or {}).get(ep.get("workflow"), [])
        for st in steps:
            sid = st.get("id")
            where = f"{name}.{ep_name} step {sid}"
            rn = step_role(st, ep)
            own = st.get("roles") or {}
            if own and rn is None:
                out.append((ep_name, sid, f"{where}: `roles:` applies to role and review steps only; code and gate "
                                          f"steps run in the env of the mode's coordinator"))
                continue
            if len(own) > 1:
                out.append((ep_name, sid, f"{where}: two envs for one step ({', '.join(f'{k}: {v}' for k, v in own.items())}); "
                                          f"a step runs its role in one env, so keep only `{rn}: <env>`"))
            elif own and rn not in own:
                out.append((ep_name, sid, f"{where}: `roles:` names {next(iter(own))}, but this step runs role {rn}"))
            if rn:
                check(rn, where, ep_name, sid, ep, st)
        if rv.get("when") == "always" and rv.get("role") and not any("review" in st for st in steps):
            check(rv["role"], f"{name}.{ep_name} review", ep_name, "review", ep, None)
    for rn, env in roles.items():
        if rn not in used and not env:
            out.append((None, None, f"mode {name}: role {rn} has no env; set `{rn}: <env>` in its `roles:`"))
    return out


class _Ctx:
    """Shared state of one resolve(): the profile, role definitions and the compiled units (cached per
    (role, mode, env), so every gap of a unit is reported once, at the first step that uses it)."""

    def __init__(self, kit: Kit, gaps: list[str]):
        self.kit, self.gaps, self.seen_conn = kit, gaps, set()
        self.profile, self.agent = kit.profile()
        if self.profile is None:
            gaps.append(f"agent profile '{self.agent}' not found (have: {', '.join(sorted(kit.profiles())) or 'none'}); "
                        f"add a `profile:` to adapters/{self.agent}/adapter.yaml or set `agent:` in "
                        f"agentbay.config.yaml to one of them")
        self.roles: dict[str, RoleDef] = {}
        for name in sorted(kit.docs["Role"]):
            rd = resolve_role_def(kit, name, gaps)
            if rd:
                self.roles[name] = rd
        self.units: dict[tuple[str, str, str], ResolvedRole | None] = {}

    def inference(self, tier: str, effort: str) -> Inference:
        p = self.profile or {}
        return Inference((p.get("tiers") or {}).get(tier, tier), (p.get("effort") or {}).get(effort, effort), tier)

    def unit(self, rn: str, md: Doc, env_name: str, kind: str, where: str) -> ResolvedRole | None:
        key = (rn, md.name, env_name)
        if key not in self.units:
            self.units[key] = self._unit(self.roles[rn], md, env_name, kind, where)
        return self.units[key]

    def _unit(self, rd: RoleDef, md: Doc, env_name: str, kind: str, where: str) -> ResolvedRole | None:
        """The role in this mode and env. Its grants come from the mode: every capability in the mode's
        `needs` that the env binds (unless `dispatcherOnly`). Connector capabilities give the read-only
        endpoints (through the use shim); tools capabilities give their tools when all their effects are read
        or network, or to roles with `access: write`."""
        kit, gaps, mode = self.kit, self.gaps, md.name
        who = f"{where}: role {rd.name} in env {env_name}"
        env = kit.get("Environment", env_name)
        if env is None:
            gaps.append(f"{who}: unknown env '{env_name}' (have: {', '.join(sorted(kit.docs['Environment']))}); "
                        f"fix mode {mode} `roles:`")
            return None
        if md.root == "user" and env.root == "framework" and env.name not in USER_FRAMEWORK_ENVS:
            gaps.append(f"mode {mode}: role {rd.name} works in the framework env {env.name} ({where}); user modes "
                        f"may put roles only in their own envs (envs/) or the framework envs "
                        f"{' and '.join(USER_FRAMEWORK_ENVS)}")
            return None
        allowed = env.spec.get("tiers")
        if allowed and rd.tier not in allowed:
            gaps.append(f"mode {mode}: role {rd.name} in env {env.name}: its default tier '{rd.tier}' (the model its "
                        f"subagent is compiled with) is not allowed by env {env.name} (allows: {', '.join(allowed)}); "
                        f"add '{rd.tier}' to `tiers` in envs/{env.name}.yaml or put the role in another env")
        tools: list[str] = []
        clis: list[str] = []
        bay_uses: list[str] = []
        uses: list[str] = []
        for iface in md.spec.get("needs", []):
            idoc = kit.get("Interface", iface)
            b = _bound(env, iface)
            if idoc is None or b is None or idoc.spec.get("dispatcherOnly"):
                continue                   # another env of the mode binds it, or only code steps use it
            if idoc.spec.get("binding", "connector") == "tools":
                effs = set(endpoint_effects(kit, iface, None))
                if not isinstance(b, dict):
                    gaps.append(f"env {env.name}: {iface} is a tools capability; bind it as {{tools: [...]}}")
                    continue
                if not effs <= set(env.spec["effects"]) or (rd.access != "write" and not effs <= READ_TOOL_EFFECTS):
                    continue
                uses.append(iface)
                b_tools, b_clis = b.get("tools", []), b.get("clis", [])
                if rd.access != "write":       # whatever the binding lists, read-only roles never write
                    b_tools = [x for x in b_tools if x not in WRITE_TOOLS]
                    b_clis = [c for c in b_clis if c in READ_ONLY_CLIS]
                    if not b_clis:             # Bash only for the CLIs that survive (or the use shim, below)
                        b_tools = [x for x in b_tools if x != "Bash"]
                tools += [x for x in b_tools if x not in tools]
                clis += [c for c in b_clis if c not in clis]
            else:
                eps = [e for e, spec in idoc.spec["endpoints"].items() if set(spec["effects"]) <= AGENT_SAFE_EFFECTS]
                if not eps or "read" not in env.spec["effects"]:
                    continue
                bay_uses += [f"{iface}.{e}" for e in eps]
                uses += [f"{iface}.{e}" for e in eps]
                for cn in connectors_of(b):
                    check_connector(kit, env, cn, iface, gaps, self.seen_conn)
        if (bay_uses or clis) and "Bash" not in tools:
            tools.append("Bash")
        budget = dict(rd.budget)
        for k in ("maxTurns", "maxMinutes"):
            lim = env.spec.get("limits", {}).get(k)
            if lim is not None:
                budget[k] = min(budget.get(k, lim), lim)
        runtime = ((self.profile.get("runtime") or {}).get(kind) if self.profile else None) or "?"
        names = role_skill_names(md, rd)
        return ResolvedRole(
            name=rd.name, unit=f"{rd.name}--{mode}", mode=mode, env=env.name, kind=kind, runtime=runtime,
            agent=self.agent, description=rd.description, root=rd.root, prompt=rd.prompt, done_when=rd.done_when,
            rules=rd.rules, uses=uses, inference=self.inference(rd.tier, rd.effort), tools=tools, clis=clis,
            bay_uses=bay_uses, skills={names[sk]: src for sk, src in {**mode_skills(md), **rd.skills}.items()},
            isolation=rd.isolation, budget=budget, access=rd.access, skill_names=names)


def name_units(modes: dict, gaps: list[str] | None = None) -> None:
    """`<role>--<mode>`, plus `--<env>` when the mode runs that role in more than one env among its installed
    features. Run by resolve and again by System.for_project."""
    units: dict[int, ResolvedRole] = {}
    for m in modes.values():
        for u in [m.coordinator_unit, *(st.resolved for f in m.features.values() for st in f.steps)]:
            if u is not None:
                units[id(u)] = u
    envs: dict[tuple[str, str], set[str]] = {}
    for u in units.values():
        envs.setdefault((u.name, u.mode), set()).add(u.env)
    seen: dict[str, tuple] = {}
    for u in units.values():
        u.unit = f"{u.name}--{u.mode}" + (f"--{u.env}" if len(envs[(u.name, u.mode)]) > 1 else "")
        if gaps is not None and u.unit in seen and seen[u.unit] != (u.name, u.mode, u.env):
            gaps.append(f"two units are both named {u.unit} ({seen[u.unit]} and {(u.name, u.mode, u.env)}); rename "
                        f"a role or mode so `<role>--<mode>` stays unique")
        seen[u.unit] = (u.name, u.mode, u.env)


def skill_front_matter(text: str) -> tuple[dict, str]:
    """(front matter, body) of a SKILL.md, CRLF line ends normalised to LF. A file that does not open with a
    `---` line has no front matter: ({}, text). Raises SpecError when the block never closes, is not YAML or is
    not a mapping (F-15)."""
    text = text.replace("\r\n", "\n")
    lines = text.split("\n")
    if lines[0].rstrip() != "---":
        return {}, text
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            head, body = "\n".join(lines[1:i]), "\n".join(lines[i + 1:])
            break
    else:
        raise SpecError("front matter opens with '---' on line 1 but has no closing '---' line")
    try:
        meta = yaml.safe_load(head)
    except yaml.YAMLError as e:
        raise SpecError(f"front matter is not valid YAML: {e}") from e
    if meta is None:
        meta = {}
    if not isinstance(meta, dict):
        raise SpecError("front matter must be a YAML mapping (name, description)")
    return meta, body


SKILL_NAME_MAX = 64        # Claude Code: a skill name (its folder and SKILL.md `name:`) is [a-z0-9-], at most 64


def skill_id(owner: str, short: str) -> str:
    """A skill's runtime name: `<mode>--<skill>` for a mode's skills (own and inherited, so each mode has its own
    namespace and two modes' same-named skills never overwrite each other), `<role>--<skill>` for a role's."""
    return f"{owner}--{short}"


def role_skill_names(md: Doc, rd) -> dict[str, str]:
    """Short name -> runtime name for a role in a mode: the mode's skills, the role's own replacing same-named ones."""
    return {**{sk: skill_id(md.name, sk) for sk in mode_skills(md)}, **{sk: skill_id(rd.name, sk) for sk in rd.skills}}


def mode_skills(md: Doc) -> dict[str, Path]:
    """A mode's skills (`skills/<name>/SKILL.md`), its own replacing inherited ones of the same name."""
    skills = {}
    for d in reversed(md.dirs):
        for sk in sorted((d / "skills").glob("*/SKILL.md")):
            skills[sk.parent.name] = sk.parent
    return skills


def type_schema(mode_dir, tname: str | None, where: str, gaps: list[str]) -> dict:
    """mode_dir: the mode folder, or its lineage (own folder first, then ancestors)."""
    if not tname:
        return {"type": "object"}
    p = type_file(mode_dir, tname)
    if not p.exists():
        gaps.append(f"{where}: type {tname} not found (expected {rel(p)})")
        return {"type": "object"}
    return inline_refs(json.loads(p.read_text()))


def code_env(kit: Kit, mode: Doc, iface: str, ep: dict | None = None) -> tuple[Doc | None, str]:
    """Env that runs a code step: the coordinator's env (for this feature), else the first role env of the mode
    that binds the capability."""
    s = mode.spec
    roles = s.get("roles") or {}
    coord = s.get("coordinator")
    if coord:
        name = role_env(s, ep, None, coord)
        return (kit.get("Environment", name) if name else None), f"the env of coordinator {coord}"
    envs = [kit.get("Environment", role_env(s, ep, None, rn) or "") for rn in roles]
    for rn, env in zip(roles, envs):
        if env and _bound(env, iface) is not None:
            return env, f"the env of role {rn}"
    return (envs[0] if envs else None), "the env of the mode's roles"


def resolve(kit: Kit) -> System:
    gaps: list[str] = list(kit.errors) + list(kit.collisions)
    ctx = _Ctx(kit, gaps)
    modes: dict[str, ResolvedMode] = {}
    warnings: list[str] = []
    for mname in sorted(kit.docs["Mode"]):
        md = kit.docs["Mode"][mname]
        if md.spec.get("abstract"):
            continue        # a base for `extends` only: linted, never installed or called
        m = resolve_mode(kit, md, ctx, warnings)
        if m:
            modes[mname] = m
    name_units(modes, gaps)
    coord_rt = ((ctx.profile.get("runtime") or {}).get("coordinator") if ctx.profile else None)
    if coord_rt and coord_rt != "claude-code-main" and any(m.coordinator for m in modes.values()):
        gaps.append(f"agent profile {ctx.agent}: coordinators run on runtime {coord_rt}, but mode coordinators need "
                    f"claude-code-main (subagents cannot spawn subagents)")
    if gaps:
        raise ResolveError(list(dict.fromkeys(gaps)))
    return System(kit, modes, ctx.roles, warnings=list(dict.fromkeys(warnings)), agent=ctx.agent)


def resolve_mode(kit: Kit, md: Doc, ctx: _Ctx, warnings: list[str] | None = None) -> ResolvedMode | None:
    gaps = ctx.gaps
    s, name = md.spec, md.name
    needs = s.get("needs", [])
    for n in needs:
        if kit.get("Interface", n) is None:
            gaps.append(f"mode {name}: needs unknown capability interface {n}")
    roles = s.get("roles") or {}
    coord_unit = _mode_roles(kit, md, ctx, roles)
    mcfg, feat_cfg = _mode_config(kit, md, gaps)
    constraints = _mode_constraints(md, mcfg, gaps)
    features: dict[str, Feature] = {}
    for ep_name, ep in s["endpoints"].items():
        feat = _feature(kit, md, ctx, ep_name, ep, feat_cfg)
        if feat:
            features[ep_name] = feat
    _check_selectors(kit, md, mcfg, gaps, warnings if warnings is not None else [])
    pb_file = next((d / "playbook.md" for d in md.dirs if (d / "playbook.md").exists()), md.dir / "playbook.md")
    return ResolvedMode(
        name=name, version=md.meta["version"], root=md.root, purpose=s["purpose"].strip(), path=md.dir,
        coordinator=s.get("coordinator"), roles=dict(roles),
        features=features, constraints=constraints, needs=needs,
        playbook=pb_file.read_text() if pb_file.exists() else "",
        skills={skill_id(name, sk): src for sk, src in mode_skills(md).items()}, config=mcfg,
        dirs=list(md.dirs), extends=md.parent, coordinator_unit=coord_unit)


def _mode_roles(kit: Kit, md: Doc, ctx: _Ctx, roles: dict) -> ResolvedRole | None:
    """Check the mode's `roles:` map and role -> env problems; return the coordinator's unit, if any."""
    name = md.name
    for rn in roles:
        if rn not in kit.docs["Role"]:
            ctx.gaps.append(f"mode {name}: roles lists unknown role '{rn}' (have: {', '.join(sorted(kit.docs['Role']))})")
        elif rn in ctx.roles and name not in ctx.roles[rn].modes:
            ctx.roles[rn].modes.append(name)
    ctx.gaps += [msg for _, _, msg in role_env_problems(md)]
    coord = md.spec.get("coordinator")
    if coord and coord in ctx.roles and roles.get(coord):
        return ctx.unit(coord, md, roles[coord], "coordinator", f"mode {name} coordinator")
    return None


CHILD_CONFIG_KEYS = ("type", "properties", "$defs", "title", "description", "$schema", "required",
                     "additionalProperties")   # F-13: a child's config schema may use these top-level keywords only;
                                               # N-5: `type`/`additionalProperties` only with the parent's value


def config_schema(kit: Kit, md: Doc, gaps: list[str]) -> dict | None:
    """The mode's config schema: its root ancestor's, extended by each descendant's along `extends` (a child's
    `config:` adds properties; redefining an inherited key is an error - change a default through configDefaults).
    None when the mode takes no settings."""
    out = None
    for cp in md.config_files:
        if not cp.exists():
            gaps.append(f"mode {md.name}: config schema {os.path.relpath(cp, kit.root)} not found")
            continue
        sch = json.loads(cp.read_text())
        if out is None:
            out = copy.deepcopy(sch)
            continue
        rel = os.path.relpath(cp, kit.root)
        for k in sch:
            if k not in CHILD_CONFIG_KEYS:
                gaps.append(f"mode {md.name}: config schema {rel} uses top-level keyword '{k}', which a child's config "
                            f"schema may not use (it only adds settings; allowed: {', '.join(CHILD_CONFIG_KEYS)})")
        for k in ("type", "additionalProperties"):     # N-5: may restate the parent's value, never change it
            if k in sch and (k not in out or sch[k] != out[k]):
                gaps.append(f"mode {md.name}: config schema {rel} sets top-level '{k}' to {json.dumps(sch[k])}, but "
                            f"the parent's is {json.dumps(out[k]) if k in out else 'unset'}; a child may only "
                            f"restate the parent's '{k}' - drop it or make it equal")
        defs = out.get("$defs") or {}
        for k in sch.get("$defs") or {}:
            if k in defs:
                gaps.append(f"mode {md.name}: config schema {rel} redefines inherited $defs '{k}'; "
                            f"give the child's definition another name")
        props = out.setdefault("properties", {})
        for k, v in (sch.get("properties") or {}).items():
            if k in props:
                gaps.append(f"mode {md.name}: config schema {os.path.relpath(cp, kit.root)} redefines inherited "
                            f"setting '{k}'; a child's config schema only adds settings - drop '{k}' from it and "
                            f"set its default with configDefaults")
                continue
            props[k] = copy.deepcopy(v)
        out["required"] = list(dict.fromkeys([*out.get("required", []), *sch.get("required", [])])) or None
        if out["required"] is None:
            out.pop("required")
        out.setdefault("$defs", {}).update({k: v for k, v in (sch.get("$defs") or {}).items() if k not in defs})
        if not out["$defs"]:
            out.pop("$defs")
    return out


def _mode_config(kit: Kit, md: Doc, gaps: list[str]) -> tuple[dict, dict]:
    """The mode's effective settings (agentbay.config.yaml over the config schema's defaults and the mode's
    configDefaults) and its per-feature settings."""
    from . import config as cfgmod
    s, name = md.spec, md.name
    mcfg, feat_cfg = cfgmod.mode_settings(kit.config, name)
    if s.get("config"):
        csch = config_schema(kit, md, gaps)
        if csch is not None:
            mcfg = {**_config_defaults(kit, md, csch, mcfg, gaps), **mcfg}
    elif mcfg:
        gaps.append(f"agentbay.config.yaml modes.{name}: mode {name} declares no config schema, so it takes no settings")
    if s.get("configDefaults") and not s.get("config"):
        gaps.append(f"mode {name}: configDefaults needs a config schema (`config:`, own or inherited)")
    if SOURCE_IFACE in s.get("needs", []) and not mcfg.get("selectors"):
        mcfg["selectors"] = [{"id": "home"}]     # no selectors setting: keep each source's default stream
    return mcfg, feat_cfg


def _config_defaults(kit: Kit, md: Doc, csch: dict, mcfg: dict, gaps: list[str]) -> dict:
    """Check the settings against the config schema; return its `default`s, with the mode's configDefaults
    (a child, usually, replacing some of them instead of copying the schema) applied."""
    name = md.name
    csch = inline_refs(csch)
    for e in schema_errors(mcfg, csch):
        gaps.append(f"agentbay.config.yaml modes.{name}: {e}")
    props = csch.get("properties") or {}
    defaults = {k: v["default"] for k, v in props.items() if "default" in v}
    for k, v in (md.spec.get("configDefaults") or {}).items():
        if k not in props:
            gaps.append(f"mode {name}: configDefaults.{k} is not a setting of its config schema "
                        f"{os.path.relpath(os.path.normpath(md.config_files[-1]), kit.root)} (has: {', '.join(props) or 'none'})")
            continue
        errs = schema_errors(v, props[k])
        gaps += [f"mode {name}: configDefaults.{k}: {e.removeprefix('<root>: ')}" for e in errs]
        if not errs:
            defaults[k] = v
    return defaults


def _mode_constraints(md: Doc, mcfg: dict, gaps: list[str]) -> dict:
    from . import config as cfgmod
    constraints = cfgmod.effective_constraints(md.spec.get("constraints", {}), mcfg)
    if "lookback" in mcfg and "lookbackMax" in constraints:
        from .util import duration
        if duration(mcfg["lookback"]) > duration(constraints["lookbackMax"]):
            gaps.append(f"agentbay.config.yaml modes.{md.name}.lookback {mcfg['lookback']} exceeds mode "
                        f"lookbackMax {constraints['lookbackMax']}")
    return constraints


def _feature_steps(kit: Kit, md: Doc, ctx: _Ctx, ep: dict, wf: list, where: str) -> list[Step]:
    """The workflow's steps, with the review step injected at its `{review: here}` marker (else at the end)."""
    ep_eff = ep["effects"]
    review = ep.get("review")
    review_on = bool(review and review.get("when") == "always")
    steps: list[Step] = []
    marker = False
    for st in wf:
        sw = f"{where} step {st['id']}"
        if "approves" in st and "gate" not in st:
            ctx.gaps.append(f"{sw}: approves: goes on a gate step only")
        if "review" in st:
            marker = True
            if review_on:
                steps.append(_role_step(ctx, md, ep, {**st, "role": review["role"]}, f"{where} review",
                                        ep_eff, review=review))
        elif "run" in st:
            steps.append(_code_step(kit, md, ep, st, sw, ep_eff, ctx.gaps, ctx.seen_conn))
        elif "gate" in st:
            # a gate passes only by a recorded approval (`bay approve`), never by a `when:` skip
            if st.get("when"):
                ctx.gaps.append(f"{sw}: a gate takes no when: (it passes only by `bay approve`, or by a recorded "
                                f"approval of the exact content its approves: names)")
            steps.append(Step(id=st["id"], kind="gate", task=st["gate"], approves=st.get("approves")))
        else:
            steps.append(_role_step(ctx, md, ep, st, sw, ep_eff))
    if review_on and not marker:
        steps.append(_role_step(ctx, md, ep, {"id": "review", "role": review["role"]}, f"{where} review",
                                ep_eff, review=review))
    ids = [x.id for x in steps]
    for i, x in enumerate(steps):
        ref = (x.when or "").lstrip("!")
        if ref.startswith("$steps.") and ref.split(".")[1] not in ids[:i]:
            ctx.gaps.append(f"{where} step {x.id}: when: {x.when} names '{ref.split('.')[1]}', which is not an earlier step")
        if ref.startswith("stale") and x.kind != "code":
            ctx.gaps.append(f"{where} step {x.id}: `when: {x.when}` is for code steps (it asks a connector's status); "
                            f"a {x.kind} step takes `$in.<f>` or `$steps.<id>.<f>`")
    for d in {i for i in ids if ids.count(i) > 1}:
        ctx.gaps.append(f"{where}: duplicate step id '{d}'" + (" (the review step is injected from mode.yaml review; "
                        "do not add a step called review)" if d == "review" else ""))
    return steps


def _feature_rules(kit: Kit, md: Doc, ep_name: str, ep: dict, feat_cfg: dict, gaps: list[str]) -> list:
    """The feature's rules, with the project's extraRules (agentbay.config.yaml) stacked on top."""
    from . import config as cfgmod
    rl: list[rulesmod.Rule] = []
    if ep.get("rules") and (md.dir / ep["rules"]).exists():
        try:
            rl = rulesmod.load(md.dir / ep["rules"])
        except rulesmod.RulesError as e:
            gaps.append(str(e))
    extra = (feat_cfg.get(ep_name) or {}).get("extraRules")
    if extra:
        p = cfgmod.config_path(kit.project, extra)
        try:
            rl = rulesmod.stack(rl, rulesmod.load(p))
        except (rulesmod.RulesError, FileNotFoundError) as e:
            gaps.append(f"agentbay.config.yaml modes.{md.name}.features.{ep_name}.extraRules: {e}")
    return rl


def _feature(kit: Kit, md: Doc, ctx: _Ctx, ep_name: str, ep: dict, feat_cfg: dict) -> Feature | None:
    gaps, name = ctx.gaps, md.name
    where = f"{name}.{ep_name}"
    wf = md.spec["workflows"].get(ep["workflow"])
    if wf is None:
        gaps.append(f"{where}: unknown workflow '{ep['workflow']}' (have: {', '.join(md.spec['workflows'])})")
        return None
    steps = _feature_steps(kit, md, ctx, ep, wf, where)
    _check_protected(kit, where, steps, gaps)
    pb_path = Path(os.path.normpath(md.dir / ep["playbook"])) if ep.get("playbook") else None
    pb_text, dod = "", []
    if pb_path and pb_path.exists():
        pb = pbk.parse(pb_path)
        pb_text, dod = pb.text, pb.dod
    rules = _feature_rules(kit, md, ep_name, ep, feat_cfg, gaps)
    review = ep.get("review")
    feat = Feature(
        mode=name, name=ep_name, workflow=ep["workflow"], steps=steps, effects=ep["effects"],
        in_type=ep.get("in"), out_type=ep.get("out"),
        in_schema=type_schema(md.dirs, ep.get("in"), where, gaps),
        out_schema=type_schema(md.dirs, ep.get("out"), where, gaps),
        playbook_path=pb_path, playbook_text=pb_text, dod=dod,
        rules=rules,
        review=review if review and review.get("when") == "always" else None,
        schedule=ep.get("schedule"), description=ep.get("description", ""))
    for st in steps:
        if st.out and st.kind == "role":
            type_schema(md.dirs, st.out, f"{where} step {st.id}", gaps)
    return feat


SOURCE_IFACE = "items.source/v1"
STORE_IFACE = "items.store/v1"


def _check_selectors(kit: Kit, md: Doc, mcfg: dict, gaps: list[str], warnings: list[str]) -> None:
    """Selectors in the mode's settings against every bound items.source/v1 connector's capability table:
    a field a source cannot express is a gap; a local-only field on a paid source is a warning."""
    if SOURCE_IFACE not in md.spec.get("needs", []):
        return
    from . import config as cfgmod, selector as selmod
    env, _ = code_env(kit, md, STORE_IFACE)
    if env is None:
        return
    sels = mcfg.get("selectors") or []
    for cn in connectors_of(_bound(env, SOURCE_IFACE)):
        c = kit.get("Connector", cn)
        if c is None:
            continue
        caps = c.spec.get("selectors") or {}
        price = c.spec.get("costPerPostUsd", mcfg.get("costPerPostUsd", cfgmod.COST_PER_POST_USD))
        errs, warns = selmod.check(sels, caps, connector=cn, paid=float(price) > 0,
                                   where=f"agentbay.config.yaml modes.{md.name}.selectors (env {env.name})")
        gaps += errs
        warnings += warns


def _code_step(kit, md, ep, st, sw, ep_eff, gaps, seen_conn) -> Step:
    iface, ep_name = _split_use(st["run"])
    step = Step(id=st["id"], kind="code", with_=st.get("with", {}), when=st.get("when"))
    if iface not in md.spec.get("needs", []):
        gaps.append(f"{sw}: runs {st['run']}, but mode {md.name} does not list {iface} in needs")
        return step
    idoc = kit.get("Interface", iface)
    if idoc is None:
        return step
    if ep_name not in idoc.spec["endpoints"]:
        gaps.append(f"{sw}: {iface} has no endpoint '{ep_name}' (has: {', '.join(idoc.spec['endpoints'])})")
        return step
    step.run = f"{iface}.{ep_name}"
    env, why = code_env(kit, md, iface, ep)
    if env is None:
        gaps.append(f"{sw}: cannot pick an env for code step {st['run']} ({why} did not resolve)")
        return step
    step.env = env.name
    b = _bound(env, iface)
    if b is None:
        gaps.append(f"{sw}: capability {iface} is not bound in env {env.name} ({why}); "
                    f"add `{iface}: <connector>` to its bind (unbound capability)")
        return step
    conns = connectors_of(b)
    if len(conns) != 1:
        gaps.append(f"{sw}: code steps need exactly one connector for {iface} in env {env.name} (found {conns or b})")
        return step
    step.connector = conns[0]
    check_connector(kit, env, conns[0], iface, gaps, seen_conn)
    step.effects = endpoint_effects(kit, iface, ep_name)
    _check_effects(step.effects, ep_eff, env, sw, f"{iface}.{ep_name}", gaps)
    if st.get("when", "").startswith("stale"):
        if "status" not in idoc.spec["endpoints"]:
            gaps.append(f"{sw}: `when: {st['when']}` needs {iface} to have a status endpoint returning lastSync")
    return step


def _role_step(ctx: _Ctx, md: Doc, ep: dict, st: dict, sw: str, ep_eff, review: dict | None = None) -> Step:
    """A role step (or the injected review step, with its `review` block). Env: step > feature > mode
    `roles:`. Tier and effort: step (the review block for review) > feature (role steps) > role default."""
    kit, gaps = ctx.kit, ctx.gaps
    rn = st["role"]
    kind = "review" if review is not None else "role"
    step = Step(id=st["id"], kind=kind, role=rn, task=st.get("task", ""), out=st.get("out"), when=st.get("when"))
    label = "review role" if review is not None else "role"
    if rn not in kit.docs["Role"]:
        gaps.append(f"{sw}: unknown {label} '{rn}' (have: {', '.join(sorted(kit.docs['Role']))})")
        return step
    rd = ctx.roles.get(rn)
    if rd is None:
        gaps.append(f"{sw}: {label} {rn} does not resolve (see role {rn} errors)")
        return step
    env_name = role_env(md.spec, ep, st, rn)
    if env_name is None:
        return step                       # no env: reported by role_env_problems (mode, feature, step)
    u = ctx.unit(rn, md, env_name, "coordinator" if rn == md.spec.get("coordinator") else "worker", sw)
    if u is None:
        return step
    env = kit.get("Environment", env_name)
    step.agent, step.env, step.resolved = ctx.agent, env.name, u
    src = review if review is not None else st
    feat = {} if review is not None else ep
    tier, origin = next(((v, w) for v, w in ((src.get("tier"), "the review block" if review is not None else "the step"),
                                             (feat.get("tier"), "the feature"), (rd.tier, f"role {rn}'s default"))
                         if v), (rd.tier, ""))
    effort = src.get("effort") or feat.get("effort") or rd.effort
    step.inference = ctx.inference(tier, effort)
    allowed = env.spec.get("tiers")
    if allowed and tier not in allowed:
        gaps.append(f"{sw}: {label} {rn} in env {env.name} runs at tier '{tier}' (from {origin}), which env "
                    f"{env.name} does not allow (allows: {', '.join(allowed)}); set an allowed `tier:` on the step, "
                    f"feature or role, or add '{tier}' to `tiers` in envs/{env.name}.yaml")
    effs: list[str] = []
    for use in u.uses:
        iface, ep_ = _split_use(use)
        for e in endpoint_effects(kit, iface, ep_):
            if e not in effs:
                effs.append(e)
    step.effects = effs
    _check_effects(effs, ep_eff, env, sw, f"{label} {rn}", gaps)
    return step


def protected_writes(env: Doc) -> list[str]:
    """Write paths of env that name a protected kit folder (PROTECTED) explicitly."""
    out = []
    for w in env.spec.get("fs", {}).get("write", []):
        parts = Path(w).parts
        if parts and parts[0] in PROTECTED:
            out.append(w)
    return out


def _check_protected(kit: Kit, target: str, steps: list[Step], gaps: list[str]) -> None:
    if target == FRAMEWORK_EXTENDER:
        return
    for st in steps:
        env = kit.get("Environment", st.env) if st.env else None
        if env is None:
            continue
        bad = protected_writes(env)
        if bad:
            who = f"role {st.role}" if st.role else f"code step {st.run}"
            gaps.append(f"{target} step {st.id}: {who} runs in env {env.name}, which can write {', '.join(bad)}; "
                        f"only {FRAMEWORK_EXTENDER} may change the framework - give it an env that writes user space only "
                        f"(e.g. local-authoring) in the mode's `roles:`")


def _check_effects(effs, ep_eff, env, sw, what, gaps) -> None:
    for e in effs:
        if e not in ep_eff:
            gaps.append(f"{sw}: effect '{e}' of {what} is not declared by the endpoint (declares: {', '.join(ep_eff)})")
        if e not in env.spec["effects"]:
            gaps.append(f"{sw}: effect '{e}' of {what} is not allowed by env {env.name} "
                        f"(allows: {', '.join(env.spec['effects'])})")
