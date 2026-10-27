"""x-api against a fake HTTP layer: request building, pagination, token refresh, allowlist, secrets."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tests"))

from helpers import NOW, SECRETS, FakeHttp, MemProvider, clock, jresp, project, system  # noqa: E402

from bay import connect, vault  # noqa: E402
from bay.connect import NetworkDenied, Response  # noqa: E402

TIMELINE = "/2/users/42/timelines/reverse_chronological"


def tweet(i, user="7", hours=1):
    from datetime import timedelta
    ts = (NOW - timedelta(hours=hours)).isoformat().replace("+00:00", "Z")
    return {"id": str(i), "text": f"post {i}", "author_id": user, "created_at": ts, "lang": "en",
            "public_metrics": {"like_count": i, "retweet_count": 0}}


def pages(n_pages=2, per=3):
    """Pages newest-first; next_token links them."""
    out = {}
    nid = 100
    for p in range(n_pages):
        data = [tweet(nid - p * per - j, hours=1 + p * per + j) for j in range(per)]
        meta = {"newest_id": data[0]["id"], "oldest_id": data[-1]["id"], "result_count": per}
        if p < n_pages - 1:
            meta["next_token"] = f"tok{p + 1}"
        out[None if p == 0 else f"tok{p}"] = {"data": data, "meta": meta,
                                              "includes": {"users": [{"id": "7", "username": "alice", "name": "Alice"}]}}
    return out


def routes(book, *, token_status=200, rotate=True, expire_first=False):
    state = {"tokens": 0, "timeline": 0}

    def token(params, headers, form):
        state["tokens"] += 1
        if token_status != 200:
            return jresp({"error": "invalid_request"}, token_status)
        assert form["grant_type"] == "refresh_token" and form["client_id"] == SECRETS["X_CLIENT_ID"]
        body = {"access_token": f"at-SECRET-{state['tokens']}", "token_type": "bearer", "expires_in": 7200,
                "scope": "tweet.read users.read offline.access"}
        if rotate:
            body["refresh_token"] = f"rt-ROTATED-SECRET-{state['tokens']}"
        return jresp(body)

    def timeline(params, headers, form):
        state["timeline"] += 1
        if expire_first and state["timeline"] == 1:
            return jresp({"title": "Unauthorized"}, 401)
        return jresp(book[params.get("pagination_token")])

    return {("POST", "/2/oauth2/token"): token, ("GET", TIMELINE): timeline}, state


def make(transport, provider=None, config=None, allow=None):
    p = project({"connectors": {"x-api": {"userId": "42", **(config or {})}},
                 "secrets": {"provider": "env"}}, source="x-api")
    s = system(p)
    if allow is not None:
        s.kit.docs["Environment"]["local-feeds"].spec["network"]["allow"] = allow
    return connect.instantiate(s, "local-feeds", "x-api", "feed.source/v1", p, transport=transport,
                               provider=provider or MemProvider(SECRETS), clock=clock)


def test_request_building():
    x = make(FakeHttp({}))
    p = x.build_params(max_results=250, since_id="99", start_time="2026-10-20T00:00:00Z",
                       exclude=["retweets", "replies"], pagination_token="abc")
    assert p["max_results"] == 100            # capped at the API maximum
    assert p["since_id"] == "99" and "start_time" not in p   # since_id wins
    assert p["exclude"] == "retweets,replies" and p["pagination_token"] == "abc"
    assert p["expansions"] == "author_id" and "created_at" in p["tweet.fields"]
    p = x.build_params(max_results=10, start_time="2026-10-20T00:00:00Z")
    assert p["start_time"] == "2026-10-20T00:00:00Z" and "since_id" not in p and "exclude" not in p
    try:
        x.build_params(max_results=10, exclude=["quotes"])
        raise AssertionError("expected ConnectorError")
    except connect.ConnectorError as e:
        assert "exclude supports" in str(e)


def test_pagination_and_mapping():
    r, st = routes(pages(3, 3))
    http = FakeHttp(r)
    x = make(http)
    out = x.fetch(startTime="2026-10-20T00:00:00Z", maxPosts=100)
    assert len(out["posts"]) == 9 and out["truncated"] is False
    assert out["newestId"] == "100"
    tl = [q for q in http.log if q["path"] == TIMELINE]
    assert [q["params"].get("pagination_token") for q in tl] == [None, "tok1", "tok2"]
    assert all(q["host"] == "api.x.com" and q["params"]["exclude"] == "retweets,replies" for q in tl)
    assert tl[0]["headers"]["Authorization"] == "Bearer at-SECRET-1"
    p = out["posts"][0]
    assert p == {"id": "100", "source": "x", "author": {"handle": "alice", "name": "Alice"}, "text": "post 100",
                 "url": "https://x.com/alice/status/100", "createdAt": "2026-10-27T11:00:00Z",
                 "fetchedAt": "2026-10-27T12:00:00Z", "lang": "en", "metrics": {"like_count": 100, "retweet_count": 0}}


def test_read_budget_is_never_exceeded_and_cursor_matches_kept():
    served = iter(range(300, 0, -1))

    def honest(params, headers, form):        # like X: returns at most max_results, always more pages
        n = int(params["max_results"])
        data = [tweet(next(served), hours=1) for _ in range(n)]
        return jresp({"data": data, "meta": {"result_count": n, "next_token": "more"}, "includes": {"users": []}})
    r, _ = routes({})
    r[("GET", TIMELINE)] = honest
    http = FakeHttp(r)
    out = make(http).fetch(sinceId="50", maxPosts=107)
    sizes = [int(q["params"]["max_results"]) for q in http.log if q["path"] == TIMELINE]
    assert sizes == [100, 7] and http.log[1]["params"]["since_id"] == "50"
    assert out["billed"] == 107 == len(out["posts"]) and out["truncated"] is True
    assert out["newestId"] == "300"
    out = make(FakeHttp(r)).fetch(maxPosts=3)          # below the API minimum page size: no request at all
    assert out["billed"] == 0 and out["posts"] == [] and out["truncated"] is True


def test_billing_includes_posts_returned_beyond_what_is_kept():
    def big(params, headers, form):
        n = int(params["max_results"])
        data = [tweet(200 - j, hours=1 + j) for j in range(n)]
        return jresp({"data": data, "meta": {"result_count": n}, "includes": {"users": []}})
    r, _ = routes({})
    r[("GET", TIMELINE)] = big
    out = make(FakeHttp(r)).fetch(maxPosts=12)
    assert out["billed"] == 12 == len(out["posts"])


def test_deletion_check_uses_official_lookup_in_batches_and_is_billed():
    r, _ = routes(pages(1, 1))
    stored = [str(i) for i in range(1, 151)]
    gone = {"7", "120"}

    def lookup(params, headers, form):
        ids = params["ids"].split(",")
        assert len(ids) <= 100 and params["tweet.fields"] == "id"
        data = [{"id": i} for i in ids if i not in gone]
        errors = [{"resource_id": i, "resource_type": "tweet", "title": "Not Found Error"} for i in ids if i in gone]
        return jresp({"data": data, **({"errors": errors} if errors else {})})
    r[("GET", "/2/tweets")] = lookup
    http = FakeHttp(r)
    out = make(http).fetch(sinceId="1", maxPosts=500, checkIds=stored)
    looks = [q for q in http.log if q["path"] == "/2/tweets"]
    assert [len(q["params"]["ids"].split(",")) for q in looks] == [100, 50]
    assert all(q["host"] == "api.x.com" for q in looks)
    assert sorted(out["deleted"]) == ["120", "7"]
    assert out["billed"] == 1 + 148                   # 1 timeline post + 148 found posts
    assert out["checked"] == stored                   # every requested id was verified
    # rate limited half way: only the first batch counts as checked
    n = {"i": 0}

    def limited(params, headers, form):
        n["i"] += 1
        return lookup(params, headers, form) if n["i"] == 1 else jresp({"title": "Too Many Requests"}, 429)
    r[("GET", "/2/tweets")] = limited
    out = make(FakeHttp(r)).fetch(sinceId="1", maxPosts=5, checkIds=stored)
    assert out["checked"] == stored[:100] and out["deleted"] == ["7"]
    assert any("deletion check incomplete (50 not checked)" in w for w in out["warnings"])


def test_exclude_comes_from_connector_config():
    r, _ = routes(pages(1, 1))
    http = FakeHttp(r)
    make(http, config={"exclude": ["retweets"]}).fetch(maxPosts=5)
    assert next(q for q in http.log if q["path"] == TIMELINE)["params"]["exclude"] == "retweets"


def test_token_refresh_on_401_and_rotation_is_persisted_not_leaked():
    r, st = routes(pages(1, 2), expire_first=True)
    prov = MemProvider(SECRETS)
    x = make(FakeHttp(r), provider=prov)
    out = x.fetch(maxPosts=10)
    assert len(out["posts"]) == 2 and st["tokens"] == 2       # initial + refresh after 401
    assert prov.environ["X_REFRESH_TOKEN"] == "rt-ROTATED-SECRET-2"
    blob = json.dumps(out)
    for v in (*SECRETS.values(), "at-SECRET-1", "at-SECRET-2", "rt-ROTATED-SECRET-2"):
        assert v not in blob


def test_confidential_client_uses_basic_auth():
    r, _ = routes(pages(1, 1))
    http = FakeHttp(r)
    make(http).fetch(maxPosts=5)
    tok = next(q for q in http.log if q["path"] == "/2/oauth2/token")
    assert tok["headers"]["Authorization"].startswith("Basic ")
    assert tok["form"]["refresh_token"] == SECRETS["X_REFRESH_TOKEN"]


def test_refresh_failure_is_actionable_and_secret_free():
    r, _ = routes(pages(1, 1), token_status=400)
    try:
        make(FakeHttp(r)).fetch(maxPosts=5)
        raise AssertionError("expected ConnectorError")
    except connect.ConnectorError as e:
        msg = str(e)
        assert "re-authorize" in msg and "X_REFRESH_TOKEN" in msg
        assert all(v not in msg for v in SECRETS.values())


def test_allowlist_enforced_before_any_request():
    calls = []

    def transport(*a):
        calls.append(a)
        return Response(200, {}, b"{}")

    x = make(transport, allow=["example.com"])
    try:
        x.fetch(maxPosts=5)
        raise AssertionError("expected NetworkDenied")
    except NetworkDenied as e:
        assert "api.x.com is not in the env network allowlist" in str(e)
    assert calls == []
    h = connect.Http(["api.x.com"], transport)
    for bad in ("https://evil.example/2/x", "http://api.x.com/2/x"):
        try:
            h.request("GET", bad)
            raise AssertionError("expected NetworkDenied")
        except NetworkDenied:
            pass
    assert calls == []


def test_rate_limit_keeps_posts_and_warns():
    book = pages(2, 2)
    r, _ = routes(book)
    first = r[("GET", TIMELINE)]
    n = {"i": 0}

    def limited(params, headers, form):
        n["i"] += 1
        if n["i"] == 2:
            return jresp({"title": "Too Many Requests"}, 429, {"x-rate-limit-reset": "1793000000"})
        return first(params, headers, form)

    r[("GET", TIMELINE)] = limited
    out = make(FakeHttp(r)).fetch(maxPosts=50)
    assert len(out["posts"]) == 2 and out["truncated"] is True
    assert "rate limited" in out["warnings"][0]


def test_secrets_only_names_allowed_by_env_and_connector():
    acc = vault.SecretAccessor(MemProvider(SECRETS), ["X_CLIENT_ID"], ["X_*"], "x-api")
    assert acc.get("X_CLIENT_ID") == SECRETS["X_CLIENT_ID"]
    for name in ("X_REFRESH_TOKEN", "AWS_SECRET"):
        try:
            acc.get(name)
            raise AssertionError("expected SecretError")
        except vault.SecretError as e:
            assert "not allowed" in str(e)


def test_keychain_provider_command():
    seen = []

    class R:
        returncode, stdout = 0, "value-from-keychain\n"

    prov = vault.KeychainProvider(run=lambda cmd, **kw: seen.append(cmd) or R(), platform="darwin")
    assert prov.get("X_CLIENT_ID") == "value-from-keychain"
    assert seen[0] == ["security", "find-generic-password", "-s", "agentbay", "-a", "X_CLIENT_ID", "-w"]
    try:
        vault.KeychainProvider(platform="linux").get("X")
        raise AssertionError("expected SecretError")
    except vault.SecretError as e:
        assert "provider: env" in str(e)
