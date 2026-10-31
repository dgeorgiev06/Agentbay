"""improve-detect: improve.detect/v1 -> the pipeline module of this folder (read-only)."""
from bay import limits
from bay.connect import ConnectorError

from .pipeline import Pipeline


class ImproveDetect:
    def __init__(self, ctx):
        self.ctx = ctx
        self.p = Pipeline(ctx.sources, ctx.kit, ctx.project, ctx.settings, ctx.now())

    def sessions(self, since=None, until=None) -> dict:
        return self.p.sessions(since, until)

    def artifacts(self, root="project") -> dict:
        try:
            return self.p.audit(root)
        except ValueError as e:
            raise ConnectorError(str(e)) from None

    def change(self, base) -> dict:
        try:
            return self.p.change(base)
        except ValueError as e:
            raise ConnectorError(str(e)) from None

    def limits(self, base, proposal=None) -> dict:
        """bay/limits.py on the project; read-only (the builder's `check --limits` writes the ratchet)."""
        root = self.p.project.resolve()
        path = next(((root / x).resolve() for x in ([proposal] if isinstance(proposal, str) else proposal or []) if x and (isinstance(proposal, str) or x.startswith("docs/proposals/"))), None)  # a list: the propose step's artifacts
        try:
            if base.startswith("-") or path and not path.is_relative_to(root):
                raise ValueError("base must be a git revision and proposal a path inside the project")
            problems, notes = limits.check(root, base, path.read_text(encoding="utf-8") if path else None, write=False)
        except (RuntimeError, ValueError, OSError) as e:
            raise ConnectorError(str(e)) from None
        return {"problems": problems, "notes": notes, **({"stopped": "; ".join(problems)} if problems else {})}

    def resolve(self, findings=None) -> dict:
        return self.p.resolve(findings or [])

    def recheck(self, finding) -> dict:
        return self.p.recheck(finding)


def create(ctx):
    return ImproveDetect(ctx)
