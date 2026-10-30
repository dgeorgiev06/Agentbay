#!/usr/bin/env python3
"""agentbay control plane.

  check [--base <ref>]   lint + resolve every mode endpoint (fails with every gap); with --base, also check the
                         change against framework/components.yaml and a proposal's touches: (--proposal, --docs)
  build | clean          compile modes/roles into a runtime (claude-code) / remove it; build writes a minimal
                         agentbay.config.yaml when the project has none
  config                 every agentbay.config.yaml setting, with type, default and description (from the schemas)
  catalog [<name>]       the registry (.agentbay/catalog.json): endpoints with schemas, workflows;
                         --roles lists the role units instead (no build needed)
  describe <mode|role>   resolved definition as JSON

  call <mode>.<endpoint> '<json>'      run an endpoint (the only way to invoke one)
  submit <callId> <stepId> '<json>'    hand back an agentic step's output
  show <callId>                        current state of a call (result or the step it waits on)
  show <mode> --resolved               the mode's features after `extends`, each with the file it comes from
  show reclaim <runId>                 mark a stuck run as reclaimed
  approve <callId|runId> [--reject]    pass an approval gate of a call, or of a workflow run (W-...)
                                       (you, in a terminal; never an agent)
          [--via chat --quote "<msg>"] from chat, relayed by the Chief of Staff, when approvals.chat is on
  approve <F-id> [--defer|--wontfix]   decide an improve backlog item (a terminal only; never from chat)
  (agents read data only through .agentbay/roles/<role>--<mode>/use, generated per role unit by build)

  new mode <name> | new feature <name> --mode <m>
  new connector <name> --implements <iface> | new env <name>     scaffolds (forge templates)
  secret set <NAME>      store a secret in the keychain (value read from stdin, never echoed)
  auth <connector>       run a connector's declared login (e.g. a browser sign-in that stores its token);
                         interactive terminal only

  status [--agents|--log]                      calls, steps and agent runs; the raw ledger
  note <ref> "text" [--instruction]            record a note (--instruction: a mid-run instruction change)
  note task                                    print a fresh taskId
  note dispatch <taskId> --agent <name> ...    the coordinator's dispatch log
  note review <taskId> '<review.verdict/v1>'   a review that ran outside a framework step
  plan <taskId> '<json>' | --done <n>          a dispatched agent's outcome and to-do (the only command subagents run)
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
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


def cmd_check(args):
    """`bay check`: lint, then resolve everything; with --base, also the change's boundary check."""
    if (args.proposal or args.docs or args.json) and not args.base:
        _die("✗ --proposal, --docs and --json belong to the boundary check: pass --base <ref> too")
    if args.json:                                   # stdout is the JSON report only; the lint lines go to stderr
        import contextlib
        with contextlib.redirect_stdout(sys.stderr):
            bad = _validate(args)
    else:
        bad = _validate(args)
    if args.base:
        bad = cmd_boundary(args) or bad
    sys.exit(1 if bad else 0)


def _validate(args) -> int:
    if cmd_lint(args):
        return 1
    s = _system(args)
    from bay import workflows as wfmod
    wf_problems = wfmod.target_problems(s.kit, s)
    for p in wf_problems:
        print(f"✗ {p}")
    for w in s.warnings:
        print(f"! {w}")
    if wf_problems:
        print(f"{len(wf_problems)} workflow problem(s)")
        return 1
    n_ep = sum(len(m.features) for m in s.modes.values())
    print(f"✓ {len(s.modes)} modes, {n_ep} features, {len(s.roles)} roles ({len(s.units())} role units), "
          f"{len(s.kit.docs['Environment'])} envs, {len(s.kit.docs['Connector'])} connectors resolve "
          f"(agent profile {s.agent})")
    for name, wf in wfmod.load(s.kit).items():
        eff = ", ".join(wfmod.effects(s, wf)) or "none"
        print(f"✓ workflow {name}: {len(wf.stages)} stages, effects {eff}")
    return 0


def cmd_build(args):
    from bay import adapter, config
    s = _system(args)
    rep = adapter.get(args.runtime).build(s, args.project, KIT)
    adapter.discover(problems=rep.warnings)
    print(f"built {len(s.modes)} modes for {rep.runtime} → {args.project}")
    if config.write_minimal(args.project):
        print(f"  + {config.NAME}")
    for f in rep.written:
        print(f"  + {f}")
    for f in rep.removed:
        print(f"  - {f}")
    for w in rep.warnings:
        print(f"  ! {w}")


def cmd_clean(args):
    from bay import adapter
    rep = adapter.get(args.runtime).clean(args.project)
    adapter.discover(problems=rep.warnings)
    for w in rep.warnings:
        print(f"  ! {w}")
    for f in rep.removed:
        print(f"  - {f}")
    print("clean")


def _print_units(s) -> None:
    print(f"\nrole units (<role>--<mode>[--<env>], agent profile {s.agent}):")
    for name, u in sorted(s.units().items()):
        run = "main thread" if u.runtime == "claude-code-main" else f"tier={u.inference.tier} model={u.inference.model}"
        print(f"  {name:<40} {u.kind:<11} env={u.env:<20} {run}")


def cmd_catalog(args):
    """The registry, as the coordinator reads it: a pure read of .agentbay/catalog.json (pre-approved).
    `--roles` also resolves the kit and lists the role units."""
    from bay import registry
    if args.roles:
        if args.name or args.json:
            _die("✗ --roles lists the role units: pass no name and no --json")
        _print_units(_system(args))
        return
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


CHAT_BY = "user@chat-via-cos"


def _approval_channel(args) -> tuple[str, str]:
    """(by, quote) for `bay approve`. A terminal approval needs a TTY. A chat approval (`--via chat`) needs the
    project's `approvals: { chat: true }` and the owner's message quoted verbatim; the ledger labels it
    user@chat-via-cos, so it is never mistaken for a terminal one (proposal 0006, Part G)."""
    if args.via != "chat":
        if args.quote:
            _die("✗ --quote goes with --via chat (a terminal approval needs no quote)")
        if not sys.stdin.isatty():
            _die("✗ bay approve needs an interactive terminal (stdin is not a TTY). Approval gates are for you, not "
                 "for agents: run it yourself in a terminal. (Approvals from chat need `approvals: { chat: true }` "
                 "in agentbay.config.yaml and `--via chat`.)")
        return "user@tty", ""
    from bay import config as cfgmod
    try:
        cfg = cfgmod.load(args.project)
    except cfgmod.ConfigError as e:
        _die(f"✗ {e}")
    if not cfgmod.chat_approvals(cfg):
        _die("✗ approvals from chat are off: `bay approve --via chat` needs `approvals: { chat: true }` in "
             f"{cfgmod.NAME} (set it yourself; the default is off). Otherwise run `bay approve` in a terminal.")
    quote = (args.quote or "").strip()
    if not quote:
        _die("✗ --via chat needs --quote \"<the owner's exact message approving this gate>\"")
    return CHAT_BY, quote


def _confirm(by: str) -> None:
    if by == CHAT_BY:
        return          # the owner's quoted message is the confirmation; Claude Code asks before this command runs
    if input("Type yes to confirm: ").strip().lower() != "yes":
        _die("not confirmed; nothing changed")


def cmd_approve(args):
    """Approval gates are passed only by the owner: at a terminal, or from chat when they turned that on."""
    if args.call.startswith("F-"):
        return _decide_finding(args)
    if args.defer or args.wontfix:
        _die("✗ --defer and --wontfix decide an improve backlog item (F-...), not a gate")
    by, quote = _approval_channel(args)
    from bay import dispatch
    if args.call.startswith("W-"):
        return _approve_workflow(args, by, quote)
    d = _dispatcher(args)
    try:
        st = d.show(args.call)
    except dispatch.CallError as e:
        _die(f"✗ {e}")
    if st.get("status") != "awaiting-approval":
        _die(f"✗ call {args.call} is {st.get('status')}, not awaiting approval")
    verb = "REJECT" if args.reject else "APPROVE"
    print(f"{verb} gate '{st['next']['step']}' of {st['target']}: {st['next']['gate']}")
    ap = st["next"].get("approves")
    if ap:      # the exact content this approval covers; an edit after it makes the gate run again
        print(f"  {ap['path']} at sha256 {ap['sha256']}")
    sha = (args.sha or "").strip() if by == CHAT_BY else (ap["sha256"] if ap else "")
    if by == CHAT_BY and ap and not sha:
        _die(f"✗ --via chat needs --sha <prefix> of the content shown: {ap['path']} at sha256 {ap['sha256']}")
    _confirm(by)
    _run(lambda: d.approve(args.call, not args.reject, args.reason or "", by=by, quote=quote, sha=sha))


def _approve_workflow(args, by: str, quote: str):
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
    _confirm(by)
    _run(lambda: d.approve_run(args.call, not args.reject, by=by, reason=args.reason or "", quote=quote))


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


def _decide_finding(args):
    """`bay approve <F-id>`: the owner's decision on an improve backlog item. Approving needs an interactive terminal
    (never an agent, never chat); `--defer` and `--wontfix` record the other two decisions."""
    if args.reject or args.via == "chat" or args.quote or args.sha:
        _die("✗ a backlog item is decided at a terminal: `bay approve <F-id>` approves it, `--defer` or `--wontfix` "
             "decide otherwise (--reject, --via, --quote and --sha are for gates)")
    if args.defer and args.wontfix:
        _die("✗ pass --defer or --wontfix, not both")
    decision = "defer" if args.defer else "wontfix" if args.wontfix else "approve"
    tty = sys.stdin.isatty()
    if decision == "approve":
        if not tty:
            _die(f"✗ bay approve {args.call} needs an interactive terminal (stdin is not a TTY). Approving a "
                 "fix is your decision, not an agent's: run it yourself in a terminal.")
        if input(f"APPROVE {args.call} for implementation on demand? Type yes to confirm: ").strip().lower() != "yes":
            _die("not confirmed; nothing changed")
    d = _dispatcher(args)
    by = "user@tty" if tty else "cli"
    _run(lambda: d.run_capability("improve", "improve.findings/v1.decide",
                                  {"id": args.call, "decision": decision, "by": by,
                                   **({"note": args.reason} if args.reason else {})}))
    ledger.append(args.project, "note", args.call, source="cli", summary=f"approve {args.call} {decision}",
                  data={"kind": "decision"})


# ------------------------------------------------------------------ scaffolds & secrets
def cmd_new(args):
    from bay import scaffold
    if args.kind == "feature" and not args.mode:
        _die("✗ new feature needs --mode <mode>")
    if args.kind == "connector" and not args.implements:
        _die("✗ new connector needs --implements <interface>")
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
    """The API a connector's `login` entry gets from `bay auth <connector>`: the same secret access a sync gets
    (names both in the env's `secrets.allow` and the connector's `needs.secrets`, read and store, through the
    env's provider), an Http limited to its declared hosts that the env allows, the browser and the terminal.
    The entry runs in-process, so this limits the API it is handed, not what the process can do: a connector's
    code is trusted the same way during a login as during a sync."""

    def __init__(self, conn, env, prov, http, open_browser, say=print):
        self.connector, self.env, self.http, self.open_browser, self.say = conn.name, env.name, http, open_browser, say
        self._prov = prov
        self._declared = list(conn.spec.get("needs", {}).get("secrets", []))
        self._acc = vault.SecretAccessor(prov, env.spec.get("secrets", {}).get("allow", []), self._declared,
                                         conn.name)
        self.provider = prov.name

    def _check(self, name: str) -> None:
        if not any(fnmatch.fnmatchcase(name, p) for p in self._declared):
            raise vault.SecretError(f"connector {self.connector} does not declare secret {name} (needs.secrets)")

    def secret(self, name: str) -> str | None:
        self._check(name)
        return self._acc.get(name, optional=True)

    def store_secret(self, name: str, value: str) -> bool:
        self._check(name)
        n = len(self._acc.warnings)
        self._acc.store(name, value)
        return len(self._acc.warnings) == n


def binds_connector(env, conn_name: str) -> bool:
    """True when the env binds the connector under some interface."""
    for v in (env.spec.get("bind") or {}).values():
        vals = v if isinstance(v, list) else [v] if isinstance(v, str) else []
        if conn_name in vals:
            return True
    return False


def _login_env(s, conn, name: str | None):
    """The env to log in through: --env (which must bind the connector), else the one env that binds it."""
    envs = s.kit.docs["Environment"]
    if name:
        if name not in envs:
            _die(f"✗ unknown env '{name}'")
        if not binds_connector(envs[name], conn.name):
            _die(f"✗ env {name} does not bind connector {conn.name}; a login goes through an env that uses it")
        return envs[name]
    found = [e for e in envs.values() if binds_connector(e, conn.name)]
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
        _die(f"✗ unknown connector '{args.connector}'")
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
    """`bay config`: every setting of agentbay.config.yaml, read from the schemas."""
    from bay import config as cfgmod, model
    sys.stdout.write(cfgmod.describe(model.Kit(model.KIT, None)))


def cmd_plan(args):
    """A dispatched agent's outcome and to-do list: the only `bay` command a subagent may run. It appends its own
    events and changes nothing else. It accepts a logged dispatch's taskId; plan ownership is enforced per agent type
    by the guard (a role subagent may run only `bay plan`) plus the dispatch record, not per run."""
    try:
        if args.done is not None:
            if args.plan_json:
                _die("✗ pass either the plan JSON or --done <n>, not both")
            ledger.record_done(args.project, args.task, args.done)
            print(f"item {args.done} of {args.task} done")
        else:
            ledger.record_plan(args.project, args.task, _json_arg(args.plan_json) if args.plan_json else None)
            print(f"plan recorded for {args.task}")
    except ledger.PlanError as e:
        _die(f"✗ {e}")


def _note_review(args, task: str, verdict_json: str):
    """`bay note review <taskId> '<review.verdict/v1>'`: the coordinator records a review that ran outside a framework
    review step as a `review.recorded` ledger event that improve reads. It touches no call, gate or approval."""
    from bay import model
    verdict = _json_arg(verdict_json)
    errs = model.schema_errors(verdict, model.data_schema("review.verdict/v1"))
    if errs:
        _die("✗ the review does not match review.verdict/v1: " + "; ".join(errs[:5]))
    try:
        ledger.record_review(args.project, task, verdict)
    except ledger.PlanError as e:
        _die(f"✗ {e}")
    print(f"review recorded for {task}")


def _note_dispatch(args, task: str):
    """`bay note dispatch <taskId> --agent ...`: the coordinator records a subagent dispatch, so `bay status` lists
    it even when the spawn hook is off."""
    if not args.agent:
        _die("✗ note dispatch needs --agent <subagent_type>")
    if not ledger.TASK_ID.match(task):
        _die(f"✗ '{task}' is not a taskId (`bay note task` mints one)")
    ledger.append(args.project, "agent.dispatch", task, source="coordinator", taskId=task,
                  callId=args.call, step=args.step, agent=args.agent, summary=args.summary or "",
                  data={k: v for k, v in (("model", args.model), ("tier", args.tier), ("role", args.role),
                                          ("mode", args.mode), ("inputs", args.input)) if v})
    print("dispatch recorded")


def _ago(ts: str) -> str:
    from datetime import datetime, timezone
    if not ts:
        return ""
    s = int((datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds())
    return f"{s}s" if s < 90 else f"{s // 60}m" if s < 5400 else f"{s // 3600}h"


def cmd_status(args):
    evs = ledger.read(args.project)
    if args.log:
        for e in evs[-args.n:]:
            print(json.dumps(e, ensure_ascii=False))
        return
    if args.agents:
        gs = ledger.agent_groups(evs)
        if args.json:
            print(json.dumps(gs, indent=2))
            return
        print(f"{'ROLE':<14}{'MODE':<14}{'MODEL':<8}{'TIER':<10}{'RUNS':>5}{'DONE':>5}{'NOT-DONE':>9}{'TODO':>8}{'TOKENS':>9}{'USD':>8}")
        for g in gs:
            print(f"{g['role']:<14}{g['mode']:<14}{g['model']:<8}{g['tier']:<10}{g['runs']:>5}{g['done']:>5}{g['failed']:>9}"
                  f"{str(g['todoDone']) + '/' + str(g['todoTotal']):>8}{g['tokens']:>9}{g['costUsd']:>8}")
        return
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
        cost = f"items={c.cost.get('items', 0)} usd={c.cost.get('usd', 0)}" if c.cost else ""
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


def _find_run(project, key) -> str:
    for r in ledger.fold(ledger.read(project)).values():
        if r.run_id.startswith(key) or r.task_id == key:
            return r.run_id
    return key  # a task, call or anything else: the note stays standalone (it never creates a run)


DISPATCH_FLAGS = ("agent", "call", "step", "model", "tier", "role", "mode", "summary", "input")


def cmd_note(args):
    """`bay note`: a note on a run, task or call; `note task` mints a taskId; `note dispatch` and `note review` are the
    coordinator's records (taskId first, so a permission rule can match them by prefix)."""
    words = args.words
    verb = words[0]
    if verb not in ("task", "dispatch", "review") and any(getattr(args, f) for f in DISPATCH_FLAGS):
        _die("✗ --agent, --call, --step, --model, --tier, --role, --mode, --summary and --input go with `note dispatch`")
    if verb == "task":
        if len(words) != 1:
            _die("✗ `bay note task` takes no arguments")
        print(protocol.new_task_id())
    elif verb == "dispatch":
        if len(words) != 2:
            _die("✗ usage: bay note dispatch <taskId> --agent <subagent_type> [--call --step --model --tier --role --mode --input]")
        _note_dispatch(args, words[1])
    elif verb == "review":
        if len(words) != 3:
            _die("✗ usage: bay note review <taskId> '<review.verdict/v1 json>'")
        _note_review(args, words[1], words[2])
    else:
        if len(words) != 2:
            _die("✗ usage: bay note <runId|taskId|callId> \"text\"")
        ref, text = words
        rid = _find_run(args.project, ref)
        kind = "instruction-change" if args.instruction else args.kind
        ledger.append(args.project, "note", rid, source="coordinator", summary=text,
                      taskId=ref if ref.startswith("T-") else None,
                      callId=ref if ref.startswith("C-") else None,
                      data={"kind": kind} if kind != "note" else None)
        print("noted")


def cmd_reclaim(args):
    rid = _find_run(args.project, args.run)
    ledger.append(args.project, "reclaimed", rid, source="cli", summary=args.reason)
    print(f"reclaimed {rid}")


def cmd_show(args):
    """`bay show <callId>`; `bay show reclaim <runId>` marks a stuck run as reclaimed (a write, so it is its own
    prefix for a permission rule)."""
    if args.ref[0] == "reclaim":
        if len(args.ref) != 2:
            _die("✗ usage: bay show reclaim <runId> [--reason ...]")
        return cmd_reclaim(argparse.Namespace(project=args.project, run=args.ref[1], reason=args.reason or "reclaimed by coordinator"))
    if args.resolved:
        if len(args.ref) != 1 or args.reason:
            _die("✗ usage: bay show <mode> --resolved")
        return cmd_show_resolved(args)
    if args.reason or len(args.ref) != 1:
        _die("✗ usage: bay show <callId>   (--reason goes with `show reclaim`)")
    d = _dispatcher(args)
    _run(lambda: d.show(args.ref[0]))


def cmd_show_resolved(args):
    """`bay show <mode> --resolved`: the mode's features after `extends`, each with the mode.yaml it comes from. A
    child's feature replaces its parent's whole, so a feature has exactly one origin (0006 Part E)."""
    from bay import model
    kit = _system(args).kit
    md = kit.get("Mode", args.ref[0])
    if md is None:
        _die(f"✗ no mode '{args.ref[0]}' (modes: {', '.join(sorted(kit.docs['Mode']))})")
    own = {}
    for d in reversed(md.dirs):                     # the ancestor first; the nearest declaration wins
        for name in (model.load_yaml(d / "mode.yaml")["spec"].get("features") or {}):
            own[name] = d / "mode.yaml"
    feats = {name: {"origin": model.rel(own[name]), **block} for name, block in md.spec["features"].items()}
    print(json.dumps({"mode": md.name, "extends": md.spec.get("extends"), "abstract": bool(md.spec.get("abstract")),
                      "features": feats}, indent=2))


def cmd_boundary(args) -> int:
    from bay import boundary
    touches, prop = [], None
    try:
        if args.proposal:                    # F-14: the proposal's touches as committed at --head
            pp = Path(args.proposal).resolve()
            if not pp.is_relative_to(KIT):
                _die(f"✗ {args.proposal}: the proposal must be a file in this repository")
            prop = pp.relative_to(KIT).as_posix()
            touches = boundary.proposal_touches(KIT, args.head, prop)
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


def _verb_first(argv: list[str]) -> None:
    """`note` and `show` are pre-approved by prefix in the generated permissions, and their writes (`note dispatch`,
    `note review`, `show reclaim`) are asked by a longer prefix. So nothing may stand between the command and its
    verb: an option there (or `--project`, which is otherwise accepted anywhere) would run the write unasked."""
    i = 0
    while i < len(argv) and argv[i].startswith("-"):      # a global option before the command
        i += 2 if argv[i] == "--project" else 1
    if i < len(argv) and argv[i] in ("note", "show") and i + 1 < len(argv) and argv[i + 1].startswith("-") \
            and argv[i + 1] not in ("-h", "--help"):
        cmd = argv[i]
        verbs = "`bay note dispatch <taskId> --agent ...`, `bay note review <taskId> '<json>'`" if cmd == "note" \
            else "`bay show reclaim <runId> --reason ...`"
        _die(f"✗ `bay {cmd}`: no option may come before the verb or ref (got {argv[i + 1]!r}); put options after it: {verbs}")


def main(argv=None):
    raw = sys.argv[1:] if argv is None else list(argv)
    _verb_first(raw)
    ap = argparse.ArgumentParser(prog="bay", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", type=Path, default=Path.cwd(), help="target project (default: cwd)")
    sub = ap.add_subparsers(dest="cmd", required=True, metavar="<command>")

    ck = sub.add_parser("check", help="lint and resolve everything; with --base, also check a change's boundary")
    ck.add_argument("--base", help="check the change from this ref: its paths against core ownership and the proposal's "
                                   "touches: (git diff <base>...<head>)")
    ck.add_argument("--head", default="HEAD")
    ck.add_argument("--proposal", help="the proposal whose front-matter touches: lists the allowed crossings")
    ck.add_argument("--docs", action="store_true", help="also run B-11 on the core docs")
    ck.add_argument("--json", action="store_true", help="the boundary report as JSON")
    ck.set_defaults(fn=cmd_check)
    b = sub.add_parser("build", help="compile modes and roles into a runtime"); b.add_argument("--runtime", default="claude-code")
    b.set_defaults(fn=cmd_build)
    c = sub.add_parser("clean", help="remove what build wrote"); c.add_argument("--runtime", default="claude-code")
    c.set_defaults(fn=cmd_clean)
    ct = sub.add_parser("catalog", help="the registry: modes, features, schemas, project workflows (--roles: role units)")
    ct.add_argument("name", nargs="?", help="<mode>, <mode>.<endpoint> or a workflow name")
    ct.add_argument("--json", action="store_true")
    ct.add_argument("--roles", action="store_true", help="list the role units instead (resolved from the sources)")
    ct.set_defaults(fn=cmd_catalog)
    d = sub.add_parser("describe", help="a mode's or role's resolved definition"); d.add_argument("name")
    d.add_argument("--prompt", action="store_true")
    d.set_defaults(fn=cmd_describe)

    ca = sub.add_parser("call", help="run <mode>.<endpoint> with a JSON input ('-' reads stdin)")
    ca.add_argument("target"); ca.add_argument("input", nargs="?"); ca.set_defaults(fn=cmd_call)
    su = sub.add_parser("submit", help="hand back an agentic step's output")
    su.add_argument("call"); su.add_argument("step"); su.add_argument("output")
    su.add_argument("--usage", help='what the runtime reported for the step: \'{"tokens": N, "costUsd": X, "durationMs": N}\'')
    su.set_defaults(fn=cmd_submit)
    sh = sub.add_parser("show", help="the state of a call; `show reclaim <runId>` marks a stuck run as reclaimed")
    sh.add_argument("ref", nargs="+"); sh.add_argument("--reason", help="show reclaim: why")
    sh.add_argument("--resolved", action="store_true", help="show <mode>: its features after `extends`, with the file each comes from")
    sh.set_defaults(fn=cmd_show)
    ap_ = sub.add_parser("approve", help="pass (or --reject) an approval gate; interactive terminal, or chat when "
                                         "approvals.chat is on; an F-id decides an improve backlog item")
    ap_.add_argument("call"); ap_.add_argument("--reject", action="store_true"); ap_.add_argument("--reason")
    ap_.add_argument("--via", choices=["tty", "chat"], default="tty",
                     help="chat: relayed by the Chief of Staff; needs approvals: { chat: true } in agentbay.config.yaml")
    ap_.add_argument("--quote", help="--via chat: the owner's exact message approving this gate (recorded in the ledger)")
    ap_.add_argument("--sha", help="--via chat: sha256 prefix (8+ hex) of the content shown to the owner; the approval "
                                   "is refused if the file changed")
    ap_.add_argument("--defer", action="store_true", help="F-id: defer the backlog item")
    ap_.add_argument("--wontfix", action="store_true", help="F-id: close the backlog item as wontfix")
    ap_.set_defaults(fn=cmd_approve)

    nw = sub.add_parser("new", help="scaffold a mode, feature, connector or env")
    nw.add_argument("kind", choices=["mode", "feature", "connector", "env"]); nw.add_argument("name")
    nw.add_argument("--intent")
    nw.add_argument("--mode", help="feature: the mode it joins")
    nw.add_argument("--role", help="feature: default is the mode's first non-coordinator, non-reviewer role")
    nw.add_argument("--effects", help="feature: comma-separated, default read,write")
    nw.add_argument("--implements", help="connector: the interface it implements")
    nw.set_defaults(fn=cmd_new)
    se = sub.add_parser("secret", help="store a secret in the keychain (interactive terminal only)")
    se.add_argument("action", choices=["set"]); se.add_argument("name")
    se.add_argument("--provider", default="keychain"); se.set_defaults(fn=cmd_secret)
    au = sub.add_parser("auth", help="sign in to a source in your browser (interactive terminal only)")
    au.add_argument("connector"); au.add_argument("--env", help="env to log in through (default: the one binding it)")
    au.set_defaults(fn=cmd_auth)
    sub.add_parser("config", help="print every agentbay.config.yaml setting, from the schemas").set_defaults(fn=cmd_config)

    s = sub.add_parser("status", help="calls, steps and agent runs from the ledger (--agents, --log)")
    s.add_argument("-n", type=int, default=10); s.add_argument("--json", action="store_true")
    s.add_argument("--agents", action="store_true", help="group agent runs by role, mode, model and tier")
    s.add_argument("--log", action="store_true", help="print the last -n raw ledger events")
    s.set_defaults(fn=cmd_status)
    pl = sub.add_parser("plan", help="a dispatched agent's outcome and to-do list (append-only; the one command subagents may run)")
    pl.add_argument("task"); pl.add_argument("plan_json", nargs="?"); pl.add_argument("--done", type=int)
    pl.set_defaults(fn=cmd_plan)
    no = sub.add_parser("note", help="record a note on a run, task or call; `note task` mints a taskId; "
                                     "`note dispatch` and `note review` are the coordinator's records")
    no.add_argument("words", nargs="+", metavar="word",
                    help="<ref> \"text\" | task | dispatch <taskId> | review <taskId> '<json>'")
    no.add_argument("--kind", choices=ledger.NOTE_KINDS, default="note")
    no.add_argument("--instruction", action="store_true", help="the user changed the instructions mid-run "
                    "(same as --kind instruction-change)")
    for f in ("agent", "call", "step", "model", "tier", "role", "mode", "summary"):
        no.add_argument(f"--{f}", help="note dispatch" + (" (required)" if f == "agent" else ""))
    no.add_argument("--input", action="append", help="note dispatch: an input ref (repeat)")
    no.set_defaults(fn=cmd_note)

    args = ap.parse_args(_hoist_project(raw))
    args.project = args.project.resolve()
    args.fn(args)


if __name__ == "__main__":
    main()
