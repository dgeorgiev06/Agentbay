"""Deterministic rules on a slicing: the constraints, the dependency waves and the coverage of a lens's verdicts."""
from __future__ import annotations

from typing import Any

FAIL_LEVELS = ("must", "must_not")


def _paths_ok(paths: list[str], c: dict[str, Any]) -> list[str]:
    out = []
    for p in paths:
        if p.startswith("/") or ".." in p.split("/"):
            out.append(f"path '{p}' is not inside the project; declare a path relative to the project root")
        for bad in c.get("forbiddenPaths") or []:
            if p == bad.rstrip("/") or p.startswith(bad) or f"{p}/".startswith(bad):
                out.append(f"path '{p}' is under '{bad}', which constraints.forbiddenPaths keeps out of every slice")
    if len(paths) > int(c.get("maxPaths", 12)):
        out.append(f"{len(paths)} paths, over constraints.maxPaths {c.get('maxPaths', 12)}; a slice that touches "
                   f"this much is not one vertical slice, split it")
    return out


def _acceptance_ok(items: list[dict[str, Any]], c: dict[str, Any]) -> list[str]:
    out = []
    ids = [a["id"] for a in items]
    if len(set(ids)) != len(ids):
        out.append("two acceptance criteria share an id; every id is unique within the slice")
    if not any(a["level"] in FAIL_LEVELS for a in items):
        out.append("no acceptance criterion is a must or a must_not, so nothing about this slice can fail review; "
                   "state what has to be true")
    if len(items) > int(c.get("maxAcceptance", 10)):
        out.append(f"{len(items)} acceptance criteria, over constraints.maxAcceptance {c.get('maxAcceptance', 10)}; "
                   f"a slice this wide is more than one outcome, split it")
    return out


def _edges_ok(s: dict[str, Any], by_id: dict[str, dict[str, Any]], dependents: dict[str, list[str]],
              c: dict[str, Any]) -> list[str]:
    out = []
    deps = s.get("deps") or []
    if len(deps) > int(c.get("maxDeps", 3)):
        out.append(f"{len(deps)} dependencies, over constraints.maxDeps {c.get('maxDeps', 3)}; a slice that waits "
                   f"for this many is not independent")
    for d in deps:
        if d not in by_id:
            out.append(f"depends on '{d}', which is not a slice of this run")
            continue
        if d == s["id"]:
            out.append("depends on itself")
    if not c.get("requireInterfaces", True):
        return out
    mine = {(i["name"], i["role"]) for i in s.get("interfaces") or []}
    for d in deps:
        other = by_id.get(d)
        if other is None:
            continue
        theirs = {i["name"] for i in other.get("interfaces") or [] if i["role"] == "publishes"}
        shared = {n for n, role in mine if role == "consumes"} & theirs
        if not shared:
            out.append(f"depends on {d} but declares no interface it consumes that {d} publishes; name the contract "
                       f"at that edge (both sides, same name) so the two slices can be built against each other")
    if dependents.get(s["id"]) and not any(role == "publishes" for _, role in mine):
        out.append(f"{', '.join(dependents[s['id']])} depend on this slice, so it must declare the interface it "
                   f"publishes, with the shape they build against")
    return out


def waves(slices: list[dict[str, Any]]) -> tuple[list[list[str]], list[str]]:
    """Dependency waves: slices in one wave depend on nothing in it, so they can be built in parallel."""
    left = {s["id"]: set(s.get("deps") or []) for s in slices}
    done: set[str] = set()
    out: list[list[str]] = []
    while left:
        ready = sorted(i for i, deps in left.items() if deps <= done)
        if not ready:
            return out, sorted(left)
        out.append(ready)
        done |= set(ready)
        for i in ready:
            del left[i]
    return out, []


def _shared_paths(group: list[dict[str, Any]]) -> list[tuple[str, str]]:
    """(slice id, problem) for every pair of one wave that claims the same path."""
    out = []
    for i, a in enumerate(group):
        for b in group[i + 1:]:
            for pa in a["paths"]:
                for pb in b["paths"]:
                    if pa == pb or pa.startswith(f"{pb}/") or pb.startswith(f"{pa}/"):
                        claim = f"'{pa}'" if pa == pb else f"'{pa}' and '{pb}'"
                        why = (f"is built in the same wave as {b['id']} and both claim {claim}; parallel builders "
                               f"would write the same files")
                        out.append((a["id"], why))
    return sorted(set(out))


def validate(slices: list[dict[str, Any]], c: dict[str, Any]) -> tuple[list[dict[str, Any]], list[list[str]]]:
    """([{id, problems}] for every slice that breaks a rule, the dependency waves of an accepted slicing)."""
    problems: dict[str, list[str]] = {s["id"]: [] for s in slices}
    ids = [s["id"] for s in slices]
    by_id = {s["id"]: s for s in slices}
    dependents: dict[str, list[str]] = {}
    for s in slices:
        for d in s.get("deps") or []:
            dependents.setdefault(d, []).append(s["id"])
    if len(set(ids)) != len(ids):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        for i in dup:
            problems[i].append("two slices share this id; ids are unique within a run")
    if len(slices) > int(c.get("maxSlices", 20)):
        for s in slices:
            problems[s["id"]].append(f"{len(slices)} slices, over constraints.maxSlices "
                                     f"{c.get('maxSlices', 20)}; plan fewer, larger outcomes or split the run")
    for s in slices:
        p = problems[s["id"]]
        if not (s.get("outcome") or "").strip():
            p.append("no outcome: say what a user can do once this slice alone is integrated")
        p += _paths_ok(list(s["paths"]), c)
        p += _acceptance_ok(list(s["acceptance"]), c)
        p += _edges_ok(s, by_id, dependents, c)
    order, cyclic = waves(slices)
    for i in cyclic:
        problems[i].append(f"its dependencies form a cycle with {', '.join(x for x in cyclic if x != i) or 'itself'}; "
                           f"break it by publishing an interface one side builds against")
    if c.get("disjointPaths", True):
        for wave in order:
            for sid, msg in _shared_paths([by_id[i] for i in wave if i in by_id]):
                problems[sid].append(msg)
    rejected = [{"id": i, "problems": sorted(set(p))} for i, p in problems.items() if p]
    return sorted(rejected, key=lambda r: str(r["id"])), order


def missing_verdicts(slice_: dict[str, Any], lens: dict[str, Any], items: list[dict[str, Any]]) -> list[str]:
    """The ids a lens's verdict set has to cover and does not: every acceptance criterion and every lens check."""
    want = [a["id"] for a in slice_["acceptance"]] + [c["id"] for c in lens.get("checks") or []]
    got = {i["id"] for i in items}
    return [i for i in want if i not in got]


def to_findings(slice_: dict[str, Any], lens: dict[str, Any], items: list[dict[str, Any]],
                round_: int) -> list[dict[str, Any]]:
    """One finding per failed verdict item, marked blocking when the item is a must, a must_not or a blocker."""
    levels = {a["id"]: a["level"] for a in slice_["acceptance"]}
    levels.update({c["id"]: c["level"] for c in lens.get("checks") or []})
    out = []
    for i in items:
        if i["verdict"] != "fail":
            continue
        hard = levels.get(i["id"]) in FAIL_LEVELS or i.get("severity") == "blocker"
        out.append({"lens": lens["id"], "id": i["id"], "level": levels.get(i["id"], "should"),
                    "severity": i.get("severity") or ("blocker" if hard else "should-fix"),
                    "evidence": i["evidence"], "suggestion": i.get("suggestion", ""),
                    "blocking": bool(hard and lens.get("blocking", True)), "round": round_, "open": True})
    return out
