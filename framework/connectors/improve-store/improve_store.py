"""improve-store: improve.findings/v1 (bay.improve.store + detectors) over its bound sources.

Sources (connectors bound in the same env): session.events/v1 (ledger, claude-transcripts, git),
review.verdicts/v1 (ledger), artifacts.read/v1 (artifacts). Writes only ctx.data_dir.
"""
from __future__ import annotations

import re
from pathlib import Path

from bay import model, protocol
from bay.connect import ConnectorError
from bay.improve import conformance, detect_artifacts, detect_sessions, store as st
from bay.improve import short_hash
from bay.util import duration, iso, parse_time

EPISODE_REF = re.compile(r"^(ab|cc|git):")


class ImproveStore:
    def __init__(self, ctx):
        self.ctx = ctx
        fw = {p.name for p in (Path(ctx.kit) / "framework" / "modes").iterdir() if p.is_dir()} if ctx.kit else set()
        self.store = st.Store(ctx.data_dir, ctx.now(), fw or None)
        self.settings = ctx.settings or {}

    # ------------------------------------------------------------------ sources
    def _with(self, method: str) -> list:
        return [s for _, s in sorted(self.ctx.sources.items()) if callable(getattr(s, method, None))]

    def _window(self, since=None, until=None) -> tuple[str, str | None]:
        now = self.ctx.now()
        s = parse_time(since or self.settings.get("window") or "7d", now)
        return iso(s), (iso(parse_time(until, now)) if until else None)

    def _session_data(self, since=None, until=None, only_ledger=False) -> tuple[dict, dict]:
        s, u = self._window(since, until)
        eps, stats = [], {}
        for src in self._with("episodes"):
            name = getattr(src, "SOURCE", src.ctx.name)
            if only_ledger and name != "ledger":
                continue
            out = src.episodes(since=s, until=u)
            eps += out["episodes"]
            stats[name] = out["stats"]
        verdicts = []
        if not only_ledger:
            for src in self._with("verdicts"):
                verdicts += src.verdicts(since=s, until=u)["verdicts"]
        stats["episodes"] = len(eps)
        stats["verdicts"] = len(verdicts)
        return {"episodes": eps, "verdicts": verdicts}, {"stats": stats, "window": {"since": s, "until": u}}

    def _artifacts_src(self):
        srcs = self._with("graph")
        if len(srcs) != 1:
            raise ConnectorError(f"improve-store needs exactly one artifacts.read/v1 connector (found {len(srcs)})")
        return srcs[0]

    def _artifacts(self, root: str) -> detect_artifacts.Artifacts:
        art = self._artifacts_src()

        def text(p):
            try:
                return art.text(path=p, root=root)["text"]
            except ConnectorError:
                return None
        base = self.ctx.kit if root == "kit" else self.ctx.project
        is_kit = Path(base).resolve() == Path(self.ctx.kit).resolve()
        ledger_eps = self._session_data(only_ledger=True)[0]["episodes"]
        return detect_artifacts.Artifacts(files=art.files(root=root)["files"], text=text, graph=art.graph(root=root),
                                          ledger=ledger_eps, conformance=conformance.run(self.ctx.kit) if is_kit else [],
                                          is_kit=is_kit)

    def _system(self):
        try:
            return model.resolve(model.Kit(self.ctx.kit, self.ctx.project))
        except Exception:
            return None

    def _role_contexts(self) -> list[dict]:
        sysm = self._system()
        if sysm is None:
            return []
        out = []
        for r in sysm.roles.values():
            base = len(r.prompt) + sum(len(x) for x in r.done_when) + sum(len(x) for x in r.rules)
            parts = [f"prompt+doneWhen+rules {base}"]
            for sk, p in r.skills.items():
                n = len((p / "SKILL.md").read_text(encoding="utf-8"))
                base += n
                parts.append(f"skill {sk} {n}")
            biggest, which = 0, ""
            for m in sysm.modes.values():
                for f in m.features.values():
                    if any(stp.role == r.name for stp in f.steps):
                        n = len(f.playbook_text) + sum(len(x.statement) for x in f.rules)
                        if n > biggest:
                            biggest, which = n, f"{m.name}.{f.name}"
            if which:
                parts.append(f"feature {which} {biggest}")
            path = str(model.rel(sysm.kit.get("Role", r.name).path))
            out.append({"name": r.name, "path": path, "chars": base + biggest, "parts": parts})
        return out

    def _read_endpoints(self) -> set[str]:
        """Read-only endpoints of store interfaces (interfaces that also write): where a full re-read per call
        is waste. Plain readers (artifacts.read, review.verdicts) are excluded."""
        k = model.Kit(self.ctx.kit)
        out = set()
        for d in k.docs["Interface"].values():
            eps = d.spec["endpoints"]
            if any("write" in s["effects"] for s in eps.values()):
                out |= {ep for ep, s in eps.items() if set(s["effects"]) <= {"read"}}
        return out

    def _connector_dirs(self) -> dict[str, str]:
        sysm = self._system()
        out: dict[str, str] = {}
        if sysm is None:
            return out
        for m in sysm.modes.values():
            for f in m.features.values():
                for stp in f.steps:
                    if stp.kind == "code" and stp.connector:
                        c = sysm.kit.get("Connector", stp.connector)
                        d = model.rel(c.dir) + "/"
                        out[f"{m.name}.{f.name}.{stp.id}"] = d
                        out.setdefault(f"endpoint:{m.name}.{f.name}", d)
        return out

    def _summary(self, ids: list[str]) -> list[dict]:
        fs = self.store.load()
        return [{k: fs[i][k] for k in ("id", "kind", "title", "severity", "priority", "status")} for i in ids if i in fs]

    @staticmethod
    def _ids(cands: list[dict]) -> list[str]:
        return list(dict.fromkeys(f"F-{st.fingerprint(c)[:8]}" for c in cands))

    # ------------------------------------------------------------------ endpoints
    def scan(self, since=None, until=None) -> dict:
        data, meta = self._session_data(since, until)
        cands = detect_sessions.run(data, self.settings)
        res = self.store.upsert(cands, "improve.scan")
        pruned = self.store.prune(duration(self.settings.get("retention") or "90d"))
        ids = self._ids(cands)
        return {"findings": ids, **res, "summary": self._summary(ids), "pruned": pruned, **meta}

    def audit(self, root="project") -> dict:
        a = self._artifacts(root)
        cands = detect_artifacts.run(a, self.settings, roles=self._role_contexts() if a.is_kit else [],
                                     read_endpoints=self._read_endpoints())
        res = self.store.upsert(cands, "improve.audit")
        ids = self._ids(cands)
        manual = [{k: r[k] for k in ("id", "level", "statement")} for r in conformance.manual(self.ctx.kit)] \
            if a.is_kit else []
        return {"findings": ids, **res, "summary": self._summary(ids), "manual": manual,
                "stats": {"files": len(a.files), "graphNodes": len(a.graph.get("nodes", [])),
                          "conformanceRules": [c["rule"] for c in a.conformance]}}

    def _resolves(self, e: dict, episodes: set[str]) -> str | None:
        ref = str(e.get("ref", ""))
        kind = e.get("kind")
        if kind == "episode":
            return None if ref in episodes else f"episode {ref} is not in the store's sources"
        if kind == "file":
            path, _, rest = ref.partition("#")[0].partition(":")
            for base in (self.ctx.project, self.ctx.kit):
                p = Path(base) / path
                if base and p.is_file():
                    if rest.isdigit() and int(rest) > p.read_text(encoding="utf-8", errors="replace").count("\n") + 1:
                        return f"{ref}: line {rest} is past the end of the file"
                    return None
            return f"file {path} does not exist"
        if kind == "rule":
            return None if re.match(r"^(C|R|DOD)-[0-9]+$", ref) else f"rule {ref} is not a rule id"
        if kind in ("measurement", "commit"):
            return None
        return f"unknown evidence kind {kind}"

    def record(self, findings=None, annotations=None, detected=None) -> dict:
        out = {"new": [], "merged": [], "reopened": [], "rejected": []}
        cands = []
        if findings:
            known = {e["id"] for e in self._session_data(since=self.settings.get("retention") or "90d")[0]["episodes"]} \
                if any(e.get("kind") == "episode" for f in findings for e in f["evidence"]) else set()
            for i, f in enumerate(findings):
                bad = [r for r in (self._resolves(e, known) for e in f["evidence"]) if r]
                eps = {e["ref"] for e in f["evidence"] if e.get("kind") == "episode"}
                if not bad and f["lens"] == "sessions" and len(eps) < 2 and f.get("severity") != "severe":
                    bad.append("a recurring session pattern needs evidence from >= 2 episodes unless it is severe")
                if bad:
                    out["rejected"].append({"index": i, "title": f["title"][:120], "reasons": bad[:5]})
                    continue
                scope = {k: v for k, v in (f.get("scope") or {}).items()
                         if k in ("mode", "feature", "step", "role", "env", "rule", "file", "files", "framework")}
                if f.get("rule"):
                    scope["rule"] = f["rule"]
                ev = [{k: v for k, v in e.items() if k in ("kind", "ref", "detail", "rewrite", "value")}
                      for e in f["evidence"]]
                c = {"lens": f["lens"], "kind": "pattern", "title": f["title"], "pattern": f["pattern"],
                     "evidence": ev, "scope": scope, "severity": f.get("severity", "medium"),
                     "occurrences": max(1, len(eps)),
                     "detector": {"name": "pattern", "key": short_hash([f["lens"], f["title"].lower(), scope])}}
                for k in ("rootCause", "proposedFix"):
                    if f.get(k):
                        c[k] = f[k]
                cands.append(c)
            res = self.store.upsert(cands, "improve-analyst")
            for k in ("new", "merged", "reopened"):
                out[k] = res[k]
        if annotations:
            out.update(self.store.annotate(annotations, "improve-analyst"))
        touched = list(dict.fromkeys(list(detected or []) + out["new"] + out["merged"] + out["reopened"]
                                     + out.get("annotated", [])))
        out["summary"] = self._summary(touched)
        return out

    def query(self, status=None, lens=None, kind=None, ids=None, limit=None) -> dict:
        return {"findings": self.store.query(status, lens, kind, ids, limit)}

    def triage(self, top=None) -> dict:
        res = self.store.triage(self._connector_dirs())
        n = top or self.settings.get("triageTop") or 5
        res["top"] = self.store.query(status="open", limit=n)
        return res

    def decide(self, id, decision, by, note=None) -> dict:
        try:
            return self.store.decide(id, decision, by, note or "")
        except st.StoreError as e:
            raise ConnectorError(str(e)) from None

    def backlog(self, top=None, week=None) -> dict:
        res = self.store.backlog(top or self.settings.get("backlogTop") or 10, week)
        p = Path(res["report"])
        try:
            res["report"] = p.relative_to(self.ctx.project).as_posix()
        except (ValueError, TypeError):
            pass
        return res

    def claim(self, id) -> dict:
        return self.store.claim(id)

    def handoff(self, id, draft) -> dict:
        return self.store.handoff(id, draft, protocol.new_task_id())

    def verify(self, id) -> dict:
        f = self.store.load().get(id)
        if f is None:
            return {"id": id, "result": "unknown", "status": None}
        name = f["detector"]["name"]
        if name == "pattern":
            return {"id": id, "result": "inconclusive", "status": f["status"],
                    "note": "analyst finding: no deterministic detector; re-run improve.scan and check by hand"}
        if f["lens"] == "sessions":
            since = next((h["ts"] for h in reversed(f.get("history", []))
                          if h["status"] in ("in-progress", "fixed", "approved")), f.get("lastSeen"))
            data, _ = self._session_data(since=since)
            new = len(_relevant(f, data))
            found = detect_sessions.run(data, self.settings, only=name)
        else:
            a = self._artifacts("project")
            new = 1
            found = detect_artifacts.run(a, self.settings, only=name,
                                         roles=self._role_contexts() if a.is_kit else [],
                                         read_endpoints=self._read_endpoints())
        present = any(st.fingerprint(c) == f["fingerprint"] for c in found)
        return {**self.store.verify(id, present, new), "newData": new}


VERDICT_KINDS = {"review-rounds", "rule-repeat", "lintable-blocker", "out-of-scope"}


def _relevant(f: dict, data: dict) -> list:
    """New data that could reproduce the finding: verdicts or episodes of the same target and source."""
    sc = f.get("scope") or {}
    target = f"{sc['mode']}.{sc['feature']}" if sc.get("mode") and sc.get("feature") else None
    if f["kind"] in VERDICT_KINDS:
        return [v for v in data["verdicts"] if not target or v["target"] == target]
    prefixes = {e["ref"].split(":")[0] for e in f["evidence"] if e["kind"] == "episode"}
    return [e for e in data["episodes"] if e["id"].split(":")[0] in prefixes
            and (not target or e.get("target") == target)]



def create(ctx):
    return ImproveStore(ctx)
