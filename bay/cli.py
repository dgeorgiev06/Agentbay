#!/usr/bin/env python3
"""agentbay control plane.

  validate               lint + resolve every mode endpoint (fails with every gap)
  lint                   structure checks: playbooks, DoD ids, rules, review, role envs
  boundary --base <ref>  check a change against framework/components.yaml and a proposal's touches:
  build | clean          compile modes/roles into a runtime (claude-code) / remove it
  ls                     modes, endpoints and roles
  catalog [<name>]       the registry (.agentbay/catalog.json): endpoints with schemas, workflows
  describe <mode|role>   resolved definition as JSON

  call <mode>.<endpoint> '<json>'      run an endpoint (the only way to invoke one)
  submit <callId> <stepId> '<json>'    hand back an agentic step's output
  show <callId>                        current state of a call (result or the step it waits on)
  approve <callId|runId> [--reject]    pass an approval gate of a call, or of a workflow run (W-...)
                                       (you, in a terminal; never an agent)
  (agents read data only through .agentbay/roles/<role>--<mode>/use, generated per role unit by build)

  mode new <name> | feature new <name> --mode <m>
  connector new <name> --implements <iface> | env new <name>     scaffolds (forge templates)
  improve decide <id> approve|defer|wontfix   record your decision on a backlog item (approve: terminal only)
  improve weekly [--since 7d]                 scan + audit + triage + backlog; cron it weekly
  secret set <NAME>      store a secret in the keychain (value read from stdin, never echoed)
  auth <connector>       run a connector's declared login (e.g. a browser sign-in that stores its token);
                         interactive terminal only

  task new | status | log | note | reclaim     ledger
  note <ref> "text" --instruction              record a mid-run instruction change (read by improve.scan)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))

from bay import ledger, protocol, vault  # noqa: E402


def _out(obj) -> None:
    print(vault.redact(json.dumps(obj, indent=2, ensure_ascii=False)))


def _die(msg: str, code: int = 1):
    print(vault.redact(msg), file=sys.stderr)
    sys.exit(code)


def _system(args):
    from bay import config, model
    try:
        kit = model.Kit(KIT, args.project)
        return model.resolve(kit)
    except (model.ResolveError, model.SpecError, config.ConfigError) as e:
        _die(f"✗ {e}")


def _json_arg(text: str | None) -> dict:
    if not text:
        return {}
    if text == "-":
        text = sys.stdin.read()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        _die(f"input is not valid JSON: {e.msg} at char {e.pos}")


# ------------------------------------------------------------------ model
def cmd_lint(args) -> int:
    from bay import config, lint, model
    try:
        kit = model.Kit(KIT, args.project)
        problems = lint.run(kit=kit)
    except config.ConfigError as e:
        _die(f"✗ {e}")
    for w in lint.warnings(kit):
        print(f"! {w}")
    for p in problems:
        print(f"✗ {p}")
    if problems:
        print(f"{len(problems)} lint problem(s)")
        return 1
    if model.jsonschema is None:
        print("! jsonschema not installed: schema checks skipped (pip install jsonschema)")
    print("✓ lint clean")
    return 0


def cmd_validate(args):
    if cmd_lint(args):
        sys.exit(1)
    s = _system(args)
    from bay import workflows as wfmod
    wf_problems = wfmod.target_problems(s.kit, s)
    for p in wf_problems:
        print(f"✗ {p}")
    for w in s.warnings:
        print(f"! {w}")
    if wf_problems:
        print(f"{len(wf_problems)} workflow problem(s)")
        sys.exit(1)
    n_ep = sum(len(m.features) for m in s.modes.values())
    print(f"✓ {len(s.modes)} modes, {n_ep} endpoints, {len(s.roles)} roles ({len(s.units())} role units), "
          f"{len(s.kit.docs['Environment'])} envs, {len(s.kit.docs['Connector'])} connectors resolve "
          f"(agent profile {s.agent})")
    for name, wf in wfmod.load(s.kit).items():
        eff = ", ".join(wfmod.effects(s, wf)) or "none"
        print(f"✓ workflow {name}: {len(wf.stages)} stages, effects {eff}")


def cmd_build(args):
    from bay import adapter
    s = _system(args)
    rep = adapter.get(args.runtime).build(s, args.project, KIT)
    print(f"built {len(s.modes)} modes for {rep.runtime} → {args.project}")
    for f in rep.written:
        print(f"  + {f}")
    for f in rep.removed:
        print(f"  - {f}")
    for w in rep.warnings:
        print(f"  ! {w}")


def cmd_clean(args):
    from bay import adapter
    rep = adapter.get(args.runtime).clean(args.project)
    for f in rep.removed:
        print(f"  - {f}")
    print("clean")


def cmd_ls(args):
    s = _system(args)
    for m in s.modes.values():
        print(f"{m.name} ({m.root}) - {m.purpose}")
        for f in m.features.values():
            rv = f" review={f.review['role']}" if f.review else ""
            print(f"  {m.name}.{f.name:<10} effects={','.join(f.effects)}{rv}")
    print(f"\nrole units (<role>--<mode>[--<env>], agent profile {s.agent}):")
    for name, u in sorted(s.units().items()):
        run = "main thread" if u.runtime == "claude-code-main" else f"tier={u.inference.tier} model={u.inference.model}"
        print(f"  {name:<40} {u.kind:<11} env={u.env:<20} {run}")


def cmd_catalog(args):
    """The registry, as the coordinator reads it: a pure read of .agentbay/catalog.json (pre-approved)."""
    from bay import registry
    try:
        cat = registry.load(args.project)
    except FileNotFoundError as e:
        _die(f"✗ {e}")
    name = args.name
    if args.json:
        if not name:
            _out(cat)
            return
        _out(_catalog_pick(cat, name))
        return
    if name:
        _out(_catalog_pick(cat, name))
        return
    print(f"registry built {cat['builtAt']} for {cat['runtime']}\n")
    for m in cat["modes"]:
        print(f"{m['name']} ({m['origin']}) - {m['purpose']}")
        for e in m["endpoints"]:
            rv = f" review={e['review']['role']}" if e.get("review") else ""
            io = f"{e.get('in') or '-'} -> {e.get('out') or '-'}"
            print(f"  {e['name']:<24} {io:<28} effects={','.join(e['effects'])}{rv}")
    wfs = cat.get("workflows") or {}
    print("\nproject workflows:" if wfs else "\nproject workflows: none (agentbay.config.yaml workflows:)")
    for w in wfs.values():
        stages = " -> ".join(s["call"] or f"gate:{s['id']}" for s in w["stages"])
        print(f"  {w['name']:<16} effects={','.join(w['effects']) or '-'}  {stages}")
        if w.get("description"):
            print(f"  {'':<16} {w['description']}")


def _catalog_pick(cat: dict, name: str):
    """One mode, one endpoint (<mode>.<endpoint>) or one workflow, by name."""
    if name in (cat.get("workflows") or {}):
        return cat["workflows"][name]
    for m in cat["modes"]:
        if m["name"] == name:
            return m
        for e in m["endpoints"]:
            if e["name"] == name:
                return e
    eps = [e["name"] for m in cat["modes"] for e in m["endpoints"]]
    _die(f"✗ no mode, endpoint or workflow '{name}' in the registry (endpoints: {', '.join(eps)}"
         + (f"; workflows: {', '.join(cat['workflows'])}" if cat.get("workflows") else "") + ")")


def cmd_describe(args):
    s = _system(args)
    if args.name in s.modes:
        m = s.modes[args.name]
        d = {"name": m.name, "version": m.version, "origin": m.root, "extends": m.extends, "purpose": m.purpose,
             "coordinator": m.coordinator,
             "roles": m.roles, "constraints": m.constraints, "config": m.config, "endpoints": {}}
        for f in m.features.values():
            d["endpoints"][f.name] = {
                "effects": f.effects, "in": f.in_type, "out": f.out_type, "review": f.review,
                "dod": [x.__dict__ for x in f.dod], "rules": [r.as_dict() for r in f.rules],
                "steps": [{k: v for k, v in st.__dict__.items() if k != "resolved" and v not in (None, [], {}, "")}
                          for st in f.steps]}
        print(json.dumps(d, indent=2, default=lambda o: o.__dict__ if hasattr(o, "__dict__") else str(o)))
        return
    if args.name in s.roles:
        r = s.roles[args.name]
        d = {k: v for k, v in r.__dict__.items() if k != "prompt"}
        d["skills"] = sorted(r.skills)
        d["units"] = [{"unit": u.unit, "mode": u.mode, "env": u.env, "kind": u.kind, "runtime": u.runtime,
                       "model": u.inference.model, "effort": u.inference.effort, "tools": u.tools, "clis": u.clis,
                       "bayUses": u.bay_uses, "budget": u.budget}
                      for u in s.units().values() if u.name == r.name]
        print(json.dumps(d, indent=2, default=str))
        if args.prompt:
            print("\n--- prompt ---\n" + r.prompt)
        return
    _die(f"no mode or role '{args.name}' (modes: {', '.join(s.modes)}; roles: {', '.join(s.roles)})")


# ------------------------------------------------------------------ runtime
def _dispatcher(args):
    from bay import dispatch
    return dispatch.Dispatcher(_system(args), args.project)


def _run(fn):
    from bay import connect, dispatch, vault as v
    try:
        res = fn()
    except (dispatch.CallError, connect.ConnectorError, v.SecretError) as e:
        _die(f"✗ {e}")
    _out(res)
    if isinstance(res, dict) and res.get("status") in ("failed",):
        sys.exit(2)


def cmd_call(args):
    d = _dispatcher(args)
    _run(lambda: d.call(args.target, _json_arg(args.input)))


def cmd_approve(args):
    """Approval gates are passed only by a human at a terminal."""
    if not sys.stdin.isatty():
        _die("✗ bay approve needs an interactive terminal (stdin is not a TTY). Approval gates are for you, not "
             "for agents: run it yourself in a terminal.")
    from bay import dispatch
    if args.call.startswith("W-"):
        return _approve_workflow(args)
    d = _dispatcher(args)
    try:
        st = d.show(args.call)
    except dispatch.CallError as e:
        _die(f"✗ {e}")
    if st.get("status") != "awaiting-approval":
        _die(f"✗ call {args.call} is {st.get('status')}, not awaiting approval")
    verb = "REJECT" if args.reject else "APPROVE"
    print(f"{verb} gate '{st['next']['step']}' of {st['target']}: {st['next']['gate']}")
    if input("Type yes to confirm: ").strip().lower() != "yes":
        _die("not confirmed; nothing changed")
    _run(lambda: d.approve(args.call, not args.reject, args.reason or "", by="user@tty"))


def _approve_workflow(args):
    """Pass or reject the gate a workflow run waits on (`bay approve W-...`)."""
    from bay import dispatch, workflows as wfmod
    s = _system(args)
    d = dispatch.Dispatcher(s, args.project)
    try:
        runs = d.run_capability("cos", "workflow.run/v1.show", {"runId": args.call})["runs"]
    except dispatch.CallError as e:
        _die(f"✗ {e}")
    run = runs[0]
    if run["status"] != "awaiting-approval":
        _die(f"✗ workflow run {args.call} is {run['status']}, not awaiting approval")
    sid = run["stages"][run["cursor"]]["id"]
    wf = wfmod.load(s.kit).get(run["workflow"])
    stage = wf.stage(sid) if wf else None
    verb = "REJECT" if args.reject else "APPROVE"
    print(f"{verb} gate '{sid}' of workflow {run['workflow']} (run {args.call}): "
          f"{(stage.gate if stage else '') or '(gate text unavailable)'}")
    if input("Type yes to confirm: ").strip().lower() != "yes":
        _die("not confirmed; nothing changed")
    _run(lambda: d.run_capability("cos", "workflow.run/v1.approve", {
        "runId": args.call, "approved": not args.reject, "by": "user@tty",
        **({"reason": args.reason} if args.reason else {})}))


def cmd_show(args):
    d = _dispatcher(args)
    _run(lambda: d.show(args.call))


def cmd_submit(args):
    d = _dispatcher(args)
    usage = _json_arg(args.usage) if args.usage else None
    _run(lambda: d.submit(args.call, args.step, _json_arg(args.output), usage=usage))


def role_use_main(unit: str, project: Path, argv: list[str]) -> None:
    """Entry point of a generated role shim. The unit (role, mode, env) is fixed by the shim; flags are not
    parsed."""
    from bay import dispatch, model
    if not argv or argv[0].startswith("-"):
        _die(f"usage: .agentbay/roles/{unit}/use <capability>/v<N>.<endpoint> '<json>'  (role unit {unit} is fixed)")
    target, inp = argv[0], argv[1] if len(argv) > 1 else None
    if len(argv) > 2:
        _die("too many arguments: pass exactly <capability>/v<N>.<endpoint> and one JSON argument")
    try:
        s = model.resolve(model.Kit(KIT, project))
    except (model.ResolveError, model.SpecError) as e:
        _die(f"✗ {e}")
    d = dispatch.Dispatcher(s, project)
    _run(lambda: d.use(unit, target, _json_arg(inp)))


# ------------------------------------------------------------------ improve
WEEKLY = ("improve.scan", "improve.audit", "improve.triage")      # then improve.backlog, once nothing is pending


def cmd_improve_decide(args):
    """Human decisions on backlog items. approve needs an interactive terminal (never an agent)."""
    tty = sys.stdin.isatty()
    if args.decision == "approve":
        if not tty:
            _die("✗ bay improve decide ... approve needs an interactive terminal (stdin is not a TTY). Approving a "
                 "fix is your decision, not an agent's: run it yourself in a terminal.")
        if input(f"APPROVE {args.id} for implementation on demand? Type yes to confirm: ").strip().lower() != "yes":
            _die("not confirmed; nothing changed")
    d = _dispatcher(args)
    by = "user@tty" if tty else "cli"
    _run(lambda: d.run_capability("improve", "improve.findings/v1.decide",
                                  {"id": args.id, "decision": args.decision, "by": by,
                                   **({"note": args.note} if args.note else {})}))
    ledger.append(args.project, "note", args.id, source="cli", summary=f"improve decide {args.id} {args.decision}",
                  data={"kind": "decision"})


def cmd_improve_weekly(args):
    """scan + audit + triage, then backlog. The report is written only when no analysis step is pending; otherwise
    this stops and lists the agent steps to finish first (the coordinator runs them, then improve.backlog)."""
    from bay import connect, dispatch
    d = _dispatcher(args)
    calls, pending = [], []
    for target in WEEKLY:
        inp = {"since": args.since} if target == "improve.scan" and args.since else {}
        try:
            r = d.call(target, inp)
        except (dispatch.CallError, connect.ConnectorError) as e:
            r = {"target": target, "status": "failed", "error": str(e)}
        item = {k: r[k] for k in ("callId", "target", "status", "error") if k in r}
        if r.get("status") in ("needs-agent", "awaiting-approval"):
            item["next"] = {k: r["next"][k] for k in ("step", "role", "runAs", "submit") if k in r["next"]}
            pending.append(item)
        calls.append(item)
    if pending:
        _out({"status": "pending", "calls": calls,
              "next": ["Run each pending step plan (`.agentbay/bay show <callId>` prints it) and submit its output; "
                       "each call continues until it is done.",
                       "Then write the report: .agentbay/bay call improve.backlog '{}'"]})
        return
    try:
        r = d.call("improve.backlog", {})
    except (dispatch.CallError, connect.ConnectorError) as e:
        _die(f"✗ improve.backlog: {e}")
    calls.append({k: r[k] for k in ("callId", "target", "status", "output") if k in r})
    _out({"status": r["status"], "calls": calls})


# ------------------------------------------------------------------ scaffolds & secrets
def cmd_new(args):
    from bay import scaffold
    try:
        res = scaffold.create(KIT, args.kind, args.name, target=getattr(args, "mode", None),
                              implements=getattr(args, "implements", None), intent=args.intent,
                              effects=args.effects.split(",") if getattr(args, "effects", None) else None,
                              role=getattr(args, "role", None))
    except scaffold.ScaffoldError as e:
        _die(f"✗ {e}")
    for f in res["files"]:
        print(f"  + {f}")
    for t in res["todo"]:
        print(f"  TODO {t}")


def cmd_secret(args):
    import getpass
    if not sys.stdin.isatty():
        _die("✗ secret set needs an interactive terminal (stdin is not a TTY); it never reads secrets from a "
             "pipe, so an agent cannot overwrite them. Run it yourself in a terminal.")
    prov = vault.provider(args.provider)
    value = getpass.getpass(f"{args.name} (input hidden): ")
    if not value:
        _die("no value given")
    vault.remember(value)
    try:
        ok = prov.set(args.name, value)
    except vault.SecretError as e:
        _die(f"✗ {e}")
    if not ok:
        _die(f"provider '{args.provider}' cannot store secrets; export {args.name} in your shell instead")
    print(f"stored {args.name} in {args.provider}")


class LoginContext:
    """What a connector's `login` entry gets from `bay auth <connector>`: its own declared secrets (read and
    store, through the env's provider), an Http limited to its declared hosts that the env allows, the browser
    and the terminal. Nothing else."""

    def __init__(self, conn, env, prov, http, open_browser, say=print):
        self.connector, self.env, self.http, self.open_browser, self.say = conn.name, env.name, http, open_browser, say
        self._prov = prov
        self._declared = set(conn.spec.get("needs", {}).get("secrets", []))
        self.provider = prov.name

    def _check(self, name: str) -> None:
        if name not in self._declared:
            raise vault.SecretError(f"connector {self.connector} does not declare secret {name} (needs.secrets)")

    def secret(self, name: str) -> str | None:
        self._check(name)
        v = self._prov.get(name)
        if v:
            vault.remember(v)
        return v

    def store_secret(self, name: str, value: str) -> bool:
        self._check(name)
        return self._prov.set(name, value)


def _login_env(s, conn, name: str | None):
    """The env to log in through: --env, else the one env that binds the connector."""
    def binds(env) -> bool:
        for v in (env.spec.get("bind") or {}).values():
            vals = v if isinstance(v, list) else [v] if isinstance(v, str) else []
            if conn.name in vals:
                return True
        return False
    envs = s.kit.docs["Environment"]
    if name:
        if name not in envs:
            _die(f"✗ unknown env '{name}'")
        return envs[name]
    found = [e for e in envs.values() if binds(e)]
    if len(found) != 1:
        which = ", ".join(e.name for e in found) or "none"
        _die(f"✗ {len(found)} envs bind connector {conn.name} ({which}); name one with --env")
    return found[0]


def cmd_auth(args):
    """`bay auth <connector>`: runs the connector's declared `login` entry (e.g. an OAuth browser login that stores
    a refresh token). Interactive terminal only, like `secret set`: an agent can neither start a login nor replace
    a token."""
    import webbrowser
    from bay import connect
    if not sys.stdin.isatty():
        _die(f"✗ bay auth {args.connector} needs an interactive terminal (stdin is not a TTY) and your browser; "
             f"run it yourself in a terminal.")
    s = _system(args)
    conn = s.kit.get("Connector", args.connector)
    if conn is None:
        _die(f"✗ unknown connector '{args.connector}' (`bay ls` lists them)")
    entry = conn.spec.get("login")
    if not entry:
        have = sorted(c.name for c in s.kit.docs["Connector"].values() if c.spec.get("login"))
        _die(f"✗ connector {conn.name} declares no `login` entry (connectors with one: {', '.join(have) or 'none'})")
    env = _login_env(s, conn, args.env)
    mod = connect._load_module(conn)
    fn = getattr(mod, entry, None)
    if not callable(fn):
        _die(f"✗ connector {conn.name}: {conn.spec['entry']} has no function {entry} (its declared `login`)")
    allow = [h for h in conn.spec.get("needs", {}).get("network", [])
             if connect.model.host_allowed(h, env.spec.get("network", {}).get("allow", []))]
    http = connect.Http(allow, who=f"bay auth {conn.name}")
    ctx = LoginContext(conn, env, connect.secrets_provider(s, env), http, webbrowser.open)
    try:
        fn(ctx)
    except (connect.ConnectorError, vault.SecretError) as e:
        _die(f"✗ {e}")


# ------------------------------------------------------------------ ledger
def cmd_config(args):
    """`bay config example`: assemble agentbay.config.example.yaml from each extension's config.example.yaml."""
    from bay import config as cfgmod, model
    text = cfgmod.example(model.Kit(model.KIT, None))
    if args.stdout:
        sys.stdout.write(text)
        return
    (model.KIT / cfgmod.EXAMPLE).write_text(text, encoding="utf-8")
    print(f"✓ wrote {cfgmod.EXAMPLE}")


def cmd_task(args):
    print(protocol.new_task_id())


def _ago(ts: str) -> str:
    from datetime import datetime, timezone
    if not ts:
        return ""
    s = int((datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds())
    return f"{s}s" if s < 90 else f"{s // 60}m" if s < 5400 else f"{s // 3600}h"


def cmd_status(args):
    evs = ledger.read(args.project)
    runs = list(ledger.fold(evs).values())
    calls = list(ledger.fold_calls(evs).values())
    notes = ledger.standalone_notes(evs)
    if args.json:
        print(json.dumps({"runs": [r.__dict__ for r in runs], "calls": [c.__dict__ for c in calls],
                          "notes": notes}, indent=2))
        return
    live = [r for r in runs if r.state == "running"]
    done = [r for r in runs if r.state != "running"][-args.n:]
    print(f"CALLS ({len(calls)})")
    for c in calls[-args.n:]:
        cost = f"posts={c.cost.get('posts', 0)} usd={c.cost.get('usd', 0)}" if c.cost else ""
        print(f"  {c.call_id:<18} {c.mode + '.' + c.endpoint:<24} {c.state:<8} step={c.last_step:<10} {_ago(c.ts):>4} {cost}")
    print(f"\nRUNNING AGENTS ({len(live)})")
    for r in live:
        print(f"  {r.run_id[:14]:<14} {r.agent:<14} {r.task_id or '-':<16} {_ago(r.started):>4}  {r.summary[:60]}")
    print(f"\nRECENT AGENTS ({len(done)} of {len(runs) - len(live)})")
    for r in done:
        print(f"  {r.run_id[:14]:<14} {r.agent:<14} {r.task_id or '-':<16} {r.state:<9} {r.summary[:70]}")
    if notes:
        print(f"\nNOTES ({len(notes)}, not attached to an agent run)")
        for n in notes[-args.n:]:
            kind = (n.get("data") or {}).get("kind", "note")
            print(f"  {n['runId'][:18]:<18} {kind:<18} {n.get('summary', '')[:70]}")


def cmd_log(args):
    for e in ledger.read(args.project)[-args.n:]:
        print(json.dumps(e, ensure_ascii=False))


def _find_run(project, key) -> str:
    for r in ledger.fold(ledger.read(project)).values():
        if r.run_id.startswith(key) or r.task_id == key:
            return r.run_id
    return key  # a task, call or anything else: the note stays standalone (it never creates a run)


def cmd_note(args):
    rid = _find_run(args.project, args.ref)
    kind = "instruction-change" if args.instruction else args.kind
    ledger.append(args.project, "note", rid, source="coordinator", summary=args.text,
                  taskId=args.ref if args.ref.startswith("T-") else None,
                  callId=args.ref if args.ref.startswith("C-") else None,
                  data={"kind": kind} if kind != "note" else None)
    print("noted")


def cmd_reclaim(args):
    rid = _find_run(args.project, args.run)
    ledger.append(args.project, "reclaimed", rid, source="cli", summary=args.reason)
    print(f"reclaimed {rid}")


def cmd_boundary(args) -> int:
    from bay import boundary, proposal
    touches, prop = [], None
    if args.proposal:
        pp = Path(args.proposal).resolve()
        try:
            touches = proposal.load_touches(pp)
        except (OSError, proposal.ProposalError) as e:
            _die(f"✗ {e}")
        prop = str(pp.relative_to(KIT)) if pp.is_relative_to(KIT) else str(pp)
    try:
        rep = boundary.check(KIT, args.base, args.head, prop, touches, docs=args.docs)
    except RuntimeError as e:
        _die(f"✗ {e}")
    if args.json:
        _out(rep.to_json())
    else:
        print("\n".join(rep.lines()))
    return rep.exit_code


def _hoist_project(argv: list[str]) -> list[str]:
    """Accept --project anywhere (`bay build --project x` as well as `bay --project x build`)."""
    out, proj = [], []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--project" and i + 1 < len(argv):
            proj = ["--project", argv[i + 1]]
            i += 2
            continue
        if a.startswith("--project="):
            proj = ["--project", a.split("=", 1)[1]]
        else:
            out.append(a)
        i += 1
    return proj + out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="bay", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", type=Path, default=Path.cwd(), help="target project (default: cwd)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate").set_defaults(fn=cmd_validate)
    sub.add_parser("lint").set_defaults(fn=lambda a: sys.exit(cmd_lint(a)))
    bd = sub.add_parser("boundary", help="check a change's paths against core ownership and the proposal's touches:")
    bd.add_argument("--base", required=True, help="the ref the change starts from (git diff <base>...<head>)")
    bd.add_argument("--head", default="HEAD")
    bd.add_argument("--proposal", help="the proposal whose front-matter touches: lists the allowed crossings")
    bd.add_argument("--docs", action="store_true", help="also run B-11 on the core docs (reported, not yet counted)")
    bd.add_argument("--json", action="store_true")
    bd.set_defaults(fn=lambda a: sys.exit(cmd_boundary(a)))
    b = sub.add_parser("build"); b.add_argument("--runtime", default="claude-code"); b.set_defaults(fn=cmd_build)
    c = sub.add_parser("clean"); c.add_argument("--runtime", default="claude-code"); c.set_defaults(fn=cmd_clean)
    sub.add_parser("ls").set_defaults(fn=cmd_ls)
    ct = sub.add_parser("catalog", help="the registry: modes, endpoints, schemas, project workflows")
    ct.add_argument("name", nargs="?", help="<mode>, <mode>.<endpoint> or a workflow name")
    ct.add_argument("--json", action="store_true")
    ct.set_defaults(fn=cmd_catalog)
    d = sub.add_parser("describe"); d.add_argument("name"); d.add_argument("--prompt", action="store_true")
    d.set_defaults(fn=cmd_describe)

    ca = sub.add_parser("call", help="run <mode>.<endpoint> with a JSON input ('-' reads stdin)")
    ca.add_argument("target"); ca.add_argument("input", nargs="?"); ca.set_defaults(fn=cmd_call)
    su = sub.add_parser("submit"); su.add_argument("call"); su.add_argument("step"); su.add_argument("output")
    su.add_argument("--usage", help='what the runtime reported for the step: \'{"tokens": N, "costUsd": X, "durationMs": N}\'')
    su.set_defaults(fn=cmd_submit)
    sh = sub.add_parser("show"); sh.add_argument("call"); sh.set_defaults(fn=cmd_show)
    ap_ = sub.add_parser("approve", help="pass (or --reject) an approval gate; interactive terminal only")
    ap_.add_argument("call"); ap_.add_argument("--reject", action="store_true"); ap_.add_argument("--reason")
    ap_.set_defaults(fn=cmd_approve)

    for kind in ("mode", "feature", "connector", "env"):
        k = sub.add_parser(kind, help=f"scaffold {'an' if kind[0] in 'aeiou' else 'a'} {kind}")
        ks = k.add_subparsers(dest="action", required=True)
        n = ks.add_parser("new"); n.add_argument("name"); n.add_argument("--intent")
        if kind == "feature":
            n.add_argument("--mode", required=True)
            n.add_argument("--role", help="default: the mode's first non-coordinator, non-reviewer role")
            n.add_argument("--effects", help="comma-separated, default read,write")
        if kind == "connector":
            n.add_argument("--implements", required=True)
        n.set_defaults(fn=cmd_new, kind=kind)
    se = sub.add_parser("secret"); se.add_argument("action", choices=["set"]); se.add_argument("name")
    se.add_argument("--provider", default="keychain"); se.set_defaults(fn=cmd_secret)
    au = sub.add_parser("auth", help="sign in to a source in your browser (interactive terminal only)")
    au.add_argument("connector"); au.add_argument("--env", help="env to log in through (default: the one binding it)")
    au.set_defaults(fn=cmd_auth)
    cf = sub.add_parser("config", help="example config assembled from the extensions' config.example.yaml")
    cf.add_argument("action", choices=["example"]); cf.add_argument("--stdout", action="store_true")
    cf.set_defaults(fn=cmd_config)

    im = sub.add_parser("improve", help="improve backlog: decide items, run the weekly pass")
    ims = im.add_subparsers(dest="action", required=True)
    dc = ims.add_parser("decide", help="approve|defer|wontfix a backlog item (approve: interactive terminal only)")
    dc.add_argument("id"); dc.add_argument("decision", choices=["approve", "defer", "wontfix"])
    dc.add_argument("--note"); dc.set_defaults(fn=cmd_improve_decide)
    wk = ims.add_parser("weekly", help="scan + audit + triage + backlog (cron: see docs/DESIGN.md)")
    wk.add_argument("--since"); wk.set_defaults(fn=cmd_improve_weekly)

    t = sub.add_parser("task"); t.add_argument("action", choices=["new"]); t.set_defaults(fn=cmd_task)
    s = sub.add_parser("status"); s.add_argument("-n", type=int, default=10); s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_status)
    lg = sub.add_parser("log"); lg.add_argument("-n", type=int, default=20); lg.set_defaults(fn=cmd_log)
    no = sub.add_parser("note", help="record a note on a run, task or call (never creates a run)")
    no.add_argument("ref"); no.add_argument("text")
    no.add_argument("--kind", choices=ledger.NOTE_KINDS, default="note")
    no.add_argument("--instruction", action="store_true", help="the user changed the instructions mid-run "
                    "(same as --kind instruction-change)")
    no.set_defaults(fn=cmd_note)
    r = sub.add_parser("reclaim"); r.add_argument("run"); r.add_argument("--reason", default="reclaimed by coordinator")
    r.set_defaults(fn=cmd_reclaim)

    args = ap.parse_args(_hoist_project(sys.argv[1:] if argv is None else list(argv)))
    args.project = args.project.resolve()
    args.fn(args)


if __name__ == "__main__":
    main()
