"""git: session.events/v1 over `git log --numstat` of the project (git_episodes.py in this folder)."""
from bay.util import parse_time

from .git_episodes import git_episodes


class GitHistory:
    SOURCE = "git"

    def __init__(self, ctx):
        self.ctx = ctx

    def episodes(self, since=None, until=None) -> dict:
        now = self.ctx.now()
        s = parse_time(since or self.ctx.settings.get("window") or "7d", now)
        u = parse_time(until, now) if until else None
        eps, stats = git_episodes(self.ctx.project, s, u)
        return {"episodes": eps, "stats": stats}


def create(ctx):
    return GitHistory(ctx)
