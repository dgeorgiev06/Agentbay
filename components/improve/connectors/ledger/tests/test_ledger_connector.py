"""ledger connector: calls/runs/notes -> episodes; call state -> verdicts with rounds and DoD/rule text."""
import json

from helpers import clock, cleanup, model, project, system
from improve_fixtures import CORES, make_ledger

from bay import connect


def inst(p, iface):
    return connect.instantiate(system(p), "improve-local", "ledger", iface, p, clock=clock)


def test_episodes_from_calls_runs_and_instruction_notes():
    p = project()
    try:
        ids = make_ledger(p)
        out = inst(p, "session.events/v1").episodes(since="7d")
        eps = {e["id"]: e for e in out["episodes"]}
        c0 = eps[f"ab:{ids[0]}"]
        assert c0["kind"] == "call" and c0["target"] == "forge.extend" and c0["status"] == "partial"
        assert c0["durationMs"] == 2_500_000 and c0["costUsd"] == 1.5 and c0["instructionChanges"] == 1
        impl = [s for s in c0["steps"] if s["id"] == "implement"][0]
        assert impl["name"] == "forge.extend.implement" and impl["durationMs"] == 2_400_000 and impl["env"] == "framework-dev"
        assert eps["ab:run:agent-1"]["denials"] == [{"tool": "Bash"}, {"tool": "Bash"}]
        assert out["stats"]["instructionNotes"] == 2 and not any("free" in i for i in eps)   # plain notes: no episode
        assert all(c not in json.dumps(out) for c in CORES)
        if model.jsonschema:
            for e in out["episodes"]:
                model.jsonschema.validate(e, model.data_schema("session.episode/v1"))
        assert inst(p, "session.events/v1").episodes(since="1h")["episodes"] == []
    finally:
        cleanup(p)


def test_verdicts_have_rounds_subjects_texts_and_no_secrets():
    p = project()
    try:
        make_ledger(p)
        out = inst(p, "review.verdicts/v1").verdicts(since="7d")
        vs = out["verdicts"]
        assert [v["round"] for v in vs] == [1, 2, 3] and {v["subject"] for v in vs} == {"docs/proposals/0002.md"}
        it = {i["id"]: i for i in vs[0]["items"]}
        assert it["DOD-5"]["severity"] == "blocker" and "tests/run.py" in it["DOD-5"]["evidence"]
        assert it["DOD-7"]["text"].startswith("Scope")             # DoD text resolved from the kit's forge.extend
        assert "[REDACTED:password]" in it["DOD-5"]["evidence"]
        assert all(c not in json.dumps(out) for c in CORES)
    finally:
        cleanup(p)
