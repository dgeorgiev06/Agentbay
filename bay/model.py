"""Load and resolve the agentbay v0.2 model.

    Mode -> endpoint (feature) -> workflow step -> Role -> Agent -> Environment -> Connector

Two roots are loaded: `framework/` (shipped with the kit, never edited by users)
and the kit root (user content). Both have the same layout:

    interfaces/<name>.v<N>.yaml   modes/<name>/mode.yaml   roles/<name>.yaml
    agents/<name>.yaml            envs/<name>.yaml         connectors/<name>/connector.yaml

`resolve(kit)` walks every endpoint and fails with ALL gaps at once, each one a
human-readable sentence naming the concept and what to fix. The `System` it
returns is the only thing adapters and the dispatcher consume.
"""
from __future__ import annotations

import copy
import fnmatch
import json
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
    "Agent": ("agents", "*.yaml", "agent"),
    "Environment": ("envs", "*.yaml", "environment"),
    "Connector": ("connectors", "*/connector.yaml", "connector"),
}
EFFECTS = ["read", "write", "network", "spend", "delete"]
AGENT_SAFE_EFFECTS = {"read"}          # connector endpoints a role may call via its use shim
LEVEL_RANK = {"should": 1, "must": 2, "must_not": 2}
PROTECTED = ("framework", "bay", "schemas")       # kit paths only forge.extend may write
FRAMEWORK_EXTENDER = "forge.extend"
STALE = re.compile(r"^stale\s*>\s*([0-9]+[mhdw])$")


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
    """'feed.post/v1' -> schemas/data/feed.post.v1.schema.json"""
    name, _, ver = ref.partition("/")
    p = SCHEMAS / "data" / f"{name}.{ver}.schema.json"
    if not p.exists():
        raise SpecError(f"unknown data schema '{ref}' (expected {p.relative_to(KIT)})")
    return json.loads(p.read_text())


def ruleset(kit: Path, name: str) -> list[dict]:
    """framework/rules/<name>.yaml rules (e.g. conformance), for reviewer plans."""
    p = kit / "framework" / "rules" / f"{name}.yaml"
    if not p.exists():
        raise SpecError(f"unknown rule set '{name}' (expected {rel(p)})")
    doc = load_yaml(p) or {}
    return [{k: r[k] for k in ("id", "level", "statement", "check") if k in r} for r in doc.get("rules") or []]


def inline_refs(s):
    """Replace {"$ref": "feed.post/v1"} with the data schema, recursively."""
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

    @property
    def dir(self) -> Path:
        return self.path.parent

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
                    try:
                        self._load(kind, root_name, f, sch)
                    except SpecError as e:
                        self.errors.append(str(e))
        from . import config as cfgmod
        self.config = cfgmod.load(project) if config is None else config
        self._select_envs()

    def _select_envs(self) -> None:
        """agentbay.config.yaml `envs: {A: B}` runs every agent of env A in env B, if B declares
        `substitutes: A`. Capabilities stay bound only in envs/; this only chooses between tracked envs."""
        for frm, to in (self.config.get("envs") or {}).items():
            a, b = self.docs["Environment"].get(frm), self.docs["Environment"].get(to)
            if a is None or b is None:
                self.errors.append(f"agentbay.config.yaml envs: unknown env '{frm if a is None else to}' "
                                   f"(have: {', '.join(sorted(self.docs['Environment']))})")
                continue
            if b.spec.get("substitutes") != frm:
                self.errors.append(f"agentbay.config.yaml envs: env {to} does not declare `substitutes: {frm}`, "
                                   f"so it cannot stand in for {frm}")
                continue
            for ag in self.docs["Agent"].values():
                if ag.spec["env"] == frm:
                    ag.spec = {**ag.spec, "env": to}

    def _load(self, kind: str, root_name: str, f: Path, sch: str) -> None:
        doc = load_yaml(f)
        where = rel(f)
        if not isinstance(doc, dict):
            raise SpecError(f"{where}: expected a mapping")
        if doc.get("kind") != kind:
            raise SpecError(f"{where}: kind must be {kind} (found {doc.get('kind')!r}); "
                            f"v0.1 kinds (AgentSpec, Layer) are gone - run `bay migrate`")
        if kind == "Environment" and isinstance((doc.get("spec") or {}).get("fs"), dict) \
                and "base" in doc["spec"]["fs"]:
            line = next((i for i, ln in enumerate(f.read_text().splitlines(), 1) if ln.strip().startswith("base:")), 1)
            raise SpecError(f"{where}:{line}: fs.base was removed in v0.2 (approved 2026-10-27); fs paths are always relative "
                            f"to the project root - delete `base:` (forge envs expect the project to be the agentbay "
                            f"checkout)")
        errs = schema_errors(doc, schema(sch))
        if errs:
            raise SpecError(f"{where}:\n    " + "\n    ".join(errs))
        meta, spec = doc["metadata"], doc["spec"]
        if kind == "Interface":
            name = f"{meta['name']}/v{spec['version']}"
            want = f"{meta['name']}.v{spec['version']}.yaml"
            if f.name != want:
                raise SpecError(f"{where}: interface {name} must live in interfaces/{want}")
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
        self.docs[kind][name] = Doc(kind, name, root_name, f, meta, spec)

    # convenience
    def get(self, kind: str, name: str) -> Doc | None:
        return self.docs[kind].get(name)



def rel(p: Path) -> str:
    """Kit-relative path for messages (absolute if outside the kit)."""
    try:
        return str(p.relative_to(KIT))
    except ValueError:
        return str(p)


# ----------------------------------------------------------------- resolved model
@dataclass
class Inference:
    model: str
    effort: str


@dataclass
class ResolvedRole:
    name: str
    description: str
    root: str
    prompt: str
    done_when: list[str]
    rules: list[str]
    uses: list[str]
    agent: str
    runtime: str
    env: str
    inference: Inference
    tools: list[str]
    clis: list[str]
    bay_uses: list[str]              # "feed.store/v1.query": dispatcher-mediated reads
    skills: dict[str, Path]
    isolation: str
    budget: dict
    default_agent: str = ""
    modes: list[str] = field(default_factory=list)


@dataclass
class Step:
    id: str
    kind: str                         # "code" | "role" | "review"
    run: str | None = None            # "feed.store/v1.sync"
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
    resolved: "ResolvedRole | None" = None    # the role as placed for this step (agent override applied)

    @property
    def subagent(self) -> str | None:
        """Claude Code subagent name: the role, or <role>--<agent> when an endpoint re-places it."""
        r = self.resolved
        if r is None or r.runtime != "claude-code-subagent":
            return None
        return r.name if r.agent == r.default_agent else f"{r.name}--{r.agent}"


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
    review: dict | None               # {role, when, model?, effort?} or None
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
    roles: list[str]
    features: dict[str, Feature]
    constraints: dict
    needs: list[str]
    playbook: str
    skills: dict[str, Path]
    config: dict                      # effective agentbay.config.yaml modes.<name> (minus features)


@dataclass
class System:
    kit: Kit
    modes: dict[str, ResolvedMode]
    roles: dict[str, ResolvedRole]

    def env(self, name: str) -> Doc:
        return self.kit.docs["Environment"][name]

    def interface(self, name: str) -> Doc:
        return self.kit.docs["Interface"][name]

    uninstalled: dict = field(default_factory=dict)   # "<mode>.<endpoint>" -> why it is not installed here

    def for_project(self, project: Path | None) -> "System":
        """The system as installed into `project`. forge.extend (and its framework-dev placements) is installed
        only when the project is the agentbay checkout; everywhere else it does not exist."""
        if project is not None and Path(project).resolve() == self.kit.root.resolve():
            return self
        mode, _, ep = FRAMEWORK_EXTENDER.partition(".")
        if mode not in self.modes or ep not in self.modes[mode].features:
            return self
        m = copy.copy(self.modes[mode])
        m.features = {k: v for k, v in m.features.items() if k != ep}
        modes = {**self.modes, mode: m}
        why = (f"{FRAMEWORK_EXTENDER} is installed only when the project is the agentbay checkout "
               f"(./bay.sh build --project {self.kit.root})")
        return System(self.kit, modes, self.roles, {**self.uninstalled, FRAMEWORK_EXTENDER: why})

    def placements(self) -> dict[str, "ResolvedRole"]:
        """Every (role, agent) placement used by some step, keyed by subagent name."""
        out: dict[str, ResolvedRole] = {}
        for m in self.modes.values():
            for f in m.features.values():
                for st in f.steps:
                    if st.subagent:
                        out.setdefault(st.subagent, st.resolved)
        return out

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


def resolve_role(kit: Kit, name: str, gaps: list[str], where: str, seen_conn: set,
                 agent: str | None = None) -> ResolvedRole | None:
    """Role -> agent -> env. `agent` overrides the role's default (per-endpoint placement)."""
    r = kit.get("Role", name)
    if r is None:
        gaps.append(f"{where}: unknown role '{name}' (have: {', '.join(sorted(kit.docs['Role']))})")
        return None
    s = r.spec
    agent_name = agent or s["agent"]
    a = kit.get("Agent", agent_name)
    if a is None:
        src = f"{where} places role {name} on" if agent else f"role {name}:"
        gaps.append(f"{src} unknown agent '{agent_name}' (have: {', '.join(sorted(kit.docs['Agent']))})")
        return None
    env = kit.get("Environment", a.spec["env"])
    if env is None:
        gaps.append(f"agent {a.name}: unknown env '{a.spec['env']}' (have: {', '.join(sorted(kit.docs['Environment']))})")
        return None
    tools: list[str] = []
    clis: list[str] = []
    bay_uses: list[str] = []
    for use in s.get("uses", []):
        iface, ep = _split_use(use)
        idoc = kit.get("Interface", iface)
        if idoc is None:
            gaps.append(f"role {name}: uses unknown capability interface {iface} "
                        f"(have: {', '.join(sorted(kit.docs['Interface']))})")
            continue
        if ep and ep not in idoc.spec["endpoints"]:
            gaps.append(f"role {name}: uses {iface}.{ep}, but {iface} has no endpoint '{ep}' "
                        f"(has: {', '.join(idoc.spec['endpoints'])})")
            continue
        b = _bound(env, iface)
        if b is None:
            gaps.append(f"role {name}: uses {iface} but env {env.name} (via agent {a.name}) does not bind it "
                        f"(unbound capability; add `{iface}: <connector>` to envs/{env.name}.yaml bind)")
            continue
        effs = endpoint_effects(kit, iface, ep)
        for e in effs:
            if e not in env.spec["effects"]:
                gaps.append(f"role {name}: uses {use} with effect '{e}', which env {env.name} does not allow "
                            f"(allows: {', '.join(env.spec['effects'])})")
        if idoc.spec.get("binding", "connector") == "tools":
            if not isinstance(b, dict):
                gaps.append(f"env {env.name}: {iface} is a tools capability; bind it as {{tools: [...]}}")
                continue
            tools += [t for t in b.get("tools", []) if t not in tools]
            clis += [c for c in b.get("clis", []) if c not in clis]
        else:
            eps = [ep] if ep else list(idoc.spec["endpoints"])
            for e in eps:
                bad = [x for x in endpoint_effects(kit, iface, e) if x not in AGENT_SAFE_EFFECTS]
                if bad:
                    gaps.append(f"role {name}: uses {iface}.{e} which has effects {bad}; agents may only call "
                                f"read-only connector endpoints (the dispatcher runs the rest as code steps)")
                else:
                    bay_uses.append(f"{iface}.{e}")
            for cn in connectors_of(b):
                check_connector(kit, env, cn, iface, gaps, seen_conn)
    if bay_uses and "Bash" not in tools:
        tools.append("Bash")
    if clis and "Bash" not in tools:
        tools.append("Bash")
    skills: dict[str, Path] = {}
    for sk in s.get("skills", []):
        src = r.dir / "skills" / sk
        if not (src / "SKILL.md").exists():
            gaps.append(f"role {name}: skill '{sk}' not found ({rel(src)}/SKILL.md)")
        else:
            skills[sk] = src
    budget = dict(s.get("budget", {}))
    for k in ("maxTurns", "maxMinutes"):
        lim = env.spec.get("limits", {}).get(k)
        if lim is not None:
            budget[k] = min(budget.get(k, lim), lim)
    inf = s.get("inference", {})
    return ResolvedRole(
        name=name, description=r.meta["description"].strip(), root=r.root, prompt=s["prompt"].strip(),
        done_when=s["doneWhen"], rules=s.get("rules", []), uses=s.get("uses", []), agent=a.name,
        runtime=a.spec["runtime"], env=env.name,
        inference=Inference(inf.get("model", a.spec["model"]), inf.get("effort", a.spec.get("effort", "medium"))),
        tools=tools, clis=clis, bay_uses=bay_uses, skills=skills, isolation=s.get("isolation", "none"),
        budget=budget, default_agent=s["agent"])


def type_schema(mode_dir: Path, tname: str | None, where: str, gaps: list[str]) -> dict:
    if not tname:
        return {"type": "object"}
    p = mode_dir / "types" / f"{tname}.schema.json"
    if not p.exists():
        gaps.append(f"{where}: type {tname} not found (expected {rel(p)})")
        return {"type": "object"}
    return inline_refs(json.loads(p.read_text()))


def step_inference(mode: Doc, step_id: str, role: ResolvedRole, override: dict | None = None) -> Inference:
    """mode step > mode default > role default > agent default (role.inference already folds the last two)."""
    inf = mode.spec.get("inference", {})
    out = {"model": role.inference.model, "effort": role.inference.effort}
    out.update({k: v for k, v in (inf.get("default") or {}).items()})
    out.update({k: v for k, v in (inf.get("steps", {}).get(step_id) or {}).items()})
    out.update({k: v for k, v in (override or {}).items() if k in ("model", "effort")})
    return Inference(out["model"], out["effort"])


def code_env(kit: Kit, mode: Doc, iface: str, roles: dict[str, ResolvedRole]) -> tuple[Doc | None, str]:
    """Env that runs a code step: the coordinator's env, else the first mode role env that binds it."""
    coord = mode.spec.get("coordinator")
    if coord:
        r = roles.get(coord)
        return (kit.get("Environment", r.env) if r else None), f"the env of coordinator {coord}"
    for rn in mode.spec["roles"]:
        r = roles.get(rn)
        if r and _bound(kit.get("Environment", r.env), iface) is not None:
            return kit.get("Environment", r.env), f"the env of role {rn}"
    first = roles.get(mode.spec["roles"][0]) if mode.spec["roles"] else None
    return (kit.get("Environment", first.env) if first else None), "the env of the mode's roles"


def resolve(kit: Kit) -> System:
    gaps: list[str] = list(kit.errors) + list(kit.collisions)
    seen_conn: set = set()
    roles: dict[str, ResolvedRole] = {}
    for name in sorted(kit.docs["Role"]):
        r = resolve_role(kit, name, gaps, f"role {name}", seen_conn)
        if r:
            roles[name] = r
    modes: dict[str, ResolvedMode] = {}
    for mname in sorted(kit.docs["Mode"]):
        m = resolve_mode(kit, kit.docs["Mode"][mname], roles, gaps, seen_conn)
        if m:
            modes[mname] = m
    if gaps:
        raise ResolveError(list(dict.fromkeys(gaps)))
    return System(kit, modes, roles)


def resolve_mode(kit: Kit, md: Doc, roles: dict[str, ResolvedRole], gaps: list[str], seen_conn: set) -> ResolvedMode | None:
    from . import config as cfgmod
    s, name = md.spec, md.name
    needs = s.get("needs", [])
    for n in needs:
        if kit.get("Interface", n) is None:
            gaps.append(f"mode {name}: needs unknown capability interface {n}")
    for rn in s["roles"]:
        if rn not in kit.docs["Role"]:
            gaps.append(f"mode {name}: roles lists unknown role '{rn}' (have: {', '.join(sorted(kit.docs['Role']))})")
    coord = s.get("coordinator")
    if coord:
        if coord not in s["roles"]:
            gaps.append(f"mode {name}: coordinator {coord} must also be listed in roles")
        r = roles.get(coord)
        if r and r.runtime != "claude-code-main":
            gaps.append(f"mode {name}: coordinator role {coord} runs on agent {r.agent} with runtime {r.runtime}; "
                        f"coordinators need runtime claude-code-main (subagents cannot spawn subagents)")
    for rn in s["roles"]:
        if rn in roles and name not in roles[rn].modes:
            roles[rn].modes.append(name)

    mcfg, feat_cfg = cfgmod.mode_settings(kit.config, name)
    if s.get("config"):
        cp = md.dir / s["config"]
        if not cp.exists():
            gaps.append(f"mode {name}: config schema {s['config']} not found")
        else:
            csch = json.loads(cp.read_text())
            for e in schema_errors(mcfg, csch):
                gaps.append(f"agentbay.config.yaml modes.{name}: {e}")
            # the mode's config schema `default`s are the single source of default settings
            defaults = {k: v["default"] for k, v in (csch.get("properties") or {}).items() if "default" in v}
            mcfg = {**defaults, **mcfg}
    elif mcfg:
        gaps.append(f"agentbay.config.yaml modes.{name}: mode {name} declares no config schema, so it takes no settings")
    constraints = cfgmod.effective_constraints(s.get("constraints", {}), mcfg)
    if "lookback" in mcfg and "lookbackMax" in constraints:
        from .util import duration
        if duration(mcfg["lookback"]) > duration(constraints["lookbackMax"]):
            gaps.append(f"agentbay.config.yaml modes.{name}.lookback {mcfg['lookback']} exceeds mode "
                        f"lookbackMax {constraints['lookbackMax']}")

    features: dict[str, Feature] = {}
    for ep_name, ep in s["endpoints"].items():
        where = f"{name}.{ep_name}"
        wf = s["workflows"].get(ep["workflow"])
        if wf is None:
            gaps.append(f"{where}: unknown workflow '{ep['workflow']}' (have: {', '.join(s['workflows'])})")
            continue
        ep_eff = ep["effects"]
        steps: list[Step] = []
        review = ep.get("review")
        review_on = bool(review and review.get("when") == "always")
        marker = False
        for st in wf:
            sw = f"{where} step {st['id']}"
            if "review" in st:
                marker = True
                if review_on:
                    steps.append(_review_step(kit, md, ep, st["id"], where, ep_eff, roles, gaps, seen_conn, review))
                continue
            if "run" in st:
                steps.append(_code_step(kit, md, st, sw, ep_eff, roles, gaps, seen_conn))
            elif "gate" in st:
                steps.append(Step(id=st["id"], kind="gate", task=st["gate"], when=st.get("when")))
            else:
                placed = _placed_roles(kit, ep, roles, gaps, where, seen_conn)
                steps.append(_role_step(kit, md, st, sw, ep_eff, placed, gaps, kind="role"))
        if review_on and not marker:
            steps.append(_review_step(kit, md, ep, "review", where, ep_eff, roles, gaps, seen_conn, review))
        ids = [x.id for x in steps]
        for d in {i for i in ids if ids.count(i) > 1}:
            gaps.append(f"{where}: duplicate step id '{d}'" + (" (the review step is injected from mode.yaml review; "
                        "do not add a step called review)" if d == "review" else ""))
        _check_protected(kit, f"{name}.{ep_name}", steps, gaps)
        pb_path = md.dir / ep["playbook"] if ep.get("playbook") else None
        pb_text, dod = "", []
        if pb_path and pb_path.exists():
            pb = pbk.parse(pb_path)
            pb_text, dod = pb.text, pb.dod
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
                gaps.append(f"agentbay.config.yaml modes.{name}.features.{ep_name}.extraRules: {e}")
        features[ep_name] = Feature(
            mode=name, name=ep_name, workflow=ep["workflow"], steps=steps, effects=ep_eff,
            in_type=ep.get("in"), out_type=ep.get("out"),
            in_schema=type_schema(md.dir, ep.get("in"), where, gaps),
            out_schema=type_schema(md.dir, ep.get("out"), where, gaps),
            playbook_path=pb_path, playbook_text=pb_text, dod=dod, rules=rl,
            review=review if review_on else None,
            schedule=ep.get("schedule"), description=ep.get("description", ""))
        for st in steps:
            if st.out and st.kind == "role":
                type_schema(md.dir, st.out, f"{where} step {st.id}", gaps)

    skills = {}
    for sk in sorted((md.dir / "skills").glob("*/SKILL.md")):
        skills[sk.parent.name] = sk.parent
    pb_file = md.dir / "playbook.md"
    return ResolvedMode(
        name=name, version=md.meta["version"], root=md.root, purpose=s["purpose"].strip(), path=md.dir,
        coordinator=coord, roles=s["roles"], features=features, constraints=constraints, needs=needs,
        playbook=pb_file.read_text() if pb_file.exists() else "", skills=skills, config=mcfg)


def _code_step(kit, md, st, sw, ep_eff, roles, gaps, seen_conn) -> Step:
    iface, ep = _split_use(st["run"])
    step = Step(id=st["id"], kind="code", with_=st.get("with", {}), when=st.get("when"))
    if iface not in md.spec.get("needs", []):
        gaps.append(f"{sw}: runs {st['run']}, but mode {md.name} does not list {iface} in needs")
        return step
    idoc = kit.get("Interface", iface)
    if idoc is None:
        return step
    if ep not in idoc.spec["endpoints"]:
        gaps.append(f"{sw}: {iface} has no endpoint '{ep}' (has: {', '.join(idoc.spec['endpoints'])})")
        return step
    step.run = f"{iface}.{ep}"
    env, why = code_env(kit, md, iface, roles)
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
    step.effects = endpoint_effects(kit, iface, ep)
    _check_effects(step.effects, ep_eff, env, sw, f"{iface}.{ep}", gaps)
    if st.get("when", "").startswith("stale"):
        if "status" not in idoc.spec["endpoints"]:
            gaps.append(f"{sw}: `when: {st['when']}` needs {iface} to have a status endpoint returning lastSync")
    return step


def _role_step(kit, md, st, sw, ep_eff, roles, gaps, kind, override=None) -> Step:
    rn = st["role"]
    step = Step(id=st["id"], kind=kind, role=rn, task=st.get("task", ""), out=st.get("out"))
    label = "review role" if kind == "review" else "role"
    if rn not in kit.docs["Role"]:
        gaps.append(f"{sw}: unknown {label} '{rn}' (have: {', '.join(sorted(kit.docs['Role']))})")
        return step
    if rn not in md.spec["roles"]:
        gaps.append(f"{sw}: {label} {rn} is not listed in mode {md.name} roles {md.spec['roles']}")
    r = roles.get(rn)
    if r is None:
        gaps.append(f"{sw}: {label} {rn} does not resolve (see role {rn} errors)")
        return step
    env = kit.get("Environment", r.env)
    step.agent, step.env, step.resolved = r.agent, r.env, r
    step.inference = step_inference(md, st["id"], r, override)
    if step.inference.model not in env.spec["models"]:
        gaps.append(f"{sw}: model '{step.inference.model}' for {label} {rn} is not allowed by env {env.name} "
                    f"(allows: {', '.join(env.spec['models'])})")
    effs: list[str] = []
    for use in r.uses:
        iface, ep = _split_use(use)
        for e in endpoint_effects(kit, iface, ep):
            if e not in effs:
                effs.append(e)
    step.effects = effs
    _check_effects(effs, ep_eff, env, sw, f"{label} {rn}", gaps)
    return step


def _review_step(kit, md, ep, step_id, where, ep_eff, roles, gaps, seen_conn, review) -> Step:
    placed = _placed_roles(kit, ep, roles, gaps, where, seen_conn)
    st = {"id": step_id, "role": review["role"]}
    return _role_step(kit, md, st, f"{where} review", ep_eff, placed, gaps, kind="review", override=review)


def _placed_roles(kit, ep, roles, gaps, where, seen_conn) -> dict[str, ResolvedRole]:
    over = ep.get("agents") or {}
    if not over:
        return roles
    placed = dict(roles)
    for rn, agent in over.items():
        r = resolve_role(kit, rn, gaps, where, seen_conn, agent=agent)
        if r:
            r.modes = roles[rn].modes if rn in roles else []
            placed[rn] = r
    return placed


def protected_writes(env: Doc) -> list[str]:
    """Write paths of env that name the kit's framework/, bay/ or schemas/ explicitly."""
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
                        f"only {FRAMEWORK_EXTENDER} may change the framework - place this role on an agent whose env "
                        f"writes user space only (e.g. local-authoring)")


def _check_effects(effs, ep_eff, env, sw, what, gaps) -> None:
    for e in effs:
        if e not in ep_eff:
            gaps.append(f"{sw}: effect '{e}' of {what} is not declared by the endpoint (declares: {', '.join(ep_eff)})")
        if e not in env.spec["effects"]:
            gaps.append(f"{sw}: effect '{e}' of {what} is not allowed by env {env.name} "
                        f"(allows: {', '.join(env.spec['effects'])})")
