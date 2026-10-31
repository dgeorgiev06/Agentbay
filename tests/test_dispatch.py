"""Dispatcher: schemas, grants, effects, budget, step plans, review, ledger, secrets."""
import json

from helpers import KIT, SECRETS, FakeHttp, MemProvider, cleanup, clock, edit_yaml, jresp, kit_copy, model, project, system

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
    assert r["cost"] == {"items": 7, "usd": 0.0}   # offline source is free
    evs = ledger.read(p)
    types = [e["type"] for e in evs]
    assert types == ["step.started", "step.completed", "call.completed"]
    done = evs[1]
    assert {k: done[k] for k in ("mode", "endpoint", "step", "env")} == \
        {"mode": "feed-briefing", "endpoint": "sync", "step": "fetch", "env": "local-feeds"}
    assert done["cost"] == {"items": 7, "usd": 0.0}
    sch = json.loads((KIT / "schemas/event.schema.json").read_text())
    for e in evs:
        model.jsonschema.validate(e, sch)


def test_config_lookback_default_and_caps_strictest_wins():
    p = project({"modes": {"feed-briefing": {"lookback": "1d", "maxItemsPerRun": 2}}})
    r = D(p).call("feed-briefing.sync", {})
    assert r["status"] == "partial" and r["output"]["fetched"] == 2
    assert r["output"]["budget"]["caps"]["maxItemsPerRun"] == 2        # config (2) < mode (500)
    assert "maxItemsPerRun" in r["stopped"]


def test_budget_exhausted_blocks_with_reason():
    p = project({"modes": {"feed-briefing": {"monthlyItems": 7}}})
    D(p).call("feed-briefing.sync", {})
    r = D(p).call("feed-briefing.sync", {})
    assert r["status"] == "blocked" and "monthlyItems cap reached" in r["reason"]


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
    assert nxt["role"] == "analyst" and nxt["runAs"] == "subagent_type=analyst--feed-briefing"
    assert (nxt["env"], nxt["agent"], nxt["tier"], nxt["model"]) == ("local-feeds", "claude-code", "balanced", "sonnet")
    assert "## Definition of Done" in nxt["playbookText"]
    assert {x["id"] for x in nxt["rules"]} == {"R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7"}  # executor|both
    assert nxt["skills"]["corpus-sql"] == "feed-briefing--corpus-sql"          # playbook's short name -> namespaced
    posts = nxt["previous"]["gather"]["items"]
    assert len(posts) == 7 and all(p["matched"] == ["home"] for p in posts)
    assert any(t.endswith("items.store/v1.sql '<json>'") for t in nxt["tools"])
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
    (rec,) = rv["review"]["recordedPlans"].values()                                  # the brief carries the recorded plan
    assert rec["step"] == "themes" and rec["outcome"] == "test run of themes" and rec["todo"][0]["n"] == 1
    assert {x["id"] for x in rv["review"]["rules"]} == {"R-1", "R-2", "R-3", "R-4", "R-6"}    # reviewer|both
    chk = {c["rule"]: c for c in rv["review"]["checks"]}
    assert chk["R-1"]["ok"] is False and "not stored items" in chk["R-1"]["detail"]
    verdict = {"items": [{"id": i, "verdict": "pass", "evidence": "ok"}
                         for i in ["DOD-1", "DOD-3", "DOD-4", "DOD-5", "R-2", "R-3", "R-4", "R-6"]]}
    verdict["items"][0]["cites"] = {"outcome": True, "todo": [1]}                    # optional citation of the recorded plan
    err(lambda: d.submit(r["callId"], "review", verdict), "missing ids: DOD-2", "R-1")
    bad = {"items": [dict(verdict["items"][0], cites={"todo": [0]})]}
    err(lambda: d.submit(r["callId"], "review", bad), "does not match review.verdict/v1")
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
    urls = [x["url"] for x in g["items"]]
    digest = {"period": {"from": "a", "to": "b"}, "coverage": g["coverage"],      # a url and an item id both resolve
              "themes": [{"title": "Staking", "summary": "Staking keeps growing.",
                          "citations": [urls[0], g["items"][1]["id"]]}]}
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
    out = D(p).use("analyst--feed-briefing", "items.store/v1.query", {"author": "lido"})
    assert {x["author"]["handle"] for x in out["items"]} == {"lido"}
    err(lambda: D(p).use("reviewer--delivery", "items.store/v1.query", {}), "not granted items.store/v1.query")
    err(lambda: D(p).use("analyst", "items.store/v1.query", {}), "unknown role unit 'analyst'")
    err(lambda: D(p).use("analyst--feed-briefing", "items.store/v1.sync", {}), "not granted items.store/v1.sync")


def test_effects_rechecked_at_runtime():
    p = project()
    s = system(p)
    s.kit.docs["Environment"]["local-feeds"].spec["effects"] = ["read"]   # changed after resolution
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
            blob += f.read_bytes().decode("latin-1")      # corpus.db is binary; secrets would still show
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


def no_deadcode(d):
    """The checkout copy is not a git repo, so forge.extend's `deadcode` step (tested in test_deadcode_check)
    reports no new finding here."""
    real = d._invoke
    d._invoke = lambda env, conn, iface, ep, args, **kw: \
        {"new": [], "existing": 0} if iface == "improve.detect/v1" else real(env, conn, iface, ep, args, **kw)


def test_gate_stops_and_resumes_only_on_approval():
    k = kit_copy()                          # forge.extend exists only in the agentbay checkout
    d = dispatch.Dispatcher(system(k, k), k, clock=clock)
    no_deadcode(d)
    r = d.call("forge.extend", {"goal": "add a bluesky source"})
    assert r["status"] == "needs-agent" and r["next"]["step"] == "propose"
    assert r["next"]["runAs"] == "subagent_type=builder--forge--framework-dev"
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
    no_deadcode(d)
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
    # a re-run on the same approved proposal: a scoped re-check of the failed items (once), else a full review
    path = _proposal(k, "0096-recheck.md", "status: draft\n")
    real_git, dispatch.boundary._git = dispatch.boundary._git, lambda *a: "abc123\n"      # the kit copy is no git checkout

    def to_review():
        r = d.call("forge.extend", {"goal": "recheck", "proposal": path})
        if r["status"] == "awaiting-approval":              # first run, or the proposal changed: the owner decides
            r = d.approve(r["callId"], True, by="user@tty")
        return d.submit(r["callId"], "implement", ok)

    def verdict(ids, fail=()):
        return {"items": [{"id": i, "verdict": "fail" if i in fail else "pass", "evidence": "e",
                           **({"severity": "blocker"} if i in fail else {})} for i in ids]}
    try:
        r1 = to_review()
        ids = [x["id"] for x in r1["next"]["review"]["definitionOfDone"] + r1["next"]["review"]["rules"]]
        a, b = ids[:2]
        assert "recheck" not in r1["next"]["review"]
        assert d.submit(r1["callId"], "review", verdict(ids, [a]))["review"]["failed"] == [a]    # still halts
        r2 = to_review()
        skipped = [e["step"] for e in ledger.read(k) if e.get("callId") == r2["callId"] and e["type"] == "step.skipped"]
        rc = r2["next"]["review"]["recheck"]
        assert "approve" in skipped and (rc["priorCall"], rc["failed"], rc["commits"]) == (r1["callId"], [a], "abc123..HEAD")
        assert sorted(i["id"] for i in rc["carried"]) == sorted(set(ids) - {a})
        err(lambda: d.submit(r2["callId"], "review", verdict([b])), "missing ids", a)          # every failed id is re-judged
        r = d.submit(r2["callId"], "review", verdict([a]))
        assert r["next"]["step"] == "release" and len(d._load(r2["callId"])["steps"]["review"]["items"]) == len(ids)
        r3 = to_review()                                    # the last review passed: a full review
        assert "recheck" not in r3["next"]["review"]
        d.submit(r3["callId"], "review", verdict(ids, [a]))
        r4 = to_review()
        assert r4["next"]["review"]["recheck"]["priorCall"] == r3["callId"]
        r = d.submit(r4["callId"], "review", verdict([a, b], [b]))                # a new verdict can fail a carried item
        assert r["status"] == "partial" and r["review"]["failed"] == [b] and "next" not in r
        assert "recheck" not in to_review()["next"]["review"]  # a second re-check is not allowed: full review
        (k / path).write_text((k / path).read_text() + "edit\n")
        assert "recheck" not in to_review()["next"]["review"]  # a changed proposal: the owner approved again, full review
    finally:
        dispatch.boundary._git = real_git
        cleanup(k)


def test_selector_change_forces_refresh_even_when_fresh():
    p = project()
    D(p).call("feed-briefing.sync", {})
    cfgp = p / "agentbay.config.yaml"
    import yaml
    cfg = yaml.safe_load(cfgp.read_text())
    cfg["modes"] = {"feed-briefing": {"selectors": [{"id": "home", "text": "staking"}]}}
    cfgp.write_text(yaml.safe_dump(cfg))
    r = D(p).call("feed-briefing.digest", {})
    assert r["next"]["previous"]["refresh"]["rematched"] == 2            # re-matched, not skipped as fresh
    assert {i["id"] for i in r["next"]["previous"]["gather"]["items"]} == \
        {"fake:1008", "fake:1007", "fake:1006", "fake:1005", "fake:1003"}


def _proposal(k, name, fm):
    (k / "docs/proposals").mkdir(parents=True, exist_ok=True)
    (k / f"docs/proposals/{name}").write_text(f"---\n{fm}touches: []\n---\n# {name}\n")
    return f"docs/proposals/{name}"


def _sha(path):
    import hashlib
    return hashlib.sha256(path.read_bytes()).hexdigest()


APPROVED_FM = "status: approved\napprovedBy: user\ndate: 2026-10-29\n"


def _gate_events(k, cid, etype):
    return [e for e in ledger.read(k) if e.get("callId") == cid and e["type"] == etype and e.get("step") == "approve"]


def _to_gate(d, path):
    """Call forge.extend on a proposal and, when the call asks for it, submit the propose step: the gate's plan."""
    r = d.call("forge.extend", {"goal": "build the proposal", "proposal": path})
    if r["next"]["step"] == "propose":
        r = d.submit(r["callId"], "propose", {"status": "done", "summary": "revised", "artifacts": [path]})
    return r


def test_front_matter_marker_grants_nothing():
    """A front-matter status: approved is informational: with no recorded approval propose runs and so does the gate."""
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        for fm in (APPROVED_FM, "status: draft\n", "status: approved\n", ""):
            p = _proposal(k, "0098-not-yet.md", fm)
            r = d.call("forge.extend", {"goal": "build the proposal", "proposal": p})
            # an existing proposal has nothing to draft: propose is skipped, the gate runs (the marker passes nothing)
            assert r["status"] == "awaiting-approval" and r["next"]["step"] == "approve", fm
            assert [e["step"] for e in ledger.read(k) if e.get("callId") == r["callId"] and e["type"] == "step.skipped"] == ["propose"]
        r = _to_gate(d, p)
        assert r["status"] == "awaiting-approval" and r["next"]["approves"] == {"path": p, "sha256": _sha(k / p)}
        assert "no recorded approval" in r["next"]["why"] and "informational" in r["next"]["why"]
        r = d.call("forge.extend", {"goal": "no proposal yet"})
        assert r["next"]["step"] == "propose"
        r = d.submit(r["callId"], "propose", {"status": "done", "summary": "s"})
        assert r["next"]["step"] == "approve" and "approves no file" in r["next"]["why"] and "approves" not in r["next"]
        r = d.call("forge.extend", {"goal": "outside proposals", "proposal": "../etc/passwd.md"})
        assert r["status"] == "failed" and "docs/proposals/" in r["error"]
    finally:
        cleanup(k)


def test_a_proposal_written_by_the_propose_step_is_bound_to_its_approval():
    """The gate approves the file the propose step's artifacts name, by path and sha256; a later call naming that
    file skips propose and the gate, one rule for both."""
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        r = d.call("forge.extend", {"goal": "design something new"})
        path = _proposal(k, "0097-new.md", "status: draft\n")          # what the builder wrote
        r = d.submit(r["callId"], "propose", {"status": "done", "summary": "s", "artifacts": ["bay/x.py", path]})
        assert r["next"]["approves"] == {"path": path, "sha256": _sha(k / path)}, r
        assert d.approve(r["callId"], True, by="user@tty")["next"]["step"] == "implement"
        ev = _gate_events(k, r["callId"], "step.completed")[-1]
        assert ev["data"]["approves"] == {"path": path, "sha256": _sha(k / path)}
        r2 = d.call("forge.extend", {"goal": "design something new", "proposal": path})
        assert r2["next"]["step"] == "implement"
        assert [e["step"] for e in ledger.read(k) if e.get("callId") == r2["callId"] and e["type"] == "step.skipped"] \
            == ["propose", "approve"]
        (k / path).write_text((k / path).read_text() + "edit\n")          # any edit: both run again
        assert d.call("forge.extend", {"goal": "build it again", "proposal": path})["next"]["step"] == "approve"
        # artifacts outside docs/proposals/ bind nothing
        r3 = d.call("forge.extend", {"goal": "design something new"})
        r3 = d.submit(r3["callId"], "propose", {"status": "done", "summary": "s", "artifacts": ["README.md"]})
        assert "approves" not in r3["next"] and "approves no file" in r3["next"]["why"]
    finally:
        cleanup(k)


def test_the_step_result_accepts_what_the_worker_contract_returns():
    """The contract tells agents to write `protocol: Result/v1`; the Result type takes it, so the block submits as is."""
    from bay import protocol
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        assert "protocol: Result/v1" in protocol.WORKER_CONTRACT
        block = {"protocol": "Result/v1", "taskId": "T-20261030-abcd", "status": "done", "summary": "s",
                 "artifacts": [], "followups": [], "blockers": []}
        r = d.call("forge.extend", {"goal": "no proposal yet"})
        assert d.submit(r["callId"], "propose", block)["next"]["step"] == "approve"
        bad = dict(block, protocol="Result/v2")
        r = d.call("forge.extend", {"goal": "no proposal yet"})
        err(lambda: d.submit(r["callId"], "propose", bad), "does not match Result")
    finally:
        cleanup(k)


def test_gate_plan_and_show_name_the_chat_path_when_approvals_chat_is_on():
    k = kit_copy()
    try:
        (k / "agentbay.config.yaml").write_text("apiVersion: agentbay/v2\napprovals: { chat: false }\n")
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        r = _to_gate(d, _proposal(k, "0096-chat.md", ""))
        assert "approveFromChat" not in r["next"] and "approveFromChat" not in d.show(r["callId"])["next"]
        (k / "agentbay.config.yaml").write_text("apiVersion: agentbay/v2\napprovals: { chat: true }\n")
        r = _to_gate(d, _proposal(k, "0096-chat.md", ""))
        for plan in (r["next"], d.show(r["callId"])["next"]):
            assert f"--via chat --quote" in plan["approveFromChat"] and r["callId"] in plan["approveFromChat"]
            assert "terminal" in plan["approve"]
    finally:
        cleanup(k)


def test_a_recorded_approval_of_the_unchanged_proposal_skips_the_gate():
    """`bay approve` (terminal or chat) records the proposal's path and sha256; the next call naming the same,
    unchanged file skips the gate, and the step plan and `bay show` say whose approval it was."""
    for by, quote in (("user@tty", ""), ("user@chat-via-cos", "yes, approve 0099")):
        k = kit_copy()
        try:
            d = dispatch.Dispatcher(system(k, k), k, clock=clock)
            path = _proposal(k, "0099-ok.md", APPROVED_FM)
            cid = _to_gate(d, path)["callId"]
            r = d.approve(cid, True, by=by, quote=quote, sha=_sha(k / path))
            assert r["next"]["step"] == "implement"
            ev = _gate_events(k, cid, "step.completed")[-1]
            assert ev["data"]["approves"] == {"path": path, "sha256": _sha(k / path)} and ev["data"]["by"] == by
            assert ev["data"].get("quote", "") == quote
            r = d.call("forge.extend", {"goal": "build the proposal again", "proposal": path})
            assert r["status"] == "needs-agent" and r["next"]["step"] == "implement", r
            why = d.show(r["callId"])["gates"]["approve"]
            assert why.startswith("skipped:") and f"approved by {by} on " in why and "content unchanged" in why, why
            assert f"(call {cid})" in why
            sk = _gate_events(k, r["callId"], "step.skipped")
            assert len(sk) == 1 and sk[0]["data"]["priorCall"] == cid and sk[0]["summary"] == why
            assert r["next"]["previous"]["approve"] == {"approved": True, "by": by, "priorCall": cid}
        finally:
            cleanup(k)


def test_an_edit_after_approval_makes_the_gate_run_again():
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        path = _proposal(k, "0099-ok.md", APPROVED_FM)
        f = k / path
        original = f.read_text()
        cid = _to_gate(d, path)["callId"]
        d.approve(cid, True, by="user@tty")
        f.write_text(original + "\nOne more slice, added after approval.\n")
        r = _to_gate(d, path)
        assert r["status"] == "awaiting-approval" and r["next"]["step"] == "approve", r
        assert "changed since user@tty approved it" in r["next"]["why"], r["next"]["why"]
        assert r["next"]["approves"]["sha256"] == _sha(f)
        assert "changed since" in d.show(r["callId"])["gates"]["approve"]
        # editing between the gate being shown and `bay approve` approves nothing: the owner re-reads first
        cid2 = r["callId"]
        f.write_text(original + "\nAnd another edit while the gate waits.\n")
        try:
            d.approve(cid2, True, by="user@tty")
            raise AssertionError("approved changed content")
        except dispatch.CallError as e:
            assert "changed since the gate was shown" in str(e)
        assert d.show(cid2)["status"] == "awaiting-approval"
        assert d.show(cid2)["next"]["approves"]["sha256"] == _sha(f)            # the plan shows the new content
        assert not [e for e in _gate_events(k, cid2, "step.completed")]
        assert d.approve(cid2, True, by="user@tty")["next"]["step"] == "implement"
        # only the latest decision on the path counts: the first content was superseded by the later approval
        f.write_text(original)
        assert d.call("forge.extend", {"goal": "build the proposal", "proposal": path})["next"]["step"] == "approve"
        f.write_text(original + "\nA rejected variant.\n")
        cid3 = _to_gate(d, path)["callId"]
        d.approve(cid3, False, by="user@tty", reason="no")
        r = _to_gate(d, path)
        assert r["next"]["step"] == "approve" and "was rejected by user@tty" in r["next"]["why"]
    finally:
        cleanup(k)


def test_only_bay_approve_events_count_as_a_recorded_approval():
    """A matching ledger line that `bay approve` did not write (another source, another `by`, a workflow gate)
    does not pass the gate. Subagents cannot write the ledger at all (test_boundaries)."""
    k = kit_copy()
    try:
        d = dispatch.Dispatcher(system(k, k), k, clock=clock)
        path = _proposal(k, "0099-ok.md", APPROVED_FM)
        subj = {"path": path, "sha256": _sha(k / path)}
        ledger.append(k, "step.completed", "C-x:approve", source="hook", callId="C-x", step="approve",
                      data={"approved": True, "by": "user@tty", "approves": subj})
        ledger.append(k, "note", "C-y", source="dispatcher", data={"approved": True, "by": "user@tty", "approves": subj})
        cid = _to_gate(d, path)["callId"]
        d.approve(cid, True)                                  # by="user": not a `bay approve` channel
        r = _to_gate(d, path)
        assert r["next"]["step"] == "approve" and "no recorded approval" in r["next"]["why"]
    finally:
        cleanup(k)


def test_a_gate_takes_no_when_and_approves_goes_on_a_gate_only():
    k = kit_copy()
    try:
        def edit(doc):
            wf = doc["spec"]["features"]["extend"]["steps"]
            next(s for s in wf if s.get("id") == "approve")["when"] = "!$steps.proposal.approved"
            next(s for s in wf if s.get("id") == "implement")["approves"] = "$in.proposal"
        edit_yaml(k / "modes/forge/mode.yaml", edit)
        try:
            model.resolve(model.Kit(k, k))
            raise AssertionError("resolved")
        except model.ResolveError as e:
            gaps = [str(e)]
        assert any("step approve: a gate takes no when:" in g for g in gaps), gaps
        assert any("step implement: approves: goes on a gate step only" in g for g in gaps), gaps
    finally:
        cleanup(k)


def test_when_names_only_an_earlier_step():
    k = kit_copy()
    try:
        def edit(doc):
            doc["spec"]["features"]["extend"]["steps"][1]["when"] = "!$steps.release.approved"
        edit_yaml(k / "modes/forge/mode.yaml", edit)
        try:
            model.resolve(model.Kit(k, k))
            raise AssertionError("resolved")
        except model.ResolveError as e:
            gaps = [str(e)]
        assert any("when: !$steps.release.approved" in g and "not an earlier step" in g for g in gaps), gaps
    finally:
        cleanup(k)
