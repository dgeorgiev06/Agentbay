#!/usr/bin/env python3
"""agentbay control plane (v0.2).

  validate               lint + resolve every mode endpoint (fails with every gap)
  lint                   structure checks: playbooks, DoD ids, rules, review placement
  build | clean          compile modes/roles into a runtime (claude-code) / remove it
  ls                     modes, endpoints and roles
  describe <mode|role>   resolved definition as JSON

  call <mode>.<endpoint> '<json>'      run an endpoint (the only way to invoke one)
  submit <callId> <stepId> '<json>'    hand back an agentic step's output or a gate approval
  (agents read data only through .agentbay/roles/<role>/use, generated per role by build)

  mode new <name> | feature new <name> --mode <m> | role new <name>
  connector new <name> --implements <iface> | env new <name>     scaffolds (forge templates)
  migrate [--confirm]    migrate user content (dry-run diff by default)
  secret set <NAME>      store a secret in the keychain (value read from stdin, never echoed)

  task new | status | log | note | reclaim     ledger
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
    n_ep = sum(len(m.features) for m in s.modes.values())
    print(f"✓ {len(s.modes)} modes, {n_ep} endpoints, {len(s.roles)} roles, "
          f"{len(s.kit.docs['Environment'])} envs, {len(s.kit.docs['Connector'])} connectors resolve")


def cmd_build(args):
    from bay import adapters
    s = _system(args)
    rep = adapters.get(args.runtime).build(s, args.project, KIT)
    print(f"built {len(s.modes)} modes for {rep.runtime} → {args.project}")
    for f in rep.written:
        print(f"  + {f}")
    for f in rep.removed:
        print(f"  - {f}")
    for w in rep.warnings:
        print(f"  ! {w}")


def cmd_clean(args):
    from bay import adapters
    rep = adapters.get(args.runtime).clean(args.project)
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
    print("\nroles:")
    for r in s.roles.values():
        print(f"  {r.name:<14} agent={r.agent:<12} env={r.env:<16} model={r.inference.model}")


def cmd_describe(args):
    s = _system(args)
    if args.name in s.modes:
        m = s.modes[args.name]
        d = {"name": m.name, "version": m.version, "origin": m.root, "purpose": m.purpose, "coordinator": m.coordinator,
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
        d["inference"] = r.inference.__dict__
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


def cmd_submit(args):
    d = _dispatcher(args)
    _run(lambda: d.submit(args.call, args.step, _json_arg(args.output)))


def role_use_main(role: str, project: Path, argv: list[str]) -> None:
    """Entry point of a generated role shim. The role is fixed by the shim; flags are not parsed."""
    from bay import dispatch, model
    if not argv or argv[0].startswith("-"):
        _die(f"usage: .agentbay/roles/{role}/use <capability>/v<N>.<endpoint> '<json>'  (role {role} is fixed)")
    target, inp = argv[0], argv[1] if len(argv) > 1 else None
    if len(argv) > 2:
        _die("too many arguments: pass exactly <capability>/v<N>.<endpoint> and one JSON argument")
    try:
        s = model.resolve(model.Kit(KIT, project))
    except (model.ResolveError, model.SpecError) as e:
        _die(f"✗ {e}")
    d = dispatch.Dispatcher(s, project)
    _run(lambda: d.use(role, target, _json_arg(inp)))


# ------------------------------------------------------------------ scaffolds & migrations
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


def cmd_migrate(args):
    from bay import migrate
    res = migrate.apply(KIT, args.to) if args.confirm else migrate.plan(KIT, args.to)
    if not args.confirm:
        print(res["diff"] or "nothing to migrate")
        for c in res["changes"]:
            print(f"  {c['op']:<6} {c['path']}  ({c['note']})")
        if res["changes"]:
            print("dry run: nothing written. Re-run with --confirm to apply.")
    else:
        print(f"applied {res['applied']} change(s)")
    for n in res["notes"]:
        print(f"  ! {n}")


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


# ------------------------------------------------------------------ ledger
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
    if args.json:
        print(json.dumps({"runs": [r.__dict__ for r in runs], "calls": [c.__dict__ for c in calls]}, indent=2))
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


def cmd_log(args):
    for e in ledger.read(args.project)[-args.n:]:
        print(json.dumps(e, ensure_ascii=False))


def _find_run(project, key) -> str:
    for r in ledger.fold(ledger.read(project)).values():
        if r.run_id.startswith(key) or r.task_id == key:
            return r.run_id
    return key  # allow notes on tasks or calls not yet spawned


def cmd_note(args):
    rid = _find_run(args.project, args.ref)
    ledger.append(args.project, "note", rid, source="coordinator", summary=args.text,
                  taskId=args.ref if args.ref.startswith("T-") else None)
    print("noted")


def cmd_reclaim(args):
    rid = _find_run(args.project, args.run)
    ledger.append(args.project, "reclaimed", rid, source="cli", summary=args.reason)
    print(f"reclaimed {rid}")


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
    b = sub.add_parser("build"); b.add_argument("--runtime", default="claude-code"); b.set_defaults(fn=cmd_build)
    c = sub.add_parser("clean"); c.add_argument("--runtime", default="claude-code"); c.set_defaults(fn=cmd_clean)
    sub.add_parser("ls").set_defaults(fn=cmd_ls)
    d = sub.add_parser("describe"); d.add_argument("name"); d.add_argument("--prompt", action="store_true")
    d.set_defaults(fn=cmd_describe)

    ca = sub.add_parser("call", help="run <mode>.<endpoint> with a JSON input ('-' reads stdin)")
    ca.add_argument("target"); ca.add_argument("input", nargs="?"); ca.set_defaults(fn=cmd_call)
    su = sub.add_parser("submit"); su.add_argument("call"); su.add_argument("step"); su.add_argument("output")
    su.set_defaults(fn=cmd_submit)

    for kind in ("mode", "feature", "role", "connector", "env"):
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
    mg = sub.add_parser("migrate"); mg.add_argument("--to"); mg.add_argument("--confirm", action="store_true")
    mg.set_defaults(fn=cmd_migrate)
    se = sub.add_parser("secret"); se.add_argument("action", choices=["set"]); se.add_argument("name")
    se.add_argument("--provider", default="keychain"); se.set_defaults(fn=cmd_secret)

    t = sub.add_parser("task"); t.add_argument("action", choices=["new"]); t.set_defaults(fn=cmd_task)
    s = sub.add_parser("status"); s.add_argument("-n", type=int, default=10); s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_status)
    lg = sub.add_parser("log"); lg.add_argument("-n", type=int, default=20); lg.set_defaults(fn=cmd_log)
    no = sub.add_parser("note"); no.add_argument("ref"); no.add_argument("text"); no.set_defaults(fn=cmd_note)
    r = sub.add_parser("reclaim"); r.add_argument("run"); r.add_argument("--reason", default="reclaimed by coordinator")
    r.set_defaults(fn=cmd_reclaim)

    args = ap.parse_args(_hoist_project(sys.argv[1:] if argv is None else list(argv)))
    args.project = args.project.resolve()
    args.fn(args)


if __name__ == "__main__":
    main()
