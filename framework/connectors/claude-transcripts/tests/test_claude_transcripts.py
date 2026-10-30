"""claude-transcripts: defensive parsing, structure-only redaction, malformed/oversized lines, symlinks, mtime
prefilter, status questions and environment gaps. Fixture transcripts only; the real ~/.claude/projects is never
read."""
import json
import os
from datetime import datetime, timedelta, timezone

from helpers import cleanup, model, tmpdir
from improve_fixtures import ALL, CORES, make_transcripts, session_records

from bay.improve import transcripts

SCHEMA = model.data_schema("session.episode/v1")


def setup():
    base = tmpdir()
    proj, root = base / "proj", base / "cc"
    proj.mkdir()
    files = make_transcripts(root, proj)
    return base, proj, root, files, transcripts.TranscriptSource(root, proj)


def test_parses_structure_counts_and_links_subagents():
    base, proj, root, files, src = setup()
    try:
        eps, stats = src.episodes()
        sessions = [e for e in eps if e["kind"] == "session"]
        subs = [e for e in eps if e["kind"] == "subagent"]
        assert len(sessions) == 2 and len(subs) == 2 and stats["otherProjects"] == 1
        s = sessions[0]
        assert s["id"].startswith("cc:0a1b2c3d") and s["model"] == "claude-opus-5-5"
        assert [t["name"] for t in s["toolCalls"]].count("Bash") == 3
        assert len({t["inputHash"] for t in s["toolCalls"] if t["name"] == "Bash"}) == 1     # identical calls
        assert s["errors"] == 2 and s["denials"] == [{"tool": "Edit"}]                       # Bash error + denial
        assert s["interrupts"] == 1 and s["instructionChanges"] == 1 and s["permissionPrompts"] == 3
        assert s["turns"] == 3 and s["statusQuestions"] == 2 and s["envGaps"] == {"command-not-found": 1}
        assert s["compaction"] == "not-detected" and s["costUsd"] == 2.5 and s["durationMs"] == 900000
        assert s["tokens"]["input"] == 300 and s["tokens"]["cacheRead"] == 3000              # last usage per message.id
        assert [x["type"] for x in s["subagents"]] == ["reviewer", "reviewer"]
        assert s["subagents"][0]["id"] == "a0" and s["subagents"][0]["finished"] is True
        assert subs[0]["parent"] == s["id"] and subs[0]["agentType"] == "reviewer"
        assert stats["unknownRecordTypes"] == {"weird-new-type": 2}                          # counted, never fatal
        assert stats["badLines"] == 2 and stats["spillFiles"] == 2                           # half-written last lines
        assert s["meta"]["entrypoint"] == "cli" and s["meta"]["version"] == "2.1.300"
        if model.jsonschema:
            for e in eps:
                model.jsonschema.validate(e, SCHEMA)
    finally:
        cleanup(base)


def test_structure_only_no_text_no_paths_no_secrets_and_nothing_written():
    base, proj, root, files, src = setup()
    try:
        eps, stats = src.episodes()
        blob = json.dumps([eps, stats])
        for core in CORES:
            assert core not in blob, core
        for text in ("deploy it", "curl", "status?", "command not found", str(proj), "secret-branch", "github.com"):
            assert text not in blob, text
        assert not (proj / ".agentbay").exists()                                   # read-only: no cache, no files
    finally:
        cleanup(base)


def test_malformed_deep_typed_and_oversized_lines_never_fail_a_scan():
    deep = "[" * 100_000 + "]" * 100_000                                           # RecursionError in json.loads
    lines = [deep, '{"type": ["user"]}', '{"type": {"a": 1}}', '{"type": "user", "message": 5}',
             '{"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": ["x"]}]}}',
             '{"type": "assistant", "message": {"content": "x", "usage": {"input_tokens": "lots"}}}',
             '{"type": "Weird Type!"}', '{"type": "brand-new"}', "not json " + ALL, "[1,2]",
             b"x" * (transcripts.MAX_LINE_BYTES + 1)]
    acc = transcripts.parse_stream(lines)
    assert acc.bad_lines == 4                       # deep JSON, not JSON, a list, oversized
    assert acc.unknown == {"other": 3, "brand-new": 1}                     # list/dict/odd names -> "other"
    ep = transcripts._episode(acc, "cc:x", "session", None)
    assert all(c not in json.dumps(ep) for c in CORES)
    # a file with an oversized line and a deep line is scanned; its other sessions still count
    base, proj, root, files, src = setup()
    try:
        f = next(iter(files.values()))
        with open(f, "ab") as fh:
            fh.write(b"\n" + b"y" * (transcripts.MAX_LINE_BYTES + 10) + b"\n" + deep.encode() + b"\n")
        eps, stats = src.episodes()
        assert len([e for e in eps if e["kind"] == "session"]) == 2 and stats["badLines"] == 4
    finally:
        cleanup(base)


def test_unreadable_file_is_named_not_fatal():
    base, proj, root, files, src = setup()
    real = transcripts.parse_session
    bad = next(iter(files.values()))

    def flaky(path, *a, **kw):
        if path == bad:
            raise PermissionError(13, "Permission denied", str(path))
        return real(path, *a, **kw)
    try:
        transcripts.parse_session = flaky
        eps, stats = src.episodes()
        assert stats["errors"] == [{"file": bad.name, "error": "PermissionError"}]
        assert len([e for e in eps if e["kind"] == "session"]) == 1
    finally:
        transcripts.parse_session = real
        cleanup(base)


def test_symlinks_are_never_followed():
    base, proj, root, files, src = setup()
    try:
        outside = base / "outside"
        (outside / "proj-folder").mkdir(parents=True)
        recs = session_records("eeeeeeee-0000-4000-8000-000000000001", str(proj))
        (outside / "secret.jsonl").write_text("".join(json.dumps(r) + "\n" for r in recs))
        (outside / "proj-folder" / "eeeeeeee-0000-4000-8000-000000000002.jsonl").write_text(
            (outside / "secret.jsonl").read_text())
        os.symlink(outside / "secret.jsonl", root / "-encoded-project" / "linked.jsonl")      # symlinked file
        os.symlink(outside / "proj-folder", root / "-linked-folder")                          # symlinked folder
        sid = next(iter(files))
        sub = root / "-encoded-project" / sid / "subagents"
        os.symlink(outside / "secret.jsonl", sub / "agent-zz.jsonl")                          # symlinked subagent
        eps, stats = src.episodes()
        ids = {e["id"] for e in eps}
        assert not any("eeeeeeee" in i or "linked" in i or "agent-zz" in i for i in ids), ids
        assert stats["skippedSymlinks"] == 3
        assert not transcripts.safe_file(root / "-linked-folder" / "eeeeeeee-0000-4000-8000-000000000002.jsonl", root)
    finally:
        cleanup(base)


def test_mtime_prefilter_skips_old_files_without_opening_them():
    base, proj, root, files, src = setup()
    try:
        old = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
        f = next(iter(files.values()))
        os.utime(f, (old, old))
        for g in (f.parent / f.stem / "subagents").glob("agent-*"):
            os.utime(g, (old, old))
        eps, stats = src.episodes(since=datetime.now(timezone.utc) - timedelta(days=30))
        assert stats["skippedOld"] == 1 and len([e for e in eps if e["kind"] == "session"]) == 1
    finally:
        cleanup(base)


def test_status_questions_and_env_gap_classification():
    acc = transcripts.parse_stream([json.dumps({"type": "user", "message": {"content": t}}) for t in (
        "status?", "any update?", "how's it going?", "are you done yet?",
        "please add a status column to the table and update the docs", "what is the progress bar library?")])
    assert acc.status_questions == 4 and acc.turns == 6
    assert transcripts.env_gap("ModuleNotFoundError: No module named 'yaml'") == "missing-module"
    assert transcripts.env_gap("curl: (6) Could not resolve host: api.x.com") == "network-blocked"
    assert transcripts.env_gap("rm: cannot remove 'x': Operation not permitted") == "sandbox-denied"
    assert transcripts.env_gap("zsh: command not found: jq") == "command-not-found"
    assert transcripts.env_gap("AssertionError: 2 != 3") is None


def test_connector_window_and_config_root():
    from helpers import clock, project, system
    from bay import connect
    base = tmpdir()
    try:
        root = base / "cc"
        p = project({"connectors": {"claude-transcripts": {"root": str(root)}}})
        make_transcripts(root, p)
        s = system(p)
        inst = connect.instantiate(s, "improve-local", "claude-transcripts", "session.events/v1", p, clock=clock)
        out = inst.episodes(since="7d")
        assert len([e for e in out["episodes"] if e["kind"] == "session"]) == 2
        assert inst.episodes(since="1d")["episodes"] == []                    # fixture sessions are 2 days old
        assert not (p / ".agentbay").exists()
    finally:
        cleanup(base)


def test_real_layout_root_is_the_project_folder_as_the_dogfood_project_configures_it():
    """Real layout: ~/.claude/projects/-home-claude/<session>.jsonl + <session>/subagents/agent-*.jsonl, with `root`
    set to that folder: it produced 0 episodes, because only <root>/<folder>/*.jsonl was looked at."""
    from helpers import clock, project, system
    from bay import connect
    base = tmpdir()
    old_home = os.environ.get("HOME")
    try:
        os.environ["HOME"] = str(base)
        folder = base / ".claude" / "projects" / "-home-claude"
        p = project({"connectors": {"claude-transcripts": {"root": "~/.claude/projects/-home-claude"}}})
        sid = "5c5c5c5c-0000-4000-8000-000000000001"
        folder.mkdir(parents=True)
        recs = session_records(sid, str(p))
        (folder / f"{sid}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in recs))
        sub = folder / sid / "subagents"
        sub.mkdir(parents=True)
        (sub / "agent-a0.jsonl").write_text("".join(json.dumps(dict(r, isSidechain=True)) + "\n" for r in recs[:4]))
        s = system(p)
        inst = connect.instantiate(s, "improve-local", "claude-transcripts", "session.events/v1", p, clock=clock)
        out = inst.episodes(since="7d")
        kinds = sorted(e["kind"] for e in out["episodes"])
        assert kinds == ["session", "subagent"], (kinds, out["stats"])
        assert out["stats"]["sessions"] == 1 and not out["stats"]["errors"]
        if model.jsonschema:
            for e in out["episodes"]:
                model.jsonschema.validate(e, SCHEMA)
    finally:
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
        cleanup(base)


def test_infinite_and_non_finite_numbers_never_fail_a_scan():
    """JSON allows 1e999 / Infinity / NaN; they are ignored, not converted (OverflowError)."""
    lines = ['{"type": "assistant", "message": {"id": "m1", "content": [], '
             '"usage": {"input_tokens": 1e999, "output_tokens": Infinity, "cache_read_input_tokens": NaN}}}',
             '{"type": "cost-state", "totalCostUSD": Infinity, "totalDuration": 1e999}',
             '{"type": "assistant", "message": {"id": "m2", "content": [], "usage": {"input_tokens": true}}}']
    acc = transcripts.parse_stream(lines)
    ep = transcripts._episode(acc, "cc:x", "session", None)
    assert ep["tokens"]["total"] == 0 and "costUsd" not in ep
    json.dumps(ep, allow_nan=False)                                    # nothing non-finite leaks out
    base, proj, root, files, src = setup()
    try:
        with open(next(iter(files.values())), "a") as fh:
            fh.write("\n" + lines[0] + "\n" + lines[1] + "\n")
        eps, stats = src.episodes()
        assert len([e for e in eps if e["kind"] == "session"]) == 2 and not stats["errors"]
    finally:
        cleanup(base)
