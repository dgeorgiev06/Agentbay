"""`bay call <mode>.<endpoint> '<json>'`: the only way to invoke an endpoint.

A call walks the feature's steps:
  code step   -> run the bound connector here (connectors never reach agents)
  role step   -> stop and return a step plan; the coordinator runs the role and
                 resumes with `bay submit <callId> <stepId> '<json>'`
  gate step   -> stop with status awaiting-approval; only `bay approve <callId>` (interactive
                 terminal, or `--via chat` when approvals.chat is on; never pre-approved) passes or
                 rejects it. A gate with `approves: $in.<f>` approves that file's exact content: the
                 ledger records its path and sha256, and a later call naming the same unchanged file
                 skips the gate (any edit makes it run again). Nothing else skips a gate.
  review step -> injected from mode.yaml `review`; gets DoD, reviewer rules and
                 deterministic check results; verdicts decide done vs partial

Every step writes step.started / step.completed (or failed/skipped/planned) to
the ledger with mode, endpoint, step, role, agent (the profile), env and cost. Secret values
are redacted from everything this module returns or logs.
"""
from __future__ import annotations

import hashlib
import json
import secrets as _rand
import time
from contextlib import suppress
from pathlib import Path

from . import boundary, checks, config as cfgmod, connect, ledger, model, secretscan, vault, workflows as wfmod
from .util import PROPOSAL_PATH, parse_time, read_json, utcnow, write_json

VERDICT = "review.verdict/v1"
# who `bay approve` records: a terminal approval, or one relayed from chat (bay/cli.py CHAT_BY); only these pass a
# gate for a later call
APPROVERS = ("user@tty", "user@chat-via-cos")
FAIL_LEVELS = ("must", "must_not")


class CallError(Exception):
    """Bad input, missing grant, unknown target. Message says what to fix."""


def _reads_stored(step, out: dict) -> bool:
    """A refresh step (a sync run only when the store is stale: `when: stale > ...`) that could not read a
    source because it is blocked (an expired login) does not stop the call when the store already holds items:
    the later steps work on what is stored, the call ends `partial`, and the store's coverage names the gap and
    its fix. A sync endpoint's own step, or a store that was never filled, still ends the call `blocked`."""
    return bool(step.when and str(step.when).startswith("stale") and out.get("blocked")
                and (out.get("coverage") or {}).get("from"))

class Dispatcher:
    def __init__(self, system: model.System, project: Path, *, transport=None, provider=None, clock=None):
        self.sys, self.project = system.for_project(project), project
        self.transport, self.provider, self.clock = transport, provider, clock or utcnow

    # ------------------------------------------------------------ public
    def call(self, target: str, inp: dict | None = None) -> dict:
        try:
            mode, feat = self.sys.feature(target)
        except model.ResolveError as e:
            raise CallError(e.gaps[0]) from None
        inp = inp or {}
        errs = model.schema_errors(inp, feat.in_schema)
        if errs:
            raise CallError(f"{target}: input does not match {feat.in_type or 'schema'}: " + "; ".join(errs))
        call_id = f"C-{self.clock():%Y%m%d}-{_rand.token_hex(3)}"
        state = {"callId": call_id, "target": target, "input": inp, "steps": {}, "cursor": 0,
                 "status": "running", "checks": [], "cost": {"items": 0, "usd": 0.0}, "t0": time.time()}
        return self._advance(mode, feat, state)

    def submit(self, call_id: str, step_id: str, output, usage: dict | None = None) -> dict:
        """`usage` (optional, from the runtime that ran the step): {tokens: {...}|int, costUsd, durationMs}."""
        state = self._load(call_id)
        mode, feat = self.sys.feature(state["target"])
        if state["status"] not in ("needs-agent", "awaiting-approval"):
            raise CallError(f"call {call_id} is {state['status']}; nothing to submit")
        step = feat.steps[state["cursor"]]
        if step.id != step_id:
            raise CallError(f"call {call_id} is waiting for step '{step.id}', not '{step_id}'")
        base = self._event_base(mode, feat, step, call_id)
        if step.kind == "gate":
            raise CallError(f"step {step.id} is an approval gate; agents and `bay submit` cannot pass it. The user "
                            f"runs `.agentbay/bay approve {call_id}` (or `--reject`) in their own terminal")
        base.update(_usage_fields(usage, state.get("plannedAt")))
        if step.kind == "review":
            self._accept_review(state, feat, step, output, base)
        else:
            if step.kind == "role" and step.resolved is not None and step.resolved.runtime != "claude-code-main":
                self._require_plan(call_id, step, output)
            if step.out:
                sch = model.type_schema(mode.dirs or mode.path, step.out, f"{feat.mode}.{feat.name}", [])
                errs = model.schema_errors(output, sch)
                if errs:
                    raise CallError(f"step {step.id}: output does not match {step.out}: " + "; ".join(errs[:5]))
            state["steps"][step.id] = output
            self._ledger("step.completed", base, summary=f"{step.role} submitted")
            self._close_runs(call_id, step, output)
        state["cursor"] += 1
        if state.get("halt"):
            state["output"] = self._endpoint_output(feat, state)
            return self._finish(state, mode, feat)
        return self._advance(mode, feat, state)

    def _close_runs(self, call_id: str, step, output) -> None:
        """A step's submit ends every run still open that was dispatched to this call and step (and the run whose
        taskId the result names, when it was dispatched), so `bay status` stops listing them as running."""
        evs = ledger.read(self.project)
        named = output.get("taskId") if isinstance(output, dict) else None
        tids = [e["taskId"] for e in evs if e.get("type") == "agent.dispatch" and e.get("taskId")
                and e.get("callId") == call_id and e.get("step") == step.id]
        if isinstance(named, str) and ledger.dispatched_agent(evs, named):
            tids.append(named)
        status = output.get("status", "done") if isinstance(output, dict) else "done"
        summary = str(output.get("summary", ""))[:200] if isinstance(output, dict) else ""
        for r in ledger.fold(evs).values():
            if r.state == "running" and r.task_id in tids:
                ledger.append(self.project, "completed", r.run_id, source="dispatcher", taskId=r.task_id, callId=call_id,
                              agent=step.subagent, summary=summary, data={"status": status})

    def _require_plan(self, call_id: str, step, output) -> None:
        """A subagent's result is accepted only when its run recorded an outcome (`bay plan`). The run is found by
        the coordinator's dispatch record for this call and step, or by the taskId in the result block when that
        taskId's dispatch names this call and step (or names no call)."""
        evs = ledger.read(self.project)
        tids = {e.get("taskId") for e in evs if e.get("type") in ("agent.dispatch", "spawned")
                and e.get("callId") == call_id and e.get("step") == step.id}
        named = output.get("taskId") if isinstance(output, dict) else None
        disp = ledger.dispatched_agent(evs, named) if isinstance(named, str) else None
        if disp and disp.get("callId") in (None, call_id) and disp.get("step") in (None, step.id):
            tids.add(named)
        if not tids & set(ledger.plans(evs)):
            raise CallError(f"step {step.id}: the run recorded no outcome and to-do list, so its result is not "
                            f"accepted. The agent runs `.agentbay/bay plan <taskId> '<json>'` first (the coordinator "
                            f"logs the dispatch with `.agentbay/bay note dispatch <taskId> --agent <subagent> "
                            f"--call {call_id} --step {step.id}`); then submit again")

    def approve(self, call_id: str, approved: bool, reason: str = "", by: str = "user", quote: str = "",
                sha: str = "") -> dict:
        """Pass or reject the approval gate a call is waiting on. Called only from `bay approve`, which needs an
        interactive terminal, or `--via chat` with the project's approvals.chat on; never pre-approved for Claude
        Code. `quote` is the owner's message a chat approval relays; the ledger keeps it next to `by`."""
        state = self._load(call_id)
        mode, feat = self.sys.feature(state["target"])
        if state["status"] != "awaiting-approval":
            raise CallError(f"call {call_id} is {state['status']}, not awaiting approval")
        step = feat.steps[state["cursor"]]
        base = self._event_base(mode, feat, step, call_id)
        base.update(_usage_fields(None, state.get("plannedAt")))
        shown = (state.get("plan") or {}).get("approves")
        subject = self._gate_subject(step, state)
        if approved and subject != shown:
            # the owner approves the content the gate showed; an edit since then needs a fresh look
            gate = self._gate_check(step, state, subject)
            state.setdefault("gates", {})[step.id] = gate
            state["plan"] = self._plan(mode, feat, step, state)
            self._save(state)
            raise CallError(f"call {call_id}: {(shown or {}).get('path') or 'the approved file'} changed since the "
                            f"gate was shown (sha256 {_short(shown)} -> {_short(subject)}); nothing approved. Read "
                            f"it again (`bay show {call_id}`) and re-run `bay approve {call_id}`")
        if approved and subject:
            # the approval names the content it covers: a chat approval must carry the sha256 (prefix) of the
            # content shown to the owner, the terminal path passes the one it printed
            if not sha and by == "user@chat-via-cos":
                raise CallError(f"call {call_id}: a chat approval needs --sha <prefix> of the content shown "
                                f"({subject['path']} at sha256 {_short(subject)})")
            if "plan" in subject and not subject["plan"]["sha256"]:
                raise CallError(f"call {call_id}: the plan step ran but {subject['plan']['path']} was not written; "
                                f"nothing approved")
            want = [subject["sha256"], *([subject["plan"]["sha256"]] if "plan" in subject else [])]
            got = sha.lower().split("+")
            if sha and (len(got) != len(want) or any(len(g) < 8 or not w.startswith(g) for g, w in zip(got, want))):
                raise CallError(f"call {call_id}: --sha {sha} does not match the current content of "
                                f"{subject['path']} (sha256 {_short(subject)}){' and its plan' * (len(want) - 1)}; "
                                f"nothing approved (a chat approval names a prefix of each sha, joined by +). Read it "
                                f"again (`bay show {call_id}`)")
        data = {"approved": approved, "by": by, **({"quote": quote} if quote else {}),
                **({"approves": subject} if subject else {})}
        state["steps"][step.id] = {"approved": approved, "by": by, **({"quote": quote} if quote else {}),
                                   **({"approves": subject} if subject else {})}
        if not approved:
            state["status"] = "blocked"
            state["result"] = {"reason": reason or "rejected at the approval gate"}
            self._ledger("step.completed", base, summary=f"gate rejected by {by}", data=data)
            return self._finish(state, mode, feat)
        self._ledger("step.completed", base, summary=f"gate approved by {by}", data=data)
        state["cursor"] += 1
        return self._advance(mode, feat, state)

    def approve_run(self, run_id: str, approved: bool, by: str, reason: str = "", quote: str = "") -> dict:
        """Pass or reject the gate a project workflow run waits on (`bay approve W-...`), and record who did,
        with the quoted message of a chat approval, in the ledger."""
        out = self.run_capability("cos", "workflow.run/v1.approve", {
            "runId": run_id, "approved": approved, "by": by,
            **({"reason": reason} if reason else {}), **({"quote": quote} if quote else {})})
        ledger.append(self.project, "step.completed", run_id, source="dispatcher", step=out.get("stage"),
                      summary=f"gate {'approved' if approved else 'rejected'} by {by}",
                      data={"approved": approved, "by": by, **({"quote": quote} if quote else {})})
        return out

    def show(self, call_id: str) -> dict:
        """Current state of a call (result, or the step it waits on). Read-only."""
        return {**self._public(self._load(call_id)), **self._agents(call_id)}

    def _agents(self, call_id: str) -> dict:
        """The agents dispatched for a call, from the ledger: outcome, to-do progress and inputs (`bay show`)."""
        evs = ledger.read(self.project)
        plans = ledger.plans(evs)
        out = []
        for e in evs:
            if e.get("type") != "agent.dispatch" or e.get("callId") != call_id:
                continue
            started = [s for s in evs if s.get("type") == "step.started" and s.get("callId") == call_id
                       and s.get("step") == e.get("step")]
            pl = plans.get(e["taskId"])
            out.append({"taskId": e["taskId"], "step": e.get("step"), "agent": e.get("agent"),
                        "model": (e.get("data") or {}).get("model"),
                        "inputs": (e.get("data") or {}).get("inputs")      # what the coordinator gave the agent
                        or ((started[-1].get("data") or {}).get("inputs") if started else None),
                        "outcome": pl["outcome"] if pl else None,
                        "progress": f"{pl['done']}/{len(pl['todo'])}" if pl else None,
                        "todo": pl["todo"] if pl else None})
        return {"agents": out} if out else {}

    def _recorded_plans(self, call_id: str) -> dict:
        """taskId -> {step, outcome, todo} of the agents dispatched for a call: what the reviewer judges the run against;
        a verdict item may cite them (`cites`)."""
        evs = ledger.read(self.project)
        plans = ledger.plans(evs)
        return {e["taskId"]: {"step": e.get("step"), "outcome": plans[e["taskId"]]["outcome"],
                              "todo": plans[e["taskId"]]["todo"]}
                for e in evs if e.get("type") == "agent.dispatch" and e.get("callId") == call_id and e.get("taskId") in plans}

    def use(self, unit: str, target: str, inp: dict | None = None) -> dict:
        """Read-only connector access for one compiled unit (a role in one mode and one env). Reached only
        through the unit's own use shim (.agentbay/roles/<unit>/use), which fixes `unit`; there is no CLI flag
        to choose it. The read runs in the unit's env and reaches only its mode's data."""
        r = self.sys.units().get(unit)
        if r is None:
            raise CallError(f"unknown role unit '{unit}' (have: {', '.join(sorted(self.sys.units()))})")
        role = r.name
        if target not in r.bay_uses:
            raise CallError(f"role {role} in mode {r.mode} is not granted {target} (granted: "
                            f"{', '.join(r.bay_uses) or 'none'}); a role may call only the read-only endpoints of the "
                            f"capabilities its mode needs that its env ({r.env}) binds")
        scoped = self._open_uses(r)
        if scoped is not None and target not in scoped:       # B-9: while a feature's step waits for this unit
            raise CallError(self._use_refusal(r, target, scoped))
        iface, ep = target.rsplit(".", 1)
        effects = model.endpoint_effects(self.sys.kit, iface, ep)
        if set(effects) - model.AGENT_SAFE_EFFECTS:      # re-checked at runtime
            raise CallError(f"{target} has effects {effects}; agents may only call read-only endpoints")
        env = self.sys.env(r.env)
        conns = model.connectors_of(env.spec["bind"].get(iface))
        if not conns:
            raise CallError(f"role {role}: {iface} is not bound to a connector in env {env.name}")
        settings = self._use_settings(r, iface)
        outs = {c: self._invoke(env.name, c, iface, ep, inp or {}, settings=settings, caps={}) for c in conns}
        out = outs[conns[0]] if len(conns) == 1 else merge_outputs(outs)
        n = len(out.get("items", [])) if isinstance(out, dict) else None
        ledger.append(self.project, "data.read", f"use:{unit}", source="dispatcher", role=role, mode=r.mode,
                      env=env.name, summary=target,
                      data={"input": inp or {}, **({"items": n} if n is not None else {})})
        return secretscan.scrub_obj(json.loads(vault.redact(json.dumps(out, ensure_ascii=False))))

    def _open_uses(self, unit) -> set[str] | None:
        """The endpoints every feature whose open call waits for `unit` (status needs-agent, cursor on a role or
        review step of this unit) declares in `uses:`: the INTERSECTION, because the use shim does not say which
        call is asking, so with several open calls a feature never reaches what another did not declare (B-9,
        fail closed). None when no such call is open or none of its features declares `uses:`, so the role-level
        grant applies (decision (c) of proposal 0008)."""
        found: set[str] | None = None
        for _, _, uses in self._open_calls(unit):
            found = set(uses) if found is None else found & set(uses)
        return found

    def _open_calls(self, unit) -> list[tuple[str, str, list[str]]]:
        """(callId, feature target, uses) of every open needs-agent call waiting for `unit` whose feature declares `uses:`."""
        out = []
        for f in sorted(self._calls_dir().glob("*.json")):
            state = read_json(f)
            if not isinstance(state, dict) or state.get("status") != "needs-agent":
                continue
            try:
                _, feat = self.sys.feature(state["target"])
                step = feat.steps[state["cursor"]]
            except (model.ResolveError, KeyError, IndexError):
                continue
            if feat.uses is not None and step.resolved is not None and step.resolved.unit == unit.unit:
                out.append((str(state.get("callId") or f.stem), state["target"], list(feat.uses)))
        return out

    def _use_refusal(self, r, target: str, scoped: set[str]) -> str:
        """Why `target` is outside the scope of the open calls, naming the calls that removed it and the way out."""
        calls = self._open_calls(r)
        blockers = [(cid, tgt) for cid, tgt, uses in calls if target not in uses]
        have = ", ".join(sorted(scoped)) or "none"
        if not blockers:
            return (f"role {r.name} in mode {r.mode} is not granted {target} by the feature it is working on "
                    f"(its `uses:`: {have})")
        names = ", ".join(f"{cid} ({tgt})" for cid, tgt in blockers)
        many = " While several calls wait on this role unit, only what all declare in `uses:` is allowed." if len(calls) > 1 else ""
        return (f"role {r.name} in mode {r.mode} is not granted {target} by the feature of the open call(s) {names}, "
                f"which do not declare it in `uses:`.{many} Allowed now: {have}. "
                f"Finish those calls first: `bay show <callId>` continues one; run its step and submit.")

    def _use_settings(self, unit, iface: str) -> dict:
        """The unit's mode settings when its mode needs `iface` (per-mode stores such as corpus-store key on the
        mode), plus the source ids bound in the unit's env: the store in that env holds what syncs there fetched,
        and refuses reads when its applied scope differs."""
        m = self.sys.modes.get(unit.mode)
        if m is None or iface not in m.needs:
            return {}
        conns = model.connectors_of(self.sys.env(unit.env).spec["bind"].get(model.SOURCE_IFACE))
        docs = [self.sys.kit.get("Connector", c) for c in conns]
        return {**self._settings(m), "sources": sorted({d.spec["source"] for d in docs if d and d.spec.get("source")})}

    def run_capability(self, mode_name: str, run: str, args: dict) -> dict:
        """Run one connector endpoint of a mode's capability outside any feature, in the env its code steps use.
        CLI only (e.g. `bay approve <F-id>`); there is no agent path to it."""
        if mode_name not in self.sys.modes:
            raise CallError(f"unknown mode '{mode_name}'")
        m = self.sys.modes[mode_name]
        iface, ep = run.rsplit(".", 1)
        if iface not in m.needs:
            raise CallError(f"mode {mode_name} does not need {iface}")
        env, why = model.code_env(self.sys.kit, self.sys.kit.get("Mode", mode_name), iface)
        conns = model.connectors_of(env.spec["bind"].get(iface)) if env else []
        if len(conns) != 1:
            raise CallError(f"{run}: {why} must bind exactly one connector for {iface}")
        bad = [e for e in model.endpoint_effects(self.sys.kit, iface, ep) if e not in env.spec["effects"]]
        if bad:
            raise CallError(f"{run}: effects {bad} are not allowed by env {env.name}")
        return self._invoke(env.name, conns[0], iface, ep, args, settings=self._settings(m), caps={})

    # ------------------------------------------------------------ engine
    def _advance(self, mode, feat, state) -> dict:
        stages = [wfmod.Stage.of_step(s) for s in feat.steps]
        by_id = {s.id: s for s in feat.steps}
        while True:
            mv = wfmod.advance(stages, state["cursor"], state["input"], state["steps"],
                               lambda st, age: self._fresh(by_id[st.id], mode, age))
            for sid in mv.skipped:
                state["steps"][sid] = None
                self._ledger("step.skipped", self._event_base(mode, feat, by_id[sid], state["callId"]),
                             summary=f"when: {by_id[sid].when}")
            if mv.kind in ("refused", "missing"):          # fail closed; resolve already refuses both
                raise CallError(mv.reason or f"{feat.name}: no step at position {mv.cursor}")
            state["cursor"] = mv.cursor
            if mv.kind == "done":
                break
            step = feat.steps[mv.cursor]
            base = self._event_base(mode, feat, step, state["callId"])
            if step.kind == "gate":
                gate = self._gate_check(step, state)
                state.setdefault("gates", {})[step.id] = gate
                if gate["skipped"]:
                    prior = gate["prior"]
                    state["steps"][step.id] = {"approved": True, "by": prior["by"], "priorCall": prior["callId"]}
                    self._ledger("step.skipped", base, summary=gate["why"],
                                 data={"approves": gate["approves"], "priorCall": prior["callId"]})
                    state["cursor"] += 1
                    continue
            if step.kind == "code":
                self._run_code(mode, feat, step, state, base)
                if state["status"] in ("blocked", "failed"):
                    return self._finish(state, mode, feat)
                state["cursor"] += 1
                continue
            if step.kind == "review" and "checks_done" not in state:
                self._run_checks(feat, state)
                with suppress(RuntimeError, OSError):          # outside git a later re-check names no commit range
                    state["head"] = boundary._git(self.project, "rev-parse", "HEAD").strip()
            state["status"] = "awaiting-approval" if step.kind == "gate" else "needs-agent"
            plan = self._plan(mode, feat, step, state)
            state["plan"] = plan
            state["plannedAt"] = time.time()
            if step.kind in ("role", "review"):
                self._ledger("step.started", base, summary=f"{step.kind} {step.role}",
                             data={"inputs": inputs_record(plan.get("input") or plan.get("review", {}).get("task", {}),
                                                           self.project)})
            self._ledger("step.planned", base, summary=f"{step.kind} {step.role or step.id}")
            self._save(state)
            return self._public(state)
        if "checks_done" not in state:
            self._run_checks(feat, state)
        output = self._endpoint_output(feat, state)
        if feat.out_schema and feat.out_type:
            errs = model.schema_errors(output, feat.out_schema)
            if errs:
                state["status"] = "failed"
                state["result"] = {"error": f"output does not match {feat.out_type}: " + "; ".join(errs[:5])}
                return self._finish(state, mode, feat)
        state["output"] = output
        if state["status"] in ("running", "needs-agent", "awaiting-approval"):
            failed_checks = [c for c in state["checks"] if not c["ok"] and c["level"] in FAIL_LEVELS]
            state["status"] = "partial" if (failed_checks or state.get("stopped")) else "done"
        return self._finish(state, mode, feat)

    def _fresh(self, step, mode, age) -> bool:
        """`stale > <age>` (via `workflows.advance`): the step's connector says whether the store is fresher than that."""
        iface = step.run.rsplit(".", 1)[0]
        st = self._invoke(step.env, step.connector, iface, "status", {}, settings=self._settings(mode), caps={})
        last = st.get("lastSync")
        if st.get("stale"):           # selectors or bound sources changed: sync re-scopes the store first
            return False
        return bool(last) and (self.clock() - parse_time(last, self.clock())) <= age

    def _gate_subject(self, step, state) -> dict | None:
        """{path, sha256} of the project file a gate's `approves: $in.<f>` names, or None (no field, no such file
        inside the project). The dispatcher hashes the file itself; no connector output decides a gate."""
        if step.kind != "gate" or not step.approves:
            return None
        sub = self._file_subject(step.approves, state)
        pp = sub and f"docs/plans/{Path(sub['path']).stem}.md"       # the plan the lead wrote for this proposal
        plan = pp and (self._file_subject(pp, state) or ({"path": pp, "sha256": None} if state["steps"].get("plan") else None))
        return {**sub, "plan": plan} if plan else sub

    def _file_subject(self, expr: str, state) -> dict | None:
        """{path, sha256} of the project file `expr` names. A list (a step's `artifacts`) names the proposal that
        step wrote: its first docs/proposals/<id>.md."""
        path = wfmod.substitute({"v": expr}, state["input"], state["steps"], {}).get("v")
        if isinstance(path, list):
            path = next((x for x in path if isinstance(x, str) and PROPOSAL_PATH.match(x)), None)
        if not isinstance(path, str) or not path:
            return None
        root = self.project.resolve()
        p = (root / path).resolve()
        if not p.is_relative_to(root) or not p.is_file():
            return None
        return {"path": path, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}

    def _gate_check(self, step, state, subject: dict | None = ...) -> dict:
        """Whether a gate runs: skipped only when the ledger's latest owner decision (`bay approve`, terminal or
        chat) on this exact path and content is an approval. {skipped, why, approves, prior}."""
        if subject is ...:
            subject = self._gate_subject(step, state)
        if subject is None:
            why = "the gate runs: it approves no file" + (f" ({step.approves} names none in the project)"
                                                          if step.approves else "")
            return {"skipped": False, "why": why, "approves": None, "prior": None}
        last = same_path = None
        mode_name, _, ep = str(state.get("target", "")).partition(".")
        for e in ledger.read(self.project):
            d = e.get("data") or {}
            if (e.get("type") != "step.completed" or e.get("source") != "dispatcher" or d.get("by") not in APPROVERS
                    or e.get("mode") != mode_name or e.get("endpoint") != ep or e.get("step") != step.id
                    or not isinstance(d.get("approves"), dict) or d["approves"].get("path") != subject["path"]):
                continue
            # only the latest decision on the path counts: a later approval or rejection of other content
            # supersedes an earlier one, so reverting a file to old content does not revive its approval
            same_path = e
            last = e if d["approves"] == subject and self._state_holds(e, step, subject) else None
        out = {"approves": subject, "prior": None, "skipped": False}
        if last is not None and last["data"].get("approved") is True:
            d = last["data"]
            out.update(skipped=True, prior={"by": d["by"], "callId": last.get("callId"), "ts": last.get("ts")},
                       why=f"skipped: {subject['path']} approved by {d['by']} on {str(last.get('ts', ''))[:10]} "
                           f"(call {last.get('callId')}), content unchanged (sha256 {_short(subject)})")
        elif last is not None:
            out["why"] = (f"the gate runs: {subject['path']} at sha256 {_short(subject)} was rejected by "
                          f"{last['data'].get('by')} on {str(last.get('ts', ''))[:10]}")
        elif same_path is not None and same_path["data"].get("approved") is True:
            d = same_path["data"]
            out["why"] = (f"the gate runs: {subject['path']} changed since {d['by']} approved it on "
                          f"{str(same_path.get('ts', ''))[:10]} (sha256 {_short(d['approves'])} -> {_short(subject)})")
        else:
            out["why"] = (f"the gate runs: no recorded approval of {subject['path']} at sha256 {_short(subject)} "
                          f"(a front-matter status: approved is informational; only `bay approve` passes a gate)")
        return out

    def _state_holds(self, e: dict, step, subject: dict) -> bool:
        """A ledger decision counts only when the call's own state file holds the same decision: the gate approved
        (or rejected) with the same content hash. A line written into the ledger alone passes nothing."""
        try:
            prior = self._load(str(e.get("callId")))
        except CallError:
            return False
        rec = (prior.get("steps") or {}).get(step.id)
        d = e.get("data") or {}
        if not isinstance(rec, dict) or rec.get("approved") is not (d.get("approved") is True) \
                or rec.get("approves") != subject:
            return False
        return True

    def _run_code(self, mode, feat, step, state, base) -> None:
        env = self.sys.env(step.env)
        bad = [e for e in step.effects if e not in env.spec["effects"] or e not in feat.effects]
        if bad:  # resolver guarantees this; re-checked at runtime in case files changed underneath
            raise CallError(f"{feat.mode}.{feat.name} step {step.id}: effects {bad} not allowed")
        args = wfmod.substitute(step.with_, state["input"], state["steps"], mode.config)
        iface, ep = step.run.rsplit(".", 1)
        self._ledger("step.started", base, summary=step.run, data={"inputs": inputs_record(args, self.project)})
        t0 = time.monotonic()
        try:
            caps = cfgmod.caps(mode.constraints, env.spec.get("limits", {}), mode.config)
            out = self._invoke(step.env, step.connector, iface, ep, args, settings=self._settings(mode), caps=caps)
        except Exception as e:  # report, never leak
            msg = vault.redact(str(e))
            self._ledger("step.failed", base, summary=msg, durationMs=_ms(t0))
            state["status"] = "failed"
            state["result"] = {"error": f"step {step.id} ({step.run}): {msg}"}
            return
        cost = {}
        if isinstance(out, dict) and "billed" in out:
            price = float(caps.get("costPerItemUsd", cfgmod.COST_PER_ITEM_USD))
            usd = out["spentUsd"] if "spentUsd" in out else out["billed"] * price
            cost = {"items": out["billed"], "usd": round(usd, 4)}
            state["cost"]["items"] += cost["items"]
            state["cost"]["usd"] = round(state["cost"]["usd"] + cost["usd"], 4)
        if isinstance(out, dict) and out.get("stopped"):
            state["stopped"] = out["stopped"]
            if not out.get("billed") and not _reads_stored(step, out):
                state["status"] = "blocked"
                state["result"] = {"reason": out["stopped"]}
        state["steps"][step.id] = out
        summary = (out.get("stopped") or "ok") if isinstance(out, dict) else "ok"
        self._ledger("step.completed", base, summary=summary, cost=cost, durationMs=_ms(t0),
                     costUsd=cost.get("usd") if cost else None)

    def _invoke(self, env_name, conn_name, iface, ep, args, *, settings, caps):
        idoc = self.sys.interface(iface)
        spec = idoc.spec["endpoints"][ep]
        in_s = model.inline_refs(spec.get("in", {"type": "object"}))
        errs = model.schema_errors(args, in_s)
        if errs:
            raise CallError(f"{iface}.{ep}: input invalid: " + "; ".join(errs))
        inst = connect.instantiate(self.sys, env_name, conn_name, iface, self.project, transport=self.transport,
                                   provider=self.provider, caps=caps, settings=settings, clock=self.clock)
        fn = getattr(inst, ep, None)
        if fn is None:
            raise CallError(f"connector {conn_name} does not implement {iface}.{ep}")
        out = fn(**args)
        errs = model.schema_errors(out, model.inline_refs(spec.get("out", {"type": "object"})))
        if errs:
            raise CallError(f"connector {conn_name}: {iface}.{ep} returned invalid output: " + "; ".join(errs[:5]))
        warn = inst.ctx.secrets.warnings + [w for s in inst.ctx.sources.values() for w in s.ctx.secrets.warnings]
        if warn and isinstance(out, dict):
            out.setdefault("warnings", []).extend(warn)
        return out

    def _settings(self, mode) -> dict:
        s = dict(mode.config)
        s["mode"] = mode.name                     # connectors that keep per-mode data (corpus-store) key on it
        s["reads"] = list(mode.reads)             # ... and make it for the content types the mode reads
        s["modeDirs"] = [str(d) for d in mode.dirs]   # ... and with the views the mode defines (views.sql there)
        if "lookbackMax" in mode.constraints:
            s["lookbackMax"] = mode.constraints["lookbackMax"]
        return s

    # ------------------------------------------------------------ checks & review
    def _check_ctx(self) -> checks.CheckContext:
        def store_refs():
            """Urls and ids (<source>:<extId>) of every stored item in this project's corpus stores."""
            import sqlite3
            refs: set[str] = set()
            for p in self.project.glob(".agentbay/data/**/corpus.db"):
                con = sqlite3.connect(p.resolve().as_uri() + "?mode=ro", uri=True)
                try:
                    for url, iid in con.execute("SELECT url, source || ':' || ext_id FROM items"):
                        refs.update(x for x in (url, iid) if x)
                finally:
                    con.close()
            return refs
        return checks.CheckContext(store_urls=store_refs, kit=self.sys.kit.root, secrets=vault.redact)

    def _run_checks(self, feat, state) -> None:
        state["checks_done"] = True
        output = self._endpoint_output(feat, state)
        ctx = self._check_ctx()
        for r in feat.rules:
            if r.check and r.applies(state["input"]):
                res = checks.run(r.check, output, ctx)
                state["checks"].append({"rule": r.id, "check": r.check, "level": r.level, **res})

    def _accept_review(self, state, feat, step, verdict, base) -> None:
        sch = model.data_schema(VERDICT)
        errs = model.schema_errors(verdict, sch)
        if errs:
            raise CallError(f"review verdict does not match {VERDICT}: " + "; ".join(errs[:5]))
        need = [d.id for d in feat.dod] + [r.id for r in feat.rules if r.for_reviewer() and r.applies(state["input"])]
        rc = state.get("recheck") or {"carried": []}        # a re-check: the carried items stand unless the verdict gives one
        got = {i["id"]: i for i in rc["carried"]} | {i["id"]: i for i in verdict["items"]}
        missing = [i for i in need if i not in got]
        if missing:
            raise CallError(f"review verdict is missing ids: {', '.join(missing)} (report pass|fail|n/a for each)")
        levels = {d.id: d.level for d in feat.dod} | {r.id: r.level for r in feat.rules}
        failed = [i for i in got.values()
                  if (i["verdict"] == "fail" and levels.get(i["id"]) in FAIL_LEVELS) or i.get("severity") == "blocker"]
        state["steps"][step.id] = {**verdict, "items": list(got.values())}
        state["review"] = {"failed": [i["id"] for i in failed], "items": len(got)}
        if failed:
            state["status"] = "partial"
            state["halt"] = True   # a failed must/blocker stops the feature (e.g. no release after a failed review)
        self._ledger("step.completed", base, summary=f"review: {len(failed)} failed must/blocker",
                     data={"failed": [i["id"] for i in failed]})

    # ------------------------------------------------------------ plans & output
    def _plan(self, mode, feat, step, state) -> dict:
        role = step.resolved   # the compiled unit: this role in this mode and env
        submit = (f".agentbay/bay submit {state['callId']} {step.id} '<json>' "
                  f"--usage '{{\"tokens\": <total tokens>, \"costUsd\": <usd>, \"durationMs\": <ms>}}'")
        plan = {"step": step.id, "kind": step.kind}
        if step.kind != "gate":                     # gates are never submitted, only approved by the user
            plan["submit"] = submit
        if step.kind == "gate":
            plan.update(self._gate_plan(step, state))
            return plan
        run_as = "main-thread playbook" if role.runtime == "claude-code-main" else f"subagent_type={step.subagent}"
        plan.update({"role": role.name, "agent": step.agent, "env": step.env, "runAs": run_as,
                     "tier": step.inference.tier, "model": step.inference.model, "effort": step.inference.effort})
        if role.skills:                             # the playbook's short skill names -> the namespaced skills
            plan["skills"] = self._plan_skills(mode, feat, role)
        if step.kind == "review":
            plan["review"] = self._review_brief(feat, state, step)
            return plan
        plan.update(self._executor_brief(feat, step, state, role))
        return plan

    def _gate_plan(self, step, state) -> dict:
        """What a gate shows the user: the text, how to approve, why it ran, and the outputs so far."""
        gate = (state.get("gates") or {}).get(step.id) or {}
        return {"gate": step.task,
                "approve": f"the USER runs in their own terminal: .agentbay/bay approve {state['callId']} "
                           f"(or --reject --reason '...'); then `.agentbay/bay show {state['callId']}`",
                **self._chat_path(state["callId"]),
                **({"why": gate["why"]} if gate.get("why") else {}),
                **({"approves": gate["approves"]} if gate.get("approves") else {}),
                "inputs": {k: v for k, v in state["steps"].items() if v is not None}}

    @staticmethod
    def _plan_skills(mode, feat, role) -> dict:
        """The playbook's short skill names -> the namespaced skills; a mode's skills are narrowed to the feature's
        `skills:`."""
        mine = model.skill_id(mode.name, "")
        return {sk: sid for sk, sid in sorted(role.skill_names.items()) if sid in role.skills
                and (feat.skills is None or not sid.startswith(mine) or sk in feat.skills)}

    def _prior_review(self, state, step) -> dict | None:
        """The re-check brief {priorCall, failed, commits, carried}: the newest other call of this feature that reviewed
        the same approved files (path and sha256 at every gate) failed its full review, its state and ledger agree. After
        a re-check, a pass or any changed file the review is full. No gate, check or step is touched here."""
        subj = lambda s: {k: g.get("approves") for k, g in (s.get("gates") or {}).items()}      # noqa: E731
        for e in reversed(ledger.read(self.project)):
            d = e.get("data") or {}
            if (e.get("type") == "step.completed" and e.get("source") == "dispatcher" and e.get("step") == step.id
                    and e.get("callId") != state["callId"] and f"{e.get('mode')}.{e.get('endpoint')}" == state["target"]
                    and isinstance(d.get("failed"), list) and any(subj(state).values())):
                prior = read_json(self._calls_dir() / f"{e['callId']}.json") or {}
                if (prior.get("review") or {}).get("failed") == d["failed"] and subj(prior) == subj(state):
                    items = (prior.get("steps") or {}).get(step.id, {}).get("items", [])
                    return None if not d["failed"] or prior.get("recheck") else {
                        "priorCall": e["callId"], "failed": d["failed"],
                        "commits": f"{prior['head']}..HEAD" if prior.get("head") else None,
                        "carried": [i for i in items if i["id"] not in d["failed"] and i["verdict"] != "fail"]}

    def _review_brief(self, feat, state, step) -> dict:
        """What the reviewer is given: the task, the DoD, the rules, the checks, the output and the verdict schema."""
        brief = {
            "task": {"target": state["target"], "input": state["input"]},
            "definitionOfDone": [{"id": d.id, "level": d.level, "text": d.text} for d in feat.dod],
            "rules": [r.as_dict() for r in feat.rules if r.for_reviewer() and r.applies(state["input"])],
            "checks": state["checks"],
            "output": self._endpoint_output(feat, state),
            "verdictSchema": VERDICT,
            "recordedPlans": self._recorded_plans(state["callId"]),
        }
        for name in (feat.review or {}).get("rulesets", []):
            # framework rule sets (e.g. conformance): judged with the DoD; cite their ids in evidence
            brief.setdefault("rulesets", {})[name] = model.ruleset(self.sys.kit.root, name)
        if rc := self._prior_review(state, step):          # judge the failed items again; the others stand
            state["recheck"] = brief["recheck"] = rc
        return brief

    def _executor_brief(self, feat, step, state, role) -> dict:
        """What an executing role is given: the task, playbook, rules, DoD, inputs, previous outputs and tools."""
        return {
            "task": step.task or f"Do step '{step.id}' of {state['target']}",
            "playbook": str(feat.playbook_path.relative_to(self.sys.kit.root)) if feat.playbook_path else None,
            "playbookText": feat.playbook_text,
            "rules": [r.as_dict() for r in feat.rules if r.for_executor() and r.applies(state["input"])],
            "definitionOfDone": [{"id": d.id, "level": d.level, "text": d.text} for d in feat.dod],
            "input": state["input"],
            "previous": {k: v for k, v in state["steps"].items() if v is not None},
            "out": step.out,
            "tools": [f"{use_shim(role.unit)} {u} '<json>'" for u in role.bay_uses
                      if feat.uses is None or u in feat.uses],
        }

    def _chat_path(self, call_id: str) -> dict:
        """With `approvals.chat` on, the gate plan also names the chat path (the owner's own words, quoted)."""
        try:
            on = cfgmod.chat_approvals(cfgmod.load(self.project))
        except cfgmod.ConfigError:
            return {}
        return {"approveFromChat": f"approvals.chat is on: when the user's latest message clearly approves this gate, "
                                   f".agentbay/bay approve {call_id} --via chat --quote \"<their exact message>\" "
                                   f"(never infer approval)"} if on else {}

    def _endpoint_output(self, feat, state):
        for st in reversed(feat.steps):
            if st.kind in ("review", "gate"):
                continue
            if st.id in state["steps"] and state["steps"][st.id] is not None:
                return state["steps"][st.id]
        return {}

    def _finish(self, state, mode, feat) -> dict:
        ledger.append(self.project, "call.completed", state["callId"], source="dispatcher", callId=state["callId"],
                      mode=mode.name, endpoint=feat.name, cost=state["cost"],
                      summary=state.get("stopped") or (state.get("result") or {}).get("error") or state["status"],
                      data={"status": state["status"]},
                      durationMs=int((time.time() - state["t0"]) * 1000) if state.get("t0") else None,
                      costUsd=state["cost"].get("usd") or None)
        self._save(state)
        return self._public(state)

    def _public(self, state) -> dict:
        out = {"callId": state["callId"], "target": state["target"], "status": state["status"]}
        if state.get("gates"):        # why each gate ran or was skipped
            out["gates"] = {k: g["why"] for k, g in state["gates"].items()}
        if state["status"] in ("needs-agent", "awaiting-approval"):
            out["next"] = state["plan"]
        else:
            if "output" in state:
                out["output"] = state["output"]
            if state.get("result"):
                out.update(state["result"])
            if state.get("stopped"):
                out["stopped"] = state["stopped"]
            if state["checks"]:
                out["checks"] = state["checks"]
            if state.get("review"):
                out["review"] = state["review"]
            out["cost"] = state["cost"]
        return secretscan.scrub_obj(json.loads(vault.redact(json.dumps(out, ensure_ascii=False))))

    # ------------------------------------------------------------ persistence & ledger
    def _calls_dir(self) -> Path:
        return self.project / ".agentbay" / "calls"

    def _save(self, state) -> None:
        write_json(self._calls_dir() / f"{state['callId']}.json",
                   secretscan.scrub_obj(json.loads(vault.redact(json.dumps(state)))))

    def _load(self, call_id: str) -> dict:
        st = read_json(self._calls_dir() / f"{call_id}.json")
        if st is None:
            raise CallError(f"unknown call '{call_id}' (see .agentbay/calls/)")
        return st

    def _event_base(self, mode, feat, step, call_id) -> dict:
        return {"run_id": f"{call_id}:{step.id}", "callId": call_id, "mode": mode.name, "endpoint": feat.name,
                "step": step.id, "role": step.role, "agent": step.agent, "env": step.env}

    def _ledger(self, etype, base, **fields) -> None:
        b = dict(base)
        rid = b.pop("run_id")
        ledger.append(self.project, etype, rid, source="dispatcher", **b, **fields)


def inputs_record(args, project: Path) -> dict:
    """What a step was given, for the ledger: a small value as is; for a large value or a file in the project, its
    sha256 and a short preview (the ledger scrubs secret-shaped text)."""
    out = {}
    for k, v in (args if isinstance(args, dict) else {}).items():
        raw = v if isinstance(v, str) else json.dumps(v, sort_keys=True, ensure_ascii=False)
        f = None
        if isinstance(v, str) and 0 < len(v) < 300 and "\n" not in v:
            with suppress(OSError, ValueError):
                q = (project / v).resolve()
                f = q if q.is_file() and q.is_relative_to(project.resolve()) else None
        if f is not None:
            out[k] = {"file": v, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
        elif len(raw) <= 160:
            out[k] = v
        else:
            out[k] = {"sha256": hashlib.sha256(raw.encode()).hexdigest(), "preview": raw[:120]}
    return out


def _short(subject) -> str:
    return str((subject or {}).get("sha256") or "none")[:12]


def _ms(t0: float) -> int:
    return max(0, int((time.monotonic() - t0) * 1000))


def _usage_fields(usage: dict | None, planned_at: float | None) -> dict:
    """Ledger fields for an agentic step: wall time since it was planned, plus what the runtime reported."""
    out: dict = {}
    u = usage or {}
    if u.get("durationMs") is not None:
        out["durationMs"] = max(0, int(u["durationMs"]))
    elif planned_at:
        out["durationMs"] = max(0, int((time.time() - planned_at) * 1000))
    tok = u.get("tokens")
    if isinstance(tok, int):
        out["tokens"] = {"total": max(0, tok)}
    elif isinstance(tok, dict):
        out["tokens"] = {k: int(v) for k, v in tok.items()
                         if k in ("input", "output", "cacheRead", "cacheCreation", "total") and isinstance(v, (int, float))}
    if isinstance(u.get("costUsd"), (int, float)):
        out["costUsd"] = round(float(u["costUsd"]), 6)
    return out


def merge_outputs(outs: dict[str, dict]) -> dict:
    """Several connectors behind one read endpoint (e.g. session.events/v1 from ledger, transcripts and git):
    list fields are concatenated; every other field is kept per connector."""
    merged: dict = {}
    for name, out in outs.items():
        for k, v in (out or {}).items():
            if isinstance(v, list):
                merged.setdefault(k, []).extend(v)
            else:
                merged.setdefault(k, {})[name] = v
    return merged


def use_shim(unit: str) -> str:
    """Project-relative path of a unit's use shim (generated by the adapter; unit = <role>--<mode>[--<env>])."""
    return f".agentbay/roles/{unit}/use"
