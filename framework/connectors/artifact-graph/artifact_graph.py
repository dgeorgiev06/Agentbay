"""artifact-graph: artifacts.read/v1 over the project (or the kit) files and reference graph (bay.improve.graph)."""
from pathlib import Path

from bay import secretscan
from bay.connect import ConnectorError
from bay.improve import graph

REFUSED_DIRS = {".agentbay", ".claude", ".git"}
MAX_BYTES = 1_000_000


class Artifacts:
    def __init__(self, ctx):
        self.ctx = ctx
        self._graphs = {}

    def _root(self, root) -> Path:
        r = self.ctx.kit if root == "kit" else self.ctx.project
        if r is None:
            raise ConnectorError(f"artifact-graph: no {root or 'project'} root")
        return Path(r)

    def files(self, root="project") -> dict:
        return {"root": root, "files": graph.files(self._root(root))}

    def graph(self, root="project") -> dict:
        if root not in self._graphs:
            base = self._root(root)
            self._graphs[root] = graph.build(base, self.ctx.kit).as_dict()
        return {"root": root, **self._graphs[root]}

    def text(self, path, root="project") -> dict:
        base = self._root(root).resolve()
        p = (base / path).resolve()
        if Path(path).is_absolute() or not p.is_relative_to(base):
            raise ConnectorError(f"artifact-graph: {path} is outside the {root}")
        parts = set(p.relative_to(base).parts)
        if parts & REFUSED_DIRS or p.name.startswith(".env"):
            raise ConnectorError(f"artifact-graph: {path} is control-plane or secret material and is never read")
        if not p.is_file():
            raise ConnectorError(f"artifact-graph: {path} is not a file")
        if p.stat().st_size > MAX_BYTES:
            raise ConnectorError(f"artifact-graph: {path} is larger than {MAX_BYTES} bytes")
        t = p.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "text": secretscan.scrub(t), "lines": t.count("\n") + 1}


def create(ctx):
    return Artifacts(ctx)
