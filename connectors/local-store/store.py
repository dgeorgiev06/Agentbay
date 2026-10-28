"""local-store: feed.store/v1 on local files.

Files (in the env's write path, default .agentbay/data/feeds/):
  posts.jsonl   one feed.post/v1 per line, dedup key `source:id`
  state.json    {cursors: {connector: {newestId, lastSync}}, coverage: {from, to},
                 budget: {"YYYY-MM": {posts, usd}}, deleted: [source:id, ...], count: N}
                count is kept in step with posts.jsonl on every write, so status never reads posts

Budget is enforced here, before each source fetch: the run is capped at the
strictest of maxPostsPerRun, monthlyPosts - used and (spendUsd - spent) /
costPerPostUsd. When a cap leaves nothing to fetch, or the source still had
more when the cap was reached, sync stops and says which cap stopped it.
"""
from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

from bay.config import COST_PER_POST_USD
from bay.util import duration, iso, parse_time, read_json, write_json

DELETION_CHECK_SHARE = 0.5     # at most this share of a run's read budget goes to re-checking stored posts


class StoreError(Exception):
    pass


def key(p: dict) -> str:
    return f"{p['source']}:{p['id']}"


class LocalStore:
    def __init__(self, ctx):
        self.ctx = ctx
        self.dir: Path = ctx.data_dir
        self.posts_path = self.dir / "posts.jsonl"
        self.state_path = self.dir / "state.json"

    # ------------------------------------------------------------ files
    def _posts(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        if self.posts_path.exists():
            for n, line in enumerate(self.posts_path.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    p = json.loads(line)
                except json.JSONDecodeError as e:
                    raise StoreError(f"{self.posts_path}:{n}: corrupt line ({e.msg}); fix or delete that line") from e
                out[key(p)] = p
        return out

    def _write_posts(self, posts: dict[str, dict]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        ordered = sorted(posts.values(), key=lambda p: (p["createdAt"], key(p)))
        tmp = self.posts_path.with_suffix(".jsonl.tmp")
        tmp.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in ordered), encoding="utf-8")
        tmp.replace(self.posts_path)

    def _save(self, posts: dict[str, dict], state: dict) -> None:
        """Write posts, then state with the post count (status reads the count, not the posts)."""
        self._write_posts(posts)
        state["count"] = len(posts)
        write_json(self.state_path, state)

    def _count(self, state: dict) -> int:
        if isinstance(state.get("count"), int):
            return state["count"]
        if not self.posts_path.exists():                 # store written before `count` existed: count lines,
            return 0                                     # without parsing; the next sync or prune records it
        with self.posts_path.open(encoding="utf-8") as f:
            return sum(1 for line in f if line.strip())

    def _state(self) -> dict:
        s = read_json(self.state_path, {}) or {}
        s.setdefault("cursors", {})
        s.setdefault("coverage", {"from": None, "to": None})
        s.setdefault("budget", {})
        s.setdefault("deleted", [])
        return s

    # ------------------------------------------------------------ helpers
    def _month(self) -> str:
        return f"{self.ctx.now():%Y-%m}"

    def _usage(self, state: dict) -> dict:
        return state["budget"].setdefault(self._month(), {"posts": 0, "usd": 0.0})

    def _cost(self, src=None) -> float:
        """Price per post read: the source connector's own price if it declares one, else the caps' price."""
        if src is not None and src.ctx.cost_per_post is not None:
            return float(src.ctx.cost_per_post)
        return float(self.ctx.caps.get("costPerPostUsd", COST_PER_POST_USD))

    def _remaining(self, state: dict, run_posts: int, want: int | None, cost: float) -> tuple[int, str | None]:
        caps = self.ctx.caps
        use = self._usage(state)
        limits = []
        if "maxPostsPerRun" in caps:
            limits.append((caps["maxPostsPerRun"] - run_posts, "maxPostsPerRun"))
        if "monthlyPosts" in caps:
            limits.append((caps["monthlyPosts"] - use["posts"], "monthlyPosts"))
        if "spendUsd" in caps and cost > 0:
            limits.append((math.floor(round((caps["spendUsd"] - use["usd"]) / cost, 6)), "spendUsd"))
        if want is not None:
            limits.append((want - run_posts, None))
        if not limits:
            return 10 ** 9, None
        n, why = min(limits, key=lambda x: x[0])
        return max(0, n), why

    def coverage(self, state: dict, requested_from: datetime | None = None) -> dict:
        cov = dict(state["coverage"])
        cov["requestedFrom"] = iso(requested_from) if requested_from else None
        complete = True
        note = ""
        if cov.get("from") is None:
            complete, note = False, "the store is empty: run feed-briefing.sync first"
        elif requested_from is not None and requested_from < parse_time(cov["from"], self.ctx.now()):
            complete = False
            note = (f"requested from {iso(requested_from)} but the store only covers from {cov['from']}; "
                    f"older posts are not available (source API window or budget limited the history)")
        cov["complete"] = complete
        if note:
            cov["note"] = note
        return cov

    # ------------------------------------------------------------ endpoints
    def sync(self, lookback: str | None = None, maxPosts: int | None = None) -> dict:
        now = self.ctx.now()
        lookback = lookback or self.ctx.settings.get("lookback")
        if not lookback:
            raise StoreError("no lookback: pass one, or give `lookback` a default in the mode's config schema")
        lb = duration(lookback)
        lb_max = self.ctx.settings.get("lookbackMax")
        if lb_max and lb > duration(lb_max):
            raise StoreError(f"lookback {lookback} exceeds the mode's lookbackMax {lb_max}")
        state = self._state()
        posts = self._posts()
        deleted = set(state["deleted"])
        window_from = now - lb
        added = fetched = billed = n_deleted = 0
        spent = 0.0
        stopped: str | None = None
        warnings: list[str] = []
        sources: dict[str, dict] = {}
        for name, src in self.ctx.sources.items():
            cur = state["cursors"].setdefault(name, {})
            remaining, why = self._remaining(state, billed, maxPosts, self._cost(src))
            if remaining <= 0:
                stopped = stopped or (f"{why} cap reached: nothing fetched from {name}" if why
                                      else f"maxPosts {maxPosts} reached before {name}")
                sources[name] = {"fetched": 0, "added": 0, "skipped": "budget"}
                continue
            start = window_from
            if src.ctx.window and now - duration(src.ctx.window) > start:
                start = now - duration(src.ctx.window)
                warnings.append(f"{name}: lookback {lookback} is longer than the source API serves "
                                f"({src.ctx.window}); posts before {iso(start)} come only from the store")
            # reserve the deletion-check share first, the timeline gets the rest (each check reads <= 1 post)
            src_id = src.ctx.source_id
            if not src_id:
                raise StoreError(f"connector {name} declares no `source`; set spec.source in its connector.yaml "
                                 f"so stored posts and deletions are keyed correctly")
            check = self._check_candidates(state, posts, src_id, start)[: int(remaining * DELETION_CHECK_SHARE)]
            req: dict = {"maxPosts": remaining - len(check)}
            if check:
                req["checkIds"] = check
            have_from = parse_time(cur["from"], now) if cur.get("from") else None
            incremental = bool(cur.get("newestId")) and have_from is not None and have_from <= start
            if incremental:
                req["sinceId"] = cur["newestId"]
            else:
                req["startTime"] = iso(start)
            res = src.fetch(**req)
            warnings += res.get("warnings", [])
            got = res["posts"]
            n_new = 0
            for p in got:
                if p["source"] != src_id:
                    raise StoreError(f"connector {name} returned a post with source '{p['source']}' but declares "
                                     f"source '{src_id}'")
                k = key(p)
                if k in deleted:
                    continue
                n_new += k not in posts
                posts[k] = p
            for pid in res.get("deleted", []):
                dk = f"{src_id}:{pid}"
                deleted.add(dk)
                n_deleted += posts.pop(dk, None) is not None
            fetched += len(got)
            added += n_new
            billed += res["billed"]
            use = self._usage(state)
            use["posts"] += res["billed"]                       # bill what the source read, not what we kept
            use["usd"] = round(use["usd"] + res["billed"] * self._cost(src), 6)
            spent += res["billed"] * self._cost(src)
            self._mark_checked(state, src_id, res.get("checked", []))
            # contiguous coverage for this source
            src_from = have_from if incremental else start
            if res["truncated"]:
                # sources return newest first: we hold [oldest fetched, now]; anything older may have a gap
                src_from = min(parse_time(p["createdAt"], now) for p in got) if got else now
                rem_after, why_after = self._remaining(state, billed, maxPosts, self._cost(src))
                if rem_after <= 0:
                    stopped = (f"{why_after} cap reached during {name} sync" if why_after
                               else f"maxPosts {maxPosts} reached during {name} sync") \
                        + f"; kept the newest posts, coverage now starts {iso(src_from)}"
                else:
                    stopped = stopped or f"{name} stopped early; see warnings"
            cur["from"], cur["to"] = iso(src_from), iso(now)
            if res.get("newestId"):
                cur["newestId"] = _max_id(cur["newestId"], res["newestId"]) if cur.get("newestId") else res["newestId"]
            cur["lastSync"] = iso(now)
            sources[name] = {"fetched": len(got), "added": n_new, "billed": res["billed"],
                             "requests": res.get("requests", 0), "truncated": res["truncated"],
                             "mode": "since_id" if incremental else "start_time",
                             "checked": len(res.get("checked", [])), "deleted": len(res.get("deleted", []))}
        state["coverage"] = self._overall(state)
        state["deleted"] = sorted(deleted)
        self._save(posts, state)
        out = {"added": added, "fetched": fetched, "billed": billed, "deleted": n_deleted, "spentUsd": round(spent, 6),
               "stopped": stopped, "sources": sources,
               "budget": self._budget(state), "coverage": self.coverage(state, window_from)}
        if warnings:
            out["warnings"] = warnings
        return out

    def _check_candidates(self, state: dict, posts: dict, src_id: str, since) -> list[str]:
        """Stored ids of this source still inside the API window, least recently checked first."""
        now = self.ctx.now()
        checked = state.setdefault("checked", {})
        for k in [k for k in checked if k not in posts]:
            checked.pop(k)
        mine = [k for k, p in posts.items() if p["source"] == src_id and parse_time(p["createdAt"], now) >= since]
        mine.sort(key=lambda k: (checked.get(k, ""), k))
        return [posts[k]["id"] for k in mine]

    def _mark_checked(self, state: dict, src_id: str, ids: list[str]) -> None:
        """Only ids the source reports as actually verified count as checked."""
        now = iso(self.ctx.now())
        for i in ids:
            state.setdefault("checked", {})[f"{src_id}:{i}"] = now

    def _overall(self, state: dict) -> dict:
        """Coverage every bound source can vouch for: latest `from`, earliest `to`."""
        names = list(self.ctx.sources) or list(state["cursors"])
        curs = [state["cursors"].get(n, {}) for n in names]
        if not curs or any(not c.get("from") for c in curs):
            return {"from": None, "to": None}
        return {"from": max(c["from"] for c in curs), "to": min(c["to"] for c in curs)}

    def _budget(self, state: dict) -> dict:
        use = self._usage(state)
        caps = {k: v for k, v in self.ctx.caps.items() if k != "costPerPostUsd"}
        return {"month": self._month(), "posts": use["posts"], "usd": round(use["usd"], 4),
                "caps": caps, "costPerPostUsd": self.ctx.caps.get("costPerPostUsd", COST_PER_POST_USD)}

    def query(self, since=None, until=None, author=None, text=None, limit=100, ids=None) -> dict:
        now = self.ctx.now()
        state = self._state()
        lo = parse_time(since, now) if since else None
        hi = parse_time(until, now) if until else None
        a = author.lower().lstrip("@") if author else None
        t = text.lower() if text else None
        want = set(ids or [])
        # only posts from the sources bound in this env (offline posts never mix into real digests)
        bound = {s.ctx.source_id for s in self.ctx.sources.values() if s.ctx.source_id}
        out = []
        for p in self._posts().values():
            if bound and p["source"] not in bound:
                continue
            created = parse_time(p["createdAt"], now)
            if lo and created < lo:
                continue
            if hi and created > hi:
                continue
            if a and p["author"]["handle"].lower().lstrip("@") != a:
                continue
            if t and t not in p["text"].lower():
                continue
            if want and key(p) not in want:
                continue
            out.append(p)
        out.sort(key=lambda p: (p["createdAt"], key(p)), reverse=True)
        return {"posts": out[: (limit or 100)], "coverage": self.coverage(state, lo)}

    def prune(self, olderThan=None, deletedIds=None) -> dict:
        now = self.ctx.now()
        retention = olderThan or self.ctx.settings.get("retention") or self.ctx.settings.get("lookbackMax")
        if not retention:
            raise StoreError("no retention: pass olderThan, or give `retention` a default in the mode's config schema")
        cutoff = now - duration(retention)
        state = self._state()
        posts = self._posts()
        deleted = set(state["deleted"]) | set(deletedIds or [])
        before = len(posts)
        n_deleted = 0
        for k in list(posts):
            if k in deleted:
                posts.pop(k)
                n_deleted += 1
            elif parse_time(posts[k]["createdAt"], now) < cutoff:
                posts.pop(k)
        state["deleted"] = sorted(deleted)
        for cur in state["cursors"].values():
            if cur.get("from") and parse_time(cur["from"], now) < cutoff:
                cur["from"] = iso(cutoff)
        state["coverage"] = self._overall(state)
        self._save(posts, state)
        return {"removed": before - len(posts), "remaining": len(posts), "deleted": n_deleted}

    def status(self) -> dict:
        state = self._state()
        return {"lastSync": state["coverage"].get("to"), "coverage": self.coverage(state),
                "budget": self._budget(state), "count": self._count(state)}


def _max_id(a: str, b: str) -> str:
    """Snowflake-style ids compare numerically; fall back to string order."""
    try:
        return a if int(a) >= int(b) else b
    except ValueError:
        return max(a, b)


def create(ctx) -> LocalStore:
    return LocalStore(ctx)
