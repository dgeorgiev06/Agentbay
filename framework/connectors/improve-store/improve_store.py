"""improve-store: improve.findings/v1 -> bay.improve.store (storage only; writes only ctx.data_dir)."""
from __future__ import annotations

from pathlib import Path

from bay import protocol
from bay.connect import ConnectorError
from bay.improve import store as st
from bay.util import duration


class ImproveStore:
    def __init__(self, ctx):
        self.ctx = ctx
        fw = {p.name for p in (Path(ctx.kit) / "framework" / "modes").iterdir() if p.is_dir()} if ctx.kit else set()
        self.store = st.Store(ctx.data_dir, ctx.now(), fw or None)
        self.settings = ctx.settings or {}

    def _summary(self, ids: list[str]) -> list[dict]:
        fs = self.store.load()
        return [{k: fs[i][k] for k in ("id", "kind", "title", "severity", "priority", "status")} for i in ids if i in fs]

    def _do(self, fn, *a):
        try:
            return fn(*a)
        except st.StoreError as e:
            raise ConnectorError(str(e)) from None

    def upsert(self, candidates=None, by="improve", rejected=None, detected=None) -> dict:
        cands = candidates or []
        res = self._do(self.store.upsert, cands, by)
        pruned = self.store.prune(duration(self.settings.get("retention") or "90d"))
        ids = list(dict.fromkeys(f"F-{st.fingerprint(c)[:8]}" for c in cands))
        touched = list(dict.fromkeys(list(detected or []) + ids))
        return {"findings": ids, **res, "rejected": rejected or [], "summary": self._summary(touched),
                "pruned": pruned}

    def annotate(self, annotations=None) -> dict:
        res = self._do(self.store.annotate, annotations or [], "analyst")
        return {**res, "summary": self._summary(res["annotated"])}

    def query(self, status=None, lens=None, kind=None, ids=None, limit=None) -> dict:
        return {"findings": self._do(self.store.query, status, lens, kind, ids, limit)}

    def get(self, id) -> dict:
        f = self._do(self.store.load).get(id)
        if f is None:
            raise ConnectorError(f"unknown finding '{id}' (see the backlog report or improve.findings/v1.query)")
        return {"finding": f}

    def triage(self, top=None) -> dict:
        res = self._do(self.store.triage)
        res["top"] = self.store.query(status="open", limit=top or self.settings.get("triageTop") or 5)
        return res

    def decide(self, id, decision, by, note=None) -> dict:
        return self._do(self.store.decide, id, decision, by, note or "")

    def backlog(self, top=None, week=None) -> dict:
        res = self._do(self.store.backlog, top or self.settings.get("backlogTop") or 10, week)
        try:
            res["report"] = Path(res["report"]).relative_to(self.ctx.project).as_posix()
        except (ValueError, TypeError):
            pass
        return res

    def claim(self, id) -> dict:
        return self._do(self.store.claim, id)

    def handoff(self, id, draft) -> dict:
        return self._do(self.store.handoff, id, draft, protocol.new_task_id())

    def verify(self, id, present=None, newData=0, note=None) -> dict:
        if present is None:
            f = self.get(id)["finding"]
            return {"id": id, "result": "inconclusive", "status": f["status"], "newData": newData,
                    "note": note or "no deterministic re-check for this finding"}
        return {**self._do(self.store.verify, id, bool(present), int(newData)), "newData": int(newData)}


def create(ctx):
    return ImproveStore(ctx)
