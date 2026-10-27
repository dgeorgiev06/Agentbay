"""forge.migrate/v1 -> bay.migrate (the single source of truth for migrations)."""
from bay import migrate


class Migrator:
    def __init__(self, ctx):
        self.ctx = ctx

    def plan(self, to=None) -> dict:
        return migrate.plan(self.ctx.kit, to)

    def apply(self, to=None) -> dict:
        return migrate.apply(self.ctx.kit, to)


def create(ctx):
    return Migrator(ctx)
