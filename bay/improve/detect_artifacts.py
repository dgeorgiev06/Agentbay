"""Deterministic artifact detectors (improve.audit): slop, unused, inefficient, conformance.

Input (`Artifacts`): file list, text reader and reference graph from artifacts.read/v1, plus ledger episodes
(for "zero uses in the window") and conformance results. Output: candidate improve.finding/v1 dicts.
Evidence is exact: file:line, the text, and a tightened rewrite or a measurement.
"""
from __future__ import annotations

import ast
import io
import re
import tokenize
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

import yaml

DEFAULTS = {"nearDuplicate": 0.7, "contextTokens": 6000, "maxFindingsPerDetector": 50}
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


def candidate(kind: str, key: str, title: str, pattern: str, evidence: list[dict], scope: dict,
              severity: str = "low", measure: dict | None = None, fix: str | None = None) -> dict:
    out = {"lens": "artifacts", "kind": kind, "title": title, "pattern": pattern, "evidence": evidence,
           "scope": scope, "severity": severity, "occurrences": max(1, len(evidence)),
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
                yield f["path"], t, ast.parse(t)
            except SyntaxError:
                continue


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
                ev.append({"kind": "file", "ref": f"{f['path']}:{i}", "detail": ln.strip()[:200], "rewrite": rew[:200]})
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
                                     [{"kind": "file", "ref": r1, "detail": t1[:200]},
                                      {"kind": "file", "ref": r2, "detail": t2[:200]}],
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
                                     [{"kind": "file", "ref": f"{path}:{row}", "detail": tok.string.strip()[:200],
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
                                         [{"kind": "file", "ref": f"{path}:{n.lineno}", "detail": msg[:200],
                                           "rewrite": PAD_RX.sub("", msg)[:200].strip()}],
                                         {"file": path}, "low"))
    return out


# ----------------------------------------------------------------------------- unused
LEDGER_FIELDS = {"role": ("role",), "agent": ("agent", "agentType"), "env": ("env",), "endpoint": ("target",)}


def _ledger_uses(a: Artifacts) -> dict[tuple, int]:
    uses: dict[tuple, int] = defaultdict(int)
    for e in a.ledger:
        if e.get("target"):
            uses[("endpoint", e["target"])] += 1
        if e.get("agent"):
            uses[("role", e["agent"])] += 1           # agentbay subagents are named after their role
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
            if not isinstance(loop, (ast.For, ast.comprehension)):
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
                                 [{"kind": "file", "ref": r["path"], "detail": ", ".join(r["parts"])[:200]},
                                  {"kind": "measurement", "ref": "tokens", "detail": f"~{tokens} tokens",
                                   "value": tokens}],
                                 {"role": r["name"], "file": r["path"]}, "medium", {"tokens": tokens},
                                 "Move reference material into a skill loaded on demand and keep the playbook to "
                                 "steps and DoD."))
    return out


# ----------------------------------------------------------------------------- conformance
def conformance(a: Artifacts, th: dict) -> list[dict]:
    out = []
    for res in a.conformance:
        for v in res["violations"][: th["maxFindingsPerDetector"]]:
            ev = [{"kind": "rule", "ref": res["rule"], "detail": res["statement"][:200]},
                  {"kind": "file", "ref": f"{v['file']}:{v['line']}", "detail": (v.get("text") or v["detail"])[:200],
                   **({"rewrite": v["rewrite"]} if v.get("rewrite") else {})}]
            out.append(candidate("conformance", f"{res['rule']}:{v['file']}:{v['detail']}",
                                 f"{res['rule']} violated in {v['file']}", v["detail"][:300], ev,
                                 {"file": v["file"], "rule": res["rule"]},
                                 "high" if res["level"] in ("must", "must_not") else "low"))
    return out


DETECTORS = {
    "slop-filler": slop_filler, "slop-duplicate-rule": slop_duplicates, "slop-comment": slop_comments,
    "slop-message": slop_messages, "unused": unused, "inefficient-store-read": inefficient,
    "inefficient-loop-call": inefficient, "oversized-context": oversized_context, "conformance": conformance,
}


def thresholds(cfg: dict | None) -> dict:
    return {**DEFAULTS, **((cfg or {}).get("thresholds") or {})}


def run(a: Artifacts, cfg: dict | None = None, only: str | None = None, roles: list[dict] | None = None,
        read_endpoints: set[str] | None = None) -> list[dict]:
    th = thresholds(cfg)
    out, seen = [], set()
    for name, fn in DETECTORS.items():
        if (only and name != only) or fn in seen:
            continue
        seen.add(fn)
        if fn is oversized_context:
            res = fn(a, th, roles)
        elif fn is inefficient:
            res = fn(a, th, read_endpoints)
        else:
            res = fn(a, th)
        res = [c for c in res if not only or c["kind"] == only]
        by_kind: dict[str, int] = defaultdict(int)
        for c in res:
            by_kind[c["kind"]] += 1
            if by_kind[c["kind"]] <= th["maxFindingsPerDetector"]:
                out.append(c)
    return out
