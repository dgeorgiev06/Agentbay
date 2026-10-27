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
