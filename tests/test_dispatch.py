"""Dispatcher: schemas, grants, effects, budget, step plans, review, ledger, secrets."""
import json

from helpers import KIT, SECRETS, FakeHttp, MemProvider, clock, jresp, kit_copy, model, project, system

from bay import dispatch, ledger, vault


def D(p, kit=None, **kw):
    return dispatch.Dispatcher(system(p, kit), p, clock=clock, **kw)


def err(fn, *needles):
    try:
        fn()
    except dispatch.CallError as e:
        for n in needles:
            assert n in str(e), str(e)
        return str(e)
    raise AssertionError("expected CallError")


def test_input_schema_validated():
    p = project()
    err(lambda: D(p).call("feed-briefing.ask", {}), "input does not match Question", "'question' is a required property")
    err(lambda: D(p).call("feed-briefing.sync", {"lookback": "forever"}), "does not match")
    err(lambda: D(p).call("feed-briefing.nope", {}), "has no endpoint 'nope'")
    err(lambda: D(p).call("ghost.x", {}), "unknown mode 'ghost'")


def test_sync_runs_code_step_and_logs_events_with_cost():
    p = project()
    r = D(p).call("feed-briefing.sync", {"lookback": "3d"})
    assert r["status"] == "done" and r["output"]["added"] == 7
    assert r["cost"] == {"posts": 7, "usd": 0.0}   # offline source is free
    evs = ledger.read(p)
    types = [e["type"] for e in evs]
    assert types == ["step.started", "step.completed", "call.completed"]
    done = evs[1]
    assert {k: done[k] for k in ("mode", "endpoint", "step", "env")} == \
        {"mode": "feed-briefing", "endpoint": "sync", "step": "fetch", "env": "local-feeds-offline"}
    assert done["cost"] == {"posts": 7, "usd": 0.0}
    if model.jsonschema:
        sch = json.loads((KIT / "schemas/event.schema.json").read_text())
        for e in evs:
            model.jsonschema.validate(e, sch)


def test_config_lookback_default_and_caps_strictest_wins():
    p = project({"modes": {"feed-briefing": {"lookback": "1d", "maxPostsPerRun": 2}}})
    r = D(p).call("feed-briefing.sync", {})
    assert r["status"] == "partial" and r["output"]["fetched"] == 2
    assert r["output"]["budget"]["caps"]["maxPostsPerRun"] == 2        # config (2) < mode (500)
    assert "maxPostsPerRun" in r["stopped"]


def test_budget_exhausted_blocks_with_reason():
    p = project({"modes": {"feed-briefing": {"monthlyPosts": 7}}})
    D(p).call("feed-briefing.sync", {})
    r = D(p).call("feed-briefing.sync", {})
    assert r["status"] == "blocked" and "monthlyPosts cap reached" in r["reason"]


def test_offline_source_is_never_billed_against_spend():
    p = project({"modes": {"feed-briefing": {"spendUsd": 0.001}}})
    r = D(p).call("feed-briefing.sync", {})
    assert r["status"] == "done" and r["output"]["fetched"] == 7 and r["output"]["budget"]["usd"] == 0


def test_agentic_step_returns_plan_then_review_then_partial_on_failed_must():
    p = project()
    d = D(p)
    r = d.call("feed-briefing.digest", {"since": "3d"})
    assert r["status"] == "needs-agent"
    nxt = r["next"]
    assert nxt["role"] == "feed-analyst" and nxt["runAs"] == "subagent_type=feed-analyst"
    assert "## Definition of Done" in nxt["playbookText"]
    assert {x["id"] for x in nxt["rules"]} == {"R-1", "R-2", "R-3", "R-4", "R-5"}       # executor|both
    posts = nxt["previous"]["gather"]["posts"]
    assert len(posts) == 7 and nxt["tools"][0].endswith("feed.store/v1.query '<json>'")
    urls = [x["url"] for x in posts]
    digest = {"period": {"from": "2026-10-24T12:00:00Z", "to": "2026-10-27T12:00:00Z"},
              "themes": [{"title": "Institutional staking", "summary": "Banks and custodians add staking.",
                          "citations": [urls[2], "https://evil.example/not-stored"]}],
              "coverage": nxt["previous"]["gather"]["coverage"]}
    err(lambda: d.submit(r["callId"], "answer", digest), "waiting for step 'themes'")
    err(lambda: d.submit(r["callId"], "themes", {"themes": []}), "output does not match Digest")
    r2 = d.submit(r["callId"], "themes", digest)
    assert r2["status"] == "needs-agent" and r2["next"]["kind"] == "review"
    rv = r2["next"]
    assert rv["model"] == "opus" and rv["effort"] == "high" and rv["role"] == "reviewer"
    assert {x["id"] for x in rv["review"]["rules"]} == {"R-1", "R-2", "R-3", "R-4"}    # reviewer|both
    chk = {c["rule"]: c for c in rv["review"]["checks"]}
    assert chk["R-1"]["ok"] is False and "not stored posts" in chk["R-1"]["detail"]
    verdict = {"items": [{"id": i, "verdict": "pass", "evidence": "ok"}
                         for i in ["DOD-1", "DOD-3", "DOD-4", "DOD-5", "R-2", "R-3", "R-4"]]}
    err(lambda: d.submit(r["callId"], "review", verdict), "missing ids: DOD-2", "R-1")
    verdict["items"] += [{"id": "DOD-2", "verdict": "fail", "evidence": "evil.example is not stored", "severity": "blocker"},
                         {"id": "R-1", "verdict": "fail", "evidence": "check R-1 failed", "severity": "blocker"}]
    r3 = d.submit(r["callId"], "review", verdict)
    assert r3["status"] == "partial" and set(r3["review"]["failed"]) == {"DOD-2", "R-1"}
    assert r3["output"]["themes"][0]["title"] == "Institutional staking"


def test_digest_done_when_review_passes():
    p = project()
    d = D(p)
    r = d.call("feed-briefing.digest", {})
    g = r["next"]["previous"]["gather"]
    urls = [x["url"] for x in g["posts"]]
    digest = {"period": {"from": "a", "to": "b"}, "coverage": g["coverage"],
              "themes": [{"title": "Staking", "summary": "Staking keeps growing.", "citations": urls[:2]}]}
    r = d.submit(r["callId"], "themes", digest)
    ids = [x["id"] for x in r["next"]["review"]["definitionOfDone"]] + [x["id"] for x in r["next"]["review"]["rules"]]
    r = d.submit(r["callId"], "review", {"items": [{"id": i, "verdict": "pass", "evidence": "checked"} for i in ids]})
    assert r["status"] == "done" and all(c["ok"] for c in r["checks"])


def test_stale_refresh_is_skipped_when_fresh():
    p = project()
    D(p).call("feed-briefing.sync", {})
    D(p).call("feed-briefing.ask", {"question": "what about solana?"})
    skipped = [e for e in ledger.read(p) if e["type"] == "step.skipped"]
    assert skipped and skipped[0]["step"] == "refresh" and "stale > 2h" in skipped[0]["summary"]


def test_use_enforces_role_grants():
    p = project()
    D(p).call("feed-briefing.sync", {})
    out = D(p).use("feed-analyst", "feed.store/v1.query", {"author": "lido"})
    assert {x["author"]["handle"] for x in out["posts"]} == {"lido"}
    err(lambda: D(p).use("reviewer", "feed.store/v1.query", {}), "not granted feed.store/v1.query")
    err(lambda: D(p).use("feed-analyst", "feed.store/v1.sync", {}), "not granted feed.store/v1.sync")


def test_effects_rechecked_at_runtime():
    p = project()
    s = system(p)
    s.kit.docs["Environment"]["local-feeds-offline"].spec["effects"] = ["read"]   # changed after resolution
    d = dispatch.Dispatcher(s, p, clock=clock)
    err(lambda: d.call("feed-briefing.prune", {}), "effects", "not allowed")


def test_connector_failure_is_reported_redacted():
    p = project(source="x-api")
    p.joinpath("agentbay.config.yaml").write_text(
        p.joinpath("agentbay.config.yaml").read_text() + "connectors: {x-api: {userId: '42'}}\nsecrets: {provider: env}\n")

    def token(params, headers, form):
        return jresp({"error": f"bad token {form.get('refresh_token')}"}, 400)
    http = FakeHttp({("POST", "/2/oauth2/token"): token})
    prov = MemProvider(SECRETS)
    r = D(p, transport=http, provider=prov).call("feed-briefing.sync", {})
    assert r["status"] == "failed" and "token refresh failed" in r["error"]
    text = json.dumps(r) + (p / ".agentbay/ledger/events.jsonl").read_text()
    text += "".join(f.read_text() for f in (p / ".agentbay/calls").glob("*.json"))
    for v in SECRETS.values():
        assert v not in text


def test_secrets_never_in_ledger_output_or_store_on_success():
    p = project(source="x-api")
    p.joinpath("agentbay.config.yaml").write_text(
        p.joinpath("agentbay.config.yaml").read_text() + "connectors: {x-api: {userId: '42'}}\nsecrets: {provider: env}\n")
    import sys
    sys.path.insert(0, str(KIT / "connectors/x-api/tests"))
    from test_x_api import pages, routes  # noqa: E402
    r, _ = routes(pages(2, 2))
    http = FakeHttp(r)
    res = D(p, transport=http, provider=MemProvider(SECRETS)).call("feed-briefing.sync", {})
    assert res["status"] == "done" and res["output"]["added"] == 4
    blob = json.dumps(res)
    for f in p.rglob("*"):
        if f.is_file():
            blob += f.read_text()
    for v in (*SECRETS.values(), "at-SECRET-1", "rt-ROTATED-SECRET-1"):
        assert v not in blob, v
    # but the requests did carry them (the connector really used them)
    assert any("at-SECRET-1" in q["headers"].get("Authorization", "") for q in http.log)


def test_redact_is_a_last_line_of_defence():
    vault.remember("super-secret-value-123")
    assert vault.redact("x super-secret-value-123 y") == "x *** y"
    p = project()
    ledger.append(p, "note", "r", summary="leaked super-secret-value-123")
    assert "super-secret-value-123" not in (p / ".agentbay/ledger/events.jsonl").read_text()


def test_gate_stops_and_resumes_only_on_approval():
    k = kit_copy()                          # forge.extend exists only in the agentbay checkout
    d = dispatch.Dispatcher(system(k, k), k, clock=clock)
    r = d.call("forge.extend", {"goal": "add a bluesky source"})
    assert r["status"] == "needs-agent" and r["next"]["step"] == "propose"
    assert r["next"]["runAs"] == "subagent_type=builder--framework-builder"
    res = {"status": "done", "summary": "proposal written", "artifacts": ["docs/proposals/0002-bsky.md"]}
    r = d.submit(r["callId"], "propose", res)
    assert r["status"] == "awaiting-approval" and r["next"]["kind"] == "gate"
    cid = r["callId"]
    assert f".agentbay/bay approve {cid}" in r["next"]["approve"] and "own terminal" in r["next"]["approve"]
    err(lambda: d.submit(cid, "approve", {"approved": True}), "approval gate", "bay approve")   # agents cannot
    assert d.show(cid)["status"] == "awaiting-approval"
    r = d.approve(cid, True)
    assert r["next"]["step"] == "implement"
    assert d.show(cid)["next"]["step"] == "implement"
    r = d.submit(cid, "implement", {"status": "done", "summary": "implemented"})
    assert r["next"]["kind"] == "review" and r["next"]["model"] == "opus"
    # rejection path
    r = d.call("forge.extend", {"goal": "another"})
    r = d.submit(r["callId"], "propose", res)
    r = d.approve(r["callId"], False, "not now")
    assert r["status"] == "blocked" and r["reason"] == "not now"
    err(lambda: d.approve(r["callId"], True), "not awaiting approval")


def test_failed_review_halts_before_release():
    k = kit_copy()                          # forge.extend exists only in the agentbay checkout
    d = dispatch.Dispatcher(system(k, k), k, clock=clock)
    r = d.call("forge.extend", {"goal": "x change"})
    ok = {"status": "done", "summary": "s"}
    r = d.submit(r["callId"], "propose", ok)
    r = d.approve(r["callId"], True)
    r = d.submit(r["callId"], "implement", ok)
    items = [{"id": x["id"], "verdict": "pass", "evidence": "e"} for x in r["next"]["review"]["definitionOfDone"]]
    items += [{"id": x["id"], "verdict": "pass", "evidence": "e"} for x in r["next"]["review"]["rules"]]
    items[0] = {"id": items[0]["id"], "verdict": "fail", "evidence": "vocabulary drift", "severity": "blocker"}
    r = d.submit(r["callId"], "review", {"items": items})
    assert r["status"] == "partial" and "next" not in r
