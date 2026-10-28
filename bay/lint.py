"""`bay lint`: structure checks for modes, features, playbooks and rules.

Every problem is one line, `file:line: message`, naming the concept and the fix.
`bay validate` runs lint and then full resolution (model.resolve).
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from . import checks, model, playbook as pbk, rules as rulesmod

# Features whose review can never be turned off, with the settings they must use.
MANDATORY_REVIEW = {"forge.extend": {"when": "always", "model": "opus", "effort": "high"}}
TOOL_NAMES = {"Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Task", "Agent"}


def _line_of(path: Path, pattern: str, default: int = 1) -> int:
    rx = re.compile(pattern)
    try:
        for i, ln in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if rx.search(ln):
                return i
    except OSError:
        pass
    return default


def _where(path: Path, line: int) -> str:
    return f"{model.rel(path)}:{line}"


def lint_feature(md: model.Doc, ep_name: str, ep: dict, kit: model.Kit) -> list[str]:
    out: list[str] = []
    mfile = md.path
    ep_line = _line_of(mfile, rf"^\s{{4}}{re.escape(ep_name)}:")
    target = f"{md.name}.{ep_name}"
    dod_ids: list[str] = []
    for key in ("playbook", "rules"):
        if not ep.get(key):
            out.append(f"{_where(mfile, ep_line)}: feature {target} has no `{key}`; add "
                       f"`{key}: features/{ep_name}/{'playbook.md' if key == 'playbook' else 'rules.yaml'}`")
        elif not (md.dir / ep[key]).exists():
            out.append(f"{_where(mfile, ep_line)}: feature {target} {key} file {ep[key]} does not exist")

    if ep.get("playbook") and (md.dir / ep["playbook"]).exists():
        pb = pbk.parse(md.dir / ep["playbook"])
        for line, msg in pb.problems:
            out.append(f"{_where(pb.path, line)}: {msg}")
        dod_ids = pb.dod_ids

    if ep.get("rules") and (md.dir / ep["rules"]).exists():
        out += lint_rules(md.dir / ep["rules"], dod_ids, ep, md)

    # review: only in mode.yaml, and its role must exist, be in the mode and resolve
    rv = ep.get("review")
    must = MANDATORY_REVIEW.get(target)
    if must:
        if not rv or any(rv.get(k) != v for k, v in must.items()):
            out.append(f"{_where(mfile, ep_line)}: feature {target} must declare review "
                       f"{{ role: <reviewer>, when: always, model: opus, effort: high }}; review is mandatory and cannot "
                       f"be disabled or weakened here")
    for rs in (rv or {}).get("rulesets", []):
        if not (kit.root / "framework" / "rules" / f"{rs}.yaml").exists():
            out.append(f"{_where(mfile, ep_line)}: feature {target} review names rule set '{rs}', but "
                       f"framework/rules/{rs}.yaml does not exist")
    if rv and rv.get("when") == "always":
        rn = rv.get("role")
        rline = _line_of(mfile, rf"^\s{{4}}{re.escape(ep_name)}:", ep_line)
        rline = _line_of(mfile, r"review:", rline) if rline else rline
        if rn not in kit.docs["Role"]:
            out.append(f"{_where(mfile, ep_line)}: feature {target} review role '{rn}' does not exist "
                       f"(have: {', '.join(sorted(kit.docs['Role']))})")
        elif rn not in md.spec["roles"]:
            out.append(f"{_where(mfile, ep_line)}: feature {target} review role '{rn}' is not listed in "
                       f"mode {md.name} roles {md.spec['roles']}")
        else:
            gaps: list[str] = []
            r = model.resolve_role(kit, rn, gaps, f"{target} review", set(), agent=(ep.get("agents") or {}).get(rn))
            if r is not None:
                env = kit.get("Environment", r.env)
                mdl = model.step_inference(md, "review", r, rv).model
                if mdl not in env.spec["models"]:
                    gaps.append(f"review model '{mdl}' is not allowed by env {env.name} (allows: {', '.join(env.spec['models'])})")
            for g in gaps:
                out.append(f"{_where(mfile, ep_line)}: feature {target} review role {rn} cannot be placed: {g}")
    return out


def lint_rules(path: Path, dod_ids: list[str], ep: dict, md: model.Doc) -> list[str]:
    out: list[str] = []
    try:
        doc, lines = rulesmod.raw(path)
    except (rulesmod.RulesError, FileNotFoundError) as e:
        return [str(e)]
    if isinstance(doc, dict):
        for k in doc:
            if k.lower().startswith("review"):
                out.append(f"{_where(path, _line_of(path, rf'^{re.escape(k)}:'))}: review settings found in rules file; "
                           f"configure review only in mode.yaml endpoints.<feature>.review")
    errs = model.schema_errors(doc, model.schema("rules"))
    for e in errs:
        out.append(f"{_where(path, 1)}: rules schema: {e}")
    if errs or not isinstance(doc, dict):
        return out
    seen: dict[str, int] = {}
    kinds = _kind_enum(md, ep)
    for i, r in enumerate(doc["rules"]):
        ln = lines.get(i, 1)
        if r["id"] in seen:
            out.append(f"{_where(path, ln)}: duplicate rule id {r['id']} (first on line {seen[r['id']]})")
        seen.setdefault(r["id"], ln)
        for ref in r.get("refs", []):
            if ref not in dod_ids:
                out.append(f"{_where(path, ln)}: rule {r['id']} refs {ref}, which is not a Definition of Done id "
                           f"in the playbook (have: {', '.join(dod_ids) or 'none'})")
        if r.get("check") and not checks.known(r["check"]):
            out.append(f"{_where(path, ln)}: rule {r['id']} names unknown check '{r['check']}' "
                       f"(have: {', '.join(checks.REGISTRY)})")
        wk = (r.get("when") or {}).get("kind")
        if wk is not None:
            vals = [wk] if isinstance(wk, str) else wk
            if kinds is None:
                out.append(f"{_where(path, ln)}: rule {r['id']} uses when.kind but the feature's input type has no "
                           f"`kind` enum")
            else:
                for v in vals:
                    if v not in kinds:
                        out.append(f"{_where(path, ln)}: rule {r['id']} when.kind '{v}' is not one of {kinds}")
    return out


def _kind_enum(md: model.Doc, ep: dict) -> list[str] | None:
    if not ep.get("in"):
        return None
    p = md.dir / "types" / f"{ep['in']}.schema.json"
    if not p.exists():
        return None
    import json
    s = json.loads(p.read_text())
    return (s.get("properties", {}).get("kind") or {}).get("enum")


def lint_mode(md: model.Doc, kit: model.Kit) -> list[str]:
    out: list[str] = []
    s = md.spec
    used = set()
    for ep_name, ep in s["endpoints"].items():
        used.add(ep["workflow"])
        if ep["workflow"] not in s["workflows"]:
            out.append(f"{_where(md.path, _line_of(md.path, rf'^\s{{4}}{re.escape(ep_name)}:'))}: feature "
                       f"{md.name}.{ep_name} uses unknown workflow '{ep['workflow']}'")
        out += lint_feature(md, ep_name, ep, kit)
    for wf in s["workflows"]:
        if wf not in used:
            out.append(f"{_where(md.path, _line_of(md.path, rf'^\s{{4}}{re.escape(wf)}:'))}: workflow '{wf}' is not "
                       f"used by any endpoint; remove it or add an endpoint")
    # modes name capabilities, never concrete tools or connectors
    text = md.path.read_text(encoding="utf-8")
    for i, ln in enumerate(text.splitlines(), 1):
        # structured values only: drop comments, quoted prose and step ids
        code = re.sub(r"\bid:\s*[\w-]+", "", re.sub(r"\"[^\"]*\"", "", ln.split("#", 1)[0]))
        for c in kit.docs["Connector"]:
            if re.search(rf"(?<![\w.-]){re.escape(c)}(?![\w-])", code):
                out.append(f"{_where(md.path, i)}: mode names connector '{c}'; modes name capabilities only "
                           f"(bind connectors in an env)")
        for t in TOOL_NAMES:
            if re.search(rf"\b(tools|uses)\s*:.*\b{t}\b", code):
                out.append(f"{_where(md.path, i)}: mode names tool '{t}'; modes name capabilities only")
    # stray review settings in mode-level playbook
    pb = md.dir / "playbook.md"
    if pb.exists():
        for i, ln in enumerate(pb.read_text(encoding="utf-8").splitlines(), 1):
            if pbk.REVIEW_SETTING.match(ln):
                out.append(f"{_where(pb, i)}: review settings found in playbook; configure review only in mode.yaml")
    # features folder must not contain orphans
    fdir = md.dir / "features"
    if fdir.is_dir():
        declared = {Path(ep.get("playbook", "")).parent.name for ep in s["endpoints"].values()}
        for d in sorted(p for p in fdir.iterdir() if p.is_dir()):
            if d.name not in declared:
                out.append(f"{model.rel(d)}: feature folder is not referenced by any endpoint in mode.yaml")
            for need in ("playbook.md", "rules.yaml"):
                if not (d / need).exists():
                    out.append(f"{model.rel(d)}: feature folder is missing {need}")
    return out


def lint_roles(kit: model.Kit) -> list[str]:
    out = []
    for kind in ("Role", "Agent", "Environment", "Connector"):
        for d in kit.docs[kind].values():
            raw = yaml.safe_load(d.path.read_text()) or {}
            if "review" in (raw.get("spec") or {}):
                out.append(f"{_where(d.path, _line_of(d.path, r'^\s+review:'))}: review settings found in {'an' if kind[0] in 'AEIOU' else 'a'} {kind}; "
                           f"configure review only in mode.yaml endpoints.<feature>.review")
    return out


# Interfaces whose connectors must say which `source` they stamp on posts and how far back
# (`window`) the source API reaches: the store keys posts and deletions on `source`.
SOURCE_INTERFACES = ("feed.source/v1",)


def lint_connectors(kit: model.Kit) -> list[str]:
    out = []
    for c in kit.docs["Connector"].values():
        impl = c.spec["implements"]
        impl = [impl] if isinstance(impl, str) else impl
        for iface in impl:
            if iface in SOURCE_INTERFACES:
                for key, why in (("source", "the value stamped on every post's `source`; the store keys posts "
                                            "and deletions on it"),
                                 ("window", "how far back the source API serves (e.g. 7d); older history "
                                            "comes only from the store")):
                    if not c.spec.get(key):
                        out.append(f"{_where(c.path, _line_of(c.path, r'^spec:'))}: connector {c.name} implements "
                                   f"{iface} but declares no spec.{key} ({why})")
    return out


# Scheduled endpoints that a CLI command runs together with the steps they depend on.
SCHEDULED_BY = {"improve.backlog": "`.agentbay/bay improve weekly` (it runs scan, audit and triage first; cron "
                                   "recipe in README)"}


def warnings(kit: model.Kit) -> list[str]:
    """Non-fatal findings: printed by `bay lint`, never fail it."""
    out = []
    for md in kit.docs["Mode"].values():
        for ep_name, ep in md.spec["endpoints"].items():
            if ep.get("schedule"):
                target = f"{md.name}.{ep_name}"
                run = SCHEDULED_BY.get(target, f"`.agentbay/bay call {target} '{{}}'`")
                out.append(f"{_where(md.path, _line_of(md.path, r'schedule:'))}: {target} declares "
                           f"schedule '{ep['schedule']}' but no runtime acts on it; run {run} from cron")
    if kit.project is not None and kit.project.resolve() == kit.root.resolve():
        for env in kit.docs["Environment"].values():
            for w in env.spec.get("fs", {}).get("write", []):
                hits = [d for d in model.PROTECTED if w in (".", "", "./") or Path(d).is_relative_to(Path(w))]
                hits = [d for d in hits if Path(w) != Path(d) and not Path(w).is_relative_to(Path(d))]
                if hits:
                    out.append(f"{env.rel}: env {env.name} write path '{w}' reaches "
                               f"{', '.join(d + '/' for d in hits)} because the project is the agentbay checkout; "
                               f"the guard hook denies those writes at runtime unless the env names them explicitly "
                               f"(only forge.extend's framework-dev does)")
    return out


def run(kit_root: Path | None = None, project: Path | None = None, kit: model.Kit | None = None) -> list[str]:
    kit = kit or model.Kit(kit_root or model.KIT, project)
    out = list(kit.errors) + list(kit.collisions)
    for md in kit.docs["Mode"].values():
        out += lint_mode(md, kit)
    out += lint_roles(kit)
    out += lint_connectors(kit)
    out += lint_rulesets(kit)
    return list(dict.fromkeys(out))


def lint_rulesets(kit: model.Kit) -> list[str]:
    """framework/rules/conformance.yaml: schema, unique ids, known checks (bay/improve/conformance.py)."""
    if not (kit.root / "framework" / "rules").is_dir():
        return []
    from .improve import conformance
    return conformance.lint(kit.root)
