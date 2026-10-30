"""Main-thread guard decisions (0008 stage 3, DOD-2): the writes that ask rules cover by prefix text also ask when the
verb is quoted or escaped, because the hook judges the shell words."""
import json

from helpers import cleanup

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
