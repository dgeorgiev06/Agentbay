"""TaskEnvelope/v1 and Result/v1: the coordinator <-> worker wire format.

Both travel as fenced YAML blocks inside plain text, so they work over any
runtime that can pass a prompt and return a message. Parsing is lenient:
a worker that forgets the block still produces a usable 'unknown' result.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

_BLOCK = re.compile(r"```(task|result)\s*\n(.*?)```", re.S)
_FIELD = re.compile(r"^\s*(\w+)\s*:\s*(.+?)\s*$", re.M)

WORKER_CONTRACT = """\
## Protocol (agentbay TaskEnvelope/v1 -> Result/v1)

Your prompt starts with a ```task block. Treat `goal`, `deliverable` and
`constraints` as the definition of done. Stay inside your tools; if the task
needs something you do not have, stop and report `blocked` instead of
improvising.

End your final message with exactly one block:

```result
protocol: Result/v1
taskId: <taskId from the task block>
status: done | partial | blocked | failed
summary: <2-5 sentences: what you did and what you found>
artifacts: [<paths or URLs you created>]
followups: [<work you noticed but did not do>]
blockers: [<only if blocked/failed>]
```
"""


def new_task_id() -> str:
    return f"T-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2)}"


def _fields(body: str) -> dict:
    return {k: v.strip().strip('"') for k, v in _FIELD.findall(body)}


def parse_blocks(text: str) -> dict[str, dict]:
    """Return the LAST task and result block found in text."""
    out: dict[str, dict] = {}
    for kind, body in _BLOCK.findall(text or ""):
        out[kind] = _fields(body)
    return out


def task_id_from(text: str) -> str | None:
    m = re.search(r"taskId\s*:\s*(T-[0-9]{8}-[0-9a-z]{4})", text or "")
    return m.group(1) if m else None
