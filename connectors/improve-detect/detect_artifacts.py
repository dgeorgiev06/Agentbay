"""Deterministic artifact detectors (improve.audit): slop, unused, inefficient, complexity, docs, compatibility
layers, conformance.

Input (`Artifacts`): file list, text reader and reference graph from artifacts.read/v1, plus ledger episodes
(for "zero uses in the window") and conformance results. Output: candidate improve.finding/v1 dicts.
Evidence is exact: file:line, the text, and a tightened rewrite or a measurement.
"""
from __future__ import annotations

import ast
import io
import os
import re
import tokenize
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import yaml
from bay.graph import SKIP_DIRS
from bay.secretscan import clip

DEFAULTS = {"nearDuplicate": 0.7, "contextTokens": 6000, "maxFindingsPerDetector": 50,
            "maxComplexity": 30, "maxFunctionLines": 150, "docWords": 3000}
HISTORY_DOCS = ("docs/proposals/",)     # records of past decisions: never sized or checked for staleness
FILLER = {
    "in order to": "to", "it is important to note that": "", "it's important to note that": "",
    "please note that": "", "it should be noted that": "", "make sure to": "", "be sure to": "",
    "basically": "", "leverage": "use", "leverages": "uses", "utilize": "use", "utilizes": "uses",
    "seamlessly": "", "seamless": "", "cutting-edge": "", "state-of-the-art": "", "a variety of": "several",
    "at the end of the day": "", "going forward": "", "in terms of": "for", "the fact that": "that",
    "delve into": "look at", "robust and scalable": "",
}
FILLER_RX = re.compile(r"(?<![\w-])(" + "|".join(re.escape(k) for k in sorted(FILLER, key=len, reverse=True))
                       + r")(?![\w-])", re.I)
PAD_RX = re.compile(r"\b(please|kindly|sorry|unfortunately|oops|whoops|something went wrong|we apologi[sz]e)\b"
                    r"[,!]?\s*", re.I)
STOP = {"the", "and", "for", "with", "this", "that", "from", "into", "then", "are", "was", "its", "our", "your",
        "via", "all", "any", "out", "use", "uses", "used", "not", "now", "new", "one", "per"}
SUBPROCESS = {"run", "Popen", "check_output", "check_call", "call", "system"}
API = {"request", "urlopen", "_invoke"}
READS_ALL = {"read_text", "readlines", "read_bytes", "load"}
SLOP_KINDS = ("playbook", "rules", "role", "skill", "doc", "mode", "config", "agent", "env", "connector", "interface")


@dataclass
class Artifacts:
    files: list[dict]
    text: Callable[[str], str | None]
    graph: dict
    ledger: list[dict] = field(default_factory=list)
    conformance: list[dict] = field(default_factory=list)
    is_kit: bool = False
    unreadable: list[str] = field(default_factory=list)   # files the text reader refused or could not read
    unparsed: list[str] = field(default_factory=list)     # Python files with syntax errors (skipped by AST checks)
    failed: list[str] = field(default_factory=list)       # detectors that raised (their findings are missing)
    root: Path | None = None    # the scanned tree on disk; doc_stale checks link targets against it when set


def candidate(kind: str, key: str, title: str, pattern: str, evidence: list[dict], scope: dict,
              severity: str = "low", measure: dict | None = None, fix: str | None = None,
              lens: str = "artifacts", occurrences: int = 0) -> dict:
    out = {"lens": lens, "kind": kind, "title": title, "pattern": pattern, "evidence": evidence,
           "scope": scope, "severity": severity, "occurrences": occurrences or max(1, len(evidence)),
           "detector": {"name": kind, "key": key}}
    if measure:
        out["measure"] = measure
    if fix:
        out["proposedFix"] = fix
    return out


def _py(a: Artifacts):
    for f in a.files:
        if f["path"].endswith(".py") and f["kind"] != "test":
            t = a.text(f["path"])
            if t is None:
                continue
            try:
                tree = ast.parse(t)
            except (SyntaxError, ValueError, RecursionError) as e:
                msg = f"{f['path']}: {type(e).__name__}"
                if msg not in a.unparsed:
                    a.unparsed.append(msg)
                continue
            yield f["path"], t, tree


# ----------------------------------------------------------------------------- slop
def slop_filler(a: Artifacts, th: dict) -> list[dict]:
    out = []
    for f in a.files:
        if f["kind"] not in SLOP_KINDS or not f["path"].endswith((".md", ".yaml", ".yml")):
            continue
        t = a.text(f["path"]) or ""
        hits: dict[str, list] = defaultdict(list)
        in_fence = False
        for i, ln in enumerate(t.splitlines(), 1):
            if ln.strip().startswith("```"):
                in_fence = not in_fence
            if in_fence:
                continue
            for m in FILLER_RX.finditer(ln):
                hits[m.group(1).lower()].append((i, ln))
        for phrase, occ in hits.items():
            ev = []
            for i, ln in occ[:5]:
                rew = re.sub(r"\s{2,}", " ", FILLER_RX.sub(lambda m: FILLER[m.group(1).lower()], ln)).strip()
                ev.append({"kind": "file", "ref": f"{f['path']}:{i}", "detail": clip(ln.strip(), 200), "rewrite": clip(rew, 200)})
            out.append(candidate("slop-filler", f"{f['path']}:{phrase}", f"Filler '{phrase}' in {f['path']}",
                                 f"'{phrase}' appears {len(occ)} time(s); it adds words, not meaning", ev,
                                 {"file": f["path"]}, "low", {"occurrences": len(occ)},
                                 f"Replace '{phrase}' with '{FILLER[phrase]}'" if FILLER[phrase] else
                                 f"Delete '{phrase}'"))
    return out


def _shingles(text: str, n: int = 3) -> set:
    w = re.findall(r"[a-z0-9]+", text.lower())
    return {tuple(w[i:i + n]) for i in range(max(1, len(w) - n + 1))} if w else set()


def _statements(a: Artifacts) -> list[tuple[str, str, str]]:
    """(group, ref, text): rule statements (group 'rules') and DoD items (group = playbook path)."""
    out = []
    for f in a.files:
        p = f["path"]
        if f["kind"] == "rules" and p.endswith(".yaml") and "/types/" not in p:
            try:
                doc = yaml.safe_load(a.text(p) or "") or {}
            except yaml.YAMLError:
                continue
            for r in doc.get("rules") or []:
                if isinstance(r, dict) and isinstance(r.get("statement"), str):
                    out.append(("rules", f"{p}#{r.get('id')}", r["statement"]))
        elif f["kind"] == "role":
            try:
                doc = yaml.safe_load(a.text(p) or "") or {}
            except yaml.YAMLError:
                continue
            for i, r in enumerate(((doc.get("spec") or {}).get("rules") or []), 1):
                if isinstance(r, str):
                    out.append(("rules", f"{p}#rule-{i}", r))
        elif f["kind"] == "playbook":
            for i, ln in enumerate((a.text(p) or "").splitlines(), 1):
                m = re.match(r"^\s*[-*]\s+\[(DOD-[0-9]+)\]\s+\((?:must|should|must_not)\)\s+(.+)$", ln)
                if m:
                    out.append((p, f"{p}:{i}#{m.group(1)}", m.group(2)))
    return out


def slop_duplicates(a: Artifacts, th: dict) -> list[dict]:
    st = [(g, ref, txt, _shingles(txt)) for g, ref, txt in _statements(a)]
    out = []
    for i in range(len(st)):
        for j in range(i + 1, len(st)):
            g1, r1, t1, s1 = st[i]
            g2, r2, t2, s2 = st[j]
            if g1 != g2 or not s1 or not s2:
                continue
            jac = len(s1 & s2) / len(s1 | s2)
            if jac >= th["nearDuplicate"]:
                key = "|".join(sorted((r1, r2)))
                out.append(candidate("slop-duplicate-rule", key, "Duplicate or restated rule",
                                     f"two statements are {jac:.0%} the same (3-word shingles)",
                                     [{"kind": "file", "ref": r1, "detail": clip(t1, 200)},
                                      {"kind": "file", "ref": r2, "detail": clip(t2, 200)}],
                                     {"file": r1.split("#")[0].split(":")[0]}, "low", {"jaccard": round(jac, 2)},
                                     "Keep one statement; reference it (refs/check) from the other place."))
    return out


def _idwords(code: str) -> set:
    out = set()
    for ident in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", code):
        for part in re.split(r"_|(?<=[a-z])(?=[A-Z])", ident):
            if part:
                out.add(part.lower())
    return out


def slop_comments(a: Artifacts, th: dict) -> list[dict]:
    out = []
    for path, text, _ in _py(a):
        lines = text.splitlines()
        try:
            toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
        except (tokenize.TokenError, IndentationError):
            continue
        for tok in toks:
            if tok.type != tokenize.COMMENT or tok.string.startswith(("#!", "# noqa", "# type:", "# pragma")):
                continue
            row = tok.start[0]
            words = [w for w in re.findall(r"[a-z]+", tok.string.lower()) if len(w) > 2 and w not in STOP]
            if not 2 <= len(words) <= 6:
                continue
            code = lines[row - 1][:tok.start[1]]
            if not code.strip():                             # standalone comment: the next code line
                nxt = next((ln for ln in lines[row:] if ln.strip() and not ln.strip().startswith("#")), "")
                code = nxt
            ids = _idwords(code)
            if ids and all(w in ids or w.rstrip("s") in ids or w + "s" in ids for w in words):
                out.append(candidate("slop-comment", f"{path}:{tok.string.strip()}", f"Comment restates code in {path}",
                                     "the comment only repeats the identifiers of the code it annotates",
                                     [{"kind": "file", "ref": f"{path}:{row}", "detail": clip(tok.string.strip(), 200),
                                       "rewrite": "(delete the comment, or say why instead of what)"}],
                                     {"file": path}, "low"))
    return out


def slop_messages(a: Artifacts, th: dict) -> list[dict]:
    out = []
    for path, text, tree in _py(a):
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            f = n.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""
            if not (name.endswith(("Error", "Exception")) or name in ("_die", "print", "die", "fail")):
                continue
            for arg in n.args[:1]:
                parts = [arg.value] if isinstance(arg, ast.Constant) and isinstance(arg.value, str) else \
                    [v.value for v in getattr(arg, "values", []) if isinstance(v, ast.Constant) and isinstance(v.value, str)]
                msg = "".join(parts)
                m = PAD_RX.search(msg)
                if m:
                    out.append(candidate("slop-message", f"{path}:{m.group(1).lower()}:{msg[:40]}",
                                         f"Padded message in {path}", f"the message pads with '{m.group(1)}'",
                                         [{"kind": "file", "ref": f"{path}:{n.lineno}", "detail": clip(msg, 200),
                                           "rewrite": clip(PAD_RX.sub("", msg).strip(), 200)}],
                                         {"file": path}, "low"))
    return out


# ----------------------------------------------------------------------------- unused
def _ledger_uses(a: Artifacts) -> dict[tuple, int]:
    uses: dict[tuple, int] = defaultdict(int)
    for e in a.ledger:
        if e.get("target"):
            uses[("endpoint", e["target"])] += 1
        if e.get("agent"):
            uses[("role", e["agent"].split("--")[0])] += 1      # agentbay subagents: <role>--<mode>[--<env>]
            uses[("agent", e["agent"])] += 1
        for st in e.get("steps", []):
            for k in ("role", "agent", "env"):
                if st.get(k):
                    uses[(k, st[k])] += 1
    return uses


def unused(a: Artifacts, th: dict) -> list[dict]:
    uses = _ledger_uses(a)
    nodes = a.graph.get("nodes", [])
    mentions: dict[str, int] = defaultdict(int)
    for e in a.graph.get("edges", []):
        if e["kind"] == "mention":
            mentions[e["to"]] += 1
    out = []
    for n in nodes:
        k = n["kind"]
        path = n.get("path") or ""
        if "/templates/" in f"/{path}" or path.startswith("docs/"):
            continue
        refs = n["refs"] if k != "endpoint" else mentions[n["id"]]
        if refs or k in ("mode",):
            continue
        if uses.get((k, n["name"]), 0):
            continue
        what = {"function": "function", "module": "module", "config-key": "config key"}.get(k, k)
        loc = f"{path}:{n['line']}" if n.get("line") else path
        out.append(candidate("unused", n["id"], f"Unused {what} {n['name']}",
                             f"{what} {n['name']} has no references in the code/reference graph and no ledger uses "
                             f"in the window", [{"kind": "file", "ref": loc, "detail": f"{n['id']}: 0 references"},
                                                {"kind": "measurement", "ref": "ledger", "detail": "0 uses",
                                                 "value": 0}],
                             {"file": path}, "low", {"references": 0, "ledgerUses": 0},
                             f"Delete {n['name']} (or wire it in if it should be used)."))
    return out


# ----------------------------------------------------------------------------- inefficient
def _closure(cls: ast.ClassDef, funcs: dict, start: str) -> tuple[set, set]:
    methods = {m.name: m for m in cls.body if isinstance(m, ast.FunctionDef)}
    seen, todo, calls = set(), [start], set()
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)
        node = methods.get(name) or funcs.get(name)
        if node is None:
            continue
        for c in ast.walk(node):
            if isinstance(c, ast.Call):
                f = c.func
                if isinstance(f, ast.Attribute):
                    calls.add(f.attr)
                    if isinstance(f.value, ast.Name) and f.value.id == "self":
                        todo.append(f.attr)
                elif isinstance(f, ast.Name):
                    calls.add(f.id)
                    if f.id in funcs:
                        todo.append(f.id)
    return calls, seen


def inefficient(a: Artifacts, th: dict, read_endpoints: set[str] | None = None) -> list[dict]:
    out = []
    read_endpoints = read_endpoints or {"query", "status", "episodes", "verdicts", "files", "graph", "text"}
    for path, text, tree in _py(a):
        funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for cls in [n for n in tree.body if isinstance(n, ast.ClassDef)]:
            for m in cls.body:
                if isinstance(m, ast.FunctionDef) and m.name in read_endpoints and "/connectors/" in f"/{path}":
                    calls, via = _closure(cls, funcs, m.name)
                    if calls & READS_ALL:
                        out.append(candidate("inefficient-store-read", f"{path}:{cls.name}.{m.name}",
                                             f"{cls.name}.{m.name} re-reads the whole store per call",
                                             f"every {m.name} call reads entire files ({', '.join(sorted(calls & READS_ALL))}) "
                                             f"via {', '.join(sorted(via - {m.name})) or m.name}",
                                             [{"kind": "file", "ref": f"{path}:{m.lineno}", "detail": f"{cls.name}.{m.name}"},
                                              {"kind": "measurement", "ref": "reads-per-call",
                                               "detail": "1 full read of the store per query; cost grows with store size"}],
                                             {"file": path}, "low", {"fullReadsPerCall": 1},
                                             "Cache the parsed store keyed by file size+mtime, or index it, so a "
                                             "query reads only what changed."))
        for loop in ast.walk(tree):
            if not isinstance(loop, (ast.For, ast.comprehension)) or _fixed_iterations(loop.iter):
                continue
            body = loop.body if isinstance(loop, ast.For) else [loop]
            for node in body:
                for c in ast.walk(node):
                    if not isinstance(c, ast.Call):
                        continue
                    f = c.func
                    attr = f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else ""
                    base = f.value.id if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) else ""
                    is_sub = base in ("subprocess", "os") and attr in SUBPROCESS
                    if is_sub or attr in API:
                        line = getattr(c, "lineno", 0)
                        what = f"{base + '.' if base else ''}{attr}"
                        out.append(candidate("inefficient-loop-call", f"{path}:{what}:{line}",
                                             f"{what} inside a loop in {path}",
                                             f"one {'subprocess' if is_sub else 'API/connector'} call per item",
                                             [{"kind": "file", "ref": f"{path}:{line}", "detail": what},
                                              {"kind": "measurement", "ref": "calls-per-run",
                                               "detail": "N calls for N items; expected gain: 1 batched call"}],
                                             {"file": path}, "low", {"callsPerItem": 1},
                                             "Batch the calls (one call for all items) or move the call out of "
                                             "the loop."))
    return out


def _fixed_iterations(it: ast.AST) -> bool:
    """A literal tuple/list of constants or range(<constant>): a bounded retry or attempt loop, not per-item work."""
    if isinstance(it, (ast.Tuple, ast.List)):
        return all(isinstance(e, ast.Constant) for e in it.elts)
    return isinstance(it, ast.Call) and isinstance(it.func, ast.Name) and it.func.id == "range" \
        and all(isinstance(a, ast.Constant) for a in it.args)


def oversized_context(a: Artifacts, th: dict, roles: list[dict] | None = None) -> list[dict]:
    """roles: [{name, path, chars, parts}] estimated by the store from the kit (prompt + doneWhen + rules +
    skills + the largest feature playbook/rules the role runs)."""
    out = []
    for r in roles or []:
        tokens = r["chars"] // 4
        if tokens > th["contextTokens"]:
            out.append(candidate("oversized-context", r["name"], f"Role {r['name']} gets ~{tokens} tokens of context",
                                 f"the largest step plan for {r['name']} carries ~{tokens} tokens of instructions "
                                 f"(limit {th['contextTokens']})",
                                 [{"kind": "file", "ref": r["path"], "detail": clip(", ".join(r["parts"]), 200)},
                                  {"kind": "measurement", "ref": "tokens", "detail": f"~{tokens} tokens",
                                   "value": tokens}],
                                 {"role": r["name"], "file": r["path"]}, "medium", {"tokens": tokens},
                                 "Move reference material into a skill loaded on demand and keep the playbook to "
                                 "steps and DoD."))
    return out


# ----------------------------------------------------------------------------- complexity
DECISIONS = tuple(x for x in (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler, ast.Assert,
                              getattr(ast, "match_case", None)) if x is not None)    # match_case: Python 3.10+
NESTED = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def _branches(fn: ast.AST) -> int:
    """Cyclomatic complexity of one function: 1 + decision points, not counting nested functions or classes
    (they are measured on their own)."""
    n = 1
    todo = list(ast.iter_child_nodes(fn))
    while todo:
        node = todo.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            continue
        if isinstance(node, DECISIONS):
            n += 1
        elif isinstance(node, ast.comprehension):
            n += 1 + len(node.ifs)
        elif isinstance(node, ast.BoolOp):
            n += len(node.values) - 1
        todo.extend(ast.iter_child_nodes(node))
    return n


def _functions(tree: ast.Module):
    """(qualified name, node) of every function and method, nested ones included."""
    todo = [("", n) for n in tree.body]
    while todo:
        prefix, n = todo.pop(0)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield prefix + n.name, n
            todo += [(f"{prefix}{n.name}.", c) for c in n.body]
        elif isinstance(n, ast.ClassDef):
            todo += [(f"{prefix}{n.name}.", c) for c in n.body]


def _own_lines(fn: ast.AST) -> int:
    """Lines of one function, less the lines of the functions and classes nested in it (measured on their own)."""
    lines = (fn.end_lineno or fn.lineno) - fn.lineno + 1
    todo = list(ast.iter_child_nodes(fn))
    while todo:
        node = todo.pop()
        if isinstance(node, NESTED):
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            lines -= (node.end_lineno or node.lineno) - start + 1
        else:
            todo.extend(ast.iter_child_nodes(node))
    return lines


def complexity(a: Artifacts, th: dict) -> list[dict]:
    """Functions with more decision points than `maxComplexity` or more own lines than `maxFunctionLines`
    (nested functions and classes are measured on their own, for both)."""
    out = []
    for path, _, tree in _py(a):
        for qual, fn in _functions(tree):
            cc = _branches(fn)
            lines = _own_lines(fn)
            if cc <= th["maxComplexity"] and lines <= th["maxFunctionLines"]:
                continue
            over = [f"complexity {cc} > {th['maxComplexity']}" if cc > th["maxComplexity"] else "",
                    f"{lines} lines > {th['maxFunctionLines']}" if lines > th["maxFunctionLines"] else ""]
            severe = cc > 2 * th["maxComplexity"] or lines > 2 * th["maxFunctionLines"]
            out.append(candidate("complexity", f"{path}:{qual}", f"{qual} in {path} is too complex",
                                 f"{qual} has {'; '.join(x for x in over if x)}: hard to read, test and change",
                                 [{"kind": "file", "ref": f"{path}:{fn.lineno}", "detail": f"def {qual}"},
                                  {"kind": "measurement", "ref": "complexity",
                                   "detail": f"cyclomatic complexity {cc}, {lines} lines", "value": cc}],
                                 {"file": path}, "medium" if severe else "low", {"complexity": cc, "lines": lines},
                                 f"Split {qual} into named helpers, one per decision it makes."))
    return out


# ----------------------------------------------------------------------------- unused constants
def _referenced(a: Artifacts) -> set[str]:
    """Every name Python code in the tree loads (names, attributes, imports, getattr-style strings); tests
    included, since a constant only a test reads is still read."""
    out: set[str] = set()
    for f in a.files:
        if not f["path"].endswith(".py"):
            continue
        try:
            tree = ast.parse(a.text(f["path"]) or "")
        except (SyntaxError, ValueError, RecursionError):
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Name) and not isinstance(n.ctx, ast.Store):
                out.add(n.id)
            elif isinstance(n, ast.Attribute):
                out.add(n.attr)
            elif isinstance(n, ast.alias):
                out.add((n.asname or n.name).split(".")[-1])
            elif isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.isidentifier():
                out.add(n.value)
    return out


def _exported(tree: ast.Module) -> set[str]:
    for n in tree.body:
        if isinstance(n, ast.Assign) and any(isinstance(x, ast.Name) and x.id == "__all__" for x in n.targets):
            try:
                return set(ast.literal_eval(n.value))
            except ValueError:
                return set()
    return set()


def unused_constants(a: Artifacts, th: dict) -> list[dict]:
    """Module-level names (constants, tables, patterns) that no Python code anywhere loads. Functions, classes
    and modules are covered by `unused` through the reference graph."""
    used = _referenced(a)
    out = []
    for path, _, tree in _py(a):
        if "/templates/" in f"/{path}":
            continue
        keep = _exported(tree)
        for n in tree.body:
            targets = n.targets if isinstance(n, ast.Assign) else [n.target] if isinstance(n, ast.AnnAssign) else []
            for t in targets:
                if not isinstance(t, ast.Name) or t.id in used or t.id in keep or t.id.startswith("__"):
                    continue
                out.append(candidate("unused-constant", f"{path}:{t.id}", f"Unused constant {t.id} in {path}",
                                     f"module-level {t.id} is never read by any Python code",
                                     [{"kind": "file", "ref": f"{path}:{n.lineno}", "detail": f"{t.id}: 0 reads"},
                                      {"kind": "measurement", "ref": "references", "detail": "0 loads", "value": 0}],
                                     {"file": path}, "low", {"references": 0}, f"Delete {t.id}."))
    return out


# ----------------------------------------------------------------------------- docs
def _docs(a: Artifacts, th: dict):
    history = tuple(th.get("historyDocs", HISTORY_DOCS))
    for f in a.files:
        p = f["path"]
        if p.endswith(".md") and f["kind"] != "test" and not p.startswith(history) and "/templates/" not in f"/{p}":
            t = a.text(p)
            if t is not None:
                yield p, t


def doc_size(a: Artifacts, th: dict) -> list[dict]:
    """Markdown files longer than `docWords`."""
    out = []
    for p, t in _docs(a, th):
        words = len(t.split())
        if words > th["docWords"]:
            out.append(candidate("doc-size", p, f"{p} is {words} words",
                                 f"{p} has {words} words (budget {th['docWords']}): long docs drift and go unread",
                                 [{"kind": "file", "ref": f"{p}:1", "detail": clip(t.strip().splitlines()[0], 200)},
                                  {"kind": "measurement", "ref": "words", "detail": f"{words} words", "value": words}],
                                 {"file": p}, "medium" if words > 2 * th["docWords"] else "low", {"words": words},
                                 "Cut history and repetition; keep the current contract and link to details."))
    return out


LINK_RX = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
CODE_RX = re.compile(r"`([^`\n]+)`")
PATH_RX = re.compile(r"^[\w][\w.-]*(/[\w.-]+)+/?$")
SYMBOL_RX = re.compile(r"`([\w./-]+\.py)`(?:\s|:{1,2})*`([A-Za-z_]\w*)(?:\(\))?`|`([\w./-]+\.py):{1,2}([A-Za-z_]\w*)`")


def _defined(a: Artifacts) -> dict[str, set[str]]:
    """Python file -> names it defines (functions, classes, methods, module-level assignments)."""
    out: dict[str, set[str]] = {}
    for path, _, tree in _py(a):
        names = {q.rsplit(".", 1)[-1] for q, _ in _functions(tree)}
        for n in tree.body:
            if isinstance(n, ast.ClassDef):
                names.add(n.name)
            for t in (n.targets if isinstance(n, ast.Assign) else [n.target] if isinstance(n, ast.AnnAssign) else []):
                if isinstance(t, ast.Name):
                    names.add(t.id)
        out[path] = names
    return out


FENCE_RX = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def _prose_lines(text: str):
    """(line number, line) outside fenced code blocks: code examples are not references."""
    fence = None
    for i, ln in enumerate(text.splitlines(), 1):
        m = FENCE_RX.match(ln)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not ln[m.end():].strip():
                fence = None
        elif m:
            fence = m.group(1)
        else:
            yield i, ln


def doc_stale(a: Artifacts, th: dict) -> list[dict]:
    """Docs that point at files or Python symbols that do not exist: relative markdown links (a leading `/`
    is the repo root), backticked kit paths (whose first folder exists, so placeholders and generated
    `.agentbay/` paths are skipped) and `file.py` `symbol` pairs. Fenced code blocks and links inside inline
    code are skipped. With `a.root` set, link targets are checked on disk (inside the root only); without it,
    against the file list, and targets under folders the list never walks (SKIP_DIRS) are not reported."""
    files = {f["path"] for f in a.files}
    dirs = {str(Path(p).parents[i]) for p in files for i in range(len(Path(p).parents) - 1)}
    tops = {p.split("/", 1)[0] for p in files}
    defined = _defined(a)
    root = Path(a.root).resolve() if a.root else None

    def exists(p: str) -> bool:
        p = os.path.normpath(p)
        if root is not None:
            q = (root / p).resolve()
            return q.is_relative_to(root) and q.exists()
        return p in files or p in dirs or bool(set(Path(p).parts) & SKIP_DIRS)

    out = []
    for doc, t in _docs(a, th):
        here = str(Path(doc).parent)
        bad: list[tuple[int, str, str]] = []
        for i, ln in _prose_lines(t):
            for m in LINK_RX.finditer(CODE_RX.sub("", ln)):
                target = m.group(1).split("#", 1)[0]
                if not target or re.match(r"^[a-z]+:", target):
                    continue
                if not exists(target.lstrip("/") if target.startswith("/") else os.path.join(here, target)):
                    bad.append((i, target, "link target does not exist"))
            for m in CODE_RX.finditer(ln):
                tok = m.group(1).strip()
                if PATH_RX.match(tok) and tok.split("/", 1)[0] in tops and not exists(tok.rstrip("/")) \
                        and not exists(os.path.join(here, tok.rstrip("/"))):
                    bad.append((i, tok, "path does not exist"))
            for m in SYMBOL_RX.finditer(ln):
                path, sym = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
                if path in defined and sym not in defined[path]:
                    bad.append((i, f"{path} {sym}", f"{path} defines no {sym}"))
        if bad:
            out.append(candidate("doc-stale", doc, f"{doc} references what no longer exists",
                                 f"{len(bad)} reference(s) in {doc} point at missing files or symbols",
                                 [{"kind": "file", "ref": f"{doc}:{i}", "detail": clip(f"{ref}: {why}", 200)}
                                  for i, ref, why in bad[:10]]
                                 + [{"kind": "measurement", "ref": "staleRefs", "detail": f"{len(bad)} references",
                                     "value": len(bad)}],
                                 {"file": doc}, "low", {"staleRefs": len(bad)},
                                 "Update or delete each reference."))
    return out


# ----------------------------------------------------------------------------- compatibility layers
COMPAT_RX = re.compile(r"\b(deprecat\w*|legacy|backwards?[- ]compat\w*|for (?:one|a) release|kept working"
                       r"|old names?|alias(?:es|ed)? (?:for|of|to))\b", re.I)
VERSION_RX = re.compile(r"\bv?(\d+)\.(\d+)(?:\.\d+)?\b")


def _kit_version(a: Artifacts) -> tuple[int, int] | None:
    m = re.search(r"__version__\s*=\s*['\"](\d+)\.(\d+)", a.text("bay/__init__.py") or "") \
        if any(f["path"] == "bay/__init__.py" for f in a.files) else None
    return (int(m.group(1)), int(m.group(2))) if m else None


def _compat_marks(path: str, text: str, tree: ast.Module) -> list[tuple[int, str]]:
    """(line, text) of comments, docstrings and identifiers that mark a compatibility layer."""
    marks = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT and COMPAT_RX.search(tok.string):
                marks.append((tok.start[0], tok.string.strip()))
    except (tokenize.TokenError, IndentationError):
        pass
    for n in ast.walk(tree):
        body = getattr(n, "body", None)
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and body \
                and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                and isinstance(body[0].value.value, str):
            for k, ln in enumerate(body[0].value.value.splitlines()):
                if COMPAT_RX.search(ln):
                    marks.append((body[0].lineno + k, ln.strip()))
        name = n.name if isinstance(n, (ast.FunctionDef, ast.ClassDef)) else n.id if isinstance(n, ast.Name) \
            else n.attr if isinstance(n, ast.Attribute) else ""
        if re.search(r"deprecat|legacy", name, re.I):
            marks.append((n.lineno, name))
    return sorted(set(marks))


YAML_COMMENT_RX = re.compile(r"(?:^|\s)#(.*)$")


def _yaml_marks(text: str) -> list[tuple[int, str]]:
    """(line, comment) of YAML comments that mark a compatibility layer."""
    marks = []
    for i, ln in enumerate(text.splitlines(), 1):
        m = YAML_COMMENT_RX.search(ln)
        if m and COMPAT_RX.search(m.group(1)):
            marks.append((i, "#" + m.group(1).rstrip()))
    return marks


def compat_layers(a: Artifacts, th: dict) -> list[dict]:
    """Code, YAML comments and schemas marked as a compatibility layer, with its age in releases when it names
    the version it dates from: each one is a removal someone promised."""
    now = _kit_version(a)
    marked: list[tuple[str, list[tuple[int, str]]]] = []
    for path, text, tree in _py(a):
        marks = _compat_marks(path, text, tree)
        if marks:
            marked.append((path, marks))
    for f in a.files:
        if f["path"].endswith(".schema.json"):
            lines = [(i, ln.strip()) for i, ln in enumerate((a.text(f["path"]) or "").splitlines(), 1)
                     if re.search(r'"deprecated"\s*:\s*true', ln)]
            if lines:
                marked.append((f["path"], lines))
        elif f["path"].endswith((".yaml", ".yml")) and f["kind"] != "test":
            lines = _yaml_marks(a.text(f["path"]) or "")
            if lines:
                marked.append((f["path"], lines))
    out = []
    for path, marks in marked:
        ages = [now[1] - int(m.group(2)) for _, s in marks for m in VERSION_RX.finditer(s)
                if now and int(m.group(1)) == now[0] and int(m.group(2)) < now[1]]
        age = max(ages) if ages else None
        promised = any(re.search(r"for (one|a) release", s, re.I) for _, s in marks)
        measure = {"markers": len(marks), **({"releasesOld": age} if age is not None else {})}
        out.append(candidate("compat-layer", path, f"Compatibility layer in {path}",
                             f"{len(marks)} compatibility marker(s)"
                             + (f", the oldest {age} release(s) old" if age is not None else ""),
                             [{"kind": "file", "ref": f"{path}:{i}", "detail": clip(s, 200)} for i, s in marks[:10]]
                             + [{"kind": "measurement", "ref": "markers", "detail": f"{len(marks)} markers",
                                 "value": len(marks)}],
                             {"file": path}, "medium" if (age or promised) else "low", measure,
                             "Remove the layer once nothing depends on the old shape; otherwise date it."))
    return out


# ----------------------------------------------------------------------------- conformance
def conformance(a: Artifacts, th: dict) -> list[dict]:
    out = []
    for res in a.conformance:
        for v in res["violations"][: th["maxFindingsPerDetector"]]:
            ev = [{"kind": "rule", "ref": res["rule"], "detail": clip(res["statement"], 200)},
                  {"kind": "file", "ref": f"{v['file']}:{v['line']}", "detail": clip((v.get("text") or v["detail"]), 200),
                   **({"rewrite": v["rewrite"]} if v.get("rewrite") else {})}]
            out.append(candidate("conformance", f"{res['rule']}:{v['file']}:{v['detail']}",
                                 f"{res['rule']} violated in {v['file']}", clip(v["detail"], 300), ev,
                                 {"file": v["file"], "rule": res["rule"]},
                                 "high" if res["level"] in ("must", "must_not") else "low"))
    return out


DETECTORS = {
    "slop-filler": slop_filler, "slop-duplicate-rule": slop_duplicates, "slop-comment": slop_comments,
    "slop-message": slop_messages, "unused": unused, "inefficient-store-read": inefficient,
    "inefficient-loop-call": inefficient, "oversized-context": oversized_context, "complexity": complexity,
    "unused-constant": unused_constants, "doc-size": doc_size, "doc-stale": doc_stale, "compat-layer": compat_layers,
    "conformance": conformance,
}


def thresholds(cfg: dict | None) -> dict:
    cfg = cfg or {}
    return {**DEFAULTS, **(cfg.get("thresholds") or {}),
            **({"historyDocs": cfg["historyDocs"]} if cfg.get("historyDocs") is not None else {})}


def run(a: Artifacts, cfg: dict | None = None, only: str | None = None, roles: list[dict] | None = None,
        read_endpoints: set[str] | None = None) -> list[dict]:
    th = thresholds(cfg)
    out, seen = [], set()
    for name, fn in DETECTORS.items():
        if (only and name != only) or fn in seen:
            continue
        seen.add(fn)
        try:
            if fn is oversized_context:
                res = fn(a, th, roles)
            elif fn is inefficient:
                res = fn(a, th, read_endpoints)
            else:
                res = fn(a, th)
        except Exception as e:      # one broken detector must not sink the audit: named in a.failed
            a.failed.append(clip(f"{fn.__name__}: {type(e).__name__}: {e}", 300))
            continue
        res = [c for c in res if not only or c["kind"] == only]
        by_kind: dict[str, int] = defaultdict(int)
        for c in res:
            by_kind[c["kind"]] += 1
            if by_kind[c["kind"]] <= th["maxFindingsPerDetector"]:
                out.append(c)
    return out
