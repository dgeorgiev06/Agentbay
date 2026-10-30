"""Selectors: one shared matcher (AND within, OR across, `not` excludes), the native/local split by a source's
capability table, and validate: errors for fields a source cannot express, warnings for local-only fields
on paid sources."""
import subprocess
import sys

from helpers import KIT, NOW, gaps, project, system

from bay import selector as sel

POST = {"id": "x:1", "extId": "1", "source": "x", "kind": "post", "author": {"handle": "Vitalik", "name": "V"},
        "title": None, "text": "Staking update: see https://ethereum.org", "createdAt": "2026-10-27T10:00:00Z",
        "fetchedAt": "2026-10-27T12:00:00Z", "container": "home", "labels": ["home", "list:9"]}
MAIL = {"id": "gmail:a", "extId": "a", "source": "gmail", "kind": "email",
        "author": {"email": "alice@bank.example", "name": "Alice"}, "title": "Q4 staking pilot",
        "text": "Please review", "to": ["dima@me.example"], "cc": ["ops@bank.example"],
        "createdAt": "2026-10-20T10:00:00Z", "fetchedAt": "2026-10-27T12:00:00Z", "container": "INBOX",
        "labels": ["INBOX", "Work"], "attachments": [{"name": "deck.pdf"}]}


def m(item, s):
    return sel.matches(item, s, NOW)


def test_fields_are_anded_values_ored_and_case_insensitive():
    assert m(POST, {"id": "a", "from": "@vitalik", "text": "STAKING"})
    assert not m(POST, {"id": "a", "from": "vitalik", "text": "solana"})
    assert m(POST, {"id": "a", "from": ["lido", "vitalik"]})
    assert m(POST, {"id": "a"})                                       # no fields: everything
    assert m(POST, {"id": "a", "in": "list:9"}) and m(POST, {"id": "a", "in": ["HOME"]})
    assert not m(POST, {"id": "a", "in": "list:10"})
    assert m(POST, {"id": "a", "has": "link"}) and not m(POST, {"id": "a", "has": "attachment"})
    assert m(POST, {"id": "a", "since": "3h"}) and not m(POST, {"id": "a", "since": "1h"})
    assert m(POST, {"id": "a", "since": "2026-10-27T00:00:00Z"})


def test_email_fields_and_not():
    assert m(MAIL, {"id": "a", "from": "bank.example"}) and m(MAIL, {"id": "a", "from": "@bank.example"})
    assert m(MAIL, {"id": "a", "from": "alice@bank.example"}) and not m(MAIL, {"id": "a", "from": "bank"})
    assert m(MAIL, {"id": "a", "to": "me.example"}) and m(MAIL, {"id": "a", "to": "ops@bank.example"})   # cc counts
    assert m(MAIL, {"id": "a", "subject": "pilot", "in": "work", "has": "attachment"})
    assert not m(MAIL, {"id": "a", "subject": "review"})              # subject is the title only
    assert m(MAIL, {"id": "a", "text": "review"})                     # text covers title and body
    assert not m(MAIL, {"id": "a", "from": "bank.example", "not": {"subject": "pilot"}})
    assert not m(MAIL, {"id": "a", "not": {"from": "nobody", "in": "INBOX"}})      # any `not` field excludes
    assert m(MAIL, {"id": "a", "not": {"from": "nobody", "in": "Spam"}})
    assert sel.match_ids(MAIL, [{"id": "x", "in": "work"}, {"id": "y", "in": "spam"}, {"id": "z"}], NOW) == ["x", "z"]


def test_split_by_capability_table():
    caps = {"from": {"mode": "native", "as": "handle"}, "in": "native", "since": "native", "text": "local", "not": "local"}
    native, local = sel.split({"id": "a", "from": "v", "in": "home", "text": "t", "since": "2d",
                               "not": {"from": "spam"}}, caps)
    assert native == {"from": "v", "in": "home", "since": "2d"} and local == {"text": "t", "not": {"from": "spam"}}
    assert sel.native_key(native) == sel.native_key({"in": ["home"], "from": "v"})      # since is not part of the key
    assert sel.native_key({}) == "{}"


def test_check_errors_and_paid_warnings():
    caps = {"from": "native", "in": "native", "since": "native", "text": "local", "not": "local"}
    errs, warns = sel.check([{"id": "a", "subject": "x"}, {"id": "a", "not": {"to": "y"}}], caps,
                            connector="x-api", paid=True, where="here")
    assert any("selector 'a' uses `subject`, which source connector x-api cannot express" in e for e in errs)
    assert any("`not.to`" in e for e in errs) and any("used twice" in e for e in errs)
    errs, warns = sel.check([{"id": "a", "text": "x", "not": {"from": "y"}, "since": "2d"}], caps,
                            connector="x-api", paid=True, where="here")
    assert errs == [] and len(warns) == 2 and "billed" in warns[0] and "`text`" in warns[0]
    assert sel.check([{"id": "a", "text": "x"}], caps, connector="fake", paid=False, where="here") == ([], [])


def test_validate_reports_unexpressible_fields_and_paid_local_fields():
    p = project({"modes": {"feed-briefing": {"selectors": [{"id": "s", "subject": "x"}]}}}, source="x-api")
    g = gaps(KIT, p)
    assert any("modes.feed-briefing.selectors (env local-feeds): selector 's' uses `subject`" in x for x in g), g
    p = project({"modes": {"feed-briefing": {"selectors": [{"id": "s", "in": "home", "text": "staking"}]}}},
                source="x-api")
    s = system(p)
    assert any("`text` is matched locally on paid source x-api" in w for w in s.warnings)
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "validate"],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "matched locally on paid source x-api" in r.stdout
    assert system(project({"modes": {"feed-briefing": {"selectors": [{"id": "s", "text": "staking"}]}}})).warnings == []
    g = gaps(KIT, project({"modes": {"feed-briefing": {"selectors": [{"id": "Bad Id"}]}}}))
    assert any("modes.feed-briefing" in x and "selectors/0/id" in x for x in g), g


def test_casefold_wildcards_only_in_from_to_and_has_enum():
    ger = dict(POST, author={"handle": "Straße"}, text="GROSSE Nachricht")
    assert m(ger, {"id": "a", "from": "STRASSE"}) and m(ger, {"id": "a", "from": "straße"})   # ß casefolds to ss
    assert m(ger, {"id": "a", "text": "große"})                        # casefold: ß == ss
    assert m(MAIL, {"id": "a", "from": "*@bank.example"}) and m(MAIL, {"id": "a", "from": "ali*"})
    assert m(MAIL, {"id": "a", "to": "*.example"}) and not m(MAIL, {"id": "a", "from": "*@other.example"})
    assert not m(MAIL, {"id": "a", "from": "a.ice@bank.example"})      # `.` is literal, not a regex
    assert not m(MAIL, {"id": "a", "subject": "q4*"})                  # no wildcards outside from/to
    from helpers import model
    sch = model.inline_refs(model.data_schema("selector/v1"))
    assert model.schema_errors({"id": "a", "has": ["link", "attachment"]}, sch) == []
    assert model.schema_errors({"id": "a", "has": "metrics"}, sch)
    try:
        m(MAIL, {"id": "a", "has": "metrics"})
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "link, attachment" in str(e)


def test_glob_is_linear_with_many_stars_on_long_strings():
    import time
    assert sel.glob("*@bank.example", "alice@bank.example") and sel.glob("a*e", "ae") and sel.glob("*", "")
    assert sel.glob("a*b*c", "aXbYc") and not sel.glob("a*b*c", "aXcYb") and not sel.glob("ab*ba", "aba")
    assert sel.glob("**x**", "x") and sel.glob("news*", "news") and not sel.glob("news", "newsroom")
    assert sel.glob("a.b", "a.b") and not sel.glob("a.b", "axb")                      # `.` is literal
    t0 = time.monotonic()
    for pattern, text, want in (("*a" * 200 + "*b", "a" * 50_000, False),           # regex: catastrophic
                                ("*a" * 200 + "*", "a" * 50_000, True),
                                ("a*" * 2_000 + "c", "ab" * 50_000, False),
                                ("*" * 5_000 + "x", "y" * 100_000 + "x", True)):
        assert sel.glob(pattern, text) is want
        assert sel.matches({"author": {"handle": text}}, {"id": "w", "from": pattern}, NOW) is want
    assert time.monotonic() - t0 < 1.0


def test_wildcard_values_are_matched_locally_never_sent_to_the_source():
    caps = {"from": "native", "in": "native", "since": "native", "text": "local"}
    assert sel.split({"id": "a", "from": "vit*", "in": "home"}, caps) == ({"in": "home"}, {"from": "vit*"})
    assert sel.split({"id": "a", "from": ["lido", "*@bank.example"]}, caps) == \
        ({}, {"from": ["lido", "*@bank.example"]})                    # values are ORed: the whole field goes local
    assert sel.split({"id": "a", "from": "lido"}, caps)[0] == {"from": "lido"}
    errs, warns = sel.check([{"id": "a", "from": "vit*"}], caps, connector="x-api", paid=True, where="here")
    assert errs == [] and len(warns) == 1
    assert "field `from` has a `*` value, which x-api cannot search natively, so the native query is empty and " \
        "becomes x-api's default stream (the home timeline on X); `from` is matched locally" in warns[0]
    _, warns = sel.check([{"id": "a", "from": "vit*", "in": "home"}], caps, connector="x-api", paid=True, where="h")
    assert "so it is matched locally" in warns[0] and "default stream" not in warns[0]   # `in` stays native
    assert sel.check([{"id": "a", "from": "vit*"}], caps, connector="fake", paid=False, where="here") == ([], [])
    # fake: `from: vit*` used to fetch nothing (the source got the pattern as a handle)
    from bay import connect
    p = project()
    st = connect.instantiate(system(p), "local-feeds", "corpus-store", "items.store/v1", p,
                             settings={"lookbackMax": "30d", "selectors": [{"id": "v", "from": "vit*"}],
                                       "mode": "feed-briefing"}, clock=lambda: NOW)
    out = st.sync(lookback="3d")
    assert [c["query"] for c in st.ctx.sources["fake"].calls] == [{}]
    assert out["added"] == 2 and {i["author"]["handle"] for i in st.query()["items"]} == {"vitalik"}


def test_wildcard_from_on_x_reads_the_home_timeline_and_validate_warns():
    from helpers import SECRETS, FakeHttp, MemProvider, clock, jresp
    from bay import dispatch
    p = project({"connectors": {"x-api": {"userId": "42"}}, "secrets": {"provider": "env"},
                 "modes": {"feed-briefing": {"selectors": [{"id": "v", "from": "vit*"}]}}}, source="x-api")
    s = system(p)
    assert any("`from` has a `*` value, which x-api cannot search natively, so the native query is empty and "
               "becomes x-api's default stream (the home timeline on X)" in w for w in s.warnings), s.warnings

    def timeline(params, headers, form):
        ts = [{"id": "11", "text": "hello", "author_id": "1", "created_at": "2026-10-27T11:00:00Z"},
              {"id": "10", "text": "other", "author_id": "2", "created_at": "2026-10-27T10:00:00Z"}]
        users = [{"id": "1", "username": "vitalik"}, {"id": "2", "username": "lido"}]
        return jresp({"data": ts, "meta": {"result_count": 2}, "includes": {"users": users}})
    http = FakeHttp({("POST", "/2/oauth2/token"): lambda *a: jresp({"access_token": "at-1"}),
                     ("GET", "/2/users/42/timelines/reverse_chronological"): timeline})
    r = dispatch.Dispatcher(s, p, transport=http, provider=MemProvider(SECRETS), clock=clock).call("feed-briefing.sync", {})
    assert r["status"] == "done" and r["output"]["added"] == 1, r
    assert not any("/users/by/username/" in q["path"] for q in http.log)
    assert {q["path"] for q in http.log if q["method"] == "GET"} == {"/2/users/42/timelines/reverse_chronological"}


def test_x_from_combined_with_in_on_a_paid_source_warns_in_validate():
    """x-api fetches `from` natively (user timeline) only without `in`; together it reads the `in` stream and
    matches `from` locally (capability `localWith: [in]`), so every post of that stream is billed."""
    caps = {"from": {"mode": "native", "localWith": ["in"]}, "in": "native", "since": "native"}
    _, warns = sel.check([{"id": "a", "from": "vitalik", "in": "list:9"}], caps, connector="x-api", paid=True,
                         where="here")
    assert len(warns) == 1 and "combines `from` with `in`" in warns[0] and "billed" in warns[0]
    assert "Split it into two selectors" in warns[0]
    assert sel.check([{"id": "a", "from": "vitalik"}], caps, connector="x-api", paid=True, where="here") == ([], [])
    assert sel.check([{"id": "a", "from": "v", "in": "home"}], caps, connector="fake", paid=False,
                     where="here") == ([], [])                                      # free source: no warning
    p = project({"modes": {"feed-briefing": {"selectors": [{"id": "s", "from": "vitalik", "in": "list:9"}]}}},
                source="x-api")
    s = system(p)
    assert any("selector 's' combines `from` with `in`" in w and "x-api" in w for w in s.warnings), s.warnings
    r = subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "validate"],
                       capture_output=True, text=True)
    assert r.returncode == 0 and "combines `from` with `in`" in r.stdout
    offline = project({"modes": {"feed-briefing": {"selectors": [{"id": "s", "from": "vitalik", "in": "home"}]}}})
    assert system(offline).warnings == []
