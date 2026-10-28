"""`bay call <mode>.<endpoint> '<json>'`: the only way to invoke an endpoint.

A call walks the feature's workflow:
  code step   -> run the bound connector here (connectors never reach agents)
  role step   -> stop and return a step plan; the coordinator runs the role and
                 resumes with `bay submit <callId> <stepId> '<json>'`
  gate step   -> stop with status awaiting-approval; only `bay approve <callId>` (interactive
                 terminal, never pre-approved) passes or rejects it
  review step -> injected from mode.yaml `review`; gets DoD, reviewer rules and
                 deterministic check results; verdicts decide done vs partial

Every step writes step.started / step.completed (or failed/skipped/planned) to
the ledger with mode, endpoint, step, role, agent (the profile), env and cost. Secret values
are redacted from everything this module returns or logs.
"""
from __future__ import annotations

import json
import secrets as _rand
import time
from pathlib import Path

from . import checks, config as cfgmod, connect, ledger, model, secretscan, vault
from .util import duration, parse_time, read_json, utcnow, write_json

VERDICT = "review.verdict/v1"
FAIL_LEVELS = ("must", "must_not")


class CallError(Exception):
    """Bad input, missing grant, unknown target. Message says what to fix."""


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
                 "status": "running", "checks": [], "cost": {"posts": 0, "usd": 0.0}, "t0": time.time()}
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
            if step.out:
                sch = model.type_schema(mode.dirs or mode.path, step.out, f"{feat.mode}.{feat.name}", [])
                errs = model.schema_errors(output, sch)
                if errs:
                    raise CallError(f"step {step.id}: output does not match {step.out}: " + "; ".join(errs[:5]))
            state["steps"][step.id] = output
            self._ledger("step.completed", base, summary=f"{step.role} submitted")
        state["cursor"] += 1
        if state.get("halt"):
            state["output"] = self._endpoint_output(feat, state)
            return self._finish(state, mode, feat)
        return self._advance(mode, feat, state)

    def approve(self, call_id: str, approved: bool, reason: str = "", by: str = "user") -> dict:
        """Pass or reject the approval gate a call is waiting on. Called only from `bay approve`, which
        requires an interactive terminal (never pre-approved for Claude Code)."""
        state = self._load(call_id)
        mode, feat = self.sys.feature(state["target"])
        if state["status"] != "awaiting-approval":
            raise CallError(f"call {call_id} is {state['status']}, not awaiting approval")
        step = feat.steps[state["cursor"]]
        base = self._event_base(mode, feat, step, call_id)
        base.update(_usage_fields(None, state.get("plannedAt")))
        if not approved:
            state["status"] = "blocked"
            state["result"] = {"reason": reason or "rejected at the approval gate"}
            self._ledger("step.completed", base, summary=f"gate rejected by {by}", data={"approved": False})
            return self._finish(state, mode, feat)
        state["steps"][step.id] = {"approved": True, "by": by}
        self._ledger("step.completed", base, summary=f"gate approved by {by}", data={"approved": True})
        state["cursor"] += 1
        return self._advance(mode, feat, state)

    def show(self, call_id: str) -> dict:
        """Current state of a call (result, or the step it waits on). Read-only."""
        return self._public(self._load(call_id))

    def use(self, unit: str, target: str, inp: dict | None = None) -> dict:
        """Read-only connector access for one compiled unit (a role in one mode and one env). Reached only
        through the unit's own use shim (.agentbay/roles/<unit>/use), which fixes `unit`; there is no CLI flag
        to choose it. The read runs in the unit's env and reaches only its mode's data."""
        r = self.sys.units().get(unit)
        if r is None:
            raise CallError(f"unknown role unit '{unit}' (have: {', '.join(sorted(self.sys.units()))})")
        role = r.name
        if target not in r.bay_uses:
            raise CallError(f"role {role} is not granted {target} (granted: {', '.join(r.bay_uses) or 'none'}); "
                            f"only read-only endpoints listed in the role's `uses` can be called")
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
        n = len(out.get("posts", [])) if isinstance(out, dict) else None
        ledger.append(self.project, "data.read", f"use:{unit}", source="dispatcher", role=role, mode=r.mode,
                      env=env.name, summary=target,
                      data={"input": inp or {}, **({"items": n} if n is not None else {})})
        return secretscan.scrub_obj(json.loads(vault.redact(json.dumps(out, ensure_ascii=False))))

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
        """Run one connector endpoint of a mode's capability outside any workflow, in the env its code steps use.
        CLI only (e.g. `bay improve decide`); there is no agent path to it."""
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
        while state["cursor"] < len(feat.steps):
            step = feat.steps[state["cursor"]]
            base = self._event_base(mode, feat, step, state["callId"])
            if step.when and self._skip(step, mode, feat, state):
                state["steps"][step.id] = None
                self._ledger("step.skipped", base, summary=f"when: {step.when}")
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
            state["status"] = "awaiting-approval" if step.kind == "gate" else "needs-agent"
            plan = self._plan(mode, feat, step, state)
            state["plan"] = plan
            state["plannedAt"] = time.time()
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

    def _skip(self, step, mode, feat, state) -> bool:
        if step.when.startswith("$in."):
            return not state["input"].get(step.when[4:])
        age = duration(step.when.split(">")[1].strip())
        iface = step.run.rsplit(".", 1)[0]
        st = self._invoke(step.env, step.connector, iface, "status", {}, settings=self._settings(mode), caps={})
        last = st.get("lastSync")
        if st.get("stale"):           # selectors or bound sources changed: sync re-scopes the store first
            return False
        return bool(last) and (self.clock() - parse_time(last, self.clock())) <= age

    def _run_code(self, mode, feat, step, state, base) -> None:
        env = self.sys.env(step.env)
        bad = [e for e in step.effects if e not in env.spec["effects"] or e not in feat.effects]
        if bad:  # resolver guarantees this; re-checked at runtime in case files changed underneath
            raise CallError(f"{feat.mode}.{feat.name} step {step.id}: effects {bad} not allowed")
        args = substitute(step.with_, state["input"], state["steps"], mode.config)
        iface, ep = step.run.rsplit(".", 1)
        caps = cfgmod.caps(mode.constraints, env.spec.get("limits", {}), mode.config)
        self._ledger("step.started", base, summary=step.run)
        t0 = time.monotonic()
        try:
            out = self._invoke(step.env, step.connector, iface, ep, args, settings=self._settings(mode), caps=caps)
        except Exception as e:  # report, never leak
            msg = vault.redact(str(e))
            self._ledger("step.failed", base, summary=msg, durationMs=_ms(t0))
            state["status"] = "failed"
            state["result"] = {"error": f"step {step.id} ({step.run}): {msg}"}
            return
        cost = {}
        if isinstance(out, dict) and "billed" in out:
            cpp = float(caps.get("costPerPostUsd", cfgmod.COST_PER_POST_USD))
            usd = out["spentUsd"] if "spentUsd" in out else out["billed"] * cpp
            cost = {"posts": out["billed"], "usd": round(usd, 4)}
            state["cost"]["posts"] += cost["posts"]
            state["cost"]["usd"] = round(state["cost"]["usd"] + cost["usd"], 4)
        if isinstance(out, dict) and out.get("stopped"):
            state["stopped"] = out["stopped"]
            if not out.get("billed"):
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
        got = {i["id"]: i for i in verdict["items"]}
        missing = [i for i in need if i not in got]
        if missing:
            raise CallError(f"review verdict is missing ids: {', '.join(missing)} (report pass|fail|n/a for each)")
        levels = {d.id: d.level for d in feat.dod} | {r.id: r.level for r in feat.rules}
        failed = [i for i in got.values()
                  if (i["verdict"] == "fail" and levels.get(i["id"]) in FAIL_LEVELS) or i.get("severity") == "blocker"]
        state["steps"][step.id] = verdict
        state["review"] = {"failed": [i["id"] for i in failed], "items": len(got)}
        if failed:
            state["status"] = "partial"
            state["halt"] = True   # a failed must/blocker stops the workflow (e.g. no release after a failed review)
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
            plan.update({"gate": step.task,
                         "approve": f"the USER runs in their own terminal: .agentbay/bay approve {state['callId']} "
                                    f"(or --reject --reason '...'); then `.agentbay/bay show {state['callId']}`",
                         "inputs": {k: v for k, v in state["steps"].items() if v is not None}})
            return plan
        run_as = "main-thread playbook" if role.runtime == "claude-code-main" else f"subagent_type={step.subagent}"
        plan.update({"role": role.name, "agent": step.agent, "env": step.env, "runAs": run_as,
                     "tier": step.inference.tier, "model": step.inference.model, "effort": step.inference.effort})
        if step.kind == "review":
            plan["review"] = {
                "task": {"target": state["target"], "input": state["input"]},
                "definitionOfDone": [{"id": d.id, "level": d.level, "text": d.text} for d in feat.dod],
                "rules": [r.as_dict() for r in feat.rules if r.for_reviewer() and r.applies(state["input"])],
                "checks": state["checks"],
                "output": self._endpoint_output(feat, state),
                "verdictSchema": VERDICT,
            }
            for name in (feat.review or {}).get("rulesets", []):
                # framework rule sets (e.g. conformance): judged with the DoD; cite their ids in evidence
                plan["review"].setdefault("rulesets", {})[name] = model.ruleset(self.sys.kit.root, name)
            return plan
        plan.update({
            "task": step.task or f"Do step '{step.id}' of {state['target']}",
            "playbook": str(feat.playbook_path.relative_to(self.sys.kit.root)) if feat.playbook_path else None,
            "playbookText": feat.playbook_text,
            "rules": [r.as_dict() for r in feat.rules if r.for_executor() and r.applies(state["input"])],
            "definitionOfDone": [{"id": d.id, "level": d.level, "text": d.text} for d in feat.dod],
            "input": state["input"],
            "previous": {k: v for k, v in state["steps"].items() if v is not None},
            "out": step.out,
            "tools": [f"{use_shim(role.unit)} {u} '<json>'" for u in role.bay_uses],
        })
        return plan

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


def substitute(template, inp: dict, steps: dict, settings: dict):
    """"$in.x", "$steps.id.x", "$config.x", "$in.x|$config.y" (first present) -> values.
    Keys whose value is missing are dropped."""
    def val(v):
        if isinstance(v, str) and v.startswith("$") and "|" in v:
            for alt in v.split("|"):
                x = val(alt.strip())
                if x is not _MISSING:
                    return x
            return _MISSING
        if isinstance(v, str) and v.startswith("$"):
            head, _, rest = v[1:].partition(".")
            src = {"in": inp, "steps": steps, "config": settings}.get(head)
            if src is None:
                return _MISSING
            cur = src
            for part in rest.split("."):
                if not isinstance(cur, dict) or part not in cur or cur[part] is None:
                    return _MISSING
                cur = cur[part]
            return cur
        if isinstance(v, dict):
            return {k: x for k, x in ((k, val(x)) for k, x in v.items()) if x is not _MISSING}
        return v
    return val(template or {})


_MISSING = object()
