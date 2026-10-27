#!/usr/bin/env python3
"""agentbay control plane.

  build     resolve specs + layers and compile them for a runtime
  validate  check every spec and layer against the schemas
  ls        list agents (resolved)
  describe  show one resolved agent
  new       scaffold an agent spec or a layer
  clean     remove everything the adapter generated

  task new  mint a taskId (coordinator)
  status    fold the ledger into run states
  log       tail ledger events
  note      append a note to a run/task
  reclaim   mark a run reclaimed
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))

from bay import ledger, protocol  # noqa: E402


def _model():
    from bay import model  # lazy: needs PyYAML
    return model


def _agents(args):
    m = _model()
    try:
        return m.resolve_all(KIT / "specs", KIT / "layers")
    except m.SpecError as e:
        sys.exit(f"spec error: {e}")


def cmd_validate(args):
    m = _model()
    try:
        layers = m.load_layers(KIT / "layers")
        agents = m.resolve_all(KIT / "specs", KIT / "layers")
    except m.SpecError as e:
        sys.exit(f"✗ {e}")
    if m.jsonschema is None:
        print("! jsonschema not installed: only structural checks ran (pip install jsonschema)")
    print(f"✓ {len(layers)} layers, {len(agents)} agents valid")


def cmd_build(args):
    from bay import adapters
    agents = _agents(args)
    rep = adapters.get(args.runtime).build(agents, args.project, KIT)
    print(f"built {len(agents)} agents for {rep.runtime} → {args.project}")
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
    for a in _agents(args):
        print(f"{a.name:<14} {a.role:<11} {a.model:<7} layers={','.join(a.layers)}  tools={len(a.tools)}")


def cmd_describe(args):
    for a in _agents(args):
        if a.name == args.agent:
            d = {k: v for k, v in a.__dict__.items() if k not in ("prompt", "source")}
            d["skills"] = sorted(a.skills)
            print(json.dumps(d, indent=2, default=str))
            if args.prompt:
                print("\n--- prompt ---\n" + a.prompt)
            return
    sys.exit(f"no agent '{args.agent}'")


SPEC_TMPL = """apiVersion: agentbay/v1
kind: AgentSpec
metadata:
  name: {name}
  description: >-
    TODO: one sentence telling the coordinator when to pick this agent.
  version: 0.1.0
spec:
  model: sonnet
  layers: [{layers}]
  isolation: none
  budget: {{ maxTurns: 30 }}
  prompt: |
    You are the {name} agent. TODO: role, method, quality bar.
"""

LAYER_TMPL = """apiVersion: agentbay/v1
kind: Layer
metadata:
  name: {name}
  description: TODO
  tier: domain   # infrastructure | domain | product
spec:
  requires: [base]
  tools: []
  mcpServers: {{}}
  skills: []
  clis: []
  prompt: |
    TODO: what agents with this layer should know.
"""


def cmd_new(args):
    if args.kind == "agent":
        p = KIT / "specs" / f"{args.name}.yaml"
        body = SPEC_TMPL.format(name=args.name, layers=", ".join(args.layers.split(",")) if args.layers else "base")
    else:
        p = KIT / "layers" / args.name / "layer.yaml"
        (p.parent / "skills").mkdir(parents=True, exist_ok=True)
        body = LAYER_TMPL.format(name=args.name)
    if p.exists():
        sys.exit(f"{p} exists")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body)
    print(f"created {p.relative_to(KIT)}")


def cmd_task(args):
    print(protocol.new_task_id())


def _ago(ts: str) -> str:
    from datetime import datetime, timezone
    if not ts:
        return ""
    s = int((datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds())
    return f"{s}s" if s < 90 else f"{s // 60}m" if s < 5400 else f"{s // 3600}h"


def cmd_status(args):
    runs = list(ledger.fold(ledger.read(args.project)).values())
    if args.json:
        print(json.dumps([r.__dict__ for r in runs], indent=2))
        return
    live = [r for r in runs if r.state == "running"]
    done = [r for r in runs if r.state != "running"][-args.n:]
    print(f"RUNNING ({len(live)})")
    for r in live:
        print(f"  {r.run_id[:14]:<14} {r.agent:<14} {r.task_id or '-':<16} {_ago(r.started):>4}  {r.summary[:60]}")
    print(f"\nRECENT ({len(done)} of {len(runs) - len(live)})")
    for r in done:
        print(f"  {r.run_id[:14]:<14} {r.agent:<14} {r.task_id or '-':<16} {r.state:<9} {r.summary[:70]}")


def cmd_log(args):
    for e in ledger.read(args.project)[-args.n:]:
        print(json.dumps(e, ensure_ascii=False))


def _find_run(project, key) -> str:
    runs = ledger.fold(ledger.read(project))
    for r in runs.values():
        if r.run_id.startswith(key) or r.task_id == key:
            return r.run_id
    return key  # allow notes on tasks not yet spawned


def cmd_note(args):
    rid = _find_run(args.project, args.ref)
    ledger.append(args.project, "note", rid, source="coordinator", summary=args.text,
                  taskId=args.ref if args.ref.startswith("T-") else None)
    print("noted")


def cmd_reclaim(args):
    rid = _find_run(args.project, args.run)
    ledger.append(args.project, "reclaimed", rid, source="cli", summary=args.reason)
    print(f"reclaimed {rid}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="bay", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", type=Path, default=Path.cwd(), help="target project (default: cwd)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate").set_defaults(fn=cmd_validate)
    b = sub.add_parser("build"); b.add_argument("--runtime", default="claude-code"); b.set_defaults(fn=cmd_build)
    c = sub.add_parser("clean"); c.add_argument("--runtime", default="claude-code"); c.set_defaults(fn=cmd_clean)
    sub.add_parser("ls").set_defaults(fn=cmd_ls)
    d = sub.add_parser("describe"); d.add_argument("agent"); d.add_argument("--prompt", action="store_true"); d.set_defaults(fn=cmd_describe)
    n = sub.add_parser("new"); n.add_argument("kind", choices=["agent", "layer"]); n.add_argument("name")
    n.add_argument("--layers", help="comma-separated, agents only"); n.set_defaults(fn=cmd_new)
    t = sub.add_parser("task"); t.add_argument("action", choices=["new"]); t.set_defaults(fn=cmd_task)
    s = sub.add_parser("status"); s.add_argument("-n", type=int, default=10); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_status)
    l = sub.add_parser("log"); l.add_argument("-n", type=int, default=20); l.set_defaults(fn=cmd_log)
    no = sub.add_parser("note"); no.add_argument("ref"); no.add_argument("text"); no.set_defaults(fn=cmd_note)
    r = sub.add_parser("reclaim"); r.add_argument("run"); r.add_argument("--reason", default="reclaimed by coordinator"); r.set_defaults(fn=cmd_reclaim)

    args = ap.parse_args(argv)
    args.project = args.project.resolve()
    args.fn(args)


if __name__ == "__main__":
    main()
