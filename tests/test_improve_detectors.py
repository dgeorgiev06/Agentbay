"""Deterministic improve detectors: each fires on its pattern with evidence, and stays quiet below threshold
or on a single non-severe episode."""
import shutil
import textwrap
from pathlib import Path

from helpers import cleanup, kit_copy, tmpdir

from bay.improve import conformance, detect_artifacts as da, detect_sessions as ds, graph

TH = ds.thresholds({"thresholds": {"slowStepMs": 1000, "costlyStepUsd": 1.0}})


def ep(i, **kw):
    base = {"id": f"ab:C-{i}", "source": "ledger", "kind": "call", "steps": [], "toolCalls": [], "errors": 0,
            "denials": [], "permissionPrompts": 0, "interrupts": 0, "instructionChanges": 0, "subagents": []}
    return {**base, **kw}


def verdict(i, subject, items, target="forge.extend"):
    return {"callId": f"C-{i}", "episode": f"ab:C-{i}", "target": target, "subject": subject, "ts": f"t{i}",
            "round": 1, "items": items}


def kinds(cands):
    return sorted(c["kind"] for c in cands)


def data(episodes=(), verdicts=()):
    return {"episodes": list(episodes), "verdicts": list(verdicts)}


def test_review_rounds_above_one():
    vs = [verdict(1, "p1", []), verdict(2, "p1", []), verdict(3, "p2", [])]
    c = ds.review_rounds(data(verdicts=vs), TH)
    assert kinds(c) == ["review-rounds"] and c[0]["measure"]["maxRounds"] == 2
    assert {e["ref"] for e in c[0]["evidence"]} == {"ab:C-1", "ab:C-2"}
    assert ds.review_rounds(data(verdicts=vs[2:]), TH) == []
    # Claude Code sessions with several reviewer subagents, in >= 2 sessions
    s = [ep(i, id=f"cc:s{i}", kind="session", source="claude-transcripts",
            subagents=[{"type": "reviewer"}, {"type": "code-reviewer"}]) for i in range(2)]
    assert kinds(ds.review_rounds(data(s), TH)) == ["review-rounds"]


def test_same_rule_failing_repeatedly():
    fail = [{"id": "DOD-7", "verdict": "fail", "severity": "should-fix", "text": "Scope: ..."}]
    c = ds.rule_repeat(data(verdicts=[verdict(1, "a", fail), verdict(2, "b", fail)]), TH)
    assert kinds(c) == ["rule-repeat"] and c[0]["scope"]["rule"] == "DOD-7"
    assert ds.rule_repeat(data(verdicts=[verdict(1, "a", fail)]), TH) == []


def test_blocker_a_check_could_catch():
    b = [{"id": "DOD-5", "verdict": "fail", "severity": "blocker", "evidence": "python3 tests/run.py: 2 failed"}]
    c = ds.lintable_blocker(data(verdicts=[verdict(1, "a", b)]), TH)
    assert kinds(c) == ["lintable-blocker"] and c[0]["severity"] == "severe"         # severe: one episode suffices
    soft = [{"id": "DOD-5", "verdict": "fail", "severity": "blocker", "evidence": "the summary is vague"}]
    assert ds.lintable_blocker(data(verdicts=[verdict(1, "a", soft)]), TH) == []


def test_out_of_scope_from_verdicts():
    s = [{"id": "DOD-7", "verdict": "fail", "evidence": "adds bay/x.py, outside the approved proposal"}]
    assert kinds(ds.out_of_scope(data(verdicts=[verdict(1, "a", s), verdict(2, "b", s)]), TH)) == ["out-of-scope"]
    assert ds.out_of_scope(data(verdicts=[verdict(1, "a", s)]), TH) == []             # one run is not recurring


def test_mid_run_instruction_changes():
    e = [ep(1, target="forge.extend", instructionChanges=1), ep(2, target="forge.extend", instructionChanges=2)]
    c = ds.instruction_changes(data(e), TH)
    assert kinds(c) == ["instruction-change"] and c[0]["measure"]["changes"] == 3
    assert ds.instruction_changes(data(e[:1]), TH) == []


def test_long_or_costly_steps_with_config_thresholds():
    st = lambda ms, usd: [{"id": "build", "name": "delivery.build.build", "durationMs": ms, "costUsd": usd}]  # noqa
    c = ds.slow_steps(data([ep(1, steps=st(2000, 2.0)), ep(2, steps=st(1500, 0.1))]), TH)
    assert sorted(kinds(c)) == ["costly-step", "slow-step"] or kinds(c) == ["slow-step"]
    slow = [x for x in c if x["kind"] == "slow-step"][0]
    assert slow["scope"] == {"mode": "delivery", "feature": "build", "step": "build"} and slow["measure"]["max"] == 2000
    # one run over the threshold is noise, unless it is severe (>= severeFactor x threshold)
    assert ds.slow_steps(data([ep(1, steps=st(1500, 0))]), TH) == []
    assert kinds(ds.slow_steps(data([ep(1, steps=st(5000, 0))]), TH)) == ["slow-step"]


def test_retries_and_repeated_identical_tool_calls():
    calls = [{"name": "Bash", "inputHash": "abc123"}] * 3 + [{"name": "Bash", "inputHash": "fff000"}]
    e = [ep(1, toolCalls=calls), ep(2, toolCalls=calls)]
    c = ds.retries(data(e), TH)
    assert kinds(c) == ["retry-loop"] and c[0]["measure"]["maxRepeats"] == 3
    assert ds.retries(data([ep(1, toolCalls=calls[:2] * 1)]), TH) == []


def test_permission_prompts_and_denials():
    e = [ep(1, denials=[{"tool": "Bash"}, {"tool": "Bash"}]), ep(2, denials=[{"tool": "Bash"}])]
    c = ds.permission_friction(data(e), TH)
    assert kinds(c) == ["permission-friction"] and c[0]["measure"]["events"] == 3
    p = [ep(1, permissionPrompts=2, agent="builder"), ep(2, permissionPrompts=2, agent="builder")]
    assert kinds(ds.permission_friction(data(p), TH)) == ["permission-friction"]
    assert ds.permission_friction(data(e[:1]), TH) == []


def test_interrupts():
    e = [ep(1, interrupts=1), ep(2, interrupts=2)]
    assert kinds(ds.interrupts(data(e), TH)) == ["interrupts"]
    assert ds.interrupts(data(e[:1]), TH) == []


def test_repeated_status_questions():
    e = [ep(1, id="cc:a", statusQuestions=2), ep(2, id="cc:b", statusQuestions=1)]
    c = ds.status_questions(data(e), TH)
    assert kinds(c) == ["status-questions"] and c[0]["measure"] == {"questions": 3, "episodes": 2}
    assert ds.status_questions(data(e[:1]), TH) == []                               # one session is not recurring


def test_environment_gaps():
    e = [ep(1, id="cc:a", envGaps={"missing-module": 2}), ep(2, id="cc:b", envGaps={"missing-module": 1,
                                                                                    "network-blocked": 1})]
    c = ds.env_gaps(data(e), TH)
    assert [x["detector"]["key"] for x in c] == ["missing-module"] and c[0]["measure"]["errors"] == 3


def test_reverts_and_churn_from_git():
    commits = [ep(i, id=f"git:{i:07x}", source="git", kind="commit",
                  commit={"sha": f"{i:07x}", "isRevert": False, "files": ["hot.py"]}) for i in range(5)]
    commits.append(ep(9, id="git:0000009", source="git", kind="commit",
                      commit={"sha": "0000009", "isRevert": True, "revertOf": "0000004", "files": ["bad.py"]}))
    c = ds.reverts(data(commits), TH)
    assert kinds(c) == ["churn", "revert"]
    assert [x for x in c if x["kind"] == "revert"][0]["severity"] == "severe"
    assert ds.reverts(data(commits[:4]), TH) == []


def test_run_filters_by_detector_name_for_verify():
    e = [ep(1, interrupts=1), ep(2, interrupts=1)]
    assert kinds(ds.run(data(e), {}, only="interrupts")) == ["interrupts"]
    assert ds.run(data(e), {}, only="retry-loop") == []


# ----------------------------------------------------------------------------- artifacts
def tree(files: dict) -> Path:
    root = tmpdir() / "repo"
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(text))
    return root


def arts(root: Path, ledger=(), conf=()):
    g = graph.build(root, None).as_dict()
    return da.Artifacts(files=graph.files(root), text=lambda p: (root / p).read_text(), graph=g,
                        ledger=list(ledger), conformance=list(conf))


def test_slop_filler_with_exact_text_and_rewrite():
    root = tree({"modes/m/features/f/playbook.md": "## Steps\n1. In order to sync, leverage the store.\n"})
    try:
        c = da.slop_filler(arts(root), da.thresholds({}))
        assert sorted(x["detector"]["key"].split(":")[-1] for x in c) == ["in order to", "leverage"]
        e = [x for x in c if x["detector"]["key"].endswith("in order to")][0]["evidence"][0]
        assert e["ref"] == "modes/m/features/f/playbook.md:2" and e["rewrite"] == "1. to sync, use the store."
    finally:
        cleanup(root.parent)


def test_duplicate_and_near_duplicate_rules_by_shingles():
    root = tree({"modes/m/features/a/rules.yaml": "rules:\n  - {id: R-1, level: must, appliesTo: both, statement: "
                 "\"Cite only urls of stored posts, exactly as stored.\"}\n",
                 "modes/m/features/b/rules.yaml": "rules:\n  - {id: R-1, level: must, appliesTo: both, statement: "
                 "\"Cite only urls of stored posts exactly as they were stored.\"}\n"
                 "  - {id: R-2, level: should, appliesTo: both, statement: \"Keep summaries under 60 words.\"}\n"})
    try:
        c = da.slop_duplicates(arts(root), da.thresholds({"thresholds": {"nearDuplicate": 0.5}}))
        assert len(c) == 1 and c[0]["measure"]["jaccard"] >= 0.5
        assert da.slop_duplicates(arts(root), da.thresholds({"thresholds": {"nearDuplicate": 0.95}})) == []
    finally:
        cleanup(root.parent)


def test_comments_restating_code_and_padded_messages():
    root = tree({"pkg/a.py": """
        def f(items):
            counter_total = len(items)  # why: items may repeat across pages
            if not items:
                raise ValueError("Oops, something went wrong, please try again")
            # return the counter total
            return counter_total
        """})
    try:
        a = arts(root)
        cm = da.slop_comments(a, da.thresholds({}))
        assert [x["evidence"][0]["ref"] for x in cm] == ["pkg/a.py:6"]
        pm = da.slop_messages(a, da.thresholds({}))
        assert len(pm) == 1 and "Oops" not in pm[0]["evidence"][0]["rewrite"] and pm[0]["evidence"][0]["ref"] == "pkg/a.py:5"
    finally:
        cleanup(root.parent)


def test_unused_needs_no_references_and_no_ledger_uses():
    root = tree({
        "pkg/core.py": "def used():\n    return 1\n\ndef dead_helper():\n    return 2\n\n"
                       "def only_in_comments():\n    return 3\n",
        "pkg/main.py": "# only_in_comments() is mentioned here, but never called\n"
                       "from pkg.core import used\n\ndef main():\n    print(used(), 'dead_helper')\n\n"
                       "if __name__ == '__main__':\n    main()\n",
        "pkg/settings.yaml": "hook: only_in_comments\nalso: orphan_mod\n",
        "pkg/orphan_mod.py": "X = 1\n",
        "interfaces/thing.v1.yaml": "apiVersion: agentbay/v2\nkind: Interface\nmetadata: {name: thing}\n"
                                    "spec: {version: 1, endpoints: {fetch: {effects: [read]}}}\n",
        "connectors/c/connector.yaml": "apiVersion: agentbay/v2\nkind: Connector\nmetadata: {name: c}\n"
                                       "spec: {implements: thing/v1, entry: c.py}\n",
        "connectors/c/c.py": "class C:\n    def fetch(self):\n        return []\n\n    def stale(self):\n"
                             "        return 0\n\ndef create(ctx):\n    return C()\n"})
    try:
        c = da.unused(arts(root), da.thresholds({}))
        ids = sorted(x["detector"]["key"] for x in c)
        # a string, a comment or a YAML mention is not a reference; scripts and connector entry points are roots
        assert ids == ["fn:connectors/c/c.py:C.stale", "fn:pkg/core.py:dead_helper", "fn:pkg/core.py:only_in_comments",
                       "py:pkg/orphan_mod.py"], ids
        assert c[0]["evidence"][1] == {"kind": "measurement", "ref": "ledger", "detail": "0 uses", "value": 0}
    finally:
        cleanup(root.parent)


def test_unused_role_is_kept_when_the_ledger_used_it():
    name = "-".join(["zz", "orphan", "role"])          # never spelled out: this file is part of the kit copy
    k = kit_copy()
    try:
        import yaml
        (k / f"framework/roles/{name}.yaml").write_text(yaml.safe_dump({
            "apiVersion": "agentbay/v2", "kind": "Role", "metadata": {"name": name, "description": "never placed"},
            "spec": {"tier": "fast", "prompt": "Never placed in any mode; exists to test the unused detector.", "doneWhen": ["x"]}}))
        g = graph.build(k, k).as_dict()
        a = da.Artifacts(files=graph.files(k), text=lambda p: (k / p).read_text(), graph=g)
        assert f"role:{name}" in [x["detector"]["key"] for x in da.unused(a, da.thresholds({}))]
        a.ledger = [{"id": "ab:x", "steps": [{"id": "s", "role": name}]}]
        assert f"role:{name}" not in [x["detector"]["key"] for x in da.unused(a, da.thresholds({}))]
    finally:
        cleanup(k)


def test_inefficient_store_reads_loop_calls_and_oversized_context():
    root = tree({"connectors/s/store.py": """
        import json, subprocess
        class S:
            def _all(self):
                return self.path.read_text().splitlines()
            def query(self, q):
                return [l for l in self._all() if q in l]
            def sync(self, ids):
                for i in ids:
                    subprocess.run(["git", "show", i])
                for attempt in (1, 2):           # a bounded retry, not per-item work
                    subprocess.run(["git", "fetch"])
        """})
    try:
        c = da.inefficient(arts(root), da.thresholds({}), read_endpoints={"query"})
        assert kinds(c) == ["inefficient-loop-call", "inefficient-store-read"]
        rd = [x for x in c if x["kind"] == "inefficient-store-read"][0]
        assert rd["evidence"][0]["ref"] == "connectors/s/store.py:6"
        big = da.oversized_context(arts(root), da.thresholds({"thresholds": {"contextTokens": 500}}),
                                   roles=[{"name": "r", "path": "roles/r.yaml", "chars": 4000, "parts": ["x"]},
                                          {"name": "s", "path": "roles/s.yaml", "chars": 400, "parts": ["y"]}])
        assert [x["scope"]["role"] for x in big] == ["r"] and big[0]["measure"]["tokens"] == 1000
    finally:
        cleanup(root.parent)


def test_conformance_checks_on_a_kit_copy():
    k = kit_copy()
    try:
        assert conformance.lint(k) == []
        base = {r["rule"]: len(r["violations"]) for r in conformance.run(k)}
        # C-1: a workflow step the playbook never mentions
        pb = k / "modes/briefing/features/sync/playbook.md"
        pb.write_text(pb.read_text().replace("`fetch`: the dispatcher runs `items.store/v1.sync`", "The store updates")
                      .replace("fetch", "read"))
        # C-4: a backticked tool in a playbook; C-7: retired vocabulary
        pb2 = k / "modes/briefing/features/ask/playbook.md"
        pb2.write_text(pb2.read_text().replace("## Outputs", "Use `Bash` and a sub-agent.\n\n## Outputs"))
        # C-5: a read-only endpoint that writes
        st = k / "framework/connectors/corpus-store/corpus_store.py"
        st.write_text(st.read_text().replace("    def status(self", "    def status(self, *a, **kw):\n"
                                             "        self.path.write_text('')\n        return self._status()\n\n"
                                             "    def _status(self", 1))
        # C-6: without a dollar cap, spend needs review (sync and ask); without review, delete is flagged (prune)
        mode = k / "modes/feed-briefing/mode.yaml"
        mode.write_text(mode.read_text().replace("    spendUsd: 5\n", ""))
        base_mode = k / "modes/briefing/mode.yaml"
        base_mode.write_text(base_mode.read_text().replace("    spendUsd: 5          # dollar cap enforced by the dispatcher (C-6 spend exemption for sync)\n", "")
                             .replace("      review: { role: reviewer, when: always, tier: balanced, effort: medium }\n      schedule: daily", "      schedule: daily"))
        res = {r["rule"]: r for r in conformance.run(k)}
        assert len(res["C-1"]["violations"]) == base["C-1"] + 2 and "fetch" in res["C-1"]["violations"][-1]["detail"]   # briefing and feed-briefing
        assert any("'Bash'" in v["detail"] for v in res["C-4"]["violations"])
        assert any("sub-agent" in v["detail"] and v["rewrite"].endswith("subagent.") for v in res["C-7"]["violations"])
        assert any("status" in v["detail"] and "write_text" in v["detail"] for v in res["C-5"]["violations"])
        assert base["C-6"] == 0
        assert sorted(v["detail"].split()[0] for v in res["C-6"]["violations"]) == \
            ["briefing.ask", "briefing.prune", "briefing.sync", "feed-briefing.ask", "feed-briefing.prune",
             "feed-briefing.sync"]
        cands = da.conformance(da.Artifacts(files=[], text=lambda p: None, graph={}, conformance=list(res.values())),
                               da.thresholds({}))
        assert {c["scope"]["rule"] for c in cands} >= {"C-1", "C-4", "C-5", "C-6", "C-7"}
        assert all(c["evidence"][0]["kind"] == "rule" for c in cands)
    finally:
        cleanup(k)


def test_conformance_yaml_is_linted():
    k = kit_copy()
    try:
        p = k / "framework/rules/conformance.yaml"
        p.write_text(p.read_text().replace("check: vocabulary", "check: no_such_check").replace("id: C-2", "id: C-1"))
        from bay import lint
        probs = lint.run(k)
        assert any("duplicate conformance rule id C-1" in x for x in probs)
        assert any("unknown check 'no_such_check'" in x for x in probs)
        p.write_text("apiVersion: agentbay/v2\nkind: Conformance\nrules: [{id: X-1, level: must}]\n")
        assert any("conformance schema" in x for x in lint.run(k))
        shutil.copy(k / "framework/modes/forge/mode.yaml", k / "fm.bak")
        p.unlink()
        assert any("conformance.yaml: missing" in x for x in lint.run(k))
    finally:
        cleanup(k)
