"""Deterministic session detectors (improve.scan).

Input: session.episode/v1 episodes (ledger, claude-transcripts, git) and review verdicts.
Output: candidate improve.finding/v1 dicts (no id/status yet; the store assigns those).
A recurring pattern needs evidence from >= 2 episodes unless it is marked severe (rules R-2 of scan).
Every detector is a pure function of (data, thresholds) so `verify` can re-run it on new data.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict

from .. import checks

DEFAULTS = {"reviewRounds": 1, "ruleRepeat": 2, "slowStepMs": 600_000, "costlyStepUsd": 1.0,
            "costlySessionUsd": 10.0, "repeatCalls": 3, "permissionEvents": 3, "interrupts": 2,
            "churnCommits": 5, "severeFactor": 3}
CHECK_CITED = re.compile(r"\b(" + "|".join(sorted(checks.REGISTRY)) + r"|bay lint|\blint\b|validate|tests?/|"
                         r"run\.py|pytest|unit tests?|failing tests?|tests? fail\w*)", re.I)
SCOPE = re.compile(r"\b(out of scope|out-of-scope|outside (the )?(approved )?(scope|proposal|deliverable)|"
                   r"beyond (the )?(approved )?(scope|proposal|deliverable|task)|not in the proposal|unapproved|"
                   r"scope creep|not requested|unrequested|scope:)", re.I)
REVIEWER = re.compile(r"review", re.I)


def candidate(kind: str, key: str, title: str, pattern: str, evidence: list[dict], scope: dict,
              severity: str = "medium", measure: dict | None = None, fix: str | None = None) -> dict:
    eps = sorted({e["ref"] for e in evidence if e["kind"] == "episode"})
    out = {"lens": "sessions", "kind": kind, "title": title, "pattern": pattern, "evidence": evidence,
           "scope": scope, "severity": severity, "occurrences": max(1, len(eps) or len(evidence)),
           "detector": {"name": kind, "key": key}}
    if measure:
        out["measure"] = measure
    if fix:
        out["proposedFix"] = fix
    return out


def _recurring(evidence: list[dict], severe: bool) -> bool:
    return severe or len({e["ref"] for e in evidence if e["kind"] == "episode"}) >= 2


def _scope_of_target(target: str) -> dict:
    mode, _, feat = target.partition(".")
    return {"mode": mode, "feature": feat} if feat else {"mode": mode}


# ----------------------------------------------------------------------------- review verdicts
def review_rounds(data: dict, th: dict) -> list[dict]:
    out = []
    by_target: dict[str, list] = defaultdict(list)
    rounds: Counter = Counter()
    for v in data["verdicts"]:
        rounds[(v["target"], v["subject"])] += 1
        by_target[v["target"]].append(v)
    for target, vs in by_target.items():
        heavy = {s for (t, s), n in rounds.items() if t == target and n > th["reviewRounds"]}
        if not heavy:
            continue
        ev = [{"kind": "episode", "ref": v["episode"], "detail": f"round {v['round']} of {v['subject']}"}
              for v in vs if v["subject"] in heavy]
        worst = max(n for (t, s), n in rounds.items() if t == target)
        out.append(candidate("review-rounds", target, f"{target} needs {worst} review rounds",
                             f"{len(heavy)} subject(s) of {target} went through more than {th['reviewRounds']} "
                             f"review round(s)", ev, _scope_of_target(target), "medium",
                             {"maxRounds": worst, "subjects": len(heavy)},
                             "Find the DoD/rule ids that fail in round 1 and turn them into checks or clearer "
                             "playbook steps."))
    # Claude Code sessions that spawned a reviewer subagent more than once
    ev = []
    for e in data["episodes"]:
        n = sum(1 for s in e.get("subagents", []) if REVIEWER.search(s.get("type", "")))
        if e.get("kind") == "session" and n > th["reviewRounds"]:
            ev.append({"kind": "episode", "ref": e["id"], "detail": f"{n} reviewer subagents", "value": n})
    if ev and _recurring(ev, False):
        out.append(candidate("review-rounds", "claude-code-sessions", "Sessions run several review rounds",
                             f"{len(ev)} sessions spawned a reviewer subagent more than {th['reviewRounds']} time(s)",
                             ev, {"framework": "claude-code sessions"}, "medium",
                             {"sessions": len(ev), "maxRounds": max(x["value"] for x in ev)}))
    return out


def rule_repeat(data: dict, th: dict) -> list[dict]:
    fails: dict[tuple, list] = defaultdict(list)
    for v in data["verdicts"]:
        for it in v["items"]:
            if it.get("verdict") == "fail":
                fails[(v["target"], it["id"])].append((v, it))
    out = []
    for (target, rid), hits in fails.items():
        if len(hits) < th["ruleRepeat"]:
            continue
        ev = [{"kind": "episode", "ref": v["episode"], "detail": f"{rid} failed ({it.get('severity', '-')})"}
              for v, it in hits]
        text = next((it.get("text") for _, it in hits if it.get("text")), "")
        out.append(candidate("rule-repeat", f"{target}:{rid}", f"{target} {rid} keeps failing review",
                             f"{rid} failed in {len(hits)} reviews" + (f": {text[:120]}" if text else ""),
                             ev, {**_scope_of_target(target), "rule": rid}, "high" if len(hits) > 2 else "medium",
                             {"failures": len(hits)},
                             "Make the rule a deterministic check (rules.yaml `check:`) or add the missing step "
                             "to the playbook so the executor meets it before review."))
    return out


def lintable_blocker(data: dict, th: dict) -> list[dict]:
    hits: dict[tuple, list] = defaultdict(list)
    for v in data["verdicts"]:
        for it in v["items"]:
            if it.get("verdict") == "fail" and it.get("severity") == "blocker" and \
                    CHECK_CITED.search(it.get("evidence", "")):
                hits[(v["target"], it["id"])].append((v, it))
    out = []
    for (target, rid), hs in hits.items():
        cited = sorted({m.group(1).lower() for _, it in hs for m in CHECK_CITED.finditer(it.get("evidence", ""))})
        ev = [{"kind": "episode", "ref": v["episode"], "detail": f"blocker {rid} cites {', '.join(cited)}"}
              for v, it in hs]
        out.append(candidate("lintable-blocker", f"{target}:{rid}", f"{target}: blocker {rid} was a check's job",
                             f"review blocker {rid} cites {', '.join(cited)}; a check before review would have "
                             f"caught it", ev, {**_scope_of_target(target), "rule": rid}, "severe",
                             {"blockers": len(hs)},
                             "Add a deterministic check (or a lint rule) for this and reference it from the rule's "
                             "`check:` so it fails before review."))
    return out


def out_of_scope(data: dict, th: dict) -> list[dict]:
    hits: dict[str, list] = defaultdict(list)
    for v in data["verdicts"]:
        for it in v["items"]:
            if it.get("verdict") == "fail" and (SCOPE.search(it.get("evidence", "")) or
                                                re.search(r"\bscope\b", it.get("text", ""), re.I)):
                hits[v["target"]].append((v, it))
    out = []
    for target, hs in hits.items():
        ev = [{"kind": "episode", "ref": v["episode"], "detail": f"{it['id']} failed on scope"} for v, it in hs]
        if not _recurring(ev, False):
            continue
        out.append(candidate("out-of-scope", target, f"{target} adds unapproved scope",
                             f"reviewers flagged out-of-scope additions in {len(ev)} runs", ev,
                             _scope_of_target(target), "medium", {"runs": len(ev)},
                             "State the deliverable list in the task envelope and add a rule that lists files "
                             "outside it as a fail."))
    return out


# ----------------------------------------------------------------------------- episodes
def instruction_changes(data: dict, th: dict) -> list[dict]:
    groups: dict[str, list] = defaultdict(list)
    for e in data["episodes"]:
        if e.get("instructionChanges"):
            groups[e.get("target") or ("claude-code-sessions" if e["source"] == "claude-transcripts" else "agentbay-runs")]\
                .append(e)
    out = []
    for key, eps in groups.items():
        ev = [{"kind": "episode", "ref": e["id"], "detail": f"{e['instructionChanges']} change(s)",
               "value": e["instructionChanges"]} for e in eps]
        if not _recurring(ev, False):
            continue
        scope = _scope_of_target(key) if "." in key else {"framework": key}
        out.append(candidate("instruction-change", key, f"Instructions change mid-run ({key})",
                             f"{len(eps)} episodes had mid-run instruction changes "
                             f"({sum(x['value'] for x in ev)} in total)", ev, scope, "medium",
                             {"episodes": len(eps), "changes": sum(x["value"] for x in ev)},
                             "Capture the missing requirement up front: add it to the input type or the playbook's "
                             "Inputs, or ask for it before the first agentic step."))
    return out


def _step_units(data: dict):
    """(key, episode id, durationMs, costUsd) for dispatcher steps and Claude Code subagents/sessions."""
    for e in data["episodes"]:
        if e["kind"] == "call":
            for st in e.get("steps", []):
                yield st.get("name", st["id"]), e["id"], st.get("durationMs"), st.get("costUsd"), "step"
        elif e["kind"] == "subagent":
            yield f"subagent:{e.get('agentType', '?')}", e["id"], e.get("durationMs"), e.get("costUsd"), "subagent"
        elif e["kind"] == "session":
            yield "claude-code-session", e["id"], None, e.get("costUsd"), "session"


def slow_steps(data: dict, th: dict) -> list[dict]:
    out = []
    for metric, lim_key, unit in (("durationMs", "slowStepMs", "ms"), ("costUsd", "costlyStepUsd", "usd")):
        groups: dict[str, list] = defaultdict(list)
        for key, eid, ms, usd, what in _step_units(data):
            val = ms if metric == "durationMs" else usd
            lim = th["costlySessionUsd"] if (what == "session" and metric == "costUsd") else th[lim_key]
            if isinstance(val, (int, float)) and val > lim:
                groups[key].append((eid, val, lim))
        for key, hits in groups.items():
            worst = max(v for _, v, _ in hits)
            lim = hits[0][2]
            severe = worst >= th["severeFactor"] * lim
            ev = [{"kind": "episode", "ref": eid, "detail": f"{v:.0f} {unit}" if unit == "ms" else f"${v:.2f}",
                   "value": v} for eid, v, _ in hits]
            if not _recurring(ev, severe):
                continue
            kind = "slow-step" if metric == "durationMs" else "costly-step"
            vals = sorted(v for _, v, _ in hits)
            target = key.rsplit(".", 1)[0] if key.count(".") >= 2 else key
            scope = {**_scope_of_target(target), "step": key.rsplit(".", 1)[-1]} if key.count(".") >= 2 \
                else {"framework": key}
            out.append(candidate(kind, key, f"{key} is {'slow' if kind == 'slow-step' else 'costly'}",
                                 f"{len(hits)} run(s) of {key} exceeded {lim} {unit} (median {vals[len(vals) // 2]:.0f}, "
                                 f"max {worst:.0f})" if unit == "ms" else
                                 f"{len(hits)} run(s) of {key} cost more than ${lim} (max ${worst:.2f})",
                                 ev, scope, "severe" if severe else "medium",
                                 {"count": len(hits), "max": worst, "median": vals[len(vals) // 2], "threshold": lim,
                                  "unit": unit}))
    return out


def retries(data: dict, th: dict) -> list[dict]:
    groups: dict[str, list] = defaultdict(list)
    for e in data["episodes"]:
        c = Counter((t["name"], t.get("inputHash")) for t in e.get("toolCalls", []) if t.get("inputHash"))
        for (name, _h), n in c.items():
            if n >= th["repeatCalls"]:
                groups[name].append((e["id"], n))
    out = []
    for tool, hits in groups.items():
        worst = max(n for _, n in hits)
        severe = worst >= th["severeFactor"] * th["repeatCalls"]
        ev = [{"kind": "episode", "ref": eid, "detail": f"{n} identical {tool} calls", "value": n} for eid, n in hits]
        if not _recurring(ev, severe):
            continue
        out.append(candidate("retry-loop", tool, f"Repeated identical {tool} calls",
                             f"{len(hits)} episodes repeated an identical {tool} call >= {th['repeatCalls']} times "
                             f"(max {worst})", ev, {"framework": f"tool {tool}"}, "severe" if severe else "medium",
                             {"episodes": len(hits), "maxRepeats": worst},
                             "Find what the retried call was waiting for (state, a missing input, a flaky check) "
                             "and make the playbook say when to stop or what to read instead."))
    return out


def permission_friction(data: dict, th: dict) -> list[dict]:
    groups: dict[str, list] = defaultdict(list)
    for e in data["episodes"]:
        tools = Counter(d.get("tool", "?") for d in e.get("denials", []))
        for tool, n in tools.items():
            groups[f"denied:{tool}"].append((e["id"], n))
        if e.get("permissionPrompts"):
            who = e.get("agent") or e.get("agentType") or \
                ("claude-code sessions" if e["source"] == "claude-transcripts" else e["source"])
            groups[f"prompted:{who}"].append(
                (e["id"], e["permissionPrompts"]))
    out = []
    for key, hits in groups.items():
        total = sum(n for _, n in hits)
        ev = [{"kind": "episode", "ref": eid, "detail": f"{n} {key.split(':')[0]}", "value": n} for eid, n in hits]
        if total < th["permissionEvents"] or not _recurring(ev, False):
            continue
        kind, what = key.split(":", 1)
        out.append(candidate("permission-friction", key,
                             f"{'Denied' if kind == 'denied' else 'Prompted'} {what} calls keep interrupting work",
                             f"{total} {kind} permission events for {what} across {len(hits)} episodes", ev,
                             {"framework": f"{kind} {what}"}, "medium", {"events": total, "episodes": len(hits)},
                             "If the call is legitimate, give the role a narrow env command prefix or a read-only "
                             "capability; if not, say so in the role prompt so the agent stops trying."))
    return out


def interrupts(data: dict, th: dict) -> list[dict]:
    hits = [(e["id"], e["interrupts"]) for e in data["episodes"] if e.get("interrupts")]
    if len(hits) < th["interrupts"]:
        return []
    ev = [{"kind": "episode", "ref": eid, "detail": f"{n} interrupt(s)", "value": n} for eid, n in hits]
    return [candidate("interrupts", "user", "The user interrupts runs",
                      f"{len(hits)} episodes were interrupted by the user ({sum(n for _, n in hits)} times)", ev,
                      {"framework": "claude-code sessions"}, "medium",
                      {"episodes": len(hits), "interrupts": sum(n for _, n in hits)},
                      "Compare what ran before each interrupt (tool calls, subagents) and add the missing "
                      "stop condition or confirmation step.")]


def reverts(data: dict, th: dict) -> list[dict]:
    out = []
    commits = [e for e in data["episodes"] if e["kind"] == "commit"]
    for e in commits:
        c = e["commit"]
        if c["isRevert"]:
            out.append(candidate("revert", c.get("revertOf") or c["sha"], f"Commit {c.get('revertOf', '?')} was reverted",
                                 f"a revert ({c['sha']}) undid {c.get('revertOf', 'a commit')} touching "
                                 f"{len(c['files'])} file(s)",
                                 [{"kind": "episode", "ref": e["id"], "detail": f"revert of {c.get('revertOf', '?')}"},
                                  *[{"kind": "file", "ref": f} for f in c["files"][:10]]],
                                 {"files": c["files"][:10]}, "severe", {"files": len(c["files"])},
                                 "Add the test that would have caught the reverted change."))
    churn: dict[str, list] = defaultdict(list)
    for e in commits:
        for f in e["commit"]["files"]:
            churn[f].append(e["id"])
    for f, ids in churn.items():
        if len(ids) >= th["churnCommits"]:
            out.append(candidate("churn", f, f"{f} changes in {len(ids)} commits",
                                 f"{f} was touched by {len(ids)} commits in the window",
                                 [{"kind": "episode", "ref": i} for i in ids] + [{"kind": "file", "ref": f}],
                                 {"file": f}, "low", {"commits": len(ids)}))
    return out


DETECTORS = {
    "review-rounds": review_rounds,
    "rule-repeat": rule_repeat,
    "lintable-blocker": lintable_blocker,
    "out-of-scope": out_of_scope,
    "instruction-change": instruction_changes,
    "slow-step": slow_steps,
    "costly-step": slow_steps,
    "retry-loop": retries,
    "permission-friction": permission_friction,
    "interrupts": interrupts,
    "revert": reverts,
    "churn": reverts,
}


def thresholds(cfg: dict | None) -> dict:
    return {**DEFAULTS, **((cfg or {}).get("thresholds") or {})}


def run(data: dict, cfg: dict | None = None, only: str | None = None) -> list[dict]:
    th = thresholds(cfg)
    out, seen = [], set()
    for name, fn in DETECTORS.items():
        if (only and name != only) or fn in seen:
            continue
        seen.add(fn)
        out += [c for c in fn(data, th) if not only or c["kind"] == only]
    return out
