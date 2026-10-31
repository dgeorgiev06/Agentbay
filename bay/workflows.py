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
stage syntax: this module holds its grammar, its validator (`check_stages`), the skip rule (`skip`),
`substitute` and the cursor rule (`advance`). A mode feature's steps (`model._feature_steps`, run by
`Dispatcher`) and a project workflow's stages (`workflow-runner`) both use them; the schemas'
`when` and `approves` patterns equal the constants below (a test compares them).

Composition stops here on purpose: a stage is not executed inside `bay call`. The dispatcher hands
the stage back as work (`cos.run` / `cos.next`), the coordinator calls that endpoint the ordinary
way, and each stage keeps its own grants, effects, budget, review and approval gates. Nothing
recurses, so there are no cycles to detect and no effect unions to propagate. The two executors stay
two (the dispatcher runs a feature's steps inside one call; the cursor hands back `nextCall`).

A gate takes no `when:` in either: it passes only by an approval, never by a value (the value of a
project stage's `when:` comes from the output the coordinator passes to `cos.next`).
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field

from .util import duration

# ---- the reference grammar, spelled once. Schemas hold the patterns built from it (config.schema.json `when`,
# mode.schema.json `when` and `approves`); tests/test_stage_syntax.py compares them.
FIELD = r"[A-Za-z][A-Za-z0-9-]*"
PATH = rf"{FIELD}(?:\.{FIELD})*"
REFERENCE = rf"\$(?:in|steps)\.{PATH}"
STALE = r"stale\s*>\s*[0-9]+[mhdw]"
WHEN_PATTERN = rf"^!?{REFERENCE}$"                                                    # a project stage
FEATURE_WHEN_PATTERN = rf"^({STALE}|!?approved\s+\$in\.{PATH}|!?{REFERENCE})$"        # a mode feature's step
APPROVES_PATTERN = rf"^\$in\.{PATH}(\|\$steps\.{PATH})?$"

REF = re.compile(r"^\$(in|steps|config)\.")          # what `with:` substitutes (a `$config.` value too)
DOLLAR = re.compile(r"^\$")
STEPS_REF = re.compile(r"^\$steps\.([a-z][a-z0-9-]*)\.")

PROJECT_GATE_FIX = ("it passes only by `bay approve <runId>`, never by a value the coordinator passes to cos.next. "
                    "Remove `when:` from this gate (put `when:` on the call stages around it if they are conditional)")
FEATURE_GATE_FIX = ("(it passes only by `bay approve`, or by a recorded approval of the exact content its approves: "
                    "names)")


@dataclass
class Stage:
    """One stage of a project workflow, or one step of a mode feature (`of_step`): the part of either that the
    stage syntax covers."""
    id: str
    call: str | None = None
    gate: str | None = None
    with_: dict = field(default_factory=dict)
    when: str | None = None
    approves: str | None = None      # a feature's gate: the project file whose content it approves
    phase: str = ""                  # a mode step's kind ("code", "role", "review", "gate"); empty for a project stage

    @property
    def kind(self) -> str:
        return self.phase or ("gate" if self.gate else "call")

    @classmethod
    def of_step(cls, step) -> "Stage":
        return cls(id=step.id, gate=step.task if step.kind == "gate" else None, with_=step.with_, when=step.when,
                   approves=step.approves, phase=step.kind)


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
    from . import model            # model imports this module, so not at the top
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
    """Checks that need no resolution, so `bay check` can run them first: stage ids, reference order, a gate
    with `when:`, and whether a workflow does anything at all."""
    out: list[str] = []
    for name, wf in load(kit).items():
        where = f"agentbay.config.yaml workflows.{name}"
        out += check_stages(wf.stages, where, PROJECT_GATE_FIX, wf)
        if not any(s.call for s in wf.stages):
            out.append(f"{where}: no `call` stage; a workflow of gates alone does nothing")
    return out


def bare_when(when: str | None) -> str:
    """A `when:` without its leading `!`."""
    when = when or ""
    return when[1:] if when.startswith("!") else when


def duplicates(ids: list[str]) -> list[str]:
    """Ids that occur more than once, in order of first repeat."""
    return list(dict.fromkeys(i for n, i in enumerate(ids) if i in ids[:n]))


def check_stages(stages: list[Stage], where: str, gate_fix: str, wf: Workflow | None = None) -> list[str]:
    """The one validator of the stage syntax. `where` names the feature or workflow; `gate_fix` ends the message
    for a gate with `when:`. Both kinds: a gate takes no `when:`, a `when:` that reads a step reads an earlier one,
    `stale` is for code steps. A project workflow (`wf` given) also: duplicate ids, the same for `with:` references,
    `$in` fields declared by the workflow, and a `$` value that is not a reference."""
    out: list[str] = []
    seen: dict[str, Stage] = {}
    for st in stages:
        at = f"{where} step {st.id}"
        if wf is not None and st.id in seen:
            out.append(f"{at}: duplicate stage id '{st.id}'")
        out += _grammar_problems(st, at, project=wf is not None)
        if st.kind == "gate" and st.when:
            out.append(f"{at}: a gate takes no when: {gate_fix}")
        else:
            refs = (_refs(st.with_) if wf is not None else []) + ([bare_when(st.when)] if st.when else [])
            for ref in refs:
                out += _check_ref(wf, st, ref, at, seen)
            if st.when and bare_when(st.when).startswith("stale") and st.kind != "code":
                out.append(f"{where} step {st.id}: `when: {st.when}` is for code steps (it asks a connector's status); "
                           f"a {st.kind} step takes `$in.<f>` or `$steps.<id>.<f>`")
        if wf is not None:
            out += _check_dollars(st, at)
        seen[st.id] = st
    return out



def _grammar_problems(st: Stage, at: str, project: bool) -> list[str]:
    """`when:` and `approves:` against the grammar. The schemas say the same at load; this keeps the validator
    right for a stage that was built in code."""
    out = []
    if st.when and not re.match(WHEN_PATTERN if project else FEATURE_WHEN_PATTERN, st.when):
        out.append(f"{at}: when: {st.when!r} is not a reference ($in.<field>, $steps.<id>.<field>, a leading `!` negates)"
                   + ("" if project else " or `stale > <age>`"))
    if st.approves and not re.match(APPROVES_PATTERN, st.approves):
        out.append(f"{at}: approves: {st.approves!r} is not `$in.<field>` (optionally `|$steps.<id>.<field>`)")
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
    """Checks that need the resolved system, so `bay check` runs them: every `call` target resolves
    and every `with` matches that endpoint's input schema."""
    out: list[str] = []
    for name, wf in load(kit).items():
        for st in wf.stages:
            if st.call:
                out += _check_call(system, st, f"agentbay.config.yaml workflows.{name} step {st.id}")
    return out


def _check_call(system, st: Stage, at: str) -> list[str]:
    from . import model
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


def _check_ref(wf: Workflow | None, st: Stage, ref: str, at: str, seen: dict) -> list[str]:
    """Problems of one reference. A feature's step (`wf` None) only reads earlier steps; a project stage also
    gets the fuller messages, the gate and `$in` checks."""
    m = STEPS_REF.match(ref)
    if m and wf is None:
        return [] if m.group(1) in seen else [f"{at}: when: {st.when} names '{m.group(1)}', which is not an earlier step"]
    if wf is None:
        return []
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


_MISSING = object()


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


def skip(when: str, inp: dict, steps: dict, fresh=None) -> bool:
    """The one skip rule. `$in.<f>` / `$steps.<id>.<f>`: skip unless truthy; a leading `!` skips when truthy instead
    (a skipped step's output counts as missing). `stale > <age>`: skip while `fresh(age)` says the store is fresher
    (a code step of a feature; no `fresh` never skips). A gate is never skipped by a value: advance refuses it."""
    neg = when.startswith("!")
    ref = when[1:] if neg else when
    if ref.startswith(("$in.", "$steps.")):
        v = substitute({"v": ref}, inp, steps, {}).get("v")
        return bool(v) if neg else not v
    age = duration(when.split(">")[1].strip())
    return bool(fresh and fresh(age))


@dataclass
class Move:
    """Where a cursor over stages stands: `call` (run `stage` with `args`), `gate` (ask the user), `done`, `missing`
    (the stage at `cursor` is gone) or `refused` (a gate with `when:`: the config must change)."""
    kind: str
    cursor: int
    skipped: list[str] = field(default_factory=list)
    stage: Stage | None = None
    args: dict = field(default_factory=dict)
    reason: str = ""


def advance(stages: list[Stage | None], cursor: int, inp: dict, results: dict, fresh=None) -> Move:
    """The one advance rule of the cursor: from `cursor`, skip stages whose `when` says so, then stop at the first
    call or gate. A gate with `when:` is refused, never evaluated, so no output passed to cos.next can skip it.
    `fresh(stage, age)` answers `stale > <age>` (a feature's code step)."""
    skipped: list[str] = []
    while cursor < len(stages):
        st = stages[cursor]
        if st is None:
            return Move("missing", cursor, skipped)
        if st.kind == "gate" and st.when:
            return Move("refused", cursor, skipped, st, reason=f"stage '{st.id}': a gate takes no when: {PROJECT_GATE_FIX}")
        if st.when and skip(st.when, inp, results, fresh and (lambda age, st=st: fresh(st, age))):
            skipped.append(st.id)
            cursor += 1
            continue
        if st.kind == "gate":
            return Move("gate", cursor, skipped, st)
        return Move("call", cursor, skipped, st, substitute(st.with_, inp, results, {}))
    return Move("done", cursor, skipped)


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
