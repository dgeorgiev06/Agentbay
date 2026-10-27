"""claude-transcripts: defensive parsing, redaction, idempotency, unknown record types. Fixture transcripts only;
the real ~/.claude/projects is never read."""
import json
import os

from helpers import KIT, cleanup, model, tmpdir
from improve_fixtures import ALL, CORES, make_transcripts

from bay.improve import transcripts

SCHEMA = model.data_schema("session.episode/v1")


def setup(keep_text=False, all_projects=False):
    base = tmpdir()
    proj, root = base / "proj", base / "cc"
    proj.mkdir()
    files = make_transcripts(root, proj)
    src = transcripts.TranscriptSource(root, proj / ".agentbay/data/improve/transcripts/index.json",
                                       None if all_projects else proj, keep_text=keep_text)
    return base, proj, root, files, src


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
        assert s["turns"] == 1 and s["compaction"] == "not-detected"
        assert s["costUsd"] == 2.5 and s["durationMs"] == 900000
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


def test_redaction_by_default_no_text_no_paths_no_secrets():
    base, proj, root, files, src = setup()
    try:
        eps, _ = src.episodes()
        blob = json.dumps(eps)
        cache = (proj / ".agentbay/data/improve/transcripts/index.json").read_text()
        for text in (blob, cache):
            for core in CORES:
                assert core not in text, core
            assert "deploy it" not in text and "curl" not in text and str(proj) not in text
            assert "secret-branch" not in text and "github.com" not in text and "excerpts" not in text
    finally:
        cleanup(base)


def test_keep_text_opt_in_is_secret_scanned():
    base, proj, root, files, src = setup(keep_text=True)
    try:
        eps, _ = src.episodes()
        s = [e for e in eps if e["kind"] == "session"][0]
        assert s["excerpts"][0]["role"] == "user" and s["excerpts"][0]["text"].startswith("deploy it, the key is")
        assert "[REDACTED:api-key]" in s["excerpts"][0]["text"]
        blob = json.dumps(eps) + (proj / ".agentbay/data/improve/transcripts/index.json").read_text()
        for core in CORES:
            assert core not in blob, core
    finally:
        cleanup(base)


def test_idempotent_by_session_id_size_and_mtime():
    base, proj, root, files, src = setup()
    try:
        _, st1 = src.episodes()
        eps2, st2 = src.episodes()
        assert st1["parsed"] == 3 and st2["parsed"] == 0 and st2["cached"] == 3
        f = next(iter(files.values()))
        with open(f, "a") as fh:                                 # a live session appends
            fh.write('\n{"type": "user", "timestamp": "2026-10-25T11:00:00Z", "message": {"content": "more"}}\n')
        os.utime(f, ns=(f.stat().st_atime_ns, f.stat().st_mtime_ns + 10**9))
        eps3, st3 = src.episodes()
        assert st3["parsed"] == 1 and st3["cached"] == 2
        assert sum(e.get("turns", 0) for e in eps3) == sum(e.get("turns", 0) for e in eps2) + 1
    finally:
        cleanup(base)


def test_garbage_never_raises_and_is_never_echoed():
    base = tmpdir()
    try:
        acc = transcripts.parse_stream(["not json " + ALL, "[1,2]", '{"type": "user", "message": 5}',
                                        '{"type": "assistant", "message": {"content": "x"}}', "", '{"type": 7}'])
        assert acc.bad_lines == 2 and acc.unknown == {"<other>": 1}
        ep = transcripts._episode(acc, "cc:x", "session", None)
        assert all(c not in json.dumps(ep) for c in CORES)
    finally:
        cleanup(base)


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
        assert (p / ".agentbay/data/improve/transcripts/index.json").exists()
    finally:
        cleanup(base)
