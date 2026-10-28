"""ledger: session.events/v1 + review.verdicts/v1 over .agentbay/ledger and .agentbay/calls (bay.improve.sources)."""
from bay.improve import sources
from bay.util import parse_time


def window(ctx, since, until):
    now = ctx.now()
    s = parse_time(since or ctx.settings.get("window") or "7d", now)
    return s, (parse_time(until, now) if until else None)


class Ledger:
    SOURCE = "ledger"

    def __init__(self, ctx):
        self.ctx = ctx

    def episodes(self, since=None, until=None) -> dict:
        eps, stats = sources.ledger_episodes(self.ctx.project, *window(self.ctx, since, until))
        return {"episodes": eps, "stats": stats}

    def verdicts(self, since=None, until=None) -> dict:
        vs, stats = sources.ledger_verdicts(self.ctx.project, self.ctx.kit, *window(self.ctx, since, until))
        return {"verdicts": vs, "stats": stats}


def create(ctx):
    return Ledger(ctx)
