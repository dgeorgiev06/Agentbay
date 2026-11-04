"""Golden baseline of every guard decision, per subagent unit, Bash command spelling and file tool."""
from __future__ import annotations

import copy
import json
import os

from golden_util import GOLDEN, compare, normal
from helpers import KIT, cleanup, edit_yaml, gaps, kit_copy, project, system

from bay import lint, model
from bay.adapter import get
from bay.guard import Guard

RENAMED = {"framework/components.yaml": "framework/kernel.yaml", "modes/x.yaml": "components/x.yaml"}
_KIT: list = []


def physical(logical: str) -> str:
    """The kit path of a logical row path (`mode:<name>/<rest>`, `env:<name>`, `connector:<name>/<rest>`)."""
    kind, sep, rest = logical.partition(":")
    if not sep:
        return RENAMED.get(logical, logical)
    if not _KIT:
        _KIT.append(model.Kit(KIT))
    name, slash, tail = rest.partition("/")
    d = _KIT[0].get({"mode": "Mode", "env": "Environment", "connector": "Connector"}[kind], name)
    if kind == "env":
        return model.rel(d.path) if d else f"components/briefing/envs/{name}.yaml"
    return (model.rel(d.dir) if d else f"components/{name}") + slash + tail

UNITS = ("builder--delivery", "builder--forge--local-authoring", "builder--forge--framework-dev", "reviewer--forge",
         "analyst--improve")
UNKNOWN = "Explore"
ENVS = ("cos-local", "framework-dev", "improve-local", "local-authoring", "research", "workspace", "local-feeds",
        "local-mail")

WRITE_PATHS = [
    "bay/guard.py", "bay/brand_new.py", "bay/improve/pipeline.py", "framework/roles/x.yaml", "framework/rules/x.yaml",
    "framework/interfaces/x.yaml", "framework/components.yaml", "schemas/x.json", "adapters/claude-code/x.py",
    "adapters/x.yaml",
    "mode:cos/mode.yaml", "mode:forge/mode.yaml", "mode:forge/features/create/playbook.md",
    "mode:improve/mode.yaml", "mode:improve/README.md", "mode:improve/features/scan/playbook.md",
    "mode:briefing/mode.yaml", "mode:delivery/mode.yaml", "mode:feed-briefing/mode.yaml", "mode:mail-briefing/mode.yaml",
    "mode:brand-new/mode.yaml",
    "env:cos-local", "env:framework-dev", "env:improve-local", "env:local-authoring", "env:workspace", "env:research",
    "env:local-feeds", "env:brand-new",
    "connector:scaffold/scaffold.py", "connector:workflow-runner/workflow_runner.py", "connector:improve-detect/connector.yaml",
    "connector:improve-store/connector.yaml", "connector:improve-store/improve_store.py", "connector:ledger/ledger.py",
    "connector:git/git_history.py", "connector:artifact-graph/artifact_graph.py", "connector:claude-transcripts/connector.yaml",
    "connector:corpus-store/connector.yaml", "connector:fake/connector.yaml", "connector:gmail-api/connector.yaml",
    "connector:brand-new/x.py",
    "src/app.py", "docs/DESIGN.md", "README.md", "tests/test_x.py", "content-types/x/y.py", "HANDOFF.md", "modes/x.yaml",
    "roles/x.yaml", "bay.sh", "BAY.SH", "agentbay.config.yaml", "CLAUDE.md", ".env", ".env.local", "Makefile",
    ".github/workflows/ci.yml", ".git/config", ".agentbay/guard.json", ".claude/settings.json", ".vscode/x.json",
    "../escape.py", "bay/../bay/guard.py", "src/../bay/guard.py", "Bay/guard.py", "/etc/passwd",
]
READ_PATHS = ["bay/guard.py", "framework/roles/builder.yaml", "src/app.py", "README.md", ".agentbay/guard.json",
              ".claude/settings.json", ".env", "../outside.txt", "/etc/passwd", "mode:improve/mode.yaml",
              "connector:ledger/ledger.py", "docs/DESIGN.md", "tests/helpers.py"]
EDIT_PATHS = ["bay/guard.py", "mode:improve/mode.yaml", "mode:briefing/mode.yaml", "src/app.py", "docs/DESIGN.md",
              "env:workspace", "connector:fake/connector.yaml"]
SEARCHES = [("Glob", {"pattern": ".agentbay/**"}), ("Glob", {"pattern": "**/*.json"}), ("Glob", {"pattern": "bay/*.py"}),
            ("Glob", {"pattern": ".*"}), ("Glob", {"pattern": "../*"}), ("Glob", {"pattern": "*", "path": ".."}),
            ("Grep", {"pattern": "x", "glob": ".claude/*"}), ("Grep", {"pattern": "x"}),
            ("Grep", {"pattern": "x", "path": ".agentbay"}), ("Grep", {"pattern": "x", "path": "docs"})]

MAIN_COMMANDS = [
    ".agentbay/bay note dispatch T-1 --agent x", "./.agentbay/bay note review T-1 '{}'", "/x/.agentbay/bay show reclaim R-1",
    "./bay.sh show reclaim R-1", "bay.sh --project . show reclaim R-1", "bay.sh --proj . show reclaim R-1",
    "python3 -m bay.cli note dispatch T-1", "python3 bay/cli.py show reclaim R-1", "python3 /k/bay/cli.py note review T",
    ".agentbay/bay note 'dispatch' T-1", ".agentbay/bay show re\\claim R-1", ".agentbay/bay note {dispatch,} T-1",
    ".agentbay/bay note $X T-1", "x;.agentbay/bay note review T", ".agentbay/bay --project /x show reclaim R",
    ".agentbay/bay note task", ".agentbay/bay status", ".agentbay/bay approve C-1", "./bay.sh approve C-1",
    ".agentbay/bay call forge.extend '{}'", "git commit -m 'bay note dispatch'", "ls", "ls 'unbalanced",
]
SUBAGENT_COMMANDS = [
    ".agentbay/bay call forge.extend '{}'", "./bay.sh call x.y '{}'", "bay.sh approve C-1", ".agentbay/bay approve C-1",
    "./.agentbay/bay approve C-1", "python3 -m bay.cli approve C-1", "python3 bay/cli.py approve C-1", "bay approve C-1",
    "git commit -m 'about bay approve'", ".agentbay/bay show C-1", "./bay.sh check", "python3 bay/cli.py check",
    "python3 tests/run.py -q", "python3 tests/run.py tests/test_improve.py", "cat .agentbay/guard.json", "ls .agentbay",
    "ls .claude", "cat .claude/settings.json", "cat '.agent''bay/guard.json'", "ls .agent*", "ls .a?entbay", "ls -la", "ls",
    "cat agentbay.config.yaml", "cat agentbay.conf''ig.yaml", "echo x > agentbay.config.yaml", "sed -i s/a/b/ agentbay.config.yaml",
    "cat agentbay.config.*", "cat .env", "cat ./bay.sh", "head -3 README.md", "git status", "git -C . status",
    "git log --output=x", "git diff --ext-diff", "git show --textconv HEAD:x", "git diff --no-index a b",
    "git worktree add ../x", "git worktree add wt/x", "git worktree add bay/wt", "git worktree add -b nb wt/y",
    "python3 -c 'print(1)'", "python3 -m http.server", "bash -c ls", "sh -c ls", "node -e 1", "perl -e 1", "ruby -e 1",
    "ls; cat x", "ls | wc", "echo $(id)", "echo `id`", "ls > out.txt", "rm -rf x", "mkdir x", "", "ls 'unbalanced",
    "./.agentbay/bay plan TASK '{}'", "./.agentbay/bay plan TASK --done 1", "./.agentbay/bay plan TASK",
    ".agentbay/bay plan TASK '{}'", "./.agentbay/bay plan T-20261031-a000 '{}'", "./.agentbay/bay plan T-20261031-b000 '{}'",
    "./.agentbay/bay plan T-bad '{}'", "./.agentbay/bay plan TASK --force", "./.agentbay/bay plan T-20261031-zzzz '{}'",
    "SHIM items.store/v1.query '{}'", "SHIM --role x items.store/v1.query '{}'", "SHIM", "OTHERSHIM items.store/v1.query '{}'",
    "ABSSHIM items.store/v1.query '{}'", "SHIM improve.findings/v1.query '{}'; ls",
]


def rows(g: Guard, k, agent: str | None, with_id: bool = True) -> dict:
    """Every decision for one caller: {"<tool> <input>": [decision, reason]}."""
    out = {}

    def ask(tool: str, ti: dict, label: str) -> None:
        payload = {"tool_name": tool, "tool_input": ti, "cwd": str(k)}
        if agent:
            payload["agent_type"] = agent
        if agent or with_id:
            payload["agent_id"] = "a1"
        d, r = g.decide(payload)
        out[f"{tool} {label}"] = [d, r]

    shim = f".agentbay/roles/{agent}/use" if agent else ".agentbay/roles/none/use"
    for lp in WRITE_PATHS:
        for tool in ("Write",):
            ask(tool, {"file_path": physical(lp), "content": "x"}, lp)
    for lp in READ_PATHS:
        ask("Read", {"file_path": physical(lp)}, lp)
    for lp in EDIT_PATHS:
        ask("Edit", {"file_path": physical(lp), "old_string": "a", "new_string": "b"}, lp)
        ask("MultiEdit", {"file_path": physical(lp), "edits": []}, lp)
    ask("NotebookEdit", {"notebook_path": "src/n.ipynb", "new_source": "x"}, "src/n.ipynb")
    ask("NotebookEdit", {"notebook_path": physical("mode:improve/n.ipynb"), "new_source": "x"}, "mode:improve/n.ipynb")
    ask("Write", {"file_path": str(k / "src/abs.py"), "content": "x"}, "<project>/src/abs.py")
    ask("Write", {"file_path": str(k / "bay/abs.py"), "content": "x"}, "<project>/bay/abs.py")
    for tool, ti in SEARCHES:
        ask(tool, ti, json.dumps(ti, sort_keys=True))
    ask("WebFetch", {"url": "https://example.com"}, "https://example.com")
    for cmd in (MAIN_COMMANDS if agent is None and not with_id else SUBAGENT_COMMANDS):
        task = f"T-20261031-a00{UNITS.index(agent)}" if agent in UNITS else "T-20261031-a999"
        cmd = cmd.replace("OTHERSHIM", ".agentbay/roles/analyst--other/use").replace("ABSSHIM", str(k / shim))
        cmd = cmd.replace("SHIM", shim).replace("TASK", task)
        ask("Bash", {"command": cmd}, cmd)
    return out


def build_kit():
    k = kit_copy()
    get("claude-code").build(system(k, k), k, k)
    led = k / ".agentbay/ledger"
    led.mkdir(parents=True, exist_ok=True)
    events = [{"v": 1, "ts": "2026-10-31T00:00:00+00:00", "type": "agent.dispatch", "runId": f"T-20261031-a00{i}",
               "taskId": f"T-20261031-a00{i}", "agent": u} for i, u in enumerate(UNITS)]
    events.append({"v": 1, "ts": "2026-10-31T00:00:00+00:00", "type": "agent.dispatch", "runId": "T-20261031-b000",
                   "taskId": "T-20261031-b000", "agent": "other"})
    (led / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
    return k


def matrix(k) -> dict:
    pol = json.loads((k / ".agentbay/guard.json").read_text())
    assert set(UNITS) <= set(pol["subagents"]), sorted(pol["subagents"])
    g = Guard(pol, k, ci=False)
    out = {"main thread": rows(g, k, None, with_id=False), UNKNOWN: rows(g, k, UNKNOWN)}
    for u in UNITS:
        out[u] = rows(g, k, u)
    return out


def policy_view(k) -> dict:
    pol = json.loads((k / ".agentbay/guard.json").read_text())
    return {"protected": pol["protected"], "autoAllowShim": pol["autoAllowShim"],
            "units": {u: {key: pol["subagents"][u][key] for key in ("role", "mode", "env", "shim", "clis", "read", "write")}
                      for u in UNITS}}


def protected_view(k) -> dict:
    kit = model.Kit(k, k)
    return {e: model.protected_writes(kit, kit.get("Environment", e)) for e in ENVS}


def resolver_gaps() -> dict:
    out = {}
    cases = {
        "forge.create in a framework-writing env": ("mode:forge/mode.yaml",
                                                      lambda d: d["spec"]["features"]["create"].update(
                                                          {"roles": {"builder": "framework-dev"}})),
        "user mode in a framework-writing env": ("mode:delivery/mode.yaml",
                                                   lambda d: d["spec"]["roles"].update({"builder": "framework-dev"})),
        "improve in a framework-writing env": ("mode:improve/mode.yaml",
                                                 lambda d: d["spec"]["roles"].update({"analyst": "framework-dev"})),
    }
    for name, (logical, fn) in cases.items():
        k = kit_copy()
        try:
            edit_yaml(k / physical(logical), fn)
            out[name] = gaps(k)
        finally:
            cleanup(k)
    return out


FOUR = ["framework", "bay", "schemas", "adapters"]
DEV, LOCAL = "builder--forge--framework-dev", "builder--forge--local-authoring"
IMPROVE = "components/improve"
DEV_CLIS = ["./bay.sh check", "python3 tests/run.py", "git status", "git diff", "git log", "git add", "git commit"]
MV_RM = ["git mv", "git rm"]
CHECKS = ["./bay.sh check", "python3 tests/run.py"]
LINT = ["python3 -I -m ruff check", "python3 -I -m mypy"]
READ = ["git status", "git diff", "git log"]
CHECK_CLIS = {
    "builder--delivery": ([*CHECKS, *LINT, *READ, "git add", "git worktree", "git commit", *MV_RM, "git show"],
                          [*READ, "git add", "git worktree", "git show"]),
    LOCAL: ([*CHECKS, *LINT, "git add", "git commit", *MV_RM, *READ, "git show"],
            ["./bay.sh check", *READ, "git show"]),
    "reviewer--forge": ([*CHECKS, *LINT, *READ, "git show"], [*READ, "git show"]),
}
CLAUSE = "{}/ of the agentbay checkout is writable only by forge.extend (env must name it)"


GOLDEN_FRAMEWORK = {"mode": {"cos", "forge", "improve"},
                    "env": {"cos-local", "framework-dev", "improve-local", "local-authoring", "workspace", "research"},
                    "connector": {"artifact-graph", "claude-transcripts", "corpus-store", "git", "improve-detect",
                                  "improve-store", "ledger", "scaffold", "workflow-runner"}}
GOLDEN_FOLDER = {"mode": "modes", "env": "envs", "connector": "connectors"}
GOLDEN_LOCAL_WRITE = ["modes", "envs", "connectors", "agentbay.config.yaml"]


def golden_physical(logical: str) -> str:
    kind, _, rest = logical.partition(":")
    name = rest.partition("/")[0]
    path = f"{GOLDEN_FOLDER[kind]}/{rest}.yaml" if kind == "env" else f"{GOLDEN_FOLDER[kind]}/{rest}"
    return f"framework/{path}" if name in GOLDEN_FRAMEWORK[kind] else path


def path_deltas() -> dict:
    logical = {lp for lp in [*WRITE_PATHS, *READ_PATHS, *EDIT_PATHS, "mode:improve/n.ipynb"] if ":" in lp}
    out = {physical(lp): golden_physical(lp) for lp in logical}
    out.update({new: old for old, new in RENAMED.items()})
    assert len(set(out)) == len(out) and all(a != b for a, b in out.items()), out
    return dict(sorted(out.items(), key=lambda kv: -len(kv[0])))


def undo_move(got: dict) -> dict:
    """The matrix as it would read with the shipped extensions still under framework/, with named differences only."""
    got = copy.deepcopy(got)
    pol, moved = got["policy"], model.Kit(KIT).protected_paths[len(FOUR):]
    assert pol["protected"] == FOUR + moved, pol["protected"]
    pol["protected"] = FOUR
    assert pol["units"][LOCAL]["write"] == ["components", "agentbay.config.yaml"], pol["units"][LOCAL]["write"]
    window = ["docs", "tests", "README.md"]
    assert pol["units"][DEV]["write"] == [*FOUR, *moved, *window], pol["units"][DEV]["write"]
    pol["units"][DEV]["write"] = [*FOUR, "docs", "tests"]
    assert got["protectedWrites"]["framework-dev"] == FOUR + moved
    got["protectedWrites"]["framework-dev"] = FOUR
    local_now, local_was = str(pol["units"][LOCAL]["write"]), str(GOLDEN_LOCAL_WRITE)
    pol["units"][LOCAL]["write"] = GOLDEN_LOCAL_WRITE
    deltas = path_deltas()
    local_writes = local_was
    dev_now, dev_was = str([*FOUR, *moved, *window]),str([*FOUR, "docs", "tests"])
    dev_clis = [*CHECKS, *LINT, *READ, "git add", "git commit", *MV_RM, "git show"]
    assert pol["units"][DEV]["clis"] == dev_clis, pol["units"][DEV]["clis"]
    pol["units"][DEV]["clis"] = [*DEV_CLIS, "git show"]
    cli_now, cli_was = ", ".join(dev_clis), ", ".join([*DEV_CLIS, "git show"])
    assert any(cli_now in r for r in (r for _, r in got["matrix"][DEV].values()))
    for unit, (now, was) in CHECK_CLIS.items():
        assert pol["units"][unit]["clis"] == now, pol["units"][unit]["clis"]
        pol["units"][unit]["clis"] = was
        assert any(", ".join(now) in r for _, r in got["matrix"][unit].values()), unit

    def old(s: str, unit: str | None = None) -> str:
        if unit in CHECK_CLIS:
            s = s.replace(", ".join(CHECK_CLIS[unit][0]), ", ".join(CHECK_CLIS[unit][1]))
        if unit == LOCAL:
            s = s.replace(local_now, local_was)
        if unit == DEV:
            s = s.replace(dev_now, dev_was).replace(cli_now, cli_was)
        for p in [*moved, IMPROVE]:
            was = f"outside the role's writable paths {local_writes}" if unit == LOCAL else CLAUSE.format("framework")
            s = s.replace(CLAUSE.format(p), was)
        for new, was_path in deltas.items():
            s = s.replace(f"<project>/{new}", f"<project>/{was_path}")
        return s

    for unit, rows_ in got["matrix"].items():
        for row, (decision, reason) in rows_.items():
            rows_[row] = [decision, old(reason, unit)]
    got["lintWarnings"] = [old(w) for w in got["lintWarnings"]]
    longer, shorter = ", ".join(FOUR + moved), ", ".join(FOUR)
    assert any(longer in g for gs in got["resolverGaps"].values() for g in gs)
    envs_now, envs_was = "their own envs (components/<name>/envs/)", "their own envs (envs/)"
    assert any(envs_now in g for gs in got["resolverGaps"].values() for g in gs)
    got["resolverGaps"] = {name: [old(g).replace(longer, shorter).replace(envs_now, envs_was) for g in gs]
                           for name, gs in got["resolverGaps"].items()}
    return got


USER_MODE_GAP = ("mode improve: role analyst works in the framework env framework-dev (improve.scan step patterns); "
                 "user modes may put roles only in their own envs (components/<name>/envs/) or the framework envs plan-writer and workspace and research")
IMPROVE_ROWS = ["Edit mode:improve/mode.yaml", "MultiEdit mode:improve/mode.yaml", "NotebookEdit mode:improve/n.ipynb",
                "Write mode:improve/README.md", "Write mode:improve/features/scan/playbook.md",
                "Write mode:improve/mode.yaml"]
IMPROVE_DELTAS: dict = {
    **{("builder--delivery", r): ("deny", "pass") for r in IMPROVE_ROWS},
    **{(LOCAL, r): ("deny", "pass") for r in IMPROVE_ROWS},
    **{(DEV, r): ("pass", "deny") for r in IMPROVE_ROWS},
}
README_DELTAS: dict = {(DEV, "Write README.md"): ("deny", "pass")}
RUN_TESTS = ["Bash python3 tests/run.py -q", "Bash python3 tests/run.py tests/test_improve.py"]
CHECK_DELTAS: dict = {
    **{("builder--delivery", r): ("deny", "pass")
       for r in ["Bash ./bay.sh check", "Bash git commit -m 'about bay approve'", *RUN_TESTS]},
    **{(LOCAL, r): ("deny", "pass") for r in ["Bash git commit -m 'about bay approve'", *RUN_TESTS]},
    **{("reviewer--forge", r): ("deny", "pass") for r in ["Bash ./bay.sh check", *RUN_TESTS]},
}
EXPECTED_DELTAS: dict = {**IMPROVE_DELTAS, **README_DELTAS, **CHECK_DELTAS}
NET_DELTAS = {k: v for k, v in EXPECTED_DELTAS.items() if v[0] != v[1]}


def put_back(got: dict, want: dict) -> dict:
    """The matrix with each EXPECTED_DELTAS row (asserted first) set to the golden's decision and reason."""
    got = copy.deepcopy(got)
    for (unit, row), (was, now) in EXPECTED_DELTAS.items():
        assert got["matrix"][unit][row][0] == now and want["matrix"][unit][row][0] == was, (unit, row)
        got["matrix"][unit][row] = want["matrix"][unit][row]
    name = "improve in a framework-writing env"
    now, was = got["resolverGaps"][name], want["resolverGaps"][name]
    assert now[0] == USER_MODE_GAP and not any("only forge.extend" in g for g in now), now
    assert [g for g in was if "only forge.extend" in g] and [g for g in now if g not in was] == [USER_MODE_GAP]
    got["resolverGaps"][name] = was
    name = "user mode in a framework-writing env"
    got["resolverGaps"][name] = [g.replace("plan-writer and ", "") for g in got["resolverGaps"][name]]
    return got


def decisions(doc: dict) -> dict:
    return {unit: {row: v[0] for row, v in rows_.items()} for unit, rows_ in doc["matrix"].items()}


def changed(got: dict, want: dict) -> dict:
    """{(caller, row): (was, now)} for every decision that differs from the golden's."""
    a, b = decisions(got), decisions(want)
    assert a.keys() == b.keys() and all(a[u].keys() == b[u].keys() for u in a), "the rows themselves changed"
    return {(u, row): (b[u][row], a[u][row]) for u in a for row in a[u] if a[u][row] != b[u][row]}


def test_guard_decision_matrix():
    k = build_kit()
    try:
        real = {str(k): "<project>", os.path.realpath(k): "<project>", str(k.parent): "<tmp>",
                os.path.realpath(k.parent): "<tmp>"}
        got = normal({"policy": policy_view(k), "protectedWrites": protected_view(k), "resolverGaps": resolver_gaps(),
                      "lintWarnings": [w for w in lint.warnings(model.Kit(k, k)) if "reaches" in w],
                      "matrix": matrix(k)}, real)
        want = json.loads((GOLDEN / "guard-matrix.json").read_text())
        diff = changed(got, want)
        assert diff == NET_DELTAS, "a guard decision changed:\n" + "\n".join(f"{key}: {v}" for key, v in diff.items())
        kit = model.Kit(k, k)
        assert not [r for _, r in NET_DELTAS if kit.covers(physical(r.split(" ", 1)[1]))], NET_DELTAS
        compare("guard-matrix", undo_move(put_back(got, want)))
    finally:
        cleanup(k)


def undo_kit_path(got: dict) -> dict:
    """The one path the kit-outside probe names moved; the decision and the rest of every reason are the golden's."""
    text = json.dumps(got, sort_keys=True)
    assert text.count("<kit>/components/briefing/mode.yaml") == 2, text.count("<kit>/components/briefing/mode.yaml")
    now, was = (", ".join(c) for c in CHECK_CLIS["builder--delivery"])
    assert text.count(now) == 4, text.count(now)
    text = text.replace("<kit>/components/briefing/mode.yaml", "<kit>/modes/briefing/mode.yaml")
    return json.loads(text.replace(now, was))


def test_guard_matrix_for_a_project_with_the_kit_outside():
    """autoAllowShim, the kit as a folder agents may not write, and no protected list."""
    p = project()
    try:
        get("claude-code").build(system(p), p, KIT)
        pol = json.loads((p / ".agentbay/guard.json").read_text())
        g = Guard(pol, p, ci=False)
        out = {"protected": pol["protected"], "autoAllowShim": pol["autoAllowShim"]}
        for u in ("builder--delivery", "analyst--feed-briefing", "builder--forge--framework-dev"):
            if u not in pol["subagents"]:
                continue
            pa = {"agent_type": u, "agent_id": "a1", "cwd": str(p)}
            shim = f".agentbay/roles/{u}/use"
            for label, tool, ti in (
                    [("kit file", "Write", {"file_path": str(KIT / "bay/guard.py")}),
                     ("kit mode", "Write", {"file_path": str(KIT / "components/briefing/mode.yaml")}),
                     ("src", "Write", {"file_path": "src/app.py"}), ("bay dir of project", "Write", {"file_path": "bay/x.py"}),
                     ("config", "Write", {"file_path": "agentbay.config.yaml"}),
                     ("ledger", "Read", {"file_path": ".agentbay/ledger/events.jsonl"}),
                     ("kit read", "Read", {"file_path": str(KIT / "bay/guard.py")})]
                    + [("shim", "Bash", {"command": f"{shim} items.store/v1.query '{{}}'"}),
                       ("shim flag", "Bash", {"command": f"{shim} --role x items.store/v1.query"}),
                       ("kit cli", "Bash", {"command": f"python3 {KIT}/bay/cli.py check"}),
                       ("kit bay.sh", "Bash", {"command": f"{KIT}/bay.sh check"}),
                       ("approve", "Bash", {"command": ".agentbay/bay approve C-1"})]):
                d, r = g.decide({**pa, "tool_name": tool, "tool_input": ti})
                out[f"{u} {label}"] = [d, r]
        compare("guard-matrix-project", undo_kit_path(normal(out, {str(p): "<project>", os.path.realpath(p): "<project>",
                                                     str(p.parent): "<tmp>", os.path.realpath(p.parent): "<tmp>",
                                                     str(KIT): "<kit>"})))
    finally:
        cleanup(p)
