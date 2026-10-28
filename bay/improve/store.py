"""The improve store: .agentbay/data/improve/findings.jsonl (one improve.finding/v1 per line). Storage only:
detectors live in bay/improve/detect_*.py and run behind improve.detect/v1; report and handoff text is rendered
by bay/improve/report.py.

  upsert    candidates (detectors or resolved analyst findings); dedup by fingerprint, merge evidence,
            reopen a fixed/verified finding whose pattern comes back
  annotate  root cause, proposed fix, route, effort from the analyst (after review); open findings only
  triage    "same file" links across lenses and priority = impact x frequency / effort
  decide    human decisions (approve | defer | wontfix); approve only via `bay improve decide` in a terminal
  backlog   write reports/<isoweek>.md
  claim / handoff   implement: only approved items; writes a draft proposal or a task envelope, never code
  verify    close as verified, or reopen

Every write is secret-scanned (secretscan.scrub_obj) before it reaches disk.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from .. import secretscan
from . import report, short_hash

STATUSES = ("open", "approved", "deferred", "wontfix", "in-progress", "fixed", "verified")
DECISIONS = {"approve": "approved", "defer": "deferred", "wontfix": "wontfix"}
SEVERITY = {"low": 1, "medium": 2, "high": 3, "severe": 5}
EFFORT = {"config": 1, "mode-fix": 2, "forge.extend": 3, "none": 1}
ROUTES = ("forge.extend", "mode-fix", "config", "none")
FRAMEWORK_DIRS = ("framework/", "bay/", "schemas/", "docs/", "tests/")
HUMAN = "user@tty"
MAX_EVIDENCE = 30


class StoreError(Exception):
    pass


def fingerprint(c: dict) -> str:
    return short_hash(f"{c['kind']}|{c['detector']['key']}", 16)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def isoweek(dt: datetime) -> str:
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


class Store:
    def __init__(self, data_dir: Path, now: datetime, framework_modes: set[str] | None = None):
        self.dir = Path(data_dir)
        self.path = self.dir / "findings.jsonl"
        self.now = now
        self.framework_modes = framework_modes or {"forge", "improve"}

    # ------------------------------------------------------------------ io
    def load(self) -> dict[str, dict]:
        out: dict[str, dict] = {}
        if self.path.exists():
            for n, line in enumerate(self.path.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    f = json.loads(line)
                except ValueError as e:
                    raise StoreError(f"{self.path}:{n}: corrupt line ({e}); fix or delete that line") from None
                out[f["id"]] = f
        return out

    def save(self, findings: dict[str, dict]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".jsonl.tmp")
        tmp.write_text("".join(json.dumps(secretscan.scrub_obj(f), ensure_ascii=False) + "\n"
                               for f in findings.values()), encoding="utf-8")
        tmp.replace(self.path)

    # ------------------------------------------------------------------ helpers
    def route_for(self, f: dict) -> str:
        sc = f.get("scope") or {}
        files = [sc["file"]] if sc.get("file") else list(sc.get("files") or [])
        if sc.get("framework") or sc.get("mode") in self.framework_modes:
            return "forge.extend"
        if files and all(x.startswith(FRAMEWORK_DIRS) for x in files):
            return "forge.extend"
        return "mode-fix"

    def score(self, f: dict) -> None:
        impact = f.get("impact") or SEVERITY.get(f.get("severity", "medium"), 2)
        freq = min(max(1, int(f.get("occurrences", 1))), 10)
        effort = f.get("effort") or EFFORT.get(f.get("route") or self.route_for(f), 2)
        f["priority"] = round(impact * freq / max(1, effort), 2)

    def _hist(self, f: dict, status: str, by: str, note: str = "") -> None:
        f.setdefault("history", []).append({"ts": iso(self.now), "status": status, "by": by,
                                            **({"note": note[:300]} if note else {})})

    # ------------------------------------------------------------------ writes
    def upsert(self, candidates: list[dict], by: str) -> dict:
        fs = self.load()
        res = {"new": [], "merged": [], "reopened": []}
        for c in candidates:
            fp = fingerprint(c)
            fid = f"F-{fp[:8]}"
            cur = fs.get(fid)
            if cur is None:
                f = {"id": fid, "fingerprint": fp, "status": "open", "firstSeen": iso(self.now), "source": by,
                     "links": [], **c}
                f["evidence"] = c["evidence"][:MAX_EVIDENCE]
                f.setdefault("route", self.route_for(f))
                self._hist(f, "open", by, "detected")
                self.score(f)
                f["lastSeen"] = iso(self.now)
                fs[fid] = f
                res["new"].append(fid)
                continue
            seen = {(e["kind"], e["ref"]) for e in cur["evidence"]}
            added = [e for e in c["evidence"] if (e["kind"], e["ref"]) not in seen]
            cur["evidence"] = (added + cur["evidence"])[:MAX_EVIDENCE]
            for k in ("title", "pattern", "measure", "severity", "scope"):
                if c.get(k):
                    cur[k] = c[k]
            cur["occurrences"] = max(cur.get("occurrences", 1), c.get("occurrences", 1))
            cur["lastSeen"] = iso(self.now)
            if cur["status"] in ("fixed", "verified") and added:
                cur["status"] = "open"
                self._hist(cur, "open", by, "pattern came back with new evidence")
                res["reopened"].append(fid)
            else:
                res["merged"].append(fid)
            self.score(cur)
        self.save(fs)
        return res

    def annotate(self, items: list[dict], by: str) -> dict:
        fs = self.load()
        done, missing = [], []
        refused = []
        for it in items:
            f = fs.get(it.get("id"))
            if f is None:
                missing.append(it.get("id"))
                continue
            if f["status"] != "open":
                refused.append({"id": f["id"], "status": f["status"],
                                "reason": "only open findings are annotated; decided or in-flight items keep theirs"})
                continue
            for k in ("rootCause", "proposedFix", "costEstimate"):
                if it.get(k):
                    f[k] = it[k]
            if it.get("route") in ROUTES:
                f["route"] = it["route"]
            for k in ("effort", "impact"):
                if isinstance(it.get(k), int) and 1 <= it[k] <= 5:
                    f[k] = it[k]
            self.score(f)
            self._hist(f, f["status"], by, "triaged: root cause and fix")
            done.append(f["id"])
        self.save(fs)
        return {"annotated": done, "missing": missing, "refused": refused}

    def prune(self, retention: timedelta) -> int:
        fs = self.load()
        cutoff = iso(self.now - retention)
        keep = {k: f for k, f in fs.items()
                if not (f["status"] in ("verified", "wontfix") and f.get("lastSeen", "") < cutoff)}
        if len(keep) != len(fs):
            self.save(keep)
        return len(fs) - len(keep)

    def decide(self, fid: str, decision: str, by: str, note: str = "") -> dict:
        if decision not in DECISIONS:
            raise StoreError(f"decision must be one of {', '.join(DECISIONS)}")
        if decision == "approve" and by != HUMAN:
            raise StoreError("approve is a human decision: run `bay improve decide <id> approve` in your terminal")
        fs = self.load()
        f = fs.get(fid)
        if f is None:
            raise StoreError(f"unknown finding '{fid}' (see the backlog report or improve.query)")
        if f["status"] in ("in-progress", "fixed", "verified") and decision != "wontfix":
            raise StoreError(f"{fid} is {f['status']}; only wontfix can still change it")
        f["status"] = DECISIONS[decision]
        self._hist(f, f["status"], by, note)
        self.save(fs)
        return f

    def set_status(self, fid: str, status: str, by: str, note: str = "") -> dict:
        fs = self.load()
        f = fs[fid]
        f["status"] = status
        self._hist(f, status, by, note)
        self.save(fs)
        return f

    # ------------------------------------------------------------------ reads
    def query(self, status=None, lens=None, kind=None, ids=None, limit=None) -> list[dict]:
        out = [f for f in self.load().values()
               if (not status or f["status"] in ([status] if isinstance(status, str) else status))
               and (not lens or f["lens"] == lens) and (not kind or f["kind"] == kind)
               and (not ids or f["id"] in ids)]
        out.sort(key=lambda f: (-f.get("priority", 0), f["id"]))
        return out[:limit] if limit else out

    # ------------------------------------------------------------------ triage
    def triage(self) -> dict:
        """Links findings of different lenses that point at the same file, and re-scores priority."""
        fs = self.load()
        live = [f for f in fs.values() if f["status"] in ("open", "approved", "deferred")]
        links: set[tuple[str, str, str]] = set()
        by_file: dict[str, list] = {}
        for f in live:
            sc = f.get("scope") or {}
            for p in ([sc["file"]] if sc.get("file") else []) + list(sc.get("files") or []):
                by_file.setdefault(p, []).append(f)
        for p, group in by_file.items():
            for a in group:
                for b in group:
                    if a["id"] < b["id"] and a["lens"] != b["lens"]:
                        links.add((a["id"], b["id"], f"same file {p}"))
        for a, b, _ in links:
            for x, y in ((a, b), (b, a)):
                if y not in fs[x]["links"]:
                    fs[x]["links"].append(y)
        for f in live:
            f.setdefault("route", self.route_for(f))
            self.score(f)
        self.save(fs)
        ranked = sorted((f for f in live if f["status"] == "open"), key=lambda f: (-f["priority"], f["id"]))
        return {"findings": len(live), "links": [{"a": a, "b": b, "why": w} for a, b, w in sorted(links)],
                "ranked": [{"id": f["id"], "priority": f["priority"], "kind": f["kind"], "title": f["title"]}
                           for f in ranked]}

    # ------------------------------------------------------------------ backlog
    def backlog(self, top: int = 10, week: str | None = None) -> dict:
        week = week or isoweek(self.now)
        items = self.query(status=["open", "approved"])[:top]
        counts = {st: 0 for st in STATUSES}
        for f in self.load().values():
            counts[f["status"]] += 1
        text = secretscan.scrub(report.backlog(items, counts, week, iso(self.now)))
        p = self.dir / "reports" / f"{week}.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return {"report": str(p), "week": week, "items": [f["id"] for f in items],
                "counts": {k: v for k, v in counts.items() if v}}

    # ------------------------------------------------------------------ implement
    def claim(self, fid: str) -> dict:
        f = self.load().get(fid)
        if f is None:
            return {"stopped": f"unknown finding '{fid}'"}
        approved = [h for h in f.get("history", []) if h["status"] == "approved" and h["by"] == HUMAN]
        if f["status"] != "approved" or not approved:
            return {"stopped": f"{fid} is {f['status']}; implement runs only for items you approved with "
                               f"`bay improve decide {fid} approve` in your terminal", "finding": f}
        return {"finding": f}

    def handoff(self, fid: str, draft: dict, task_id: str) -> dict:
        c = self.claim(fid)
        if "stopped" in c:
            return c
        name, body, nxt = report.handoff(c["finding"], draft, task_id)
        hdir = self.dir / "handoffs"
        hdir.mkdir(parents=True, exist_ok=True)
        body = secretscan.scrub(body)
        if "input" in nxt:
            nxt["input"]["context"] = body
        else:
            nxt["envelope"] = body
        (hdir / name).write_text(body, encoding="utf-8")
        self.set_status(fid, "in-progress", "improve.implement", f"handoff {name}")
        return {"id": fid, "route": draft.get("route") or c["finding"].get("route"), "draft": name, "next": nxt}

    def verify(self, fid: str, still_present: bool, new_data: int, by: str = "improve.verify") -> dict:
        f = self.load().get(fid)
        if f is None:
            return {"id": fid, "result": "unknown", "status": None}
        if f["status"] not in ("in-progress", "fixed", "approved", "verified"):
            return {"id": fid, "result": "skipped", "status": f["status"],
                    "note": "verify runs on items that are being fixed (in-progress or fixed)"}
        if new_data == 0:
            return {"id": fid, "result": "inconclusive", "status": f["status"],
                    "note": "no new episodes since the fix; run again after the fixed flow ran"}
        if still_present:
            f = self.set_status(fid, "open", by, "pattern still present after the fix")
            return {"id": fid, "result": "reopened", "status": "open"}
        f = self.set_status(fid, "verified", by, "pattern gone on new data")
        return {"id": fid, "result": "verified", "status": "verified"}
