"""framework/rules/conformance.yaml: load, validate and run its deterministic checks.

Each check takes (kit, rule) and returns violations: {file, line, detail, text?, rewrite?}.
Rules without a `check` are returned by `manual()` for the analyst (improve.audit) and reviewers
(forge.create / forge.extend review plans).
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import yaml

from .. import model, playbook as pbk, rules as rulesmod
from ..secretscan import clip

PATH = Path("framework") / "rules" / "conformance.yaml"
TOOLS = ("Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "NotebookEdit")
VAGUE = ("good", "nice", "clean", "proper", "properly", "appropriate", "appropriately", "reasonable", "high quality",
         "high-quality", "well-written", "robust", "adequate", "adequately", "sufficient", "user-friendly",
         "intuitive", "elegant", "as needed")
ANCHOR = re.compile(r"[0-9`/\"]|\bDOD-|\bR-[0-9]|\b(every|each|no|none|never|all|at least|exactly|only)\b", re.I)
WRITE_CALLS = {"write_text", "write_bytes", "unlink", "rmtree", "rename", "mkdir", "write_json", "dump", "touch",
               "rmdir"}
NET_CALLS = {"urlopen", "request"}


def path(kit: Path) -> Path:
    return kit / PATH


def load(kit: Path) -> dict:
    p = path(kit)
    if not p.exists():
        return {"rules": []}
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {"rules": []}


def lint(kit: Path) -> list[str]:
    """Structure problems of conformance.yaml, as `file:line: message` (used by bay lint)."""
    p = path(kit)
    if not p.exists():
        return [f"{PATH}: missing; it is the single source of semantic conformance rules"]
    try:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        return [f"{PATH}:1: invalid YAML: {e}"]
    out = [f"{PATH}:1: conformance schema: {e}" for e in model.schema_errors(doc, model.schema("conformance"))]
    if out or not isinstance(doc, dict):
        return out
    lines = p.read_text(encoding="utf-8").splitlines()

    def line_of(rid):
        return next((i for i, ln in enumerate(lines, 1) if re.search(rf"id:\s*{re.escape(rid)}\b", ln)), 1)
    seen = set()
    for r in doc["rules"]:
        if r["id"] in seen:
            out.append(f"{PATH}:{line_of(r['id'])}: duplicate conformance rule id {r['id']}")
        seen.add(r["id"])
        if r.get("check") and r["check"] not in CHECKS:
            out.append(f"{PATH}:{line_of(r['id'])}: rule {r['id']} names unknown check '{r['check']}' "
                       f"(have: {', '.join(CHECKS)})")
        if r.get("check") == "vocabulary" and not r.get("terms"):
            out.append(f"{PATH}:{line_of(r['id'])}: rule {r['id']} uses check vocabulary but lists no terms")
    return out


def manual(kit: Path) -> list[dict]:
    return [r for r in load(kit)["rules"] if not r.get("check")]


def run(kit: Path, only: list[str] | None = None) -> list[dict]:
    """Run every deterministic check -> [{rule, level, statement, violations: [...]}]."""
    out = []
    for r in load(kit)["rules"]:
        if not r.get("check") or (only and r["id"] not in only):
            continue
        fn = CHECKS.get(r["check"])
        vs = fn(kit, r) if fn else [{"file": str(PATH), "line": 1, "detail": f"unknown check {r['check']}"}]
        out.append({"rule": r["id"], "level": r["level"], "statement": r["statement"], "check": r["check"],
                    "violations": vs})
    return out


# ----------------------------------------------------------------------------- helpers
def _kit(kit: Path) -> model.Kit:
    return model.Kit(kit)


def _rel(kit: Path, p: Path) -> str:
    try:
        return p.resolve().relative_to(kit.resolve()).as_posix()
    except ValueError:
        return str(p)


def _features(k: model.Kit):
    for md in k.docs["Mode"].values():
        for ep_name, ep in md.spec["endpoints"].items():
            yield md, ep_name, ep


def _vague(text: str) -> str | None:
    low = text.lower()
    for w in VAGUE:
        if re.search(rf"(?<![\w-]){re.escape(w)}(?![\w-])", low) and not ANCHOR.search(text):
            return w
    return None


# ----------------------------------------------------------------------------- checks
def playbook_matches_workflow(kit: Path, rule: dict) -> list[dict]:
    out = []
    k = _kit(kit)
    for md, ep_name, ep in _features(k):
        pb_path = md.dir / ep.get("playbook", "")
        if not ep.get("playbook") or not pb_path.exists():
            continue
        pb = pbk.parse(pb_path)
        if "Steps" not in pb.sections:
            continue
        hline, body = pb.sections["Steps"]
        text = "\n".join(t for _, t in body).lower()
        steps = list(md.spec["workflows"].get(ep["workflow"], []))
        if (ep.get("review") or {}).get("when") == "always" and not any("review" in s for s in steps):
            steps.append({"id": "review", "review": "here"})
        for st in steps:
            tokens = [st["id"]]
            if st.get("role"):
                tokens.append(st["role"])
            if st.get("run"):
                tokens += [st["run"], st["run"].rsplit(".", 1)[-1]]
            if "gate" in st:
                tokens += ["gate", "approv"]
            if "review" in st:
                tokens += ["review"]
            if not any(t.lower() in text for t in tokens):
                what = st.get("run") or st.get("role") or ("gate" if "gate" in st else "review")
                out.append({"file": _rel(kit, pb_path), "line": hline,
                            "detail": f"{md.name}.{ep_name}: workflow step '{st['id']}' ({what}) is not described "
                                      f"in ## Steps"})
    return out


def dod_checkable(kit: Path, rule: dict) -> list[dict]:
    out = []
    for md, ep_name, ep in _features(_kit(kit)):
        p = md.dir / ep.get("playbook", "")
        if ep.get("playbook") and p.exists():
            for d in pbk.parse(p).dod:
                w = _vague(d.text)
                if w:
                    out.append({"file": _rel(kit, p), "line": d.line, "text": d.text,
                                "detail": f"{d.id} rests on '{w}' with no observable anchor"})
    return out


def rules_testable(kit: Path, rule: dict) -> list[dict]:
    out = []
    k = _kit(kit)
    for md, ep_name, ep in _features(k):
        p = md.dir / ep.get("rules", "")
        if ep.get("rules") and p.exists():
            try:
                rs = rulesmod.load(p)
            except rulesmod.RulesError:
                continue
            for r in rs:
                w = _vague(r.statement)
                if w:
                    out.append({"file": _rel(kit, p), "line": r.line, "text": r.statement,
                                "detail": f"{r.id} rests on '{w}' with no observable anchor"})
    for d in k.docs["Role"].values():
        for i, r in enumerate(d.spec.get("rules", [])):
            w = _vague(r)
            if w:
                out.append({"file": _rel(kit, d.path), "line": 1, "text": r,
                            "detail": f"role {d.name} rule {i + 1} rests on '{w}' with no observable anchor"})
    return out


def names_no_tools(kit: Path, rule: dict) -> list[dict]:
    """Backticked tool or connector names in playbooks and feature rules (mode.yaml itself is covered by lint)."""
    out = []
    k = _kit(kit)
    names = list(TOOLS) + sorted(k.docs["Connector"])
    rx = re.compile(r"`(" + "|".join(re.escape(n) for n in names) + r")`")
    for md in k.docs["Mode"].values():
        step_ids = {st["id"] for wf in md.spec["workflows"].values() for st in wf}
        files = [md.dir / "playbook.md"] + sorted(md.dir.glob("features/*/playbook.md")) + \
            sorted(md.dir.glob("features/*/rules.yaml"))
        for f in files:
            if not f.exists():
                continue
            for i, ln in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                for m in rx.finditer(ln):
                    if m.group(1) in step_ids:          # a step id that happens to share a connector's name
                        continue
                    out.append({"file": _rel(kit, f), "line": i, "text": clip(ln.strip(), 200),
                                "detail": f"names concrete {'tool' if m.group(1) in TOOLS else 'connector'} "
                                          f"'{m.group(1)}'; name the capability instead"})
    return out


def _calls(fn: ast.AST) -> set[str]:
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Attribute):
                out.add(f.attr)
                if isinstance(f.value, ast.Name) and f.value.id == "self":
                    out.add(f"self.{f.attr}")
            elif isinstance(f, ast.Name):
                out.add(f.id)
                if f.id == "open" and len(n.args) > 1 and isinstance(n.args[1], ast.Constant) \
                        and any(c in str(n.args[1].value) for c in "wax"):
                    out.add("write_text")
    return out


def effects_match_code(kit: Path, rule: dict) -> list[dict]:
    out = []
    k = _kit(kit)
    for c in k.docs["Connector"].values():
        entry = c.dir / c.spec["entry"]
        try:
            tree = ast.parse(entry.read_text(encoding="utf-8"))
        except (OSError, SyntaxError):
            continue
        impl = c.spec["implements"]
        eps: dict[str, list[str]] = {}
        for iface in [impl] if isinstance(impl, str) else impl:
            d = k.get("Interface", iface)
            for ep, spec in (d.spec["endpoints"] if d else {}).items():
                eps.setdefault(ep, []).extend(spec["effects"])
        funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for cls in [n for n in tree.body if isinstance(n, ast.ClassDef)]:
            methods = {m.name: m for m in cls.body if isinstance(m, ast.FunctionDef)}
            for ep, effects in eps.items():
                if ep not in methods or set(effects) - {"read"}:
                    continue
                seen, todo, calls = set(), [ep], set()
                while todo:
                    name = todo.pop()
                    if name in seen:
                        continue
                    seen.add(name)
                    node = methods.get(name) or funcs.get(name)
                    if node is None:
                        continue
                    cs = _calls(node)
                    calls |= cs
                    todo += [x.removeprefix("self.") for x in cs if x.startswith("self.")]
                    todo += [x for x in cs if x in funcs]
                bad_w = sorted(calls & WRITE_CALLS)
                bad_n = sorted(calls & NET_CALLS)
                if bad_w or bad_n:
                    m = methods[ep]
                    what = ", ".join(([f"writes ({', '.join(bad_w)})"] if bad_w else []) +
                                     ([f"network ({', '.join(bad_n)})"] if bad_n else []))
                    out.append({"file": _rel(kit, entry), "line": m.lineno,
                                "detail": f"connector {c.name}: endpoint {ep} is declared {effects} but its code "
                                          f"path {what}"})
    return out


def review_on_side_effects(kit: Path, rule: dict) -> list[dict]:
    out = []
    for md, ep_name, ep in _features(_kit(kit)):
        eff = set(ep["effects"])
        rv = ep.get("review") or {}
        on = rv.get("when") == "always"
        line = next((i for i, ln in enumerate(md.path.read_text().splitlines(), 1)
                     if re.match(rf"^\s{{4}}{re.escape(ep_name)}:", ln)), 1)
        # Spend is exempt when the mode caps it in dollars: only dispatcher code steps can spend (agents reach
        # read-only endpoints only) and the dispatcher enforces constraints.spendUsd. Delete is never exempt.
        risky = eff & {"delete"} | (eff & {"spend"} if "spendUsd" not in (md.spec.get("constraints") or {}) else set())
        if risky and not on:
            out.append({"file": _rel(kit, md.path), "line": line,
                        "detail": f"{md.name}.{ep_name} has effects {sorted(risky)} but review "
                                  f"is {'off (when: never)' if rv else 'not configured'}"})
        elif "write" in eff and not on and rv.get("when") != "never":
            out.append({"file": _rel(kit, md.path), "line": line,
                        "detail": f"{md.name}.{ep_name} writes but declares no review; add review when always, or "
                                  f"`review: {{when: never}}` if it writes only its own data store"})
    return out


def vocabulary(kit: Path, rule: dict) -> list[dict]:
    out = []
    k = _kit(kit)
    terms = rule.get("terms") or {}
    files: list[Path] = []
    for kind in ("Mode", "Role", "Agent", "Environment", "Connector"):
        for d in k.docs[kind].values():
            files.append(d.path)
            if kind == "Mode":
                files += sorted(d.dir.glob("**/*.md")) + sorted(d.dir.glob("features/*/rules.yaml"))
    files += sorted((kit / "coordinator").glob("**/*.md")) + [kit / "README.md"]
    for f in dict.fromkeys(files):
        if not f.exists():
            continue
        for i, ln in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            for term, use in terms.items():
                flags = 0 if term[:1].isupper() else re.I
                if re.search(rf"(?<![\w-]){re.escape(term)}(?![\w-])", ln, flags):
                    out.append({"file": _rel(kit, f), "line": i, "text": clip(ln.strip(), 200),
                                "detail": f"'{term}' is not framework vocabulary; use '{use}'",
                                "rewrite": clip(re.sub(rf"(?<![\w-]){re.escape(term)}(?![\w-])", use, ln.strip(),
                                                  flags=flags), 200)})
    return out


CHECKS = {
    "playbook_matches_workflow": playbook_matches_workflow,
    "dod_checkable": dod_checkable,
    "rules_testable": rules_testable,
    "names_no_tools": names_no_tools,
    "effects_match_code": effects_match_code,
    "review_on_side_effects": review_on_side_effects,
    "vocabulary": vocabulary,
}
