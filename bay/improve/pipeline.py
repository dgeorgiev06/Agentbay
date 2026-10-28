"""improve's read-only analysis (improve.detect/v1): gather data from the bound sources, run the deterministic
detectors, resolve analyst evidence, re-check a finding. Nothing here writes; the store does.

`sources` are connector instances bound in the same env: session.events/v1 (ledger, claude-transcripts, git),
review.verdicts/v1 (ledger), artifacts.read/v1 (artifact-graph).
"""
from __future__ import annotations

import re
import subprocess
from datetime import datetime
from pathlib import Path

import yaml

from .. import model
from . import conformance, detect_artifacts, detect_sessions, short_hash
from .store import fingerprint

EPISODE_SUMMARY_FIELDS = ("id", "source", "kind", "target", "status", "agent", "agentType", "parent", "start",
                          "durationMs", "costUsd", "errors", "permissionPrompts", "interrupts", "instructionChanges",
                          "statusQuestions", "envGaps", "turns")
MAX_SUMMARIES = 300
VERDICT_KINDS = {"review-rounds", "rule-repeat", "lintable-blocker", "out-of-scope"}
SCOPE_KEYS = ("mode", "feature", "step", "role", "env", "rule", "file", "files", "framework")
SHA = re.compile(r"^[0-9a-f]{7,40}$")


def iso(dt: datetime | None) -> str | None:
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z") if dt else None


def summary(e: dict) -> dict:
    """What an analyst sees of an episode in its step plan: counts and names only."""
    out = {k: e[k] for k in EPISODE_SUMMARY_FIELDS if e.get(k) not in (None, [], {}, 0)}
    if e.get("toolCalls"):
        names: dict[str, int] = {}
        for t in e["toolCalls"]:
            names[t["name"]] = names.get(t["name"], 0) + 1
        out["tools"] = names
    if e.get("denials"):
        out["denials"] = len(e["denials"])
    if e.get("subagents"):
        out["subagents"] = [s.get("type", "?") for s in e["subagents"]]
    if e.get("steps"):
        out["steps"] = [{k: s[k] for k in ("id", "status", "durationMs", "costUsd") if k in s} for s in e["steps"]]
    if e.get("commit"):
        c = e["commit"]
        out["commit"] = {"sha": c["sha"], "isRevert": c["isRevert"], "files": len(c["files"])}
    return out


class Pipeline:
    def __init__(self, sources: dict, kit: Path, project: Path, settings: dict, now: datetime, run=subprocess.run):
        self.sources, self.kit, self.project = sources, Path(kit), Path(project)
        self.settings, self.now, self.run = settings or {}, now, run
        self.warnings: list[str] = []

    # ------------------------------------------------------------------ data
    def _with(self, method: str) -> list:
        return [s for _, s in sorted(self.sources.items()) if callable(getattr(s, method, None))]

    def window(self, since=None, until=None) -> tuple[str, str | None]:
        from ..util import parse_time
        s = parse_time(since or self.settings.get("window") or "7d", self.now)
        return iso(s), (iso(parse_time(until, self.now)) if until else None)

    def session_data(self, since=None, until=None, only_ledger=False) -> tuple[dict, dict]:
        s, u = self.window(since, until)
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
                out = src.verdicts(since=s, until=u)
                verdicts += out["verdicts"]
                stats["verdicts"] = out["stats"]
        stats["episodes"] = len(eps)
        return {"episodes": eps, "verdicts": verdicts}, {"stats": stats, "window": {"since": s, "until": u}}

    def _artifacts_src(self):
        srcs = self._with("graph")
        if len(srcs) != 1:
            raise ValueError(f"improve.detect needs exactly one artifacts.read/v1 connector (found {len(srcs)})")
        return srcs[0]

    def artifacts(self, root: str = "project") -> detect_artifacts.Artifacts:
        art = self._artifacts_src()
        unreadable: list[str] = []

        def text(p):
            try:
                raw = getattr(art, "raw_text", None)     # dispatcher-side only; outputs are scrubbed
                return raw(path=p, root=root) if raw else art.text(path=p, root=root)["text"]
            except Exception as e:           # refused or unreadable: counted, named in warnings
                unreadable.append(f"{p}: {type(e).__name__}")
                return None
        base = self.kit if root == "kit" else self.project
        is_kit = base.resolve() == self.kit.resolve()
        ledger_eps = self.session_data(only_ledger=True)[0]["episodes"]
        return detect_artifacts.Artifacts(files=art.files(root=root)["files"], text=text, graph=art.graph(root=root),
                                          ledger=ledger_eps, conformance=conformance.run(self.kit) if is_kit else [],
                                          is_kit=is_kit, unreadable=unreadable)

    def _system(self):
        try:
            return model.resolve(model.Kit(self.kit, self.project))
        except (model.ResolveError, model.SpecError) as e:
            self.warnings.append(f"role context skipped: the kit does not resolve for this project ({str(e)[:200]})")
            return None

    def role_contexts(self) -> list[dict]:
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
            out.append({"name": r.name, "path": model.rel(sysm.kit.get("Role", r.name).path),
                        "chars": base + biggest, "parts": parts})
        return out

    def read_endpoints(self) -> set[str]:
        """Read-only endpoints of store interfaces (interfaces that also write): where re-reading the whole store
        per call is waste. Plain readers (artifacts.read, review.verdicts) are excluded."""
        out = set()
        for d in model.Kit(self.kit).docs["Interface"].values():
            eps = d.spec["endpoints"]
            if any("write" in s["effects"] for s in eps.values()):
                out |= {ep for ep, s in eps.items() if set(s["effects"]) <= {"read"}}
        return out

    # ------------------------------------------------------------------ endpoints
    def sessions(self, since=None, until=None) -> dict:
        data, meta = self.session_data(since, until)
        cands = detect_sessions.run(data, self.settings)
        sums = [summary(e) for e in data["episodes"]]
        return {"candidates": cands, "episodes": sums[:MAX_SUMMARIES], "episodesTotal": len(sums),
                "stats": meta["stats"], "window": meta["window"], "warnings": self.warnings}

    def audit(self, root: str = "project") -> dict:
        a = self.artifacts(root)
        cands = detect_artifacts.run(a, self.settings, roles=self.role_contexts() if a.is_kit else [],
                                     read_endpoints=self.read_endpoints())
        manual = [{k: r[k] for k in ("id", "level", "statement")} for r in conformance.manual(self.kit)] \
            if a.is_kit else []
        warnings = self.warnings + [f"unreadable: {u}" for u in a.unreadable[:20]] + \
            [f"not parsed: {u}" for u in a.unparsed[:20]]
        return {"candidates": cands, "manual": manual, "warnings": warnings,
                "stats": {"files": len(a.files), "graphNodes": len(a.graph.get("nodes", [])),
                          "conformanceRules": [c["rule"] for c in a.conformance],
                          "unreadable": len(a.unreadable), "unparsed": len(a.unparsed)}}

    def _known_rule_ids(self) -> set[str]:
        """C-n from framework/rules/conformance.yaml, R-n from every rules.yaml, DOD-n from every playbook."""
        if getattr(self, "_rule_ids", None) is None:
            ids: set[str] = set()
            for base in {self.kit.resolve(), self.project.resolve()}:
                for f in list(base.glob("framework/rules/*.yaml")) + list(base.glob("**/features/*/rules.yaml")):
                    if ".agentbay" in f.parts:
                        continue
                    try:
                        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
                    except (OSError, yaml.YAMLError):
                        continue
                    for r in doc.get("rules", []) if isinstance(doc, dict) else []:
                        if isinstance(r, dict) and isinstance(r.get("id"), str):
                            ids.add(r["id"])
                for f in base.glob("**/features/*/playbook.md"):
                    if ".agentbay" not in f.parts:
                        ids.update(re.findall(r"\[(DOD-[0-9]+)\]", f.read_text(encoding="utf-8", errors="replace")))
            self._rule_ids = ids
        return self._rule_ids

    def _commit_exists(self, sha: str) -> bool:
        if not SHA.match(sha):
            return False
        try:
            r = self.run(["git", "-C", str(self.project), "cat-file", "-e", f"{sha}^{{commit}}"],
                         capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            return False
        return r.returncode == 0

    def _resolves(self, e: dict, episodes: set[str]) -> str | None:
        ref = str(e.get("ref", ""))
        kind = e.get("kind")
        if kind == "episode":
            return None if ref in episodes else f"episode {ref} is not in the sources (retention window)"
        if kind == "commit":
            return None if self._commit_exists(ref.removeprefix("git:")) else f"commit {ref} is not in the project's git"
        if kind == "file":
            path, _, rest = ref.partition("#")[0].partition(":")
            for base in (self.project, self.kit):
                p = (base / path)
                try:
                    inside = p.resolve().is_relative_to(base.resolve())
                except OSError:
                    inside = False
                if inside and p.is_file():
                    if rest.isdigit() and int(rest) > p.read_text(encoding="utf-8", errors="replace").count("\n") + 1:
                        return f"{ref}: line {rest} is past the end of the file"
                    return None
            return f"file {path} does not exist"
        if kind == "rule":
            if not re.match(r"^(C|R|DOD)-[0-9]+$", ref):
                return f"rule {ref} is not a rule id"
            return None if ref in self._known_rule_ids() else f"rule {ref} does not exist in any rules file or playbook"
        if kind == "measurement":
            return None
        return f"unknown evidence kind {kind}"

    def resolve(self, findings: list[dict]) -> dict:
        """Analyst/auditor findings -> candidates whose evidence resolves; the rest rejected with reasons."""
        accepted, rejected = [], []
        known: set[str] = set()
        if any(e.get("kind") == "episode" for f in findings for e in f["evidence"]):
            data, _ = self.session_data(since=self.settings.get("retention") or "90d")
            known = {e["id"] for e in data["episodes"]}
        for i, f in enumerate(findings):
            bad = [r for r in (self._resolves(e, known) for e in f["evidence"]) if r]
            if all(e.get("kind") == "measurement" for e in f["evidence"]):
                bad.append("measurement-only evidence: cite the episode, file:line, commit or rule it was measured on")
            eps = {e["ref"] for e in f["evidence"] if e.get("kind") == "episode"}
            if not bad and f["lens"] == "sessions" and len(eps) < 2 and f.get("severity") != "severe":
                bad.append("a recurring session pattern needs evidence from >= 2 episodes unless it is severe")
            if bad:
                rejected.append({"index": i, "title": f["title"][:120], "reasons": bad[:5]})
                continue
            scope = {k: v for k, v in (f.get("scope") or {}).items() if k in SCOPE_KEYS}
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
            accepted.append(c)
        return {"accepted": accepted, "rejected": rejected}

    def recheck(self, f: dict) -> dict:
        """Re-run the finding's detector on data newer than the fix."""
        name = f["detector"]["name"]
        if name == "pattern":
            return {"present": None, "newData": 0,
                    "note": "analyst finding: no deterministic detector; re-run improve.scan and check by hand"}
        if f["lens"] == "sessions":
            since = next((h["ts"] for h in reversed(f.get("history", []))
                          if h["status"] in ("in-progress", "fixed", "approved")), f.get("lastSeen"))
            data, _ = self.session_data(since=since)
            new = len(relevant(f, data))
            found = detect_sessions.run(data, self.settings, only=name)
        else:
            a = self.artifacts("project")
            new = 1
            found = detect_artifacts.run(a, self.settings, only=name,
                                         roles=self.role_contexts() if a.is_kit else [],
                                         read_endpoints=self.read_endpoints())
        return {"present": any(fingerprint(c) == f["fingerprint"] for c in found), "newData": new}


def relevant(f: dict, data: dict) -> list:
    """New data that could reproduce the finding: verdicts or episodes of the same target and source."""
    sc = f.get("scope") or {}
    target = f"{sc['mode']}.{sc['feature']}" if sc.get("mode") and sc.get("feature") else None
    if f["kind"] in VERDICT_KINDS:
        return [v for v in data["verdicts"] if not target or v["target"] == target]
    prefixes = {e["ref"].split(":")[0] for e in f["evidence"] if e["kind"] == "episode"}
    return [e for e in data["episodes"] if e["id"].split(":")[0] in prefixes
            and (not target or e.get("target") == target)]
