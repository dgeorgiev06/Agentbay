"""x-api: feed.source/v1 over the official X API v2.

  GET https://api.x.com/2/users/{id}/timelines/reverse_chronological
      max_results (<=100), since_id | start_time, exclude=retweets,replies,
      pagination_token, expansions=author_id, tweet.fields, user.fields
  POST https://api.x.com/2/oauth2/token      (grant_type=refresh_token)
  GET https://api.x.com/2/users/me            (only when config.userId is unset)

OAuth 2.0 user context, scopes tweet.read users.read offline.access.
Access tokens live in memory for this call only. X rotates refresh tokens;
the new one is written back through the secrets accessor (keychain), never to
disk, logs or output. All requests go through ctx.http, which enforces the
env network allowlist before any request is made.
"""
from __future__ import annotations

import base64
from datetime import datetime

from bay.connect import ConnectorError
from bay.util import iso

API = "https://api.x.com/2"
TOKEN_URL = f"{API}/oauth2/token"
SCOPES = "tweet.read users.read offline.access"
PAGE_MAX = 100
TWEET_FIELDS = "created_at,lang,public_metrics,author_id"
USER_FIELDS = "username,name"
EXCLUDE_OK = ("retweets", "replies")


class XApi:
    def __init__(self, ctx):
        self.ctx = ctx
        self._access: str | None = None
        self.max_pages = int(ctx.config.get("maxPages", 50))

    # ------------------------------------------------------------ auth
    def _refresh(self) -> None:
        cid = self.ctx.secrets.get("X_CLIENT_ID")
        secret = self.ctx.secrets.get("X_CLIENT_SECRET", optional=True)
        rt = self.ctx.secrets.get("X_REFRESH_TOKEN")
        headers = {}
        data = {"grant_type": "refresh_token", "refresh_token": rt, "client_id": cid}
        if secret:  # confidential client: HTTP Basic with client credentials
            headers["Authorization"] = "Basic " + base64.b64encode(f"{cid}:{secret}".encode()).decode()
        r = self.ctx.http.request("POST", TOKEN_URL, headers=headers, data=data)
        if r.status != 200:
            raise ConnectorError(f"x-api: token refresh failed (HTTP {r.status}); re-authorize the X app "
                                 f"with scopes '{SCOPES}' and store a new X_REFRESH_TOKEN")
        body = r.json() or {}
        if not body.get("access_token"):
            raise ConnectorError("x-api: token refresh returned no access_token")
        self._access = body["access_token"]
        new_rt = body.get("refresh_token")
        if new_rt and new_rt != rt:
            self.ctx.secrets.store("X_REFRESH_TOKEN", new_rt)

    def _get(self, url: str, params: dict | None = None):
        if self._access is None:
            self._refresh()
        for attempt in (1, 2):
            r = self.ctx.http.request("GET", url, params=params,
                                      headers={"Authorization": f"Bearer {self._access}"})
            if r.status == 401 and attempt == 1:
                self._refresh()
                continue
            return r
        return r

    def user_id(self) -> str:
        uid = self.ctx.config.get("userId")
        if uid:
            return str(uid)
        r = self._get(f"{API}/users/me")
        if r.status != 200:
            raise ConnectorError(f"x-api: GET /2/users/me failed (HTTP {r.status}); "
                                 f"set connectors.x-api.userId in agentbay.config.yaml")
        return str(r.json()["data"]["id"])

    # ------------------------------------------------------------ requests
    def build_params(self, *, max_results: int, since_id: str | None = None, start_time: str | None = None,
                     exclude: list[str] | None = None, pagination_token: str | None = None) -> dict:
        bad = [e for e in (exclude or []) if e not in EXCLUDE_OK]
        if bad:
            raise ConnectorError(f"x-api: exclude supports {EXCLUDE_OK}, got {bad}")
        p = {
            "max_results": max(1, min(PAGE_MAX, int(max_results))),
            "tweet.fields": TWEET_FIELDS,
            "expansions": "author_id",
            "user.fields": USER_FIELDS,
        }
        if since_id:
            p["since_id"] = since_id
        elif start_time:
            p["start_time"] = start_time
        if exclude:
            p["exclude"] = ",".join(exclude)
        if pagination_token:
            p["pagination_token"] = pagination_token
        return p

    def _to_post(self, t: dict, users: dict, fetched: str) -> dict:
        u = users.get(t.get("author_id"), {})
        handle = u.get("username", t.get("author_id", "unknown"))
        post = {
            "id": str(t["id"]),
            "source": "x",
            "author": {"handle": handle, "name": u.get("name", handle)},
            "text": t.get("text", ""),
            "url": f"https://x.com/{handle}/status/{t['id']}",
            "createdAt": _norm(t.get("created_at")) or fetched,
            "fetchedAt": fetched,
        }
        if t.get("lang"):
            post["lang"] = t["lang"]
        m = t.get("public_metrics")
        if isinstance(m, dict):
            post["metrics"] = {k: int(v) for k, v in m.items() if isinstance(v, int)}
        return post

    # ------------------------------------------------------------ feed.source/v1.fetch
    def fetch(self, sinceId: str | None = None, startTime: str | None = None, maxPosts: int = 100,
              exclude: list[str] | None = None) -> dict:
        exclude = list(exclude) if exclude is not None else list(EXCLUDE_OK)
        url = f"{API}/users/{self.user_id()}/timelines/reverse_chronological"
        fetched = iso(self.ctx.now())
        posts: list[dict] = []
        newest: str | None = None
        token: str | None = None
        warnings: list[str] = []
        truncated = False
        pages = 0
        while True:
            want = maxPosts - len(posts)
            if want <= 0:
                truncated = token is not None or pages == 0
                break
            if pages >= self.max_pages:
                truncated = True
                warnings.append(f"x-api: stopped after maxPages={self.max_pages}")
                break
            # X requires max_results >= 5 per page; trim locally if we need fewer
            params = self.build_params(max_results=max(5, want), since_id=sinceId, start_time=startTime,
                                       exclude=exclude, pagination_token=token)
            r = self._get(url, params)
            pages += 1
            if r.status == 429:
                truncated = True
                reset = r.headers.get("x-rate-limit-reset") or r.headers.get("X-Rate-Limit-Reset")
                warnings.append(f"x-api: rate limited (HTTP 429){f', resets at epoch {reset}' if reset else ''}; "
                                f"kept {len(posts)} posts, run sync again later")
                break
            if r.status != 200:
                raise ConnectorError(f"x-api: timeline request failed (HTTP {r.status})")
            body = r.json() or {}
            users = {u["id"]: u for u in (body.get("includes") or {}).get("users", [])}
            page = body.get("data") or []
            meta = body.get("meta") or {}
            if meta.get("newest_id") and newest is None:
                newest = str(meta["newest_id"])
            for t in page[:want]:
                posts.append(self._to_post(t, users, fetched))
            if len(page) > want:
                truncated = True
                break
            token = meta.get("next_token")
            if not token:
                break
        if posts:
            newest = posts[0]["id"]  # newest first: advance the cursor only to what we kept
        return {"posts": posts, "newestId": newest, "truncated": truncated, "requests": self.ctx.http.requests,
                **({"warnings": warnings} if warnings else {})}


def _norm(ts: str | None) -> str | None:
    if not ts:
        return None
    return iso(datetime.fromisoformat(ts.replace("Z", "+00:00")))


def create(ctx) -> XApi:
    return XApi(ctx)
