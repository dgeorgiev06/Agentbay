"""Ledger: richer events (durations, tokens, cost, permission decisions, instruction changes); notes never
create runs."""
import json
import subprocess
import sys

from helpers import KIT, clock, cleanup, kit_for, model, project, system

from bay import dispatch, ledger
from bay.adapters import get

SCHEMA = json.loads((KIT / "schemas/event.schema.json").read_text())


def valid(evs):
    if model.jsonschema:
        for e in evs:
            model.jsonschema.validate(e, SCHEMA)


def cli(p, *args):
    return subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), *args],
                          capture_output=True, text=True)


def test_note_on_unknown_ref_never_creates_a_running_run():
    p = project()
    try:
        assert cli(p, "note", "C-20261027-abcdef", "decided to skip review").returncode == 0
        assert cli(p, "note", "T-20261027-ab12", "the user changed scope", "--instruction").returncode == 0
        assert cli(p, "note", "anything", "free note").returncode == 0
        evs = ledger.read(p)
        assert ledger.fold(evs) == {}
        st = json.loads(cli(p, "status", "--json").stdout)
        assert st["runs"] == [] and len(st["notes"]) == 3
        assert "RUNNING AGENTS (0)" in cli(p, "status").stdout
        inst = [e for e in evs if (e.get("data") or {}).get("kind") == "instruction-change"]
        assert len(inst) == 1 and inst[0]["taskId"] == "T-20261027-ab12"
        assert evs[0]["callId"] == "C-20261027-abcdef"
        valid(evs)
    finally:
        cleanup(p)


def test_note_attaches_to_existing_run_by_run_id_or_task_id():
    p = project()
    try:
        ledger.append(p, "spawned", "toolu_1", agent="builder", taskId="T-20261027-aa11", summary="build")
        cli(p, "note", "toolu_1", "on the run")
        cli(p, "note", "T-20261027-aa11", "on the task")
        runs = ledger.fold(ledger.read(p))
        assert list(runs) == ["toolu_1"] and runs["toolu_1"].notes == ["on the run", "on the task"]
        assert ledger.standalone_notes(ledger.read(p)) == []
    finally:
        cleanup(p)


def test_code_steps_and_calls_carry_duration_and_cost():
    p = project()
    try:
        dispatch.Dispatcher(system(p), p, clock=clock).call("feed-briefing.sync", {})
        evs = ledger.read(p)
        done = [e for e in evs if e["type"] == "step.completed"][0]
        assert isinstance(done["durationMs"], int)
        call = [e for e in evs if e["type"] == "call.completed"][0]
        assert isinstance(call["durationMs"], int)
        assert ledger.fold_calls(evs)[call["callId"]].duration_ms == call["durationMs"]
        valid(evs)
    finally:
        cleanup(p)


def test_submit_records_reported_usage():
    p = project()
    try:
        d = dispatch.Dispatcher(system(p), p, clock=clock)
        r = d.call("feed-briefing.ask", {"question": "what is new?"})
        prev = r["next"]["previous"]["search"]
        d.submit(r["callId"], "answer", {"answer": "x", "citations": [prev["posts"][0]["url"]],
                                         "coverage": prev["coverage"]},
                 usage={"tokens": {"input": 1200, "output": 300}, "costUsd": 0.02, "durationMs": 4100})
        ev = [e for e in ledger.read(p) if e["type"] == "step.completed" and e.get("step") == "answer"][0]
        assert ev["tokens"] == {"input": 1200, "output": 300} and ev["costUsd"] == 0.02 and ev["durationMs"] == 4100
        valid(ledger.read(p))
    finally:
        cleanup(p)


def test_guard_decisions_are_ledger_events_without_raw_commands():
    p = project()
    try:
        get("claude-code").build(system(p), p, kit_for(p))
        secret = "sk-ant-api03-PLANTEDsecretVALUE0000000000"

        def hook(agent, cmd):
            payload = {"tool_name": "Bash", "tool_input": {"command": cmd}, "agent_type": agent, "agent_id": "ag-1",
                       "session_id": "s-1", "cwd": str(p)}
            return subprocess.run([sys.executable, str(KIT / "bay/guard.py")], input=json.dumps(payload), text=True,
                                  capture_output=True, env={"CLAUDE_PROJECT_DIR": str(p), "PATH": "/usr/bin:/bin"})
        assert hook("feed-analyst", f"curl -H 'Authorization: Bearer {secret}' x").returncode == 2
        assert hook("reviewer", "git status").returncode == 0                       # left to Claude Code's prompt: no event
        assert hook("feed-analyst", ".agentbay/roles/feed-analyst/use feed.store/v1.query '{}'").returncode == 0
        evs = ledger.read(p)
        kinds = [e["type"] for e in evs]
        assert kinds == ["permission.denied"], kinds         # prompts come from transcripts, not the guard
        assert evs[0]["tool"] == "Bash" and evs[0]["agent"] == "feed-analyst" and evs[0]["source"] == "guard"
        raw = (p / ".agentbay/ledger/events.jsonl").read_text()
        assert secret not in raw
        valid(evs)
    finally:
        cleanup(p)


def test_hook_records_agent_duration_and_tokens():
    p = project()
    try:
        payload = {"tool_name": "Agent", "tool_use_id": "toolu_9", "session_id": "s",
                   "tool_input": {"subagent_type": "builder", "prompt": "x"},
                   "tool_response": {"content": [], "totalDurationMs": 5300, "totalTokens": 4400,
                                     "usage": {"input_tokens": 4000, "output_tokens": 400}}}
        r = subprocess.run([sys.executable, str(KIT / "bay/hook.py"), "post"], input=json.dumps(payload), text=True,
                           capture_output=True, env={"CLAUDE_PROJECT_DIR": str(p), "PATH": "/usr/bin:/bin"})
        assert r.returncode == 0
        ev = ledger.read(p)[0]
        assert ev["durationMs"] == 5300 and ev["tokens"] == {"input": 4000, "output": 400, "total": 4400}
        valid([ev])
    finally:
        cleanup(p)


def test_ledger_scrubs_secret_shaped_text_and_stays_valid_json():
    p = project()
    try:
        ledger.append(p, "note", "x", summary="password=hunter2 and Bearer abcdefghijklmnopqrstuvwxyz012345")
        raw = (p / ".agentbay/ledger/events.jsonl").read_text()
        assert "hunter2" not in raw and "abcdefghijklmnopqrstuvwxyz012345" not in raw
        assert json.loads(raw)["summary"].startswith("[REDACTED:password]")
    finally:
        cleanup(p)


def test_secret_scan_catches_planted_secrets_but_not_code_expressions():
    from bay import secretscan
    from improve_fixtures import CORES, SECRETS
    for kind, value in SECRETS.items():
        assert not any(c in secretscan.scrub(f"x {value} y") for c in CORES), kind
    for code in ('secret = self.ctx.secrets.get("X_CLIENT_SECRET", optional=True)', "password = getpass.getpass()",
                 "pwd = args.password", "token = refresh_token_for(user)"):
        assert secretscan.scrub(code) == code, code
    cut = "x" * 290 + " " + SECRETS["api-key"]
    assert "sk-ant" not in secretscan.clip(cut, 300) and "sk-ant" in cut[:300]       # cutting first would leak
