"""Scaffolds for user content. Templates live in modes/forge/templates/
and are shared by `bay new <kind>` and the forge.create feature (via the
scaffold connector), so code scaffolding and the agentic flow cannot drift.

Scaffolds write new instances into modes/, envs/ and connectors/, never overwrite an existing file and refuse a
protected name (the map's `protected:` block reserves them).
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

TEMPLATES = Path(__file__).resolve().parent.parent / "modes" / "forge" / "templates"
KINDS = ("mode", "feature", "connector", "env")
NAME = re.compile(r"^[a-z][a-z0-9-]{1,40}$")
REVIEW_EFFECTS = {"write", "spend", "delete"}   # features with these get review on by default


class ScaffoldError(Exception):
    pass


def _render(template: str, **vals) -> str:
    text = (TEMPLATES / template).read_text(encoding="utf-8")
    for k, v in vals.items():
        text = text.replace("{{" + k + "}}", str(v))
    left = re.findall(r"\{\{(\w+)\}\}", text)
    if left:
        raise ScaffoldError(f"template {template}: unfilled placeholders {sorted(set(left))}")
    return text


def _write(kit: Path, rel: str, text: str, files: list[str]) -> None:
    p = kit / rel
    if p.exists():
        raise ScaffoldError(f"{rel} already exists; scaffolds never overwrite (pick another name)")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    files.append(rel)


def _q(s: str) -> str:
    return s.replace('"', "'")


def _check_name(kit: Path, kind: str, name: str) -> None:
    if not NAME.match(name):
        raise ScaffoldError(f"{kind} name '{name}' must be lowercase letters, digits and dashes (2-41 chars)")
    if kind in ("mode", "env", "connector") and _protected(kit, kind, name):
        raise ScaffoldError(f"{kind} '{name}' is a protected name (framework/components.yaml `protected:`): only "
                            f"forge.extend defines it; pick another")


def _protected(kit: Path, kind: str, name: str) -> bool:
    """Does the component map reserve this name? A map that cannot be read reserves every name (fail closed)."""
    from .model import load_protection
    return load_protection(kit)[0].reserved(kind, name)


def review_block(effects: list[str], role: str = "reviewer") -> str:
    when = "always" if REVIEW_EFFECTS & set(effects) else "never"
    return f"      review: {{ role: {role}, when: {when} }}"


def create(kit: Path, kind: str, name: str, *, target: str | None = None, implements: str | None = None,
           intent: str | None = None, effects: list[str] | None = None, role: str | None = None) -> dict:
    if kind == "role":
        from .model import USER_ROLE
        raise ScaffoldError(USER_ROLE)
    if kind not in KINDS:
        raise ScaffoldError(f"unknown kind '{kind}' (have: {', '.join(KINDS)})")
    _check_name(kit, kind, name)
    raw_intent = intent or f"TODO one sentence: what {name} is for"
    intent = _q(raw_intent)
    files: list[str] = []
    todo: list[str] = []
    if kind == "mode":
        base = f"modes/{name}"
        _write(kit, f"{base}/mode.yaml", _render("mode/mode.yaml", name=name, intent=intent), files)
        _write(kit, f"{base}/playbook.md", _render("mode/playbook.md", name=name), files)
        _write(kit, f"{base}/README.md", _render("mode/README.md", name=name, intent=raw_intent), files)
        _write(kit, f"{base}/types/RunReq.schema.json", _render("mode/RunReq.schema.json"), files)
        _write(kit, f"{base}/types/RunOut.schema.json", _render("mode/RunOut.schema.json"), files)
        _write(kit, f"{base}/features/run/playbook.md",
               _render("feature/playbook.md", mode=name, name="run", intent=intent, role=role or "builder"), files)
        _write(kit, f"{base}/features/run/rules.yaml", _render("feature/rules.yaml"), files)
        todo = [f"fill the TODOs in {base}/features/run/playbook.md and rules.yaml",
                f"rename or add features with `bay new feature <name> --mode {name}`", "run `./bay.sh check`"]
    elif kind == "feature":
        if not target:
            raise ScaffoldError("kind=feature needs a target mode (--mode <mode>)")
        mdir = kit / "modes" / target
        mfile = mdir / "mode.yaml"
        if _protected(kit, "mode", target):
            raise ScaffoldError(f"mode '{target}' is protected (framework/components.yaml `protected:`): it is changed "
                                f"via forge.extend")
        if not mfile.exists():
            raise ScaffoldError(f"mode '{target}' not found under modes/")
        doc = yaml.safe_load(mfile.read_text())
        from . import model
        merged = model.Kit(kit).get("Mode", target)          # a mode that extends another inherits its roles
        spec = merged.spec if merged is not None else doc["spec"]
        if name in spec["features"]:
            raise ScaffoldError(f"mode {target} already has a feature named '{name}'")
        if role is None:   # default: the mode's first role that is neither its coordinator nor a reviewer
            role = next((r for r in spec["roles"] if r != spec.get("coordinator") and "review" not in r), None)
            if role is None:
                raise ScaffoldError(f"mode {target} has no worker role to run the feature; pass --role")
        if role not in spec["roles"]:
            raise ScaffoldError(f"role '{role}' is not in mode {target} roles {spec['roles']}; pass --role")
        effects = effects or ["read", "write"]
        reviewer = "reviewer" if "reviewer" in spec["roles"] else None
        rv = review_block(effects, reviewer) if reviewer else "      # review: add a reviewer role to the mode to enable"
        ft = _render("feature/feature.yaml", name=name, intent=intent, effects=", ".join(effects), review=rv, role=role)
        text = _insert_under(mfile.read_text(), "  features:", ft)
        _write(kit, f"modes/{target}/features/{name}/playbook.md",
               _render("feature/playbook.md", mode=target, name=name, intent=intent, role=role), files)
        _write(kit, f"modes/{target}/features/{name}/rules.yaml", _render("feature/rules.yaml"), files)
        mfile.write_text(text)
        files.append(f"modes/{target}/mode.yaml")
        todo = [f"fill the TODOs in modes/{target}/features/{name}/", "run `./bay.sh check`"]
    elif kind == "connector":
        if not implements:
            raise ScaffoldError("kind=connector needs --implements <interface>/v<N> (e.g. items.source/v1)")
        iface = _find_interface(kit, implements)
        module = name.replace("-", "_")
        host = "api.example.com"
        methods = "\n".join(_method(ep, spec) for ep, spec in iface["spec"]["endpoints"].items())
        base = f"connectors/{name}"
        src = ""
        if implements.startswith("items.source/"):
            from . import model
            kinds = model.item_kinds(kit)
            kind = next((f"{k}/v{min(v)}" for k, v in sorted(kinds.items())), "<kind>/v1")
            src = (f"  produces: [{kind}]    # TODO the item kind(s) its items carry: <kind>/v<N> (a content type, content-types/)\n"
                   f"  source: {name}       # value stamped on every item's `source`; item ids are <source>:<extId>\n"
                   f"  window: 7d             # how far back the API serves; older history comes from the store\n"
                   f"  selectors:             # TODO which selector fields the API handles natively; unlisted = unsupported\n"
                   f"    since: native\n    text: local\n    not: local\n")
        _write(kit, f"{base}/connector.yaml", _render("connector/connector.yaml", name=name, intent=intent,
                                                      implements=implements, module=module, host=host,
                                                      source_fields=src), files)
        _write(kit, f"{base}/{module}.py", _render("connector/module.py.tmpl", name=name, implements=implements,
                                                   host=host, methods=methods), files)
        _write(kit, f"{base}/README.md", _render("connector/README.md", name=name, intent=raw_intent,
                                                 implements=implements), files)
        _write(kit, f"{base}/tests/test_{module}.py", _render("connector/test_module.py.tmpl", name=name,
                                                               module=module, host=host), files)
        todo = [f"set the real API host in {base}/connector.yaml and {base}/{module}.py",
                f"implement {', '.join(iface['spec']['endpoints'])}",
                f"bind it in an env: `{implements}: [{name}]` and allow its host and secrets"]
    elif kind == "env":
        _write(kit, f"envs/{name}.yaml", _render("env/env.yaml", name=name, intent=intent), files)
        todo = [f"bind capabilities in envs/{name}.yaml", f"put roles in it from a mode's `roles:` (<role>: {name})"]
    return {"kind": kind, "name": name, "files": files, "todo": todo}


def _method(ep: str, spec: dict) -> str:
    props = list(((spec.get("in") or {}).get("properties") or {}))
    args = "".join(f", {p}=None" for p in props)
    return (f"    def {ep}(self{args}) -> dict:\n"
            f"        \"\"\"{(spec.get('description') or ep).strip().splitlines()[0]}\"\"\"\n"
            f"        raise ConnectorError(\"{ep}: not implemented yet\")\n")


def _find_interface(kit: Path, ref: str) -> dict:
    name, _, ver = ref.partition("/")
    for base in (kit / "interfaces", kit / "framework" / "interfaces"):
        p = base / f"{name}.{ver}.yaml"
        if p.exists():
            return yaml.safe_load(p.read_text())
    raise ScaffoldError(f"unknown interface '{ref}'")


def _insert_under(text: str, header: str, block: str) -> str:
    """Append `block` at the end of the mapping that starts at `header` (2-space YAML)."""
    lines = text.splitlines(keepends=True)
    try:
        i = next(n for n, ln in enumerate(lines) if ln.rstrip() == header)
    except StopIteration:
        # an extending mode may inherit the whole section: start its own (entries merge with the parent's)
        if not any(ln.rstrip() == "spec:" for ln in lines):
            raise ScaffoldError(f"mode.yaml has no '{header.strip()}' section")
        return text.rstrip("\n") + "\n" + header + "\n" + block.rstrip("\n") + "\n"
    j = i + 1
    while j < len(lines) and (lines[j].startswith("    ") or not lines[j].strip()):
        j += 1
    while j > i + 1 and not lines[j - 1].strip():
        j -= 1
    return "".join(lines[:j]) + block.rstrip("\n") + "\n" + "".join(lines[j:])
