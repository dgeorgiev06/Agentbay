"""`bay lint`: structure checks for modes, features, playbooks and rules.

Every problem is one line, `file:line: message`, naming the concept and the fix.
`bay validate` runs lint and then full resolution (model.resolve).
"""
from __future__ import annotations

import fnmatch
import os
import re
import subprocess
from pathlib import Path

import yaml

from . import boundary, checks, model, playbook as pbk, rules as rulesmod, workflows as wfmod

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
    roles = md.spec.get("roles") or {}
    problems = [(None, None, f"mode {md.name}: `roles:` names unknown role '{rn}' (framework roles: "
                             f"{', '.join(sorted(kit.docs['Role']))}); {model.USER_ROLE}")
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


def lint_substitutes(kit: model.Kit) -> list[str]:
    """F-11: at most one env may substitute a given env. The offline switch maps each env to one substitute, so a
    second one would be dropped from agentbay.config.example.yaml without a word."""
    by: dict[str, list] = {}
    for env in sorted(kit.docs["Environment"].values(), key=lambda e: e.name):
        if env.spec.get("substitutes"):
            by.setdefault(env.spec["substitutes"], []).append(env)
    out = []
    for target, envs in sorted(by.items()):
        if len(envs) > 1:
            first = envs[0]
            line = _line_of(first.path, r"^\s*substitutes:")
            out.append(f"{_where(first.path, line)}: envs "
                       f"{', '.join(e.name for e in envs)} all declare `substitutes: {target}`; "
                       f"an env may have one substitute only")
    return out


def lint_adapters(kit: model.Kit) -> list[str]:
    """F-12: every adapters/<name>/adapter.yaml matches schemas/adapter.schema.json, its `name` is its folder and
    its `module` a file inside the folder. Checked without importing any adapter code."""
    from . import adapter
    _, bad = adapter.scan(kit.root / "adapters")
    return [_rel(e, kit) for errs in bad.values() for e in errs]


def _rel(msg: str, kit: model.Kit) -> str:
    root = str(kit.root.resolve()) + "/"
    return msg.replace(root, "").replace(str(kit.root) + "/", "")


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


def _binds(env, conn_name: str) -> bool:
    for v in (env.spec.get("bind") or {}).values():
        if conn_name in (v if isinstance(v, list) else [v] if isinstance(v, str) else []):
            return True
    return False


def lint_connectors(kit: model.Kit) -> list[str]:
    out = []
    for c in kit.docs["Connector"].values():
        needs = c.spec.get("needs", {}).get("secrets", [])
        if c.spec.get("login") and needs:
            ok = [e.name for e in kit.docs["Environment"].values() if _binds(e, c.name)
                  and all(any(fnmatch.fnmatchcase(a, p) for a in e.spec.get("secrets", {}).get("allow", []))
                          for p in needs)]
            if not ok:
                out.append(f"{_where(c.path, _line_of(c.path, r'^\s+login:'))}: connector {c.name} declares a "
                           f"`login` but no env that binds it allows all of its needs.secrets ({', '.join(needs)}); "
                           f"`bay auth` gives a login only the secrets a sync through that env would get")
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


def _as_list(v) -> list:
    return [v] if isinstance(v, str) else list(v or [])


def lint_contract_versions(kit: model.Kit) -> list[str]:
    """B-6 (proposal 0006, Part F): contracts are versioned and agree. `needs:`, `implements:`, `reads:` and
    `produces:` name `<name>/v<N>`; `reads:`/`produces:` name a known item kind; an items.source connector says
    what it produces and a mode that needs items.source says what it reads; and every kind a mode reads is
    produced, at that version, by the items.source connectors bound in each env its roles use (and in each env
    that can stand in for one)."""
    out, kinds = [], model.item_kinds(kit.root)
    known = ", ".join(f"{k}/v{v}" for k in sorted(kinds) for v in sorted(kinds[k])) or "none"

    def kind_problems(where, owner, key, names):
        for n in names:
            if not model.VERSIONED.match(n):
                out.append(f"{where}: {owner} {key}: '{n}' is unversioned; name the contract version, "
                           f"`<kind>/v<N>` (known: {known})")
                continue
            k, _, v = n.partition("/v")
            if k not in kinds:
                out.append(f"{where}: {owner} {key}: unknown item kind '{n}' (known: {known}); add the kind's "
                           f"schema to schemas/data/ or fix the name")
            elif int(v) not in kinds[k]:
                out.append(f"{where}: {owner} {key}: item kind {k} has no version {v} (known: {known})")

    for c in sorted(kit.docs["Connector"].values(), key=lambda d: d.name):
        where = _where(c.path, _line_of(c.path, r"^\s+implements:"))
        impl = _as_list(c.spec["implements"])
        for i in impl:
            if not model.VERSIONED.match(i):
                out.append(f"{where}: connector {c.name} implements '{i}', which is unversioned; write "
                           f"`<interface>/v<N>` (e.g. items.source/v1)")
        kind_problems(_where(c.path, _line_of(c.path, r"^\s+produces:")), f"connector {c.name}", "produces",
                      _as_list(c.spec.get("produces")))
        if model.SOURCE_IFACE in impl and not c.spec.get("produces"):
            out.append(f"{where}: connector {c.name} implements {model.SOURCE_IFACE} but declares no "
                       f"spec.produces (the item kinds its items carry, e.g. `produces: [post/v1]`; known: {known})")
    envs = kit.docs["Environment"]
    for md in sorted(kit.docs["Mode"].values(), key=lambda d: d.name):
        path, line = md.path, _line_of(md.path, r"^\s+needs:")
        for n in md.spec.get("needs", []):
            if not model.VERSIONED.match(n):
                out.append(f"{_where(path, line)}: mode {md.name} needs '{n}', which is unversioned; write "
                           f"`<interface>/v<N>`")
        reads = _as_list(md.spec.get("reads"))
        rpath = next((d / "mode.yaml" for d in md.dirs if re.search(r"(?m)^\s+reads:", (d / "mode.yaml").read_text())),
                     md.path)
        rwhere = _where(rpath, _line_of(rpath, r"^\s+reads:"))
        kind_problems(rwhere, f"mode {md.name}", "reads", reads)
        if model.SOURCE_IFACE not in md.spec.get("needs", []) or md.spec.get("abstract"):
            continue
        if not reads:
            out.append(f"{_where(md.path, _line_of(md.path, r'^spec:'))}: mode {md.name} needs {model.SOURCE_IFACE} "
                       f"but declares no spec.reads (the item kinds its features read, e.g. `reads: [post/v1]`; "
                       f"known: {known})")
            continue
        names = model.mode_envs(md)
        names += [e.name for e in envs.values() if e.spec.get("substitutes") in names]
        for en in dict.fromkeys(names):
            env = envs.get(en)
            if env is None:
                continue                                    # unknown envs are lint_role_envs' problem
            bound = model.connectors_of(model._bound(env, model.SOURCE_IFACE))
            if not bound:
                continue
            made: dict[str, dict[int, list[str]]] = {}
            for cn in bound:
                c = kit.docs["Connector"].get(cn)
                for p in _as_list(c.spec.get("produces")) if c else []:
                    k, _, v = p.partition("/v")
                    if v.isdigit():
                        made.setdefault(k, {}).setdefault(int(v), []).append(cn)
            for r in reads:
                k, _, v = r.partition("/v")
                if not v.isdigit():
                    continue
                if k not in made:
                    out.append(f"{rwhere}: mode {md.name} reads {r}, but no {model.SOURCE_IFACE} connector env {en} "
                               f"binds ({', '.join(bound)}) produces {k}. Bind a connector that produces {r} in "
                               f"env {en}, or make one with forge.connect")
                elif int(v) not in made[k]:
                    have = "; ".join(f"{', '.join(cs)} produce {k}/v{n}" for n, cs in sorted(made[k].items()))
                    out.append(f"{rwhere}: mode {md.name} reads {r}, but in env {en} {have}: version mismatch. "
                               f"Update the mode's reads: or the connector to the same version")
                elif len(made[k]) > 1:
                    odd = "; ".join(f"{', '.join(cs)} produce {k}/v{n}" for n, cs in sorted(made[k].items())
                                    if n != int(v))
                    out.append(f"{rwhere}: mode {md.name} reads {r}, but in env {en} {odd}: mixed versions of {k} "
                               f"reach the mode. Bind only connectors that produce {r}, or update them")
    return out


# B-7: the files of an extension that must not name another. READMEs are exempt (they document the extension's
# own setup and may name what its env binds); so are tests/ (fixtures pick concrete stand-ins on purpose).
MODE_FILES = ("mode.yaml", "playbook.md", "config.example.yaml", "config.schema.json", "features/**/*",
              "skills/**/*", "types/**/*")
CONNECTOR_FILES = ("**/*.py", "**/*.yaml", "**/*.yml")
_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+(?:\s*,\s*[\w.]+)*))")


def _extension_files(doc: model.Doc, pats) -> list[Path]:
    """The files B-7 scans: the patterns inside the folder (README.md and the folder's top-level tests/ exempt)
    plus every file the manifest references (entry, config schema), wherever it lives."""
    out = {doc.path}
    for pat in pats:
        out |= {f for f in doc.dir.glob(pat) if f.is_file() and "__pycache__" not in f.parts
                and f.relative_to(doc.dir).parts[0] != "tests" and f.name != "README.md"}
    for key in ("entry", "config"):
        ref = doc.spec.get(key)
        if isinstance(ref, str) and (doc.dir / ref).is_file():
            out.add((doc.dir / ref).resolve())
    return sorted(out)


def lint_extension_names(kit: model.Kit) -> list[str]:
    """B-7 (proposal 0006, Part F; conformance C-4, C-8): no extension names another. A mode's files never name a
    connector or another mode (its `extends:` ancestors excepted); a connector's code and yaml never name a mode
    or another connector, and its code imports no other extension's module. Core instances (under a core
    `owns:` path) are not extensions and are not scanned; framework instances may name each other (they ship and
    change together, only through forge.extend), never a user extension. A static scan cannot be complete
    (a name can be computed at run time); it catches the spelled-out forms: the name in any case, its module
    form, the kernel's `agentbay_connector_*`/`agentbay_adapter_*` keys and imports."""
    cpath = kit.root / "framework" / "components.yaml"
    cmap = boundary.ComponentMap.load(cpath) if cpath.exists() else None

    def relk(f: Path) -> str:
        try:
            return str(f.relative_to(kit.root))
        except ValueError:
            return str(f)

    docs = [*kit.docs["Mode"].values(), *kit.docs["Connector"].values()]
    names = {d.name: d for d in docs}
    def name_rx(n: str):
        # the name, its module form (gmail_api) and the sys.modules keys the kernel loads it under
        mod = re.escape(n.replace("-", "_"))
        return re.compile(rf"(?<![\w.-]){re.escape(n)}(?![\w-]|\.\w)|(?<![\w.-]){mod}(?![\w-]|\.\w)"
                          rf"|agentbay_(?:connector|adapter)_{mod}(?!\w)", re.I)
    rxs = {n: name_rx(n) for n in names}
    modules = {Path(d.spec["entry"]).stem: d for d in kit.docs["Connector"].values() if d.spec.get("entry")}
    out = []
    for d in sorted(docs, key=lambda x: (x.kind, x.name)):
        if cmap and cmap.owner(relk(d.path)):
            continue
        allowed = {d.name}
        if d.kind == "Mode":
            cur = d
            while cur is not None and cur.parent:
                allowed.add(cur.parent)
                cur = kit.docs["Mode"].get(cur.parent)
        what = "mode" if d.kind == "Mode" else "connector"
        for f in _extension_files(d, MODE_FILES if d.kind == "Mode" else CONNECTOR_FILES):
            if f.parent != d.dir and cmap and not f.is_relative_to(d.dir) and cmap.owner(relk(f)):
                continue                          # a referenced core file (e.g. briefing's schema): core, not scanned
            try:
                lines = f.read_text().splitlines()
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(lines, 1):
                for n, rx in rxs.items():
                    o = names[n]
                    if n in allowed or (d.root == "framework" and o.root == "framework") or not rx.search(line):
                        continue
                    sort = "mode" if o.kind == "Mode" else "connector"
                    fix = ("name the capability (`<interface>/v<N>`) or the content type it serves; envs bind "
                           "connectors" if sort == "connector" else "describe what is needed, not which mode needs it")
                    out.append(f"{_where(f, i)}: {what} {d.name} names {sort} {n}; no extension names another "
                               f"(B-7, C-4, C-8): {fix}")
                if f.suffix != ".py":
                    continue
                m = _IMPORT.match(line)
                for mod in (([m.group(1)] if m and m.group(1) else (m.group(2) or "").split(",")) if m else []):
                    head = [p for p in mod.strip().split(".") if p]
                    hit = next((modules[x] for x in head if x in modules and modules[x] is not d), None)
                    if hit is not None and not (d.root == "framework" and hit.root == "framework"):
                        out.append(f"{_where(f, i)}: {what} {d.name} imports {mod.strip()} of connector {hit.name}; "
                                   f"no extension imports another (B-7): move shared code into the kernel or copy it")
    return out


# Scheduled endpoints that a CLI command runs together with the steps they depend on.
SCHEDULED_BY = {"improve.backlog": "`.agentbay/bay improve weekly` (it runs scan, audit and triage first; cron "
                                   "recipe in docs/DESIGN.md)"}


def warnings(kit: model.Kit) -> list[str]:
    """Non-fatal findings: printed by `bay lint`, never fail it."""
    out = []
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


def lint_config_schemas(kit: model.Kit) -> list[str]:
    """A child mode's config schema only adds settings to its parent's (0006 Part A): redefining one is an error."""
    out: list[str] = []
    for md in sorted(kit.docs["Mode"].values(), key=lambda d: d.name):
        if md.spec.get("config") and len(md.config_files) > 1:
            gaps: list[str] = []
            model.config_schema(kit, md, gaps)
            out += [g for g in gaps if "redefines inherited" in g]
    return out


def lint_self_description(kit: model.Kit) -> list[str]:
    """Each extension describes itself (0006 Part A): user modes and connectors have a README.md; every
    extension that takes settings has a config.example.yaml whose settings its config schema accepts; and the
    kit's agentbay.config.example.yaml is the one `bay config example` assembles from them."""
    from . import config as cfgmod
    out: list[str] = []
    for kind in ("Mode", "Connector"):
        for d in sorted(kit.docs[kind].values(), key=lambda d: d.name):
            where = os.path.relpath(d.dir, kit.root)
            if d.root == "user" and not (d.dir / "README.md").exists():
                out.append(f"{where}/: {kind.lower()} {d.name} has no README.md; add one (what it is, its "
                           f"contract, setup, settings)")
            if not cfgmod.takes_settings(kind, d):
                continue
            ex = d.dir / cfgmod.FRAGMENT
            if not ex.exists():
                out.append(f"{where}/: {kind.lower()} {d.name} takes settings but has no {cfgmod.FRAGMENT}; add "
                           f"one (the settings body, as under {kind.lower()}s.{d.name} in agentbay.config.yaml)")
                continue
            try:
                body = yaml.safe_load(ex.read_text(encoding="utf-8"))
            except yaml.YAMLError as e:
                out.append(f"{where}/{cfgmod.FRAGMENT}: invalid YAML: {e}")
                continue
            if body is None:
                continue
            gaps: list[str] = []
            sch = model.config_schema(kit, d, gaps) if kind == "Mode" else d.spec["config"]
            if sch is not None and isinstance(body, dict):
                body = {k: v for k, v in body.items() if not (kind == "Mode" and k == "features")}
            errs = model.schema_errors(body, model.inline_refs(sch)) if sch is not None else []
            out += [f"{where}/{cfgmod.FRAGMENT}: {e}" for e in errs]
    example = kit.root / cfgmod.EXAMPLE
    if not example.exists() or example.read_text(encoding="utf-8") != cfgmod.example(kit):
        out.append(f"{cfgmod.EXAMPLE} is stale; run bay config example")
    return out


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
    out += lint_substitutes(kit)
    out += lint_adapters(kit)
    out += lint_connectors(kit)
    out += lint_contract_versions(kit)
    out += lint_extension_names(kit)
    out += lint_rulesets(kit)
    out += lint_components(kit)
    out += lint_ownership(kit)
    out += lint_case_and_manifests(kit)
    out += lint_config_schemas(kit)
    out += lint_self_description(kit)
    out += lint_skill_names(kit)
    out += wfmod.structure_problems(kit)        # project workflows; targets are checked by `bay validate`
    return list(dict.fromkeys(out))


SKILL_REF = re.compile(r"(?:\bthe\s+|\()`?([a-z0-9]+(?:-[a-z0-9]+)*)`?\s+skill\b"
                       r"|\bthe\s+skill\s+`?([a-z0-9]+(?:-[a-z0-9]+)*)`?", re.I)
# words that follow "the skill" in prose, not names ("the skill is", "the skill to use")
_SKILL_PROSE = {"a", "an", "and", "as", "at", "by", "can", "does", "for", "from", "has", "in", "is", "it", "may",
                "must", "of", "on", "or", "should", "that", "the", "then", "this", "to", "was", "when", "which",
                "will", "with", "you"}
SKILL_SHORT = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _skill_refs(text: str) -> list[tuple[int, str]]:
    """Skills a playbook or prompt names by short name ("the corpus-sql skill", "(research-brief skill)")."""
    out = []
    for i, ln in enumerate(text.splitlines(), 1):
        for m in SKILL_REF.finditer(ln):
            name = m.group(1) or m.group(2)
            if m.group(2) and "`" not in m.group(0) and name.lower() in _SKILL_PROSE:
                continue
            out.append((i, name))
    return out


def lint_skill_names(kit: model.Kit) -> list[str]:
    """B-8. The build writes a mode's skills as `<mode>--<skill>` and a role's as `<role>--<skill>`, so each name
    must stay a valid runtime name (a-z, 0-9, '-', at most 64), two sources never share one, and every skill a
    playbook or role prompt names by short name is in that mode's chain (or the roles it maps)."""
    out: list[str] = []
    ids: dict[str, Path] = {}

    def add(owner: str, kind: str, sk: str, src: Path) -> None:
        sid = model.skill_id(owner, sk)
        where = _where(src / "SKILL.md", 1)
        if not SKILL_SHORT.match(sk):
            out.append(f"{where}: skill folder '{sk}' must be lowercase letters, digits and single hyphens")
        if len(sid) > model.SKILL_NAME_MAX:
            out.append(f"{where}: skill name '{sid}' ({kind} {owner}) is {len(sid)} characters, over the "
                       f"{model.SKILL_NAME_MAX} a runtime skill name allows; shorten the skill folder name "
                       f"(or the {kind} name) by {len(sid) - model.SKILL_NAME_MAX}")
        prev = ids.setdefault(sid, src)
        if prev != src:
            out.append(f"{where}: skill name '{sid}' is also built from {model.rel(prev)}; rename one")

    roles = {n: d for n, d in kit.docs["Role"].items()}
    role_skills = {n: list(d.spec.get("skills", [])) for n, d in roles.items()}
    for rn, sks in sorted(role_skills.items()):
        for sk in sks:
            add(rn, "role", sk, roles[rn].dir / "skills" / sk)
    for md in sorted(kit.docs["Mode"].values(), key=lambda d: d.name):
        chain = model.mode_skills(md)
        if not md.spec.get("abstract"):
            for sk, src in sorted(chain.items()):
                add(md.name, "mode", sk, src)
        mapped = set((md.spec.get("roles") or {})) | ({md.spec["coordinator"]} if md.spec.get("coordinator") else set())
        known = set(chain) | {sk for rn in mapped for sk in role_skills.get(rn, [])}
        files = [next((d / "playbook.md" for d in md.dirs if (d / "playbook.md").exists()), None)]
        for ep in (md.spec.get("endpoints") or {}).values():
            if ep.get("playbook"):
                files.append(next((d / ep["playbook"] for d in md.dirs if (d / ep["playbook"]).exists()), None))
        for f in dict.fromkeys(x for x in files if x is not None):
            for i, sk in _skill_refs(f.read_text(encoding="utf-8")):
                if sk not in known:
                    out.append(f"{_where(f, i)}: names skill '{sk}', which is not in mode {md.name}'s chain "
                               f"({', '.join(sorted(known)) or 'none'}); add skills/{sk}/SKILL.md to the mode or "
                               f"fix the name")
    users: dict[str, list] = {}
    for md in kit.docs["Mode"].values():
        if not md.spec.get("abstract"):
            for rn in md.spec.get("roles") or {}:
                users.setdefault(rn, []).append(md)
    for rn, rd in sorted(roles.items()):
        for i, sk in _skill_refs(rd.spec.get("prompt", "")):
            missing = [m.name for m in users.get(rn, []) if sk not in model.mode_skills(m)]
            if sk not in role_skills[rn] and (missing or not users.get(rn)):
                out.append(f"{_where(rd.path, 1)}: role {rn}'s prompt names skill '{sk}', which is neither the "
                           f"role's own (`skills:`) nor in the chain of mode(s) {', '.join(missing) or '-'} that "
                           f"map it; add it to the role's skills or name it in the mode's playbook instead")
    return out


def lint_components(kit: model.Kit) -> list[str]:
    """framework/components.yaml (proposal 0006, Part A): its schema, and every `owns:` glob names a real path."""
    path = kit.root / "framework" / "components.yaml"
    if not path.exists():
        return []
    try:
        doc = model.load_yaml(path)
    except model.SpecError as e:
        return [f"{_where(path, 1)}: {e}"]
    out = [f"{_where(path, 1)}: components schema: {e}" for e in model.schema_errors(doc, model.schema("components"))]
    if out:
        return out
    for comp, spec in doc["components"].items():
        for g in spec["owns"]:
            if not any(kit.root.glob(g.rstrip("/"))):
                out.append(f"{_where(path, _line_of(path, re.escape(g)))}: component {comp} owns '{g}', which matches "
                           f"no path in the kit. Fix the path or remove it")
    return out


def lint_ownership(kit: model.Kit) -> list[str]:
    """B-4 (proposal 0006, Part F): every tracked file of the kit is under a core `owns:` path, an extension
    folder (`at:`) or the boundary's other set. Runs only when the kit is a git checkout."""
    path = kit.root / "framework" / "components.yaml"
    r = subprocess.run(["git", "-C", str(kit.root), "ls-files", "-z"], capture_output=True)
    if not path.exists() or r.returncode:
        return []
    files = [f for f in r.stdout.decode("utf-8", "replace").split("\0") if f]
    return [f"{f}: not under a core owns: path, an extension folder or the boundary's other set (B-4). Move it "
            f"into the folder of the component or extension it belongs to, or add it to that component's owns: "
            f"in framework/components.yaml" for f in boundary.stray(files, boundary.ComponentMap.load(path))]


MANIFESTS = {"mode": "mode.yaml", "connector": "connector.yaml", "adapter": "adapter.yaml"}


def lint_case_and_manifests(kit: model.Kit) -> list[str]:
    """F-4: no two tracked paths differ only in case (one checkout of them would clobber the other on macOS or
    Windows, and `bay boundary` treats them as one), and every extension folder carries its manifest."""
    path = kit.root / "framework" / "components.yaml"
    r = subprocess.run(["git", "-C", str(kit.root), "ls-files", "-z"], capture_output=True)
    if not path.exists() or r.returncode:
        return []
    files = [f for f in r.stdout.decode("utf-8", "replace").split("\0") if f]
    out, seen = [], {}
    for f in files:
        parts = f.split("/")
        for i in range(1, len(parts) + 1):
            p = "/".join(parts[:i])
            other = seen.setdefault(p.casefold(), p)
            if other != p:
                out.append(f"{p}: differs only in case from {other}; rename one (paths must be unique ignoring case)")
                seen[p.casefold()] = p
    cmap, roots = boundary.ComponentMap.load(path), {}
    for f in files:
        ext = cmap.extension(f)
        if ext and ext[0].name in MANIFESTS and ext[1].endswith("/"):
            roots.setdefault(ext[1], set()).add(f[len(ext[1]):])
    for root, inside in sorted(roots.items()):
        if MANIFESTS[cmap.extension(root + "x")[0].name] not in inside:
            out.append(f"{root}: extension folder without its manifest "
                       f"{MANIFESTS[cmap.extension(root + 'x')[0].name]}")
    return list(dict.fromkeys(out))


def lint_rulesets(kit: model.Kit) -> list[str]:
    """framework/rules/conformance.yaml: schema, unique ids, known checks (bay/improve/conformance.py)."""
    if not (kit.root / "framework" / "rules").is_dir():
        return []
    from .improve import conformance
    return conformance.lint(kit.root)
