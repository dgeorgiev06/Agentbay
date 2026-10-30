"""Main-thread guard decisions (0008 stage 3, DOD-2): the writes that ask rules cover by prefix text also ask when the
verb is quoted or escaped, because the hook judges the shell words."""
import io
import json
import os
import sys

from helpers import cleanup

from bay import guard
from bay.guard import Guard, main_thread_decision
from test_boundaries import built

ASKED = (
    ".agentbay/bay note dispatch T-20261030-abcd --agent x",
    ".agentbay/bay note 'dispatch' T-20261030-abcd --agent x",
    '.agentbay/bay note "dispatch" T-20261030-abcd --agent x',
    ".agentbay/bay note disp\\atch T-20261030-abcd --agent x",
    ".agentbay/bay note 'review' T-20261030-abcd '{}'",
    '.agentbay/bay note "review" T-20261030-abcd \'{}\'',
    ".agentbay/bay note re\\view T-20261030-abcd '{}'",
    ".agentbay/bay show re\\claim R-1",
    ".agentbay/bay show 'reclaim' R-1 --reason r",
    '.agentbay/bay show "re""claim" R-1',
    ".agentbay/bay --project . note 'dispatch' T-20261030-abcd --agent x",
    ".agentbay/bay --project=. show re\\claim R-1",
    ".agentbay/bay --proj . note 'review' T-20261030-abcd '{}'",
    ".agentbay/bay -- note 'dispatch' T-20261030-abcd --agent x",
    "FOO=1 .agentbay/bay note 'dispatch' T-20261030-abcd --agent x",
    "A=1 B='2 3' ./bay.sh show re\\claim R-1",
    "./bay.sh note 'review' T-20261030-abcd '{}'",
    "bay.sh note 'dispatch' T-20261030-abcd --agent x",
    "python3 -m bay.cli note 'dispatch' T-20261030-abcd --agent x",
    "PYTHONPATH=. python3 -m bay.cli show re\\claim R-1",
    "python3 bay/cli.py show 'reclaim' R-1",
    "echo hi; .agentbay/bay note 'dispatch' T-20261030-abcd --agent x",
    "true && .agentbay/bay show re\\claim R-1",
    # expansions the shell may turn into an asked verb: the word cannot be known, so it asks
    ".agentbay/bay note {dispatch,} T-20261030-abcd --agent x",
    ".agentbay/bay note ${X:-dispatch} T-20261030-abcd --agent x",
    ".agentbay/bay note dispatc${X}h T-20261030-abcd --agent x",
    '.agentbay/bay note "$V" T-20261030-abcd --agent x',
    ".agentbay/bay show `echo reclaim` R-1",
    ".agentbay/bay show re{claim,} R-1",
    ".agentbay/bay note dis\\\npatch T-20261030-abcd --agent x",
    "./bay.sh note {review,} T-20261030-abcd '{}'",
)
NOT_ASKED = (
    ".agentbay/bay note T-20261030-abcd \"text about dispatch\"",
    ".agentbay/bay note T-20261030-abcd dispatch",
    ".agentbay/bay note task",
    ".agentbay/bay status",
    ".agentbay/bay status --log -n 20",
    ".agentbay/bay show C-20261030-abcd",
    ".agentbay/bay show 'C-20261030-abcd'",
    ".agentbay/bay catalog",
    ".agentbay/bay catalog forge.extend",
    ".agentbay/bay approve C-1",
    ".agentbay/bay 'approve' C-1",
    "./bay.sh check",
    "git commit -m 'bay note dispatch and show reclaim'",
    "echo approve",
    "ls",
)
# plain words after note/show that merely contain braces or $ later in the line are not asked
NOT_ASKED_LATER = (
    ".agentbay/bay note T-20261030-abcd \"cost is $5 {approx}\"",
    ".agentbay/bay show C-20261030-abcd --json",
)


def _main(cmd, tool="Bash"):
    return main_thread_decision({"tool_name": tool, "tool_input": {"command": cmd}})[0]


def test_main_thread_asks_for_any_spelling_of_the_asked_writes():
    for cmd in ASKED:
        d, why = main_thread_decision({"tool_name": "Bash", "tool_input": {"command": cmd}})
        assert d == "ask" and why.startswith("agentbay: `bay "), cmd
    assert "note dispatch" in main_thread_decision({"tool_name": "Bash", "tool_input": {
        "command": ".agentbay/bay note 'dispatch' T-1 --agent x"}})[1]


def test_main_thread_gives_no_decision_for_reads_and_plain_notes():
    for cmd in NOT_ASKED:
        assert _main(cmd) == "pass", cmd
    assert _main(".agentbay/bay note 'dispatch' T-1", tool="Read") == "pass"
    assert main_thread_decision({"tool_name": "Bash", "tool_input": {}})[0] == "pass"
    assert _main("echo 'unbalanced") == "pass"


def test_guard_decide_routes_the_main_thread_and_leaves_subagents_denied():
    p = built()
    try:
        g = Guard(json.loads((p / ".agentbay/guard.json").read_text()), p)
        for cmd in ASKED:
            main = {"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": str(p)}
            assert g.decide(main)[0] == "ask", cmd
            role = {"agent_id": "a1", "agent_type": next(iter(g.policy["subagents"]))}
            assert g.decide({**main, **role})[0] == "deny", cmd
        for cmd in NOT_ASKED[:9]:
            main = {"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": str(p)}
            assert g.decide(main)[0] == "pass", cmd
            role = next(iter(g.policy["subagents"]))
            assert g.decide({**main, "agent_id": "a1", "agent_type": role})[0] == "deny", cmd
    finally:
        cleanup(p)


def test_expansions_later_in_the_line_do_not_ask():
    for cmd in NOT_ASKED_LATER:
        assert _main(cmd) == "pass", cmd


def _run_main(payload, project):
    """What main() prints and returns for a hook payload on stdin."""
    old_in, old_out, old_env = sys.stdin, sys.stdout, os.environ.get("CLAUDE_PROJECT_DIR")
    sys.stdin, sys.stdout = io.StringIO(json.dumps(payload)), io.StringIO()
    os.environ["CLAUDE_PROJECT_DIR"] = str(project)
    try:
        code = guard.main()
        return code, sys.stdout.getvalue()
    finally:
        sys.stdin, sys.stdout = old_in, old_out
        if old_env is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = old_env


def test_main_prints_the_ask_decision_for_the_main_thread_and_for_agent_sessions():
    p = built()
    try:
        cmd = ".agentbay/bay note 'dispatch' T-20261030-abcd --agent x"
        base = {"tool_name": "Bash", "tool_input": {"command": cmd}, "cwd": str(p)}
        for extra in ({}, {"agent_type": "an-unlisted-agent"}):      # main thread; `--agent` session (no agent_id)
            code, out = _run_main({**base, **extra}, p)
            hook = json.loads(out)["hookSpecificOutput"]
            assert code == 0 and hook["permissionDecision"] == "ask", extra
            assert hook["permissionDecisionReason"].startswith("agentbay: `bay note dispatch`"), extra
        code, out = _run_main({**base, "tool_input": {"command": "ls"}, "agent_type": "an-unlisted-agent"}, p)
        assert code == 0 and out == ""
    finally:
        cleanup(p)


def test_generated_hook_runs_the_guard_for_the_main_threads_bash_calls():
    p = built()
    try:
        s = json.loads((p / ".claude/settings.json").read_text())
        guard = [h for e in s["hooks"]["PreToolUse"] for h in e["hooks"] if "guard.py" in h["command"]]
        entries = [e for e in s["hooks"]["PreToolUse"] if any("guard.py" in h["command"] for h in e["hooks"])]
        assert guard and entries and "Bash" in entries[0]["matcher"].split("|")
        assert "agent_type" not in entries[0] and "agent" not in entries[0]       # no subagent-only filter
    finally:
        cleanup(p)
