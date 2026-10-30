"""improve-detect: improve.detect/v1 -> bay.improve.pipeline (read-only)."""
from bay.connect import ConnectorError
from bay.improve.pipeline import Pipeline


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

    def resolve(self, findings=None) -> dict:
        return self.p.resolve(findings or [])

    def recheck(self, finding) -> dict:
        return self.p.recheck(finding)


def create(ctx):
    return ImproveDetect(ctx)
