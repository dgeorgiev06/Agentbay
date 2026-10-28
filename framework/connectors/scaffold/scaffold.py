"""forge.scaffold/v1 -> bay.scaffold (the single source of truth for templates)."""
from bay import scaffold
from bay.connect import ConnectorError


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


def create(ctx):
    return Scaffold(ctx)
