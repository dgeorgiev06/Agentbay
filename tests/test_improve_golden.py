"""Golden baseline of the improve mode (proposal 0008, stage 5 part A): what `improve.scan`, `improve.audit`, the
store's routing, the reports and the dead-code check produce on data the tests build themselves (fixed clock), so
moving improve's code out of its old folder (now removed) cannot change the reference. tests/golden/improve.json was generated from
the code before the move. A failing compare means a behavior changed (see golden_util).

Every import of improve's own modules is in `mods()`: the move changes that function and nothing else."""
from __future__ import annotations

import json
import subprocess
import textwrap
from datetime import datetime
from pathlib import Path

from golden_util import compare, normal
from helpers import KIT, NOW, cleanup, clock, connector_pkg, project, system, tmpdir
from improve_fixtures import make_ledger, make_transcripts

from bay import dispatch

HUMAN = "user@tty"


def mods():
    from bay import graph
    pipeline = connector_pkg("improve-detect", "pipeline")
    return pipeline.detect_artifacts, graph, pipeline, connector_pkg("improve-store", "report"), connector_pkg("improve-store", "store")


def findings_rows(p: Path) -> list:
    f = p / ".agentbay/data/improve/findings.jsonl"
    return [json.loads(x) for x in f.read_text().splitlines()] if f.exists() else []


def candidate_view(c: dict, fingerprint) -> dict:
    return {"kind": c["kind"], "lens": c["lens"], "title": c["title"], "severity": c["severity"], "scope": c["scope"],
            "evidence": [e["ref"] for e in c["evidence"]], "key": c["detector"]["key"], "fingerprint": fingerprint(c)}


# ------------------------------------------------------------------------------------------------ (a) scan
def golden_scan() -> dict:
    store = mods()[4]
    root = tmpdir() / "cc"
    root.mkdir()
    p = project({"connectors": {"claude-transcripts": {"root": str(root)}}})
    make_transcripts(root, p)
    make_ledger(p)
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        r = d.call("improve.scan", {"since": "7d"})
        assert r["status"] == "needs-agent", r
        detect = r["next"]["previous"]["detect"]
        done = d.submit(r["callId"], "patterns", {"findings": []})
        assert done["status"] == "done", done
        rows = [{k: v for k, v in f.items() if k != "ts"} for f in findings_rows(p)]
        out = {"candidates": [candidate_view(c, store.fingerprint) for c in detect["candidates"]],
               "stats": detect["stats"], "window": detect["window"], "episodesTotal": detect["episodesTotal"],
               "store": rows}
        return normal(out, {str(p): "<project>", str(root): "<cc>"})
    finally:
        cleanup(p)


# ------------------------------------------------------------------------------------------------ (b) audit
def write(root: Path, files: dict) -> None:
    for rel, text in files.items():
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)


def audit_tree() -> dict:
    giant = "def giant(x):\n" + "".join(f"    if x == {i}:\n        return {i}\n" for i in range(36)) + "    return -1\n"
    return {
        "app/core.py": textwrap.dedent('''\
            """The fixture app."""
            UNUSED_LIMIT = 5


            def used_one():
                return 1


            def never_called():
                return 2


            def old_one():
                # legacy alias for used_one until callers move, for one release
                return used_one()


            ''') + giant,
        "app/main.py": "from app.core import used_one\n\n\ndef main():\n    return used_one()\n\n\nif __name__ == '__main__':\n"
                       "    main()\n",
        "docs/big.md": "# Big\n\n" + "word " * 3100 + "\n",
        "docs/stale.md": "# Stale\n\nSee `app/missing.py` and [the guide](nope.md) and `app/core.py` `vanished`.\n",
    }


def golden_audit() -> dict:
    store = mods()[4]
    p = project()
    write(p, audit_tree())
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        r = d.call("improve.audit", {})
        assert r["status"] == "needs-agent", r
        detect = r["next"]["previous"]["detect"]
        kinds = sorted({c["kind"] for c in detect["candidates"]})
        assert {"unused", "unused-constant", "compat-layer", "complexity", "doc-size", "doc-stale"} <= set(kinds), kinds
        out = {"candidates": [candidate_view(c, store.fingerprint) for c in detect["candidates"]],
               "stats": detect["stats"], "manual": detect["manual"], "warnings": detect["warnings"]}
        return normal(out, {str(p): "<project>"})
    finally:
        cleanup(p)


# ------------------------------------------------------------------------------------------------ (c) audit of the kit
def golden_kit_audit() -> dict:
    p = project()
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        r = d.call("improve.audit", {"root": "kit"})
        assert r["status"] == "needs-agent", r
        detect = r["next"]["previous"]["detect"]
        counts: dict[str, int] = {}
        for c in detect["candidates"]:
            counts[c["kind"]] = counts.get(c["kind"], 0) + 1
        assert not counts.get("conformance"), [c["title"] for c in detect["candidates"] if c["kind"] == "conformance"]
        return {"countsPerKind": counts, "conformanceFindings": counts.get("conformance", 0),
                "conformanceRules": detect["stats"]["conformanceRules"], "manual": [m["id"] for m in detect["manual"]]}
    finally:
        cleanup(p)


# ------------------------------------------------------------------------------------------------ (d) routing
ROUTE_SCOPES = {
    "framework file": {"file": "framework/roles/builder.yaml"},
    "bay file": {"file": "bay/guard.py"},
    "schemas file": {"file": "schemas/config.schema.json"},
    "docs file": {"file": "docs/DESIGN.md"},
    "tests file": {"file": "tests/test_improve.py"},
    "bay and mode file": {"files": ["bay/guard.py", "modes/briefing/mode.yaml"]},
    "mode cos": {"mode": "cos"},
    "mode forge": {"mode": "forge"},
    "mode improve": {"mode": "improve"},
    "user mode": {"mode": "feed-briefing", "feature": "digest"},
    "user file": {"file": "modes/feed-briefing/mode.yaml"},
    "framework flag": {"framework": True},
    "empty": {},
}


def golden_routes() -> dict:
    store = mods()[4]
    out = {}
    for label, framework_modes in (("default", None), ("shipped modes", {"cos", "forge", "improve"})):
        s = store.Store(tmpdir(), NOW, framework_modes)
        out[label] = {name: s.route_for({"scope": sc}) for name, sc in ROUTE_SCOPES.items()}
    return out


# ------------------------------------------------------------------------------------------------ (e) reports
def fixed_candidates() -> list:
    def c(kind, key, lens, sev, file, occ=1):
        return {"lens": lens, "kind": kind, "title": f"{kind} in {file}", "pattern": f"{kind} pattern for {key}",
                "evidence": [{"kind": "file", "ref": f"{file}:3", "detail": "the line", "rewrite": "do better"},
                             {"kind": "measurement", "ref": "n", "detail": "2", "value": 2}],
                "scope": {"file": file}, "severity": sev, "occurrences": occ, "measure": {"n": 2},
                "detector": {"name": kind, "key": key}}
    return [c("unused", "fn:bay/a.py:x", "artifacts", "low", "bay/a.py"),
            c("complexity", "fn:modes/m/y.py:y", "artifacts", "high", "modes/m/y.py", 3),
            c("doc-size", "docs/b.md", "artifacts", "medium", "docs/b.md"),
            c("slow-step", "forge.extend:implement", "sessions", "severe", "bay/a.py", 4)]


def golden_reports() -> dict:
    store = mods()[4]
    tmp = tmpdir()
    s = store.Store(tmp, NOW, {"cos", "forge", "improve"})
    res = s.upsert(fixed_candidates(), "improve.scan")
    s.triage()
    ids = res["new"]
    s.decide(ids[1], "approve", HUMAN, "fix it")
    s.decide(ids[2], "defer", HUMAN)
    agents = {"groups": [{"role": "builder", "mode": "forge", "model": "sonnet", "tier": "balanced", "runs": 2, "done": 1,
                          "failed": 1, "todoDone": 3, "todoTotal": 4, "tokens": 1200, "costUsd": 0.5}],
              "plans": {"T-20261025-aaaa": {"outcome": "did a thing", "todo": ["a", "b"], "done": 1}}}
    backlog = s.backlog(top=3, week="2026-W44", agents=agents)
    text = Path(backlog["report"]).read_text()
    drafts = {"forge.extend": {"title": "Cut the churn", "problem": "It churns.", "change": "Fix it.", "route": "forge.extend",
                               "tests": ["a test"]},
              "mode-fix": {"title": "Fix the mode", "problem": "It breaks.", "change": "Patch it.", "route": "mode-fix",
                           "evidence": ["file modes/m/y.py:3"]}}
    handoffs = {}
    for route, fid in (("forge.extend", ids[1]), ("mode-fix", ids[0])):
        if route == "mode-fix":
            s.decide(fid, "approve", HUMAN)
        h = s.handoff(fid, drafts[route], "T-20261031-0001")
        handoffs[route] = {"id": h["id"], "route": h["route"], "draft": h["draft"], "next": h["next"],
                           "file": (tmp / "handoffs" / h["draft"]).read_text()}
    rows = [{k: v for k, v in f.items()} for f in s.load().values()]
    return normal({"upsert": res, "backlog": {k: v for k, v in backlog.items() if k != "report"}, "reportText": text,
                   "handoffs": handoffs, "rows": rows}, {str(tmp): "<store>"})


# ------------------------------------------------------------------------------------------------ (f) dead-code check
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com"]
BASE = {
    "pkg/core.py": "def used():\n    return 1\n\ndef old_dead():\n    return 2\n",
    "pkg/main.py": "from pkg.core import used\n\ndef main():\n    return used()\n\nif __name__ == '__main__':\n    main()\n",
}


class FakeGraph:
    """artifacts.read/v1 over a directory, as artifact-graph serves it."""

    def __init__(self, root: Path):
        self.root = root

    def files(self, root="project"):
        return {"root": root, "files": mods()[1].files(self.root)}

    def graph(self, root="project"):
        return {"root": root, **mods()[1].build(self.root, KIT).as_dict()}

    def raw_text(self, path, root="project"):
        return (self.root / path).read_text()


def golden_change() -> dict:
    pipeline = mods()[2]
    repo = tmpdir() / "repo"
    repo.mkdir()
    try:
        write(repo, BASE)
        for args in (["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "base"]):
            subprocess.run([*GIT, "-C", str(repo), *args], capture_output=True, text=True, check=True)
        write(repo, {"pkg/core.py": BASE["pkg/core.py"] + "\ndef brand_new_helper():\n    return 3\n",
                     "pkg/main.py": BASE["pkg/main.py"].replace("return used()", "return old_used()")
                     + "\ndef old_used():\n    # alias for used until callers move\n    return used()\n"})
        pl = pipeline.Pipeline({"artifact-graph": FakeGraph(repo)}, KIT, repo, {}, datetime(2026, 10, 30))
        return normal(pl.change("HEAD"), {str(repo): "<repo>"})
    finally:
        cleanup(repo)


MOVING = ("bay/graph.py", "bay/conformance.py", "bay/util.py", "framework/connectors/", "framework/modes/",
          "framework/envs/")
DEADCODE_KINDS = ("unused", "unused-constant", "compat-layer", "complexity")


def test_moving_files_have_no_deadcode_findings():
    """The dead-code step compares fingerprints, and a fingerprint holds the file path: a finding in a file that moves
    is new at its new path and would block the step. So the files stage 5 moves (improve's code, the shipped connectors
    and modes) must have none now; a finding found here is fixed before the move, not after."""
    detect_artifacts, graph, pipeline, _, _ = mods()
    pl = pipeline.Pipeline({"artifact-graph": FakeGraph(KIT)}, KIT, KIT, {}, datetime(2026, 10, 30))
    arts = pl.artifacts("project")
    found = []
    for kind in DEADCODE_KINDS:
        for c in detect_artifacts.run(arts, {}, only=kind):
            where = c["scope"].get("file") or c["detector"]["key"]
            if where.startswith(MOVING):
                found.append(f"{kind} {c['detector']['key']}")
    assert not found, found


# Named, reasoned changes to the golden since it was taken from untouched code (the rest of the file must not move).
EXPECTED_DELTAS = {
    ("kitAudit", "countsPerKind", "inefficient-store-read"): {
        "was": 3, "now": 5,
        "why": "stage 5 part C moved improve's store.py into connectors/improve-store/; the detector scans only files "
               "under /connectors/, so Store.query and Store.claim (each re-reads the findings file per call) now count. "
               "Fixture-data results (scan, audit, routes, reports, change) are unchanged."},
}


def test_improve_golden():
    got = {"scan": golden_scan(), "audit": golden_audit(), "kitAudit": golden_kit_audit(), "routes": golden_routes(),
           "reports": golden_reports(), "change": golden_change()}
    for path, delta in EXPECTED_DELTAS.items():
        node = got
        for key in path:
            node = node[key]
        assert node == delta["now"] != delta["was"], f"{'/'.join(path)}: expected {delta['was']} -> {delta['now']} ({delta['why']}), got {node}"
    compare("improve", got)
