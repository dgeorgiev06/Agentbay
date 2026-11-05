"""artifact-graph: files, text (refuses control-plane/secret files), reference graph of the kit."""
from helpers import KIT, clock, cleanup, project, system
from improve_fixtures import SECRETS

from bay import connect
from bay.connect import ConnectorError


def inst(p):
    return connect.instantiate(system(p), "improve-local", "artifact-graph", "artifacts.read/v1", p, clock=clock)


def test_files_and_text_with_refusals_and_secret_scan():
    p = project()
    try:
        (p / "app.py").write_text(f"KEY = '{SECRETS['api-key']}'\n")
        (p / ".env").write_text("X=1\n")
        (p / ".agentbay").mkdir()
        (p / ".agentbay/guard.json").write_text("{}")
        a = inst(p)
        files = {f["path"]: f for f in a.files()["files"]}
        assert "app.py" in files and files["app.py"]["kind"] == "python" and ".agentbay/guard.json" not in files
        assert "[REDACTED:api-key]" in a.text(path="app.py")["text"]
        for bad in (".env", ".agentbay/guard.json", "../x", "/etc/passwd"):
            try:
                a.text(path=bad)
                raise AssertionError(bad)
            except ConnectorError:
                pass
    finally:
        cleanup(p)


def test_kit_graph_has_concepts_edges_and_reference_counts():
    p = project()
    try:
        g = inst(p).graph(root="kit")
        nodes = {n["id"]: n for n in g["nodes"]}
        for nid in ("mode:improve", "endpoint:improve.scan", "role:analyst", "agent:claude-code", "env:improve-local",
                    "connector:claude-transcripts", "interface:session.events/v1", "schema:improve.finding/v1",
                    "type:improve/Draft", "config:improve.window", "fn:bay/dispatch.py:Dispatcher.call"):
            assert nid in nodes, nid
        edges = {(e["from"], e["to"]) for e in g["edges"]}
        assert ("env:improve-local", "connector:claude-transcripts") in edges
        assert ("mode:improve", "env:improve-local") in edges and ("mode:improve", "agent:claude-code") in edges
        assert ("interface:improve.findings/v1", "schema:improve.finding/v1") in edges
        assert nodes["role:analyst"]["refs"] >= 1 and nodes["fn:bay/dispatch.py:Dispatcher.call"]["refs"] >= 1
    finally:
        cleanup(p)
