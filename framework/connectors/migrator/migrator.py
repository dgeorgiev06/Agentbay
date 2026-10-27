"""forge.migrate/v1 -> bay.migrate (the single source of truth for migrations)."""
from bay import migrate
from bay.connect import ConnectorError


def kit_project(ctx):
    """fs paths are project-relative; forge's project must be the agentbay checkout it migrates."""
    if ctx.project is None or ctx.project.resolve() != ctx.kit.resolve():
        raise ConnectorError(f"forge migrates the agentbay checkout, but the project is {ctx.project}; run it from "
                             f"the kit itself: ./bay.sh build --project {ctx.kit}")
    return ctx.project


class Migrator:
    def __init__(self, ctx):
        self.ctx = ctx

    def plan(self, to=None) -> dict:
        kit = kit_project(self.ctx)
        return migrate.plan(kit, to, project=kit)

    def apply(self, to=None) -> dict:
        kit = kit_project(self.ctx)
        return migrate.apply(kit, to, project=kit)


def create(ctx):
    return Migrator(ctx)
