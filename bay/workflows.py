"""Project workflows: user-configured stages that compose mode endpoints.

A feature's `steps` (`mode.yaml spec.features.<name>.steps`) are a list of steps inside one mode, written by the
mode's author. A *project* workflow is a list of stages across modes, written by the user in
`agentbay.config.yaml`:

    workflows:
      morning:
        description: refresh feeds, then digest
        steps:
          - id: sync
            call: feed-briefing.sync
            with: { lookback: 1d }
          - id: digest
            call: briefing.digest
            with: { since: "$steps.sync.until" }
            when: $steps.sync.added
          - id: ship
            gate: "send the digest?"

Stage kinds are `call` (one `<mode>.<endpoint>`) and `gate` (approval). `with:`, `when:`,
`$in.<field>` and `$steps.<id>.<field>` mean what they mean in a feature's steps, so there is one
substitution language; `bay.dispatch.substitute` does the substituting for both.

Composition stops here on purpose: a stage is not executed inside `bay call`. The dispatcher hands
the stage back as work (`cos.run` / `cos.next`), the coordinator calls that endpoint the ordinary
way, and each stage keeps its own grants, effects, budget, review and approval gates. Nothing
recurses, so there are no cycles to detect and no effect unions to propagate.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field

from . import model

REF = re.compile(r"^\$(in|steps|config)\.")
DOLLAR = re.compile(r"^\$")
STEPS_REF = re.compile(r"^\$steps\.([a-z][a-z0-9-]*)\.")


@dataclass
class Stage:
    id: str
    call: str | None = None
    gate: str | None = None
    with_: dict = field(default_factory=dict)
    when: str | None = None

    @property
    def kind(self) -> str:
        return "gate" if self.gate else "call"


@dataclass
class Workflow:
    name: str
    description: str
    stages: list[Stage]
    in_schema: dict = field(default_factory=dict)

    def stage(self, sid: str) -> Stage | None:
        return next((s for s in self.stages if s.id == sid), None)


def load(kit) -> dict[str, Workflow]:
    """Project workflows from agentbay.config.yaml. Structure is already schema-checked by config.load."""
    out: dict[str, Workflow] = {}
    for name, spec in (kit.config.get("workflows") or {}).items():
        stages = [Stage(id=s["id"], call=s.get("call"), gate=s.get("gate"),
                        with_=s.get("with", {}) or {}, when=s.get("when"))
                  for s in spec.get("steps", [])]
        out[name] = Workflow(name=name, description=spec.get("description", ""), stages=stages,
                             in_schema=spec.get("in", {}) or {})
    return out


def effects(system, wf: Workflow) -> list[str]:
    """Union of the effects of every endpoint the workflow calls. What this workflow may do."""
    eff: set[str] = set()
    for st in wf.stages:
        if not st.call:
            continue
        try:
            _, feat = system.feature(st.call)
        except model.ResolveError:
            continue
        eff.update(feat.effects)
    return [e for e in ("read", "write", "network", "spend", "delete") if e in eff]


def _literals(template):
    """`with:` with every $ reference dropped: what can be checked before the run."""
    if isinstance(template, dict):
        return {k: _literals(v) for k, v in template.items()
                if not (isinstance(v, str) and REF.match(v))}
    if isinstance(template, list):
        return [_literals(v) for v in template]
    return template


def _optional(schema: dict) -> dict:
    """The endpoint's input schema with `required` dropped, recursively: the rest of the input
    arrives from $in/$steps at run time, so a missing field is not a lint problem - but a misspelled
    property or a wrong literal type still is."""
    if not isinstance(schema, dict):
        return schema
    out = {k: v for k, v in schema.items() if k != "required"}
    for k in ("properties", "$defs", "definitions"):
        if isinstance(out.get(k), dict):
            out[k] = {pk: _optional(pv) for pk, pv in out[k].items()}
    for k in ("items", "additionalProperties", "if", "then", "else", "not"):
        if isinstance(out.get(k), dict):
            out[k] = _optional(out[k])
    for k in ("allOf", "anyOf", "oneOf"):
        if isinstance(out.get(k), list):
            out[k] = [_optional(x) for x in out[k]]
    return out


def structure_problems(kit) -> list[str]:
    """Checks that need no resolution, so `bay lint` can run them: stage ids, reference order, and
    whether a workflow does anything at all."""
    out: list[str] = []
    for name, wf in load(kit).items():
        where = f"agentbay.config.yaml workflows.{name}"
        seen: dict[str, Stage] = {}
        for st in wf.stages:
            at = f"{where} step {st.id}"
            if st.id in seen:
                out.append(f"{at}: duplicate stage id '{st.id}'")
            for ref in _refs(st.with_) + ([st.when] if st.when else []):
                out += _check_ref(wf, st, ref, at, seen)
            out += _check_dollars(st, at)
            seen[st.id] = st
        if not any(s.call for s in wf.stages):
            out.append(f"{where}: no `call` stage; a workflow of gates alone does nothing")
    return out



def _check_dollars(st: Stage, at: str) -> list[str]:
    """A string starting with `$` that is not `$in.`, `$steps.` or `$config.` is dropped silently by
    substitution, so the endpoint would receive nothing for that key. Say so instead."""
    out = []
    for key, bad in _dollars(st.with_):
        out.append(f"{at}: `with` value {bad!r}" + (f" at {key}" if key else "") +
                   " starts with `$` but is not a reference ($in.<field>, $steps.<id>.<field>). It would be "
                   "dropped, not passed. Use a reference, or quote the value differently if it is a literal.")
    return out


def _dollars(template, path: str = "") -> list[tuple[str, str]]:
    if isinstance(template, dict):
        return [x for k, v in template.items() for x in _dollars(v, f"{path}.{k}" if path else k)]
    if isinstance(template, list):
        return [x for i, v in enumerate(template) for x in _dollars(v, f"{path}[{i}]")]
    if isinstance(template, str) and DOLLAR.match(template):
        parts = [p.strip() for p in template.split("|")]
        if any(not REF.match(p) for p in parts):
            return [(path, template)]
    return []

def target_problems(kit, system) -> list[str]:
    """Checks that need the resolved system, so `bay validate` runs them: every `call` target resolves
    and every `with` matches that endpoint's input schema."""
    out: list[str] = []
    for name, wf in load(kit).items():
        for st in wf.stages:
            if st.call:
                out += _check_call(system, st, f"agentbay.config.yaml workflows.{name} step {st.id}")
    return out


def _check_call(system, st: Stage, at: str) -> list[str]:
    try:
        _, feat = system.feature(st.call)
    except model.ResolveError as e:
        return [f"{at}: cannot call '{st.call}': {e.gaps[0]}"]
    lit = _literals(st.with_)
    if lit and feat.in_schema:
        errs = model.schema_errors(lit, _optional(copy.deepcopy(feat.in_schema)))
        if errs:
            return [f"{at}: `with` does not match {st.call} input"
                    + (f" ({feat.in_type})" if feat.in_type else "") + ": " + "; ".join(errs[:3])]
    if not st.with_ and feat.in_schema.get("required"):
        return [f"{at}: {st.call} requires {', '.join(feat.in_schema['required'])} but the stage passes no `with`"]
    return []


def _refs(template) -> list[str]:
    if isinstance(template, dict):
        return [r for v in template.values() for r in _refs(v)]
    if isinstance(template, list):
        return [r for v in template for r in _refs(v)]
    if isinstance(template, str) and REF.match(template):
        return [p.strip() for p in template.split("|")]
    return []


def _check_ref(wf: Workflow, st: Stage, ref: str, at: str, seen: dict) -> list[str]:
    m = STEPS_REF.match(ref)
    if m:
        sid = m.group(1)
        if sid == st.id:
            return [f"{at}: `{ref}` refers to its own stage"]
        if sid not in seen:
            later = wf.stage(sid)
            return [f"{at}: `{ref}` refers to "
                    + (f"stage '{sid}', which runs later" if later else f"unknown stage '{sid}'")
                    + f" (earlier stages: {', '.join(seen) or 'none'})"]
        if seen[sid].kind == "gate":
            return [f"{at}: `{ref}` reads stage '{sid}', which is an approval gate; a gate only yields "
                    f"`approved`"]
        return []
    if ref.startswith("$in.") and wf.in_schema.get("properties"):
        fld = ref[4:].split(".")[0]
        if fld not in wf.in_schema["properties"]:
            return [f"{at}: `{ref}` is not declared in workflows.{wf.name}.in.properties "
                    f"({', '.join(wf.in_schema['properties']) or 'none'})"]
    return []


def catalog_entries(system) -> dict:
    """Project workflows as the registry publishes them."""
    out = {}
    for name, wf in load(system.kit).items():
        out[name] = {
            "name": name, "description": wf.description, "effects": effects(system, wf),
            "in": wf.in_schema or None,
            "stages": [{"id": s.id, "kind": s.kind, "call": s.call, "gate": s.gate, "when": s.when}
                       for s in wf.stages],
        }
    return out
