"""git: session.events/v1 over `git log --numstat` of the project (bay.improve.sources.git_episodes)."""
from bay.improve import sources
from bay.util import parse_time


class GitHistory:
    SOURCE = "git"

    def __init__(self, ctx):
        self.ctx = ctx

    def episodes(self, since=None, until=None) -> dict:
        now = self.ctx.now()
        s = parse_time(since or self.ctx.settings.get("window") or "7d", now)
        u = parse_time(until, now) if until else None
        eps, stats = sources.git_episodes(self.ctx.project, s, u)
        return {"episodes": eps, "stats": stats}


def create(ctx):
    return GitHistory(ctx)
