#!/usr/bin/env python3
"""Claude Code hook -> ledger events. Wired by the claude_code adapter.

  PreToolUse  (matcher Task|Agent) -> spawned
  PostToolUse (matcher Task|Agent) -> completed / failed

Never blocks the session: any error is logged and the hook exits 0.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bay import ledger, protocol  # noqa: E402


def _run_id(payload: dict) -> str:
    if payload.get("tool_use_id"):
        return payload["tool_use_id"]
    ti = payload.get("tool_input") or {}
    raw = f"{payload.get('session_id')}|{ti.get('subagent_type')}|{ti.get('prompt', '')[:2000]}"
    return "r-" + hashlib.sha1(raw.encode()).hexdigest()[:12]


def _text(resp) -> str:
    return resp if isinstance(resp, str) else json.dumps(resp, ensure_ascii=False)


def handle(phase: str, payload: dict) -> None:
    project = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
    ti = payload.get("tool_input") or {}
    agent = ti.get("subagent_type") or "general-purpose"
    run_id = _run_id(payload)
    task_id = protocol.task_id_from(ti.get("prompt", ""))

    if phase == "pre":
        ledger.append(project, "spawned", run_id, agent=agent, taskId=task_id,
                      sessionId=payload.get("session_id"), source="hook",
                      summary=ti.get("description", ""))
        return

    resp = payload.get("tool_response")
    text = _text(resp)
    blocks = protocol.parse_blocks(text.replace("\\n", "\n"))
    res = blocks.get("result", {})
    status = res.get("status", "unknown").split()[0] if res else "unknown"
    etype = "failed" if status == "failed" else "completed"
    ledger.append(project, etype, run_id, agent=agent, taskId=task_id or res.get("taskId"),
                  sessionId=payload.get("session_id"), source="hook",
                  summary=res.get("summary") or ti.get("description", ""),
                  data={"status": status}, **usage(resp))


def usage(resp) -> dict:
    """durationMs / tokens the runtime reports for an Agent run, read defensively (shape is not a stable API)."""
    if not isinstance(resp, dict):
        return {}
    out: dict = {}
    if isinstance(resp.get("totalDurationMs"), (int, float)):
        out["durationMs"] = int(resp["totalDurationMs"])
    u = resp.get("usage") if isinstance(resp.get("usage"), dict) else {}
    tok = {k: int(u[src]) for k, src in (("input", "input_tokens"), ("output", "output_tokens"),
                                         ("cacheRead", "cache_read_input_tokens"),
                                         ("cacheCreation", "cache_creation_input_tokens"))
           if isinstance(u.get(src), (int, float))}
    if isinstance(resp.get("totalTokens"), (int, float)):
        tok["total"] = int(resp["totalTokens"])
    if tok:
        out["tokens"] = tok
    return out


def main() -> int:
    phase = sys.argv[1] if len(sys.argv) > 1 else "pre"
    try:
        payload = json.load(sys.stdin)
        if payload.get("tool_name") in ("Task", "Agent"):
            handle(phase, payload)
    except Exception:  # never break the session
        try:
            log = ledger.project_root() / ".agentbay" / "ledger" / "hook-errors.log"
            log.parent.mkdir(parents=True, exist_ok=True)
            log.open("a").write(f"{ledger.now()} {phase}\n{traceback.format_exc()}\n")
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
