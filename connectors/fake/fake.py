"""fake: offline feed.source/v1. No network, no secrets.

Posts come from connectors.fake.fixture (JSON list) or SAMPLE. `ageHours` is
relative to the call's clock so demos and tests are deterministic.
"""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

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
            p = Path(fx) if Path(fx).is_absolute() else (ctx.project or Path.cwd()) / fx
            self.items = json.loads(p.read_text())
        else:
            self.items = SAMPLE

    def fetch(self, sinceId=None, startTime=None, maxPosts=100, checkIds=None) -> dict:
        self.calls.append({"sinceId": sinceId, "startTime": startTime, "maxPosts": maxPosts, "checkIds": checkIds})
        now = self.ctx.now()
        lo = now - timedelta(days=7)
        if startTime:
            lo = max(lo, parse_time(startTime, now))
        rows = []
        for it in sorted(self.items, key=lambda x: int(x["id"]), reverse=True):
            created = now - timedelta(hours=float(it["ageHours"]))
            if created < lo or created > now:
                continue
            if sinceId and int(it["id"]) <= int(sinceId):
                continue
            rows.append({
                "id": str(it["id"]), "source": "fake",
                "author": {"handle": it["handle"], "name": it.get("name", it["handle"])},
                "text": it["text"], "url": f"https://example.com/{it['handle']}/status/{it['id']}",
                "createdAt": iso(created), "fetchedAt": iso(now),
            })
        kept = rows[:maxPosts]
        gone = set(self.ctx.config.get("deleted", []))
        checks = list(checkIds or [])
        deleted = [i for i in checks if i in gone]
        return {"posts": kept, "newestId": kept[0]["id"] if kept else None,
                "truncated": len(rows) > maxPosts, "requests": 0,
                "billed": len(kept) + len(checks) - len(deleted), "checked": checks, "deleted": deleted}


def create(ctx) -> Fake:
    return Fake(ctx)
