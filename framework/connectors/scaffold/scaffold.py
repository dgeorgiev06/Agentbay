"""forge.scaffold/v1 -> bay.scaffold (the single source of truth for templates)."""
from bay import scaffold


class Scaffold:
    def __init__(self, ctx):
        self.ctx = ctx

    def create(self, kind, name, target=None, implements=None, intent=None) -> dict:
        return scaffold.create(self.ctx.kit, kind, name, target=target, implements=implements, intent=intent)


def create(ctx):
    return Scaffold(ctx)
