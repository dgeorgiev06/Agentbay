"""`bay lint`: structure checks for modes, features, playbooks and rules.

Every problem is one line, `file:line: message`, naming the concept and the fix.
`bay validate` runs lint and then full resolution (model.resolve).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

from . import checks, model, playbook as pbk, rules as rulesmod

# Features whose review can never be turned off, with the settings they must use.
MANDATORY_REVIEW = {"forge.extend": {"when": "always", "tier": "deep", "effort": "high"}}
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


def _entry_line(path: Path, section: str, name: str) -> int | None:
    """0-based index of `    <name>:` inside the `  <section>:` block of a mode.yaml, or None."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    inside = False
    for i, ln in enumerate(lines):
        if re.match(r"^\s{2}\S", ln):
            inside = ln.strip().startswith(f"{section}:")
        elif inside and re.match(rf"^\s{{4}}{re.escape(name)}:", ln):
            return i
    return None


def _lineage_where(md: model.Doc, section: str, name: str) -> tuple[Path, int]:
    """The mode.yaml (own, else the nearest ancestor's) whose `section` (endpoints, workflows) declares `name`,
    and that line: inherited parts are reported where they are written."""
    for d in md.dirs:
        i = _entry_line(d / "mode.yaml", section, name)
        if i is not None:
            return d / "mode.yaml", i + 1
    return md.path, 1


def _ep_where(md: model.Doc, ep_name: str) -> tuple[Path, int]:
    return _lineage_where(md, "endpoints", ep_name)


def _ep_key_where(md: model.Doc, ep_name: str, key: str) -> tuple[Path, int]:
    """The mode.yaml (own, else the nearest ancestor's) whose endpoint `ep_name` sets `key`, and that line;
    falls back to where the endpoint is declared."""
    rx_key = re.compile(rf"\b{re.escape(key)}:")
    for d in md.dirs:
        start = _entry_line(d / "mode.yaml", "endpoints", ep_name)
        if start is None:
            continue
        lines = (d / "mode.yaml").read_text(encoding="utf-8").splitlines()
        for i in range(start, len(lines)):
            ln = lines[i]
            if i > start and ln.strip() and len(ln) - len(ln.lstrip()) <= 4:
                break                                    # the next endpoint (or section) starts
            if rx_key.search(ln.split("#", 1)[0]):
                return d / "mode.yaml", i + 1
    return _ep_where(md, ep_name)


def _file(md: model.Doc, relpath: str, kit: model.Kit) -> str:
    """A mode-relative path (possibly inherited, `../briefing/...`) as a normalized kit-relative path."""
    return os.path.relpath(os.path.normpath(md.dir / relpath), kit.root)


def lint_feature(md: model.Doc, ep_name: str, ep: dict, kit: model.Kit) -> list[str]:
    out: list[str] = []
    mfile, ep_line = _ep_where(md, ep_name)
    target = f"{md.name}.{ep_name}"
    dod_ids: list[str] = []
    for key in ("playbook", "rules"):
        if not ep.get(key):
            out.append(f"{_where(mfile, ep_line)}: feature {target} has no `{key}`; add "
                       f"`{key}: features/{ep_name}/{'playbook.md' if key == 'playbook' else 'rules.yaml'}`")
        elif not (md.dir / ep[key]).exists():
            out.append(f"{_where(mfile, ep_line)}: feature {target} {key} file {_file(md, ep[key], kit)} does not exist")

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
                       f"{{ role: <reviewer>, when: always, tier: deep, effort: high }}; review is mandatory and cannot "
                       f"be disabled or weakened here")
    for rs in (rv or {}).get("rulesets", []):
        if not (kit.root / "framework" / "rules" / f"{rs}.yaml").exists():
            out.append(f"{_where(mfile, ep_line)}: feature {target} review names rule set '{rs}', but "
                       f"framework/rules/{rs}.yaml does not exist")
    if rv and rv.get("when") == "always" and rv.get("role") not in kit.docs["Role"]:
        out.append(f"{_where(mfile, ep_line)}: feature {target} review role '{rv.get('role')}' does not exist "
                   f"(have: {', '.join(sorted(kit.docs['Role']))})")
    return out


def _step_where(md: model.Doc, ep_name: str, sid: str | None) -> tuple[Path, int]:
    """Where a workflow step of a feature is written (own mode.yaml, else the nearest ancestor's)."""
    wf = (md.spec.get("endpoints") or {}).get(ep_name, {}).get("workflow")
    rx = re.compile(rf"\bid:\s*{re.escape(sid or '')}(?![\w-])")
    for d in md.dirs:
        start = _entry_line(d / "mode.yaml", "workflows", wf) if wf and sid else None
        if start is None:
            continue
        lines = (d / "mode.yaml").read_text(encoding="utf-8").splitlines()
        for i in range(start + 1, len(lines)):
            if lines[i].strip() and len(lines[i]) - len(lines[i].lstrip()) <= 4:
                break
            if rx.search(lines[i]):
                return d / "mode.yaml", i + 1
    return _ep_key_where(md, ep_name, "roles")


def lint_role_envs(md: model.Doc, kit: model.Kit) -> list[str]:
    """Each role of the mode is a framework role; each step's role is in the mode and has exactly one env
    (step > feature > mode `roles:`)."""
    out = []
    roles = md.spec.get("roles") if isinstance(md.spec.get("roles"), dict) else {}
    problems = [(None, None, f"mode {md.name}: `roles:` names unknown role '{rn}' (framework roles: "
                             f"{', '.join(sorted(kit.docs['Role']))}); {model.USER_ROLE.split(' (`bay migrate`')[0]}")
                for rn in roles if rn not in kit.docs["Role"]]
    envs = kit.docs["Environment"]
    have = ", ".join(sorted(envs))

    def unknown(where, mapping):
        return [f"{where}: `roles:` puts role {rn} in unknown env '{env}' (have: {have})"
                for rn, env in (mapping or {}).items() if env and env not in envs]
    problems += [(None, None, m) for m in unknown(f"mode {md.name}", roles)]
    for ep_name, ep in (md.spec.get("endpoints") or {}).items():
        problems += [(ep_name, None, m) for m in unknown(f"{md.name}.{ep_name}", ep.get("roles"))]
        for st in (md.spec.get("workflows") or {}).get(ep.get("workflow"), []):
            problems += [(ep_name, st.get("id"), m)
                         for m in unknown(f"{md.name}.{ep_name} step {st.get('id')}", st.get("roles"))]
    for ep_name, sid, msg in problems + model.role_env_problems(md):
        if ep_name and sid:
            where = _step_where(md, ep_name, sid)
        elif ep_name:
            where = _ep_key_where(md, ep_name, "roles")
        else:
            where = next(((d / "mode.yaml", i + 1) for d in md.dirs
                          for i, ln in enumerate((d / "mode.yaml").read_text(encoding="utf-8").splitlines())
                          if re.match(r"^\s{2}roles:", ln)), (md.path, 1))
        out.append(f"{_where(*where)}: {msg}")
    return out


def lint_env_bindings(kit: model.Kit) -> list[str]:
    """A tools binding under a capability without the `write` effect may not list file-writing tools or any CLI
    beyond the read-only ones (git status/diff/log/show): roles of every access level get read capabilities."""
    out = []
    for env in kit.docs["Environment"].values():
        for iface, b in (env.spec.get("bind") or {}).items():
            idoc = kit.get("Interface", iface)
            if not isinstance(b, dict) or idoc is None or "write" in model.endpoint_effects(kit, iface, None):
                continue
            bad = [x for x in b.get("tools", []) if x in model.WRITE_TOOLS]
            bad += [c for c in b.get("clis", []) if c not in model.READ_ONLY_CLIS]
            if bad:
                line = _line_of(env.path, rf"^\s+{re.escape(iface)}:")
                out.append(f"{_where(env.path, line)}: env {env.name} binds {', '.join(bad)} under {iface}, which has "
                           f"no `write` effect; file-writing tools and CLIs other than "
                           f"{', '.join(model.READ_ONLY_CLIS)} belong under a capability with the write effect "
                           f"(e.g. workspace.write/v1)")
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
    p = model.type_file(md.dirs, ep["in"])
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
            out.append(f"{_where(*_ep_where(md, ep_name))}: feature "
                       f"{md.name}.{ep_name} uses unknown workflow '{ep['workflow']}'")
        out += lint_feature(md, ep_name, ep, kit)
    out += lint_role_envs(md, kit)
    for wf in s["workflows"]:
        if wf not in used:
            out.append(f"{_where(*_lineage_where(md, 'workflows', wf))}: workflow '{wf}' is not "
                       f"used by any endpoint; remove it or add an endpoint")
    # modes name capabilities, never concrete tools or connectors
    text = md.path.read_text(encoding="utf-8")
    for i, ln in enumerate(text.splitlines(), 1):
        # structured values only: drop comments, quoted prose and step ids
        code = re.sub(r"\bid:\s*[\w-]+", "", re.sub(r"\"[^\"]*\"", "", ln.split("#", 1)[0]))
        for c in kit.docs["Connector"]:
            if re.search(rf"(?<![\w.-]){re.escape(c)}(?![\w-]|\.[a-z][\w.-]*/v[0-9])", code):     # not a capability name
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
            have = [n for n in ("playbook.md", "rules.yaml") if (d / n).exists()]
            if md.parent and have:
                continue        # an extending mode's folder holds only what it overrides; the rest is inherited
            for need in ("playbook.md", "rules.yaml"):
                if need not in have:
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


# Interfaces whose connectors must say which `source` they stamp on items, how far back (`window`) the
# source API reaches, and which selector fields its native search handles: the store keys items and
# deletions on `source` and splits every selector by that table.
SOURCE_INTERFACES = ("items.source/v1",)
SELECTOR_MODES = ("native", "local")


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
                if not c.spec.get("selectors"):
                    out.append(f"{_where(c.path, _line_of(c.path, r'^spec:'))}: connector {c.name} implements {iface} "
                               f"but declares no spec.selectors (which selector fields its native search handles: "
                               f"`<field>: native|local`; unlisted fields cannot be expressed)")
    return out


# Scheduled endpoints that a CLI command runs together with the steps they depend on.
SCHEDULED_BY = {"improve.backlog": "`.agentbay/bay improve weekly` (it runs scan, audit and triage first; cron "
                                   "recipe in README)"}


def warnings(kit: model.Kit) -> list[str]:
    """Non-fatal findings: printed by `bay lint`, never fail it."""
    out = list(getattr(kit, "deprecations", []))
    for md in kit.docs["Mode"].values():
        if md.spec.get("abstract"):
            continue                    # never installed: its children carry the schedule
        for ep_name, ep in md.spec["endpoints"].items():
            if ep.get("schedule"):
                target = f"{md.name}.{ep_name}"
                run = SCHEDULED_BY.get(target, f"`.agentbay/bay call {target} '{{}}'`")
                out.append(f"{_where(*_ep_key_where(md, ep_name, 'schedule'))}: {target} declares "
                           f"schedule '{ep['schedule']}' but no runtime acts on it; run {run} from cron")
    out += split_store_warnings(kit)
    stores = [c.name for c in kit.docs["Connector"].values() if "items.store/v1" in (
        [c.spec["implements"]] if isinstance(c.spec["implements"], str) else c.spec["implements"])]
    if stores:
        from .sqlsandbox import fts5_available
        if not fts5_available():
            out.append(f"this Python's SQLite has no FTS5: {', '.join(stores)} falls back to LIKE matching "
                       f"(search is slower and unranked; items_fts is absent from sql). Use a Python built with "
                       f"FTS5 (python.org and Homebrew builds have it) for ranked full-text search")
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


def split_store_warnings(kit: model.Kit) -> list[str]:
    """Code steps (sync, prune) run in the env of the mode's coordinator. A role of a store-reading mode put in an
    env whose items.store/items.source bindings differ reads a store that the mode's sync never fills: a partial
    `roles:` override silently splits the mode."""
    out = []
    keys = (model.STORE_IFACE, model.SOURCE_IFACE)
    for md in kit.docs["Mode"].values():
        if md.spec.get("abstract") or model.STORE_IFACE not in md.spec.get("needs", []):
            continue
        s = md.spec
        maps = [(None, None, s.get("roles"))] + [(ep, None, e.get("roles")) for ep, e in (s.get("endpoints") or {}).items()]
        maps += [(ep, st.get("id"), st.get("roles")) for ep, e in (s.get("endpoints") or {}).items()
                 for st in (s.get("workflows") or {}).get(e.get("workflow"), [])]
        for ep_name, sid, mapping in maps:
            code, _ = model.code_env(kit, md, model.STORE_IFACE, (s.get("endpoints") or {}).get(ep_name))
            if code is None or not isinstance(mapping, dict):
                continue
            want = [code.spec["bind"].get(k) for k in keys]
            for rn, env_name in mapping.items():
                env = kit.get("Environment", kit.env_name(env_name) or "")
                if env is None or env.name == code.name or model.STORE_IFACE not in env.spec.get("bind", {}):
                    continue
                if [env.spec["bind"].get(k) for k in keys] != want:
                    where = (_step_where(md, ep_name, sid) if sid else _ep_key_where(md, ep_name, "roles") if ep_name
                             else next(((d / "mode.yaml", i + 1) for d in md.dirs for i, ln in enumerate(
                                 (d / "mode.yaml").read_text(encoding="utf-8").splitlines())
                                 if re.match(r"^\s{2}roles:", ln)), (md.path, 1)))
                    out.append(f"{_where(*where)}: mode {md.name} puts role {rn} in env {env.name}, whose "
                               f"items.store/items.source bindings differ from env {code.name}, where its code steps "
                               f"(sync, prune) run (the coordinator's env): {rn} would read a store this mode's sync "
                               f"never fills. Put {rn} in {code.name}, or move the coordinator too")
    return list(dict.fromkeys(out))


def run(kit_root: Path | None = None, project: Path | None = None, kit: model.Kit | None = None) -> list[str]:
    kit = kit or model.Kit(kit_root or model.KIT, project)
    out = list(kit.errors) + list(kit.collisions)
    seen: set[str] = set()
    # parents first; a child's problem that is its parent's problem (same file:line, the same message with the
    # child's mode name) is reported once, as the parent's
    for md in sorted(kit.docs["Mode"].values(), key=lambda d: (len(d.dirs), d.name)):
        ancestors, cur = [], md
        while cur.parent and cur.parent not in ancestors:
            ancestors.append(cur.parent)
            cur = kit.docs["Mode"].get(cur.parent)
            if cur is None:
                break
        for p in lint_mode(md, kit):
            loc, msg = (p.split(": ", 1) + [""])[:2] if re.match(r"^\S+:\d+: ", p) else ("", p)
            same = {(f"{loc}: " if loc else "") + re.sub(rf"(?<![\w-]){re.escape(md.name)}(?![\w-])", a, msg)
                    for a in ancestors}
            if p in seen or same & seen:
                continue
            seen.add(p)
            out.append(p)
    out += lint_roles(kit)
    out += lint_env_bindings(kit)
    out += lint_connectors(kit)
    out += lint_rulesets(kit)
    return list(dict.fromkeys(out))


def lint_rulesets(kit: model.Kit) -> list[str]:
    """framework/rules/conformance.yaml: schema, unique ids, known checks (bay/improve/conformance.py)."""
    if not (kit.root / "framework" / "rules").is_dir():
        return []
    from .improve import conformance
    return conformance.lint(kit.root)
