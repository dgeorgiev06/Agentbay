"""Text rendering for improve: the weekly backlog report and implement's handoff drafts. Pure functions;
the store writes what they return (after a secret scan)."""
from __future__ import annotations


def backlog(items: list[dict], counts: dict, week: str, generated: str) -> str:
    lines = [f"# improve backlog {week}", "",
             f"Generated {generated}. " + ", ".join(f"{n} {s}" for s, n in counts.items() if n) + ".", "",
             "Decide each item in your own terminal: `.agentbay/bay improve decide <id> approve|defer|wontfix`.",
             "Approved items are implemented only on demand: `.agentbay/bay call improve.implement "
             "'{\"id\": \"<id>\"}'`.", ""]
    if not items:
        lines.append("Nothing open.")
    for n, f in enumerate(items, 1):
        lines += [f"## {n}. {f['title']}", "",
                  f"`{f['id']}` | {f['lens']}/{f['kind']} | severity {f['severity']} | priority {f['priority']} "
                  f"| status **{f['status']}** | route {f.get('route', '-')}", "",
                  f"- **Pattern:** {f['pattern']}"]
        if f.get("measure"):
            lines.append("- **Measurement:** " + ", ".join(f"{k}={v}" for k, v in f["measure"].items()))
        lines.append("- **Evidence:**")
        for e in f["evidence"][:5]:
            d = f" - {e['detail']}" if e.get("detail") else ""
            r = f" -> `{e['rewrite']}`" if e.get("rewrite") else ""
            lines.append(f"  - {e['kind']} `{e['ref']}`{d}{r}")
        if len(f["evidence"]) > 5:
            lines.append(f"  - ... {len(f['evidence']) - 5} more (improve.findings/v1.query)")
        lines.append(f"- **Root cause:** {f.get('rootCause') or 'not analysed yet (improve.triage)'}")
        lines.append(f"- **Proposed fix:** {f.get('proposedFix') or '-'}")
        if f.get("links"):
            lines.append(f"- **Linked:** {', '.join(f['links'])}")
        lines.append("")
    return "\n".join(lines) + "\n"


def handoff(f: dict, draft: dict, task_id: str) -> tuple[str, str, dict]:
    """(file name, body, next) for an approved finding: a forge.extend proposal draft or a task envelope."""
    route = draft.get("route") or f.get("route") or "mode-fix"
    ev = draft.get("evidence") or [f"{e['kind']} {e['ref']}" for e in f["evidence"][:8]]
    if route == "forge.extend":
        body = "\n".join([
            f"# Proposal draft: {draft['title']}", "",
            f"Status: draft from improve finding {f['id']}. File it with forge.extend (its propose step writes "
            f"docs/proposals/<id>.md); nothing is implemented before that call's approval gate.", "",
            "## Problem", draft["problem"], "", "## Evidence", *[f"- {x}" for x in ev], "",
            "## Change", draft["change"], "",
            "## Compatibility", draft.get("compatibility") or "No contract change expected.", "",
            "## Tests", *[f"- {t}" for t in draft.get("tests") or ["(to be listed by forge.extend)"]], ""])
        return f"{f['id']}.proposal.md", body, {"call": "forge.extend",
                                                 "input": {"goal": draft["title"][:200], "context": body}}
    env = draft.get("envelope") or {}
    ctx = draft["problem"] + "\n\nEvidence:\n" + "\n".join(f"- {x}" for x in ev) + "\n\nChange:\n" + draft["change"]
    body = "\n".join([
        "```task", "protocol: TaskEnvelope/v1", f"taskId: {task_id}",
        f"goal: {env.get('goal') or draft['title']}", "context: |", *[f"  {ln}" for ln in ctx.splitlines()],
        "constraints:", *[f"  - {c}" for c in env.get("constraints") or
                          ["change only the mode named in the finding", "bay lint and validate stay clean"]],
        f"deliverable: {env.get('deliverable') or draft['change'][:300]}", "```", ""])
    return f"{f['id']}.task.md", body, {"envelope": body,
                                         "how": "the Chief of Staff hands this to forge.create or the builder role"}
