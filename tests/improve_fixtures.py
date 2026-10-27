"""Fixtures for improve: Claude Code transcripts, a ledger with calls/verdicts, a git repo. All in temp dirs.

Planted secrets (SECRETS) appear in user text, tool inputs, tool results, attachments, subagent meta,
spilled tool output, ledger notes and review evidence. Tests assert none of their cores (CORES) ever
reach the improve store, the ledger, call state, reports or outputs.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

SECRETS = {
    "api-key": "sk-ant-api03-PLANTEDkeyAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "bearer": "Bearer PLANTEDbearerTOKEN1234567890abcdef",
    "private-key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpPLANTEDprivateKEYmaterial0000\n-----END RSA PRIVATE KEY-----",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJQTEFOVEVEand0In0.PLANTEDjwtSIGNATUREabc123",
    "password": "password=PLANTEDhunter2pass",
    "connection-string": "postgres://admin:PLANTEDdbPass@db.internal:5432/prod",
}
CORES = ["PLANTEDkeyAAAA", "PLANTEDbearerTOKEN", "MIIEpPLANTEDprivateKEY", "PLANTEDjwtSIGNATURE",
         "PLANTEDhunter2pass", "PLANTEDdbPass"]
ALL = " ".join(SECRETS.values())


def _w(path: Path, records: list, tail: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records) + tail, encoding="utf-8")


def chain(sid: str, cwd: str, n: int, minute: int) -> dict:
    return {"uuid": f"u{n}", "parentUuid": f"u{n - 1}" if n else None, "sessionId": sid,
            "timestamp": f"2026-10-25T10:{minute:02d}:00Z", "cwd": cwd, "version": "2.1.300",
            "gitBranch": "feat/secret-branch", "isSidechain": False, "userType": "external", "entrypoint": "cli"}


def session_records(sid: str, cwd: str, reviewer_spawns: int = 2) -> list:
    c = lambda n, m: chain(sid, cwd, n, m)          # noqa: E731
    bash = {"command": f"curl -H 'Authorization: {SECRETS['bearer']}' https://api.example.com"}
    recs = [
        {**c(0, 0), "type": "user", "message": {"role": "user", "content": f"deploy it, the key is {SECRETS['api-key']}"}},
        {**c(1, 1), "type": "attachment", "attachment": {"type": "memory", "content": SECRETS["private-key"]}},
    ]
    n = 2
    for i in range(3):                              # three identical Bash calls, one errors
        recs.append({**c(n, 2 + i), "type": "assistant", "requestId": f"r{i}",
                     "message": {"id": f"msg{i}", "model": "claude-opus-5-5", "role": "assistant",
                                 "content": [{"type": "tool_use", "id": f"tu{i}", "name": "Bash", "input": bash}],
                                 "usage": {"input_tokens": 100, "output_tokens": 20, "cache_read_input_tokens": 1000,
                                           "cache_creation_input_tokens": 0}}})
        recs.append({**c(n + 1, 2 + i), "type": "user", "sourceToolAssistantUUID": f"u{n}",
                     "permissionDecision": {"decision": "accept", "source": "user", "reasonType": "x"},
                     "toolUseResult": {"stdout": SECRETS["password"], "stderr": "", "interrupted": False},
                     "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"tu{i}",
                                                              "content": SECRETS["connection-string"],
                                                              "is_error": i == 0}]}})
        n += 2
    recs.append({**c(n, 6), "type": "assistant", "message": {"id": "msgE", "model": "claude-opus-5-5", "content": [
        {"type": "tool_use", "id": "tuE", "name": "Edit", "input": {"file_path": "/etc/x", "old_string": SECRETS["jwt"]}}]}})
    recs.append({**c(n + 1, 6), "type": "user", "toolDenialKind": "user-rejected", "message": {"content": [
        {"type": "tool_result", "tool_use_id": "tuE", "content": "The user doesn't want to proceed", "is_error": True}]}})
    n += 2
    for k in range(reviewer_spawns):
        recs.append({**c(n, 7 + k), "type": "assistant", "message": {"id": f"msgA{k}", "model": "claude-opus-5-5", "content": [
            {"type": "tool_use", "id": f"tuA{k}", "name": "Agent",
             "input": {"subagent_type": "reviewer", "description": "review", "prompt": f"review with {SECRETS['jwt']}"}}]}})
        recs.append({**c(n + 1, 8 + k), "type": "user", "toolUseResult": {"status": "completed", "agentId": f"agent-a{k}"},
                     "message": {"content": [{"type": "tool_result", "tool_use_id": f"tuA{k}", "content": "done"}]}})
        n += 2
    recs += [
        {**c(n, 12), "type": "user", "message": {"content": [{"type": "text", "text": "[Request interrupted by user]"}]}},
        {"type": "queue-operation", "operation": "enqueue", "timestamp": "2026-10-25T10:13:00Z",
         "content": f"also rotate {SECRETS['password']}"},
        {"type": "system", "subtype": "stop_hook_summary", "timestamp": "2026-10-25T10:14:00Z", "hookCount": 1,
         "hookInfos": [{"command": f"echo {SECRETS['api-key']}", "durationMs": 120}], "hookErrors": []},
        {"type": "last-prompt", "lastPrompt": SECRETS["api-key"]},
        {"type": "pr-link", "prNumber": 3, "prUrl": "https://github.com/x/y/pull/3", "prRepository": "x/y"},
        {"type": "weird-new-type", "payload": SECRETS["password"]},
        {"type": "cost-state", "totalCostUSD": 2.5, "totalDuration": 900000, "totalAPIDuration": 1,
         "modelUsage": {"claude-opus-5-5": {"inputTokens": 1, "outputTokens": 1, "costUSD": 2.5}}},
    ]
    return recs


def make_transcripts(root: Path, project: Path, sessions: int = 2) -> dict[str, Path]:
    """`sessions` sessions in `project` (+1 in another project), each with a subagent and spill file, and a
    half-written last line. Returns {session id: file}."""
    out = {}
    for i in range(sessions):
        sid = f"0a1b2c3d-0000-4000-8000-00000000000{i}"
        f = root / "-encoded-project" / f"{sid}.jsonl"
        _w(f, session_records(sid, str(project)), tail='{"type": "assistant", "message": {"id": "half')
        sub = root / "-encoded-project" / sid / "subagents"
        _w(sub / "agent-a0.jsonl", [{**chain(sid, str(project), 0, 9), "type": "assistant", "isSidechain": True,
                                      "message": {"id": "s1", "model": "claude-sonnet-4-6", "content": [
                                          {"type": "text", "text": f"found {SECRETS['api-key']}"}],
                                          "usage": {"input_tokens": 10, "output_tokens": 5}}},
                                     {**chain(sid, str(project), 1, 11), "type": "assistant", "isSidechain": True,
                                      "message": {"id": "s2", "content": []}}])
        (sub / "agent-a0.meta.json").write_text(json.dumps({"agentType": "reviewer", "isBuiltIn": False,
                                                            "description": f"secret {SECRETS['bearer']}",
                                                            "toolUseId": "tuA0", "finished": True}))
        (sub / "agent-a0.prefix.json").write_text(json.dumps({"cache": SECRETS["api-key"]}))
        tr = root / "-encoded-project" / sid / "tool-results"
        tr.mkdir(parents=True, exist_ok=True)
        (tr / "big.txt").write_text(ALL * 10)
        out[sid] = f
    other = root / "-other" / "ffffffff-0000-4000-8000-000000000009.jsonl"
    _w(other, session_records("ffffffff-0000-4000-8000-000000000009", "/somewhere/else"))
    (root / "ccr-tip.json").write_text("{}")
    return out


def ev(ts: str, type: str, run: str, **kw) -> dict:
    return {"v": 1, "ts": ts, "type": type, "runId": run, **kw}


def make_ledger(project: Path) -> list[str]:
    """Calls with slow steps, review rounds with repeated/lintable/scope failures, guard denials and
    instruction-change notes. Returns the call ids."""
    led = project / ".agentbay" / "ledger" / "events.jsonl"
    led.parent.mkdir(parents=True, exist_ok=True)
    calls = project / ".agentbay" / "calls"
    calls.mkdir(parents=True, exist_ok=True)
    evs, ids = [], []
    for i in range(3):
        cid = f"C-20261025-00000{i}"
        ids.append(cid)
        base = {"callId": cid, "mode": "forge", "endpoint": "extend", "source": "dispatcher"}
        t = f"2026-10-25T1{i}:00:00+00:00"
        evs += [ev(t, "step.planned", f"{cid}:implement", step="implement", role="builder", **base),
                ev(t, "step.completed", f"{cid}:implement", step="implement", role="builder", agent="framework-builder",
                   env="framework-dev", durationMs=2_400_000 + i, costUsd=1.5, tokens={"input": 9000, "output": 900}, **base),
                ev(t, "step.completed", f"{cid}:review", step="review", role="reviewer", durationMs=60_000, **base),
                ev(t, "call.completed", cid, durationMs=2_500_000, costUsd=1.5, data={"status": "partial"}, **base)]
        verdict = {"items": [
            {"id": "DOD-5", "verdict": "fail", "severity": "blocker",
             "evidence": f"tests/run.py fails: 2 failed; also saw {SECRETS['password']}"},
            {"id": "DOD-7", "verdict": "fail", "severity": "should-fix",
             "evidence": "adds bay/extra.py, outside the approved proposal"},
            {"id": "R-3", "verdict": "pass", "evidence": "lint clean"}]}
        (calls / f"{cid}.json").write_text(json.dumps({
            "callId": cid, "target": "forge.extend", "input": {"goal": "add the improve mode", "proposal": "docs/proposals/0002.md"},
            "status": "partial", "steps": {"propose": {"status": "done", "summary": "x"}, "review": verdict}}))
    evs += [ev("2026-10-25T10:30:00+00:00", "permission.denied", "agent-1", source="guard", agent="builder", tool="Bash",
               reason="agentbay: role builder may only run ..."),
            ev("2026-10-25T10:31:00+00:00", "permission.denied", "agent-1", source="guard", agent="builder", tool="Bash"),
            ev("2026-10-25T11:30:00+00:00", "permission.denied", "agent-2", source="guard", agent="builder", tool="Bash"),
            ev("2026-10-25T10:40:00+00:00", "note", ids[0], source="coordinator", callId=ids[0],
               summary=f"user changed the goal; token {SECRETS['bearer']}", data={"kind": "instruction-change"}),
            ev("2026-10-25T11:40:00+00:00", "note", ids[1], source="coordinator", callId=ids[1],
               summary="user added a requirement", data={"kind": "instruction-change"}),
            ev("2026-10-25T11:41:00+00:00", "note", "free", source="coordinator", summary="plain note")]
    led.write_text("".join(json.dumps(e) + "\n" for e in evs))
    return ids


def git(repo: Path, *args: str) -> str:
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@x",
           "GIT_AUTHOR_DATE": "2026-10-25T10:00:00Z", "GIT_COMMITTER_DATE": "2026-10-25T10:00:00Z",
           "HOME": str(repo), "PATH": "/usr/bin:/bin:/usr/local/bin"}
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def make_git_repo(repo: Path, churn: int = 5) -> str:
    """A repo with `churn` commits on hot.py, one bad commit and its revert (with a secret in the message)."""
    repo.mkdir(parents=True, exist_ok=True)
    git(repo, "init", "-q", "-b", "main")
    for i in range(churn):
        (repo / "hot.py").write_text(f"x = {i}\n")
        git(repo, "add", "hot.py")
        git(repo, "commit", "-q", "-m", f"tweak {i}")
    (repo / "bad.py").write_text("boom\n")
    git(repo, "add", "bad.py")
    git(repo, "commit", "-q", "-m", f"add bad ({SECRETS['password']})")
    bad = git(repo, "rev-parse", "HEAD")
    git(repo, "revert", "--no-edit", bad)
    return bad
