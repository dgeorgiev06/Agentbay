"""Claude Code (interactive) runtime adapter, v2.

Mapping:
  worker role placement   -> .claude/agents/<role>.md  (or <role>--<agent>.md when an endpoint re-places it)
  Chief of Staff + mode
  coordinator playbooks    -> .agentbay/COORDINATOR.md, imported from CLAUDE.md (your main session)
  role skills, mode skills -> .claude/skills/<skill>/
  tools-capability clis    -> .claude/settings.json permissions.allow  Bash(<cli>:*)
  ledger hooks             -> .claude/settings.json hooks (Pre/PostToolUse on Task|Agent)
  catalog                  -> .agentbay/catalog.json (modes, endpoints, roles)

Guarantees (unchanged from v0.1): idempotent; only touches files recorded in
.agentbay/manifest.json; merges with user CLAUDE.md, .claude/settings.json and
.mcp.json, never clobbers; clean restores the originals.

Known limits of this runtime:
  * skills, MCP servers and CLI permissions are project-wide in Claude Code;
    per-role scope is enforced through each subagent's `tools` allowlist and,
    for connectors, by the dispatcher (`bay use` checks the role's grants)
  * subagents cannot spawn subagents, so mode coordinators run as playbooks in
    the main thread
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from ..ledger import now
from ..model import ResolvedRole, System
from ..protocol import WORKER_CONTRACT
from .base import BuildReport

MARK_BEGIN = "<!-- agentbay:begin (generated; run ./bay build) -->"
MARK_END = "<!-- agentbay:end -->"
HOOK_TAG = "bay/hook.py"
BAY = ".agentbay/bay"


def _read_json(p: Path, default):
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            raise SystemExit(f"{p} is not valid JSON; fix it before building")
    return default


def _write_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2) + "\n")


class ClaudeCodeAdapter:
    name = "claude-code"

    # ---------- public contract ----------
    def build(self, system: System, project: Path, kit: Path) -> BuildReport:
        rep = BuildReport(self.name)
        old = self._manifest(project)
        man = {"runtime": self.name, "builtAt": now(), "kit": str(kit),
               "files": [], "mcpServers": [], "permissions": []}

        placements = system.placements()
        for sub, role in sorted(placements.items()):
            man["files"].append(self._write_agent(sub, role, system, project, rep))
        for sk, src in sorted(self._skills(system, placements).items()):
            dst = project / ".claude" / "skills" / sk
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            man["files"].append(str(dst.relative_to(project)))
            rep.written.append(str(dst.relative_to(project)) + "/")
        man["files"].append(self._shim(project, kit, rep))
        man["files"] += self._commands(project, kit, rep)
        man["mcpServers"] = self._mcp(system, project, old, rep)
        man["permissions"] = self._settings(placements, project, kit, old, rep)
        man["files"] += self._coordinator(system, placements, project, kit, rep)
        man["files"].append(self._catalog(system, placements, project, rep))

        for f in set(old.get("files", [])) - set(man["files"]):
            self._rm(project / f, rep)

        _write_json(project / ".agentbay" / "manifest.json", man)
        self._ensure_gitignore(project)
        if placements:
            rep.warnings.append("Skills and CLI permissions are project-wide in Claude Code; per-role scope is "
                                "enforced via each subagent's tools allowlist and by the dispatcher for connectors.")
        return rep

    def clean(self, project: Path) -> BuildReport:
        rep = BuildReport(self.name)
        old = self._manifest(project)
        for f in old.get("files", []):
            self._rm(project / f, rep)
        self._mcp(None, project, old, rep)
        self._settings({}, project, Path(old.get("kit", ".")), old, rep, remove_only=True)
        self._claude_md(project, None, rep)
        (project / ".agentbay" / "manifest.json").unlink(missing_ok=True)
        return rep

    # ---------- pieces ----------
    def _manifest(self, project: Path) -> dict:
        return _read_json(project / ".agentbay" / "manifest.json", {})

    def _rm(self, p: Path, rep: BuildReport) -> None:
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
        else:
            return
        rep.removed.append(str(p))

    def _write_agent(self, sub: str, r: ResolvedRole, system: System, project: Path, rep: BuildReport) -> str:
        tools = r.tools or ["Read"]
        if not r.tools:
            rep.warnings.append(f"{sub}: no tools resolved; defaulting to Read only (empty would inherit ALL tools)")
        modes = ", ".join(r.modes) or "-"
        fm = ["---", f"name: {sub}", f"description: {json.dumps(r.description)}",
              f"tools: {', '.join(tools)}", f"model: {r.inference.model}", "---"]
        extras = [f"## Placement\nRole `{r.name}` on agent `{r.agent}` in env `{r.env}` (modes: {modes}). "
                  f"Your step plan (in the task block) gives the feature's playbook, rules and definition of done; "
                  f"they are your definition of done for that step."]
        extras.append("## Done when\n" + "\n".join(f"- {d}" for d in r.done_when))
        if r.rules:
            extras.append("## Rules\n" + "\n".join(f"- {x}" for x in r.rules))
        if r.skills:
            extras.append("## Skills\nUse these skills when relevant: " + ", ".join(sorted(r.skills)) + ".")
        if r.bay_uses:
            extras.append("## Data access\nRead feed data only through the dispatcher, never from files:\n"
                          + "\n".join(f"- `{BAY} use --role {r.name} {u} '<json>'`" for u in r.bay_uses))
        if r.clis:
            extras.append("## Allowed CLIs\nOnly run these commands via Bash: " + ", ".join(r.clis) + ".")
        if r.budget:
            b = ", ".join(f"{k}={v}" for k, v in r.budget.items())
            extras.append(f"## Budget\nStay within: {b}. If you cannot finish, return status `partial`.")
        body = "\n\n".join([f"<!-- generated by agentbay from role {r.name}; edit the role, not this file -->",
                            r.prompt, *extras, WORKER_CONTRACT])
        rel = Path(".claude/agents") / f"{sub}.md"
        (project / rel).parent.mkdir(parents=True, exist_ok=True)
        (project / rel).write_text("\n".join(fm) + "\n\n" + body.strip() + "\n")
        rep.written.append(str(rel))
        return str(rel)

    def _skills(self, system: System, placements) -> dict[str, Path]:
        out: dict[str, Path] = {}
        for r in placements.values():
            out.update(r.skills)
        for m in system.modes.values():
            out.update(m.skills)
        return out

    def _commands(self, project: Path, kit: Path, rep: BuildReport) -> list[str]:
        written = []
        for src in sorted((kit / "coordinator" / "commands").glob("*.md")):
            rel = Path(".claude/commands") / src.name
            (project / rel).parent.mkdir(parents=True, exist_ok=True)
            (project / rel).write_text(src.read_text().replace("{{BAY}}", BAY))
            written.append(str(rel))
            rep.written.append(str(rel))
        return written

    def _mcp(self, system: System | None, project: Path, old: dict, rep: BuildReport) -> list[str]:
        path = project / ".mcp.json"
        if not path.exists() and not old.get("mcpServers"):
            want = self._want_mcp(system)
            if not want:
                return []
        cfg = _read_json(path, {"mcpServers": {}})
        servers = cfg.setdefault("mcpServers", {})
        for name in old.get("mcpServers", []):
            servers.pop(name, None)
        owned = []
        for name, s in self._want_mcp(system).items():
            if name in servers:
                rep.warnings.append(f"MCP server '{name}' already defined by you in .mcp.json; leaving yours")
                continue
            servers[name] = s
            owned.append(name)
        _write_json(path, cfg)
        rep.written.append(".mcp.json")
        return owned

    def _want_mcp(self, system: System | None) -> dict:
        if system is None:
            return {}
        out = {}
        for env in system.kit.docs["Environment"].values():
            for b in env.spec["bind"].values():
                if isinstance(b, dict):
                    out.update(b.get("mcpServers", {}))
        return out

    def _shim(self, project: Path, kit: Path, rep: BuildReport) -> str:
        rel = Path(BAY)
        p = project / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('#!/bin/sh\n# generated by agentbay: control plane for this project\n'
                     f'exec python3 "{kit / "bay" / "cli.py"}" --project "$(cd "$(dirname "$0")/.." && pwd)" "$@"\n')
        p.chmod(0o755)
        rep.written.append(str(rel))
        return str(rel)

    def _settings(self, placements, project: Path, kit: Path, old: dict, rep: BuildReport,
                  remove_only: bool = False) -> list[str]:
        path = project / ".claude" / "settings.json"
        cfg = _read_json(path, {})
        perms = cfg.setdefault("permissions", {})
        allow = perms.setdefault("allow", [])
        for p in old.get("permissions", []):
            if p in allow:
                allow.remove(p)
        hooks = cfg.setdefault("hooks", {})
        for event in ("PreToolUse", "PostToolUse"):
            hooks[event] = [h for h in hooks.get(event, [])
                            if not any(HOOK_TAG in x.get("command", "") for x in h.get("hooks", []))]
            if not hooks[event]:
                hooks.pop(event)
        owned: list[str] = []
        if not remove_only:
            want = [f"Bash({BAY}:*)"]
            for r in placements.values():
                want += [f"Bash({c}:*)" for c in r.clis]
            for p in dict.fromkeys(want):
                if p not in allow:
                    allow.append(p)
                    owned.append(p)
                elif p in old.get("permissions", []):
                    owned.append(p)
            hook = f'python3 "{kit / "bay" / "hook.py"}"'
            for event, phase in (("PreToolUse", "pre"), ("PostToolUse", "post")):
                hooks.setdefault(event, []).append(
                    {"matcher": "Task|Agent", "hooks": [{"type": "command", "command": f"{hook} {phase}", "timeout": 10}]})
        if not allow:
            perms.pop("allow")
        if not perms:
            cfg.pop("permissions")
        if not hooks:
            cfg.pop("hooks")
        _write_json(path, cfg)
        rep.written.append(".claude/settings.json")
        return owned

    def _coordinator(self, system: System, placements, project: Path, kit: Path, rep: BuildReport) -> list[str]:
        cos = (kit / "coordinator" / "chief-of-staff.md").read_text().strip()
        ep_rows, role_rows, books = [], [], []
        for m in system.modes.values():
            for f in m.features.values():
                review = f"{f.review['role']} ({f.review.get('model', 'default')})" if f.review else "-"
                ep_rows.append(f"| `{m.name}.{f.name}` | {f.in_type or '-'} -> {f.out_type or '-'} | "
                               f"{', '.join(f.effects)} | {review} | {f.description or m.purpose} |")
            if m.coordinator and m.playbook:
                coord = system.roles[m.coordinator]
                books.append(f"### Mode `{m.name}` - coordinator role `{coord.name}`\n\n{coord.prompt}\n\n"
                             + m.playbook.strip().replace("# ", "#### ", 1))
        for sub, r in sorted(placements.items()):
            role_rows.append(f"| `{sub}` | {r.inference.model} | {r.env} | {r.isolation} | {r.description} |")
        doc = f"""<!-- generated by agentbay; edit coordinator/, modes/ and roles/, not this file -->
{cos}

## Mode endpoints (generated)

| endpoint | in -> out | effects | review | use when |
|---|---|---|---|---|
{chr(10).join(ep_rows)}

## Worker subagents (generated)

| subagent_type | model | env | isolation | role |
|---|---|---|---|---|
{chr(10).join(role_rows)}

Machine-readable: `.agentbay/catalog.json`.

## Mode coordinator playbooks (run in this main thread)

{chr(10).join(books) or '_none_'}

## Control plane (run via Bash)

- `{BAY} call <mode>.<endpoint> '<json>'` -> run an endpoint; returns a result or the next step plan
- `{BAY} submit <callId> <stepId> '<json>'` -> hand back a step's output (or a gate approval)
- `{BAY} task new` -> prints a fresh taskId
- `{BAY} status` / `{BAY} log -n 20` -> calls, steps and agent runs from the ledger
- `{BAY} note <runId|taskId|callId> "text"` -> record a decision
- `{BAY} reclaim <runId>` -> mark a stuck run as reclaimed
- `{BAY} describe <mode|role>` -> full resolved definition
"""
        rel = Path(".agentbay/COORDINATOR.md")
        (project / rel).parent.mkdir(parents=True, exist_ok=True)
        (project / rel).write_text(doc)
        rep.written.append(str(rel))
        self._claude_md(project, "@.agentbay/COORDINATOR.md", rep)
        return [str(rel)]

    def _claude_md(self, project: Path, line: str | None, rep: BuildReport) -> None:
        path = project / "CLAUDE.md"
        text = path.read_text() if path.exists() else ""
        if MARK_BEGIN in text:
            pre, rest = text.split(MARK_BEGIN, 1)
            post = rest.split(MARK_END, 1)[1] if MARK_END in rest else ""
            text = pre.rstrip("\n") + ("\n" if pre.strip() else "") + post.lstrip("\n")
        if line:
            block = f"{MARK_BEGIN}\n{line}\n{MARK_END}\n"
            text = block + ("\n" + text if text.strip() else "")
        if text.strip() or path.exists():
            path.write_text(text)
            rep.written.append("CLAUDE.md")

    def _catalog(self, system: System, placements, project: Path, rep: BuildReport) -> str:
        modes = []
        for m in system.modes.values():
            modes.append({
                "name": m.name, "version": m.version, "origin": m.root, "purpose": m.purpose,
                "coordinator": m.coordinator, "roles": m.roles, "constraints": m.constraints,
                "endpoints": [{
                    "name": f"{m.name}.{f.name}", "description": f.description, "in": f.in_type, "out": f.out_type,
                    "effects": f.effects, "schedule": f.schedule,
                    "review": f.review, "steps": [{"id": s.id, "kind": s.kind, "run": s.run, "role": s.role,
                                                   "subagent": s.subagent, "env": s.env} for s in f.steps],
                    "playbook": str(f.playbook_path.relative_to(system.kit.root)) if f.playbook_path else None,
                } for f in m.features.values()],
            })
        roles = [{
            "subagent": sub, "role": r.name, "agent": r.agent, "env": r.env, "runtime": r.runtime,
            "model": r.inference.model, "effort": r.inference.effort, "description": r.description,
            "tools": r.tools, "uses": r.uses, "skills": sorted(r.skills), "clis": r.clis,
            "isolation": r.isolation, "budget": r.budget, "modes": r.modes,
            "io": {"accepts": "TaskEnvelope/v1", "returns": "Result/v1"},
        } for sub, r in sorted(placements.items())]
        coords = [{"role": r.name, "modes": r.modes, "runtime": r.runtime}
                  for r in system.roles.values() if r.runtime == "claude-code-main" and r.modes]
        rel = ".agentbay/catalog.json"
        _write_json(project / rel, {"runtime": self.name, "builtAt": now(), "modes": modes,
                                    "roles": roles, "coordinators": coords})
        rep.written.append(rel)
        return rel

    def _ensure_gitignore(self, project: Path) -> None:
        gi = project / ".agentbay" / ".gitignore"
        if not gi.exists():
            gi.write_text("ledger/\ndata/\ncalls/\n")
