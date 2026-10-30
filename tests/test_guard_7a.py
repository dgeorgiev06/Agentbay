"""Review 7a F-2 (guard de-quoting) and F-7 (claude-code adapter asks/denies for approvals and the owner's config)."""
import json

from helpers import cleanup

from bay.guard import Guard
from test_boundaries import built


def _decide(g, tool_name, ti, agent=None):
    payload = {"tool_name": tool_name, "tool_input": ti, "cwd": str(g.project), "agent_id": "a1"}
    if agent:
        payload["agent_type"] = agent
    return g.decide(payload)[0]


def test_f2_unparseable_or_quoted_commands_naming_the_config_are_denied_for_a_generic_subagent():
    p = built()
    try:
        g = Guard(json.loads((p / ".agentbay/guard.json").read_text()), p)
        for cmd in ("cp /tmp/c agentbay.conf''ig.yaml", "cp /tmp/c agentbay.config.ya\\ml",
                    "cat /tmp/c > agentbay.conf\"ig\".yaml", "cat /tmp/c > AGENTBAY.CONF''IG.yaml",
                    "ln -s ../agentbay.conf''ig.yaml sub/x", "echo x > agentbay.conf'ig.yaml"):
            assert _decide(g, "Bash", {"command": cmd}) == "deny", cmd
        for cmd in ("echo x >> .agent''bay/ledger/events.jsonl", "cat /tmp/l > .agentbay/ledger/events.jsonl",
                    "cp /tmp/l .agent\"\"bay/ledger/events.jsonl", "sed -i s/a/b/ .agent\\bay/ledger/events.jsonl"):
            assert _decide(g, "Bash", {"command": cmd}) == "deny", cmd
        role = next(iter(g.policy["subagents"]))
        assert _decide(g, "Bash", {"command": "cp /tmp/c agentbay.conf''ig.yaml"}, agent=role) == "deny"
        assert _decide(g, "Bash", {"command": "ls src"}) == "pass"
    finally:
        cleanup(p)


def test_f2_a_non_dict_ledger_line_does_not_break_the_plan_check():
    p = built()
    try:
        g = Guard(json.loads((p / ".agentbay/guard.json").read_text()), p)
        led = p / ".agentbay/ledger/events.jsonl"
        led.parent.mkdir(parents=True, exist_ok=True)
        led.write_text("[1]\nnull\n" + json.dumps({"type": "agent.dispatch", "taskId": "T-20261030-abcd",
                                                   "agent": "x y"}) + "\n")
        role = next(iter(g.policy["subagents"]))
        assert _decide(g, "Bash", {"command": ".agentbay/bay plan T-20261030-abcd --done 1"}, agent=role) == "deny"
    finally:
        cleanup(p)


def test_f7_adapter_asks_before_bay_approve_variants_and_denies_edits_of_the_owners_config():
    p = built()
    try:
        s = json.loads((p / ".claude/settings.json").read_text())
        perms = s["permissions"]
        asks = " ".join(perms.get("ask", []))
        for needle in ("bay approve", "bay.sh approve", "bay.cli approve", "bay/cli.py approve"):
            assert needle in asks, (needle, perms.get("ask"))
        # the writes that share a prefix with a pre-approved command keep their prompt (ask is checked before allow)
        for verb in ("show reclaim", "note dispatch", "note review"):
            assert f"Bash(.agentbay/bay {verb}:*)" in perms["ask"], (verb, perms.get("ask"))
        # every canonical write form is matched by an ask rule (a prefix), and every pre-approved prefix is only
        # reachable for a read: a write verb under an allow prefix must start with its ask prefix
        asked = [x[len("Bash("):-len(":*)")] for x in perms["ask"]]
        for form in (".agentbay/bay note dispatch T-1 --agent x", ".agentbay/bay note review T-1 {}",
                     ".agentbay/bay show reclaim R-1 --reason r", ".agentbay/bay approve C-1"):
            assert any(form.startswith(a) for a in asked), form
        allowed = [x[len("Bash("):-len(":*)")] for x in perms["allow"] if x.startswith("Bash(.agentbay/bay ")]
        assert sorted(allowed) == [".agentbay/bay " + c for c in ("catalog", "note", "show", "status")]
        deny = perms.get("deny", []) + perms.get("ask", [])
        assert any(x.startswith("Edit(") and "agentbay.config.yaml" in x for x in deny), deny
        assert not any("approve" in x for x in perms.get("allow", []))
    finally:
        cleanup(p)
