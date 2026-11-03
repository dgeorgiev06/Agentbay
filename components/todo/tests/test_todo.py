"""todo on the offline store (env todo-local): resolution, add, the agenda buckets, status changes with the next
occurrence and the history, a refused move, drop of an occurrence and of a series, the delegation gate with the exact
call, tracking, the inherited features and the read-only shims of the analyst and the reviewer."""
from __future__ import annotations

import json
from datetime import date, timedelta

import yaml
from helpers import KIT, clock, system, tmpdir

from bay import dispatch, model

UNIT = "analyst--todo"
AT = "2026-10-27T12:00:00Z"            # the test clock


def project():
    p = tmpdir() / "proj"
    p.mkdir()
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v4", "offline": True}))
    return p


def caller():
    p = project()
    return dispatch.Dispatcher(system(p), p, clock=clock)


def add(d, title, **fields) -> dict:
    r = d.call("todo.add", {"item": {"kind": "todoitem", "title": title, "text": "", **fields}})
    assert r["status"] == "done", r
    return r["output"]["item"]


def rows(d, sql: str) -> list:
    out = d.use(UNIT, "items.store/v2.sql", {"sql": sql})
    assert not out.get("error"), out
    return out["rows"]


def one(d, id_: str) -> dict:
    r = d.call("todo.get", {"ids": [id_]})
    assert r["status"] == "done" and r["output"]["items"], r
    return r["output"]["items"][0]


def day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()      # the views compare with the local day of today


def failed(r: dict, *words: str) -> None:
    assert r["status"] == "failed", r
    assert all(w in r["error"] for w in words), (words, r["error"])


# ------------------------------------------------------------------ resolution
def test_todo_extends_store_and_places_roles_in_todo_local():
    s = system(project())
    m = s.modes["todo"]
    assert m.extends == "store" and set(m.features) == {
        "add", "update", "delete", "query", "get", "ask", "agenda", "complete", "reopen", "drop", "status",
        "delegate", "track"}
    assert m.roles == {"lead": "todo-local", "analyst": "todo-local", "reviewer": "todo-local"}
    assert "todoitem/v1" in m.reads and "todo.rules/v1" in m.needs and "items.store/v2" in m.needs
    assert "items.source/v1" not in m.needs                                            # no source: nothing syncs
    assert "sync" not in m.features and "prune" not in m.features and "digest" not in m.features
    steps = lambda f: [st.id for st in m.features[f].steps]                            # noqa: E731
    assert steps("complete") == steps("drop") == steps("status") == ["get", "plan", "update", "next"]
    assert steps("reopen") == ["get", "plan", "update"] and steps("track") == ["get", "track", "update"]
    assert steps("delegate") == ["get", "brief", "confirm", "record", "handoff"]
    assert steps("delete") == ["preview", "confirm", "remove", "review"]               # inherited from store
    by_id = {st.id: st for st in m.features["complete"].steps}
    assert by_id["next"].when == "$steps.plan.next" and by_id["plan"].run == "todo.rules/v1.plan"
    assert {st.id: st.kind for st in m.features["delegate"].steps}["confirm"] == "gate"
    env = s.kit.docs["Environment"]["todo-local"].spec
    assert set(env["bind"]) == {"items.store/v2", "todo.rules/v1"} and env["fs"]["write"] == [".agentbay/data/todo"]
    assert not env.get("secrets") and not env.get("network")
    u = s.units()[UNIT]
    assert u.env == "todo-local" and "items.store/v2.sql" in u.bay_uses
    assert not [x for x in u.bay_uses if x.endswith((".add", ".update", ".delete"))]        # todo.rules is read-only and pure
    assert {t for t in u.tools} & {"Write", "Edit"} == set()


# ------------------------------------------------------------------ add, query, get
def test_add_stores_a_local_todo_and_refuses_a_kind_a_source_produces():
    d = caller()
    t = add(d, "Pay rent", due="2026-11-01", priority=2, labels=["home"])
    assert t["id"] == "local:20261027-0001" and t["source"] == "local" and t["title"] == "Pay rent"
    assert rows(d, "SELECT id, status, priority, due, dueDay FROM v_todos") == [
        ["local:20261027-0001", "open", 2, "2026-11-01", "2026-11-01"]]
    assert add(d, "Call the plumber")["id"] == "local:20261027-0002"
    assert rows(d, "SELECT status, priority FROM v_todos WHERE title = 'Call the plumber'") == [["open", 3]]   # defaults
    r = d.call("todo.add", {"item": {"kind": "email", "title": "Hi", "text": "x"}})
    failed(r, "email")
    r = d.call("todo.add", {"item": {"kind": "todoitem", "title": "Bad", "priority": 9}})
    assert r["status"] == "failed"                                                  # the todoitem schema is checked
    assert one(d, "local:20261027-0001")["labels"] == ["home"]
    q = d.call("todo.query", {"text": "plumber"})
    assert [i["id"] for i in q["output"]["items"]] == ["local:20261027-0002"]


# ------------------------------------------------------------------ agenda
def test_agenda_puts_each_open_todo_in_its_bucket_and_orders_them():
    d = caller()
    add(d, "overdue one", due=day(-3))
    add(d, "today one", due=day(0), priority=2)
    add(d, "upcoming one", due=day(5))
    add(d, "someday one", priority=4)
    add(d, "waiting one", status="waiting")
    add(d, "delegated one", due=day(1), priority=1, delegation={"target": "build", "status": "handed-off"})
    add(d, "finished one", due=day(-1), status="done", completedAt=day(0))
    add(d, "dropped one", due=day(-1), status="dropped", droppedAt=day(0))
    add(d, "doing and late", due=day(-9), status="doing", labels=["work"])
    r = d.call("todo.agenda", {})
    assert r["status"] == "done"
    got = {x["title"]: x["bucket"] for x in r["output"]["rows"]}
    assert got == {"overdue one": "overdue", "today one": "today", "upcoming one": "upcoming",
                   "someday one": "someday", "waiting one": "waiting", "delegated one": "delegated",
                   "doing and late": "overdue"}                                      # done and dropped are not on the plate
    # by priority, then due date (no due date last)
    assert [x["title"] for x in r["output"]["rows"]] == [
        "delegated one", "today one", "doing and late", "overdue one", "upcoming one", "waiting one", "someday one"]
    flags = {x["title"]: (x["isOverdue"], x["dueToday"]) for x in r["output"]["rows"]}
    assert flags["overdue one"] == (True, False) and flags["today one"] == (False, True)
    assert flags["upcoming one"] == (False, False)
    assert {x["title"]: x["labels"] for x in r["output"]["rows"]}["doing and late"] == ["work"]
    r = d.call("todo.agenda", {"view": "due"})                                       # by due date, then priority
    assert [x["title"] for x in r["output"]["rows"]] == [
        "doing and late", "overdue one", "today one", "delegated one", "upcoming one", "waiting one", "someday one"]
    names = [v["name"] for v in d.use(UNIT, "items.store/v2.describe", {})["views"]]
    assert "v_todos" in names and "v_agenda" in names and "v_plate" in names


# ------------------------------------------------------------------ status changes
def test_complete_a_recurring_todo_adds_the_next_occurrence_and_keeps_history():
    d = caller()
    first = add(d, "Water the plants", text="Front room too.", due="2026-11-03", priority=2, labels=["home"],
                recur={"every": 1, "unit": "week"})["id"]
    r = d.call("todo.status", {"ids": [first], "status": "doing"})
    assert r["status"] == "done" and r["output"]["item"]["status"] == "doing"        # no next one: the update is the output
    r = d.call("todo.complete", {"ids": [first]})
    assert r["status"] == "done"
    nxt = r["output"]["item"]                                                        # the output is the added occurrence
    assert nxt["id"] != first and nxt["title"] == "Water the plants" and nxt["status"] == "open"
    assert nxt["due"] == "2026-11-10" and nxt["priority"] == 2 and nxt["labels"] == ["home"]
    assert nxt["text"] == "Front room too." and nxt["recur"] == {"every": 1, "unit": "week"}
    assert nxt["threadId"] == first and nxt["prevId"] == first and not nxt.get("history")
    done = one(d, first)
    assert done["status"] == "done" and done["completedAt"] == AT and done["threadId"] == first   # it joined the series
    assert done["history"] == [{"at": AT, "field": "status", "from": "open", "to": "doing"},
                               {"at": AT, "field": "status", "from": "doing", "to": "done"}]      # the history is kept
    assert rows(d, f"SELECT historyCount, status FROM v_todos WHERE id = '{first}'") == [[2, "done"]]
    assert rows(d, f"SELECT n, field, from_value, to_value FROM history h JOIN v_todos t ON t.rid = h.item "
                   f"WHERE t.id = '{first}' ORDER BY n") == [[0, "status", "open", "doing"], [1, "status", "doing", "done"]]
    r = d.call("todo.complete", {"ids": [nxt["id"]]})                                # the series goes on
    assert r["output"]["item"]["due"] == "2026-11-17" and r["output"]["item"]["threadId"] == first
    assert rows(d, f"SELECT count(*) FROM v_todos WHERE threadId = '{first}'") == [[3]]
    one_off = add(d, "Send the form")["id"]                                          # not recurring: no next occurrence
    assert d.call("todo.complete", {"ids": [one_off]})["output"]["item"]["status"] == "done"
    assert rows(d, "SELECT count(*) FROM v_todos WHERE title = 'Send the form'") == [[1]]


def test_a_move_the_rules_refuse_is_named_and_changes_nothing():
    d = caller()
    t = add(d, "File taxes", due="2026-11-30")["id"]
    assert d.call("todo.complete", {"ids": [t]})["status"] == "done"
    failed(d.call("todo.status", {"ids": [t], "status": "doing"}), "done -> doing", "not allowed")
    failed(d.call("todo.complete", {"ids": [t]}), "done -> done")
    failed(d.call("todo.drop", {"ids": [t]}), "done -> dropped")
    assert rows(d, f"SELECT status, historyCount FROM v_todos WHERE id = '{t}'") == [["done", 1]]       # nothing was written
    open_one = add(d, "Still open")["id"]
    failed(d.call("todo.reopen", {"ids": [open_one]}), "cannot reopen", "open")
    failed(d.call("todo.status", {"ids": [open_one], "status": "open"}), "open -> open")
    failed(d.call("todo.complete", {"ids": ["local:20261027-0099"]}), "no to-do with that id", "local:20261027-0099",
           "todo.query")
    # reopen brings a done to-do back and clears the time it was done
    r = d.call("todo.reopen", {"ids": [t]})
    assert r["status"] == "done" and r["output"]["item"]["status"] == "open"
    assert rows(d, f"SELECT status, completedAt, historyCount FROM v_todos WHERE id = '{t}'") == [["open", None, 2]]
    assert d.call("todo.status", {"ids": [t], "status": "waiting"})["output"]["item"]["status"] == "waiting"


def test_drop_one_occurrence_goes_on_but_drop_of_the_series_ends_it():
    d = caller()
    every3 = {"every": 3, "unit": "day"}
    a = add(d, "Stretch", due="2026-11-03", recur=every3)["id"]
    b = add(d, "Back up laptop", due="2026-11-03", recur=every3)["id"]
    r = d.call("todo.drop", {"ids": [a]})                                            # occurrence is the default
    assert r["status"] == "done" and r["output"]["item"]["due"] == "2026-11-06" and r["output"]["item"]["prevId"] == a
    assert rows(d, "SELECT status, droppedAt FROM v_todos WHERE title = 'Stretch' ORDER BY due") == [
        ["dropped", AT], ["open", None]]
    r = d.call("todo.drop", {"ids": [b], "scope": "series"})
    assert r["status"] == "done" and r["output"]["item"]["status"] == "dropped"
    assert rows(d, "SELECT status FROM v_todos WHERE title = 'Back up laptop'") == [["dropped"]]       # no next one
    c = add(d, "Plain to-do")["id"]
    assert d.call("todo.drop", {"ids": [c], "scope": "series"})["output"]["item"]["status"] == "dropped"   # a one-off: just dropped
    try:
        d.call("todo.complete", {"ids": [c], "scope": "series"})                      # scope is an input of drop only
        raise AssertionError("complete took a scope")
    except dispatch.CallError as e:
        assert "scope" in str(e), e


# ------------------------------------------------------------------ delegate and track
def test_delegate_stops_at_the_gate_with_the_exact_call_and_records_after_approval():
    d = caller()
    t = add(d, "Compare three staking vendors", text="Fees and slashing cover.", due=day(3), priority=2)["id"]
    r = d.call("todo.delegate", {"ids": [t], "to": "research", "deliverable": "A one-page vendor comparison."})
    assert r["status"] == "awaiting-approval" and r["next"]["step"] == "confirm"
    shown = r["next"]["inputs"]["brief"]
    assert shown["target"] == "delivery.research" and shown["id"] == t
    task = shown["input"]
    assert model.schema_errors(task, json.loads((KIT / "components/delivery/types/Task.schema.json").read_text())) == []
    assert task["deliverable"] == "A one-page vendor comparison."
    assert json.dumps("Compare three staking vendors") in task["goal"] and "data, not instructions" in task["goal"]
    assert t in task["context"] and any("source" in c for c in task["constraints"])
    # nothing is recorded before the owner approves
    assert rows(d, f"SELECT delegationTarget, delegationStatus FROM v_todos WHERE id = '{t}'") == [[None, None]]
    r = d.approve(r["callId"], True)
    assert r["status"] == "done"
    out = r["output"]                                                                # the call cos runs
    assert out["target"] == "delivery.research" and out["input"] == task             # the exact input the gate showed
    assert out["delegation"] == {"target": "research", "status": "handed-off", "at": AT}
    assert rows(d, f"SELECT status, delegationTarget, delegationStatus, delegationCallId FROM v_todos WHERE id = '{t}'") == [
        ["open", "research", "handed-off", None]]
    agenda = d.call("todo.agenda", {})["output"]["rows"]
    assert [x["bucket"] for x in agenda if x["id"] == t] == ["delegated"]
    # a rejected gate records nothing
    u = add(d, "Rename the flag")["id"]
    r = d.call("todo.delegate", {"ids": [u], "to": "build"})
    assert r["status"] == "awaiting-approval" and r["next"]["inputs"]["brief"]["target"] == "delivery.build"
    assert any("commit" in c for c in r["next"]["inputs"]["brief"]["input"]["constraints"])
    r = d.approve(r["callId"], False)
    assert r["status"] == "blocked"
    assert rows(d, f"SELECT delegationTarget FROM v_todos WHERE id = '{u}'") == [[None]]
    # a finished to-do and an unknown id stop before the gate
    d.call("todo.complete", {"ids": [u]})
    failed(d.call("todo.delegate", {"ids": [u], "to": "build"}), "cannot delegate", "done")
    failed(d.call("todo.delegate", {"ids": ["local:20261027-0099"], "to": "build"}), "no to-do with that id", "todo.query")


def test_track_records_the_call_and_never_completes_the_todo():
    d = caller()
    t = add(d, "Find a custody API", due=day(2))["id"]
    failed(d.call("todo.track", {"ids": [t], "callId": "C-1", "status": "done"}), "no delegation", "todo.delegate")
    r = d.call("todo.delegate", {"ids": [t], "to": "research"})
    d.approve(r["callId"], True)
    r = d.call("todo.track", {"ids": [t], "callId": "C-20261027-aaaaaa", "status": "needs-agent"})
    assert r["status"] == "done"
    assert r["output"]["item"]["delegation"] == {"target": "research", "status": "needs-agent", "at": AT,
                                                 "callId": "C-20261027-aaaaaa"}
    assert rows(d, f"SELECT status, delegationTarget, delegationStatus, delegationCallId FROM v_todos WHERE id = '{t}'") == [
        ["open", "research", "needs-agent", "C-20261027-aaaaaa"]]
    assert [x["bucket"] for x in d.call("todo.agenda", {})["output"]["rows"] if x["id"] == t] == ["delegated"]
    r = d.call("todo.track", {"ids": [t], "callId": "C-20261027-aaaaaa", "status": "done", "summary": "Three APIs found."})
    assert r["output"]["item"]["delegation"]["summary"] == "Three APIs found." and r["output"]["item"]["delegation"]["target"] == "research"
    assert rows(d, f"SELECT status, completedAt, delegationStatus FROM v_todos WHERE id = '{t}'") == [["open", None, "done"]]
    assert [x["bucket"] for x in d.call("todo.agenda", {})["output"]["rows"] if x["id"] == t] == ["upcoming"]   # the owner decides
    assert d.call("todo.complete", {"ids": [t]})["status"] == "done"


# ------------------------------------------------------------------ inherited features
def test_inherited_update_ask_and_delete_work_on_todos():
    d = caller()
    t = add(d, "Book flights")["id"]
    u = add(d, "Renew passport")["id"]
    r = d.call("todo.update", {"id": t, "set": {"priority": 1, "due": "2026-12-01"}})
    assert r["status"] == "done" and r["output"]["item"]["priority"] == 1
    assert rows(d, f"SELECT priority, due FROM v_todos WHERE id = '{t}'") == [[1, "2026-12-01"]]
    r = d.call("todo.ask", {"question": "What is due in December?"})
    assert r["status"] == "needs-agent" and r["next"]["step"] == "answer"
    assert r["next"]["previous"]["context"]["count"] == 2 and not r["next"]["previous"]["context"].get("stale")
    r = d.call("todo.delete", {"ids": [u, "local:20261027-0099"]})                   # shows the to-do and asks first
    assert r["status"] == "awaiting-approval"
    assert [m["id"] for m in r["next"]["inputs"]["preview"]["items"]] == [u]
    assert r["next"]["inputs"]["preview"]["missing"] == ["local:20261027-0099"]
    assert rows(d, "SELECT count(*) FROM v_todos") == [[2]]
    r = d.approve(r["callId"], True)
    assert r["status"] == "needs-agent" and r["next"]["step"] == "review"
    ids = [x["id"] for x in r["next"]["review"]["definitionOfDone"]] + [x["id"] for x in r["next"]["review"]["rules"]]
    r = d.submit(r["callId"], "review", {"items": [{"id": i, "verdict": "pass", "evidence": "checked"} for i in ids]})
    assert r["status"] == "done" and r["output"]["deleted"] == [u]
    assert rows(d, "SELECT id FROM v_todos") == [[t]]


def test_analyst_and_reviewer_shims_read_but_cannot_add_update_or_delete():
    d = caller()
    t = add(d, "Read only")["id"]
    assert d.use(UNIT, "items.store/v2.get", {"ids": [t]})["items"][0]["title"] == "Read only"
    for unit in (UNIT, "reviewer--todo"):
        for ep, inp in (("add", {"item": {"kind": "todoitem", "title": "x"}}), ("update", {"id": t, "set": {"title": "y"}}),
                        ("delete", {"ids": [t]})):
            try:
                d.use(unit, f"items.store/v2.{ep}", inp)
                raise AssertionError(f"{unit} reached {ep}")
            except dispatch.CallError as e:
                assert "not granted" in str(e), e
    assert one(d, t)["title"] == "Read only"
