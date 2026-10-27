"""claude-transcripts: session.events/v1 over Claude Code transcripts (bay.improve.transcripts).

Runs only on the dispatcher side; agents never read transcript files (improve-local gives roles no path to them,
and the guard denies reads outside the project)."""
from pathlib import Path

from bay.improve import sources
from bay.improve.transcripts import TranscriptSource
from bay.util import parse_time

DEFAULT_ROOT = "~/.claude/projects"


class Transcripts:
    SOURCE = "claude-transcripts"

    def __init__(self, ctx):
        self.ctx = ctx
        cfg = ctx.config or {}
        root = Path(cfg.get("root") or DEFAULT_ROOT).expanduser()
        if not root.is_absolute():
            root = (ctx.project or Path.cwd()) / root
        self.src = TranscriptSource(root, ctx.data_dir / "transcripts" / "index.json",
                                    None if cfg.get("allProjects") else ctx.project,
                                    keep_text=bool(cfg.get("keepText")))

    def episodes(self, since=None, until=None) -> dict:
        now = self.ctx.now()
        s = parse_time(since or self.ctx.settings.get("window") or "7d", now)
        u = parse_time(until, now) if until else None
        eps, stats = self.src.episodes()
        main = {e["id"] for e in eps if e["kind"] == "session" and sources.in_window(e.get("start"), s, u)}
        eps = [e for e in eps if e["id"] in main or e.get("parent") in main]
        return {"episodes": eps, "stats": stats}


def create(ctx):
    return Transcripts(ctx)
