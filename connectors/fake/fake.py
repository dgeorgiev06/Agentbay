"""fake: offline items.source/v1 (post/v1 items). No network, no secrets.

Posts come from connectors.fake.fixture (JSON list) or SAMPLE. `ageHours` is
relative to the call's clock so demos and tests are deterministic. Every post is
in the `home` container; an optional fixture `list` field also puts it in
`list:<id>`. Native query fields: `from` (handles) and `in` (home, list:<id>).
"""
from __future__ import annotations

import json
import os
from datetime import timedelta
from pathlib import Path

from bay.connect import ConnectorError
from bay.util import iso, parse_time

SAMPLE = [
    {"id": "1009", "handle": "vitalik", "name": "Vitalik", "ageHours": 2,
     "text": "Danksharding progress: blob fees stayed low through the week; next step is PeerDAS on mainnet."},
    {"id": "1008", "handle": "solana_dev", "name": "Solana Dev", "ageHours": 5,
     "text": "Firedancer validator client now on 8% of mainnet stake. Staking yields unchanged."},
    {"id": "1007", "handle": "custody_news", "name": "Custody News", "ageHours": 9,
     "text": "Two more EU banks announce institutional staking pilots for ETH via regulated custodians."},
    {"id": "1006", "handle": "vitalik", "name": "Vitalik", "ageHours": 20,
     "text": "Thoughts on staking decentralization: operator diversity matters more than client count."},
    {"id": "1005", "handle": "lido", "name": "Lido", "ageHours": 30,
     "text": "Community staking module opens to new node operators; bond requirements reduced."},
    {"id": "1004", "handle": "solana_dev", "name": "Solana Dev", "ageHours": 50,
     "text": "Stake-weighted QoS rollout complete; fewer dropped transactions under load."},
    {"id": "1003", "handle": "custody_news", "name": "Custody News", "ageHours": 70,
     "text": "US custodian adds Solana staking for institutional clients with daily reward reporting."},
    {"id": "1002", "handle": "lido", "name": "Lido", "ageHours": 120,
     "text": "Withdrawal queue cleared in under 24h this month."},
    {"id": "1001", "handle": "old_account", "name": "Old Account", "ageHours": 200,
     "text": "This post is older than the 7d API window."},
]


class Fake:
    def __init__(self, ctx):
        self.ctx = ctx
        self.calls: list[dict] = []
        fx = ctx.config.get("fixture")
        if fx:
            root = Path(os.path.realpath(ctx.project or Path.cwd()))
            p = Path(os.path.realpath(root / fx))
            if not p.is_relative_to(root):
                raise ConnectorError(f"fake: fixture {fx} must be a path inside the project ({root})")
            self.items = json.loads(p.read_text())
        else:
            self.items = SAMPLE

    def fetch(self, query=None, since=None, cursor=None, maxItems=100, checkIds=None) -> dict:
        query = query or {}
        self.calls.append({"query": query, "since": since, "cursor": cursor, "maxItems": maxItems, "checkIds": checkIds})
        if self.ctx.config.get("blocked"):
            return {"items": [], "cursor": cursor, "truncated": True, "billed": 0, "requests": 0,
                    "blocked": str(self.ctx.config["blocked"])}
        now = self.ctx.now()
        lo = now - timedelta(days=7)
        if since:
            lo = max(lo, parse_time(since, now))
        handles = {_v.lower().lstrip("@") for _v in _list(query.get("from"))}
        where = {_v.lower() for _v in _list(query.get("in"))}
        rows = []
        for it in sorted(self.items, key=lambda x: int(x["id"]), reverse=True):
            created = now - timedelta(hours=float(it["ageHours"]))
            if created < lo or created > now or (cursor and int(it["id"]) <= int(cursor)):
                continue
            boxes = ["home"] + ([f"list:{it['list']}"] if it.get("list") else [])
            if handles and it["handle"].lower() not in handles or where and not where & set(boxes):
                continue
            container = next((b for b in boxes if b in where), "home")
            rows.append({
                "id": f"fake:{it['id']}", "extId": str(it["id"]), "source": "fake", "kind": "post",
                "author": {"handle": it["handle"], "name": it.get("name", it["handle"])},
                "title": None, "text": it["text"], "url": f"https://example.com/{it['handle']}/status/{it['id']}",
                "createdAt": iso(created), "fetchedAt": iso(now), "container": container,
                "labels": [container], "threadId": None,
            })
        kept = rows[:maxItems]
        gone = set(self.ctx.config.get("deleted", []))
        checks = list(checkIds or [])
        deleted = [i for i in checks if i in gone]
        return {"items": kept, "cursor": kept[0]["extId"] if kept else None,
                "truncated": len(rows) > maxItems, "requests": 0,
                "billed": len(kept) + len(checks) - len(deleted), "checked": checks, "deleted": deleted}


def _list(v) -> list[str]:
    return [] if v is None else [str(x) for x in (v if isinstance(v, list) else [v])]


def create(ctx) -> Fake:
    return Fake(ctx)
