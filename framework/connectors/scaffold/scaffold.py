"""forge.scaffold/v1 -> bay.scaffold (the single source of truth for templates)."""
from bay import scaffold
from bay.connect import ConnectorError
from bay.proposal import ProposalError, front_matter


def kit_project(ctx):
    """fs paths are project-relative; forge's project must be the agentbay checkout it writes."""
    if ctx.project is None or ctx.project.resolve() != ctx.kit.resolve():
        raise ConnectorError(f"forge writes the agentbay checkout, but the project is {ctx.project}; build the kit "
                             f"into itself and call forge from there: ./bay.sh build --project {ctx.kit}")
    return ctx.project


class Scaffold:
    def __init__(self, ctx):
        self.ctx = ctx

    def create(self, kind, name, target=None, implements=None, intent=None) -> dict:
        return scaffold.create(kit_project(self.ctx), kind, name, target=target, implements=implements, intent=intent)


    def proposal(self, path) -> dict:
        """A proposal's approval status, from its front matter. Approved only with status, approvedBy and date."""
        root = kit_project(self.ctx)
        p = (root / path).resolve()
        if not p.is_relative_to((root / "docs" / "proposals").resolve()) or not p.is_file():
            raise ConnectorError(f"no proposal at {path} (docs/proposals/<id>.md)")
        try:
            fm = front_matter(p.read_text(encoding="utf-8"))
        except ProposalError as e:
            raise ConnectorError(f"{path}: {e}") from e
        out = {"path": path, **{k: str(fm[k]) for k in ("status", "approvedBy", "date") if fm.get(k)}}
        out["approved"] = out.get("status") == "approved" and bool(out.get("approvedBy")) and bool(out.get("date"))
        return out


def create(ctx):
    return Scaffold(ctx)
