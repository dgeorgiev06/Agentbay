"""Claude Code (interactive) runtime adapter.

Mapping:
  worker AgentSpec   -> .claude/agents/<name>.md        (subagent: name, description, tools, model)
  coordinator spec   -> .agentbay/COORDINATOR.md, imported from CLAUDE.md (your main session)
  layer skills       -> .claude/skills/<skill>/
  layer mcpServers   -> .mcp.json (merged)
  layer clis         -> .claude/settings.json permissions.allow  Bash(<cli>:*)
  ledger             -> .claude/settings.json hooks (Pre/PostToolUse on Task|Agent)
  catalog            -> .agentbay/catalog.json

Known limits of this runtime (by design, surfaced as warnings):
  * skills, MCP servers and CLI permissions are project-wide in Claude Code;
    per-agent scoping is enforced through each subagent's `tools` allowlist
  * subagents cannot spawn subagents, so only one coordinator (the main session)
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from ..ledger import now
from ..model import ResolvedAgent
from ..protocol import WORKER_CONTRACT
from .base import BuildReport

MARK_BEGIN = "<!-- agentbay:begin (generated; run ./bay build) -->"
MARK_END = "<!-- agentbay:end -->"
HOOK_TAG = "bay/hook.py"


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
    def build(self, agents: list[ResolvedAgent], project: Path, kit: Path) -> BuildReport:
        rep = BuildReport(self.name)
        coords = [a for a in agents if a.role == "coordinator"]
        workers = [a for a in agents if a.role == "worker"]
        if len(coords) > 1:
            raise SystemExit(f"claude-code runtime supports one coordinator; got {[c.name for c in coords]}")

        old = self._manifest(project)
        man = {"runtime": self.name, "builtAt": now(), "kit": str(kit),
               "files": [], "mcpServers": [], "permissions": []}

        for a in workers:
            man["files"].append(self._write_agent(a, project, rep))
        for sk, src in self._skills(workers + coords).items():
            dst = project / ".claude" / "skills" / sk
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            man["files"].append(str(dst.relative_to(project)))
            rep.written.append(str(dst.relative_to(project)) + "/")
        man["files"].append(self._shim(project, kit, rep))
        man["files"] += self._commands(project, kit, rep)
        man["mcpServers"] = self._mcp(agents, project, old, rep)
        man["permissions"] = self._settings(agents, project, kit, old, rep)
        man["files"] += self._coordinator(coords[0] if coords else None, workers, project, kit, rep)
        man["files"].append(self._catalog(workers, project, rep))

        for f in set(old.get("files", [])) - set(man["files"]):
            self._rm(project / f, rep)

        _write_json(project / ".agentbay" / "manifest.json", man)
        self._ensure_gitignore(project)
        rep.warnings += [
            "Skills, MCP servers and CLI permissions are project-wide in Claude Code; "
            "per-agent scope is enforced via each subagent's tools allowlist.",
        ] if workers else []
        return rep

    def clean(self, project: Path) -> BuildReport:
        rep = BuildReport(self.name)
        old = self._manifest(project)
        for f in old.get("files", []):
            self._rm(project / f, rep)
        self._mcp([], project, old, rep)
        self._settings([], project, Path(old.get("kit", ".")), old, rep, remove_only=True)
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

    def _write_agent(self, a: ResolvedAgent, project: Path, rep: BuildReport) -> str:
        tools = a.tools
        if not tools:
            rep.warnings.append(f"{a.name}: no tools resolved; defaulting to Read only (empty would inherit ALL tools)")
            tools = ["Read"]
        fm = [
            "---",
            f"name: {a.name}",
            f"description: {json.dumps(a.description)}",
            f"tools: {', '.join(tools)}",
            f"model: {a.model}",
            "---",
        ]
        extras = []
        if a.skills:
            extras.append("## Skills\nUse these skills when relevant: " + ", ".join(sorted(a.skills)) + ".")
        if a.clis:
            extras.append("## Allowed CLIs\nOnly run these commands via Bash: " + ", ".join(a.clis) + ".")
        if a.budget:
            b = ", ".join(f"{k}={v}" for k, v in a.budget.items())
            extras.append(f"## Budget\nStay within: {b}. If you cannot finish, return status `partial`.")
        body = "\n\n".join(
            [f"<!-- generated by agentbay from {a.source.name} v{a.version}; edit the spec, not this file -->",
             a.prompt, *extras, WORKER_CONTRACT]
        )
        rel = Path(".claude/agents") / f"{a.name}.md"
        (project / rel).parent.mkdir(parents=True, exist_ok=True)
        (project / rel).write_text("\n".join(fm) + "\n\n" + body.strip() + "\n")
        rep.written.append(str(rel))
        return str(rel)

    def _skills(self, agents: list[ResolvedAgent]) -> dict[str, Path]:
        out: dict[str, Path] = {}
        for a in agents:
            out.update(a.skills)
        return out

    def _commands(self, project: Path, kit: Path, rep: BuildReport) -> list[str]:
        written = []
        src_dir = kit / "coordinator" / "commands"
        for src in sorted(src_dir.glob("*.md")):
            rel = Path(".claude/commands") / src.name
            (project / rel).parent.mkdir(parents=True, exist_ok=True)
            (project / rel).write_text(src.read_text().replace("{{BAY}}", self._bay_cmd(kit)))
            written.append(str(rel))
            rep.written.append(str(rel))
        return written

    def _mcp(self, agents, project: Path, old: dict, rep: BuildReport) -> list[str]:
        path = project / ".mcp.json"
        cfg = _read_json(path, {"mcpServers": {}})
        servers = cfg.setdefault("mcpServers", {})
        for name in old.get("mcpServers", []):
            servers.pop(name, None)
        owned = []
        for a in agents:
            for name, s in a.mcp_servers.items():
                if name in servers and name not in old.get("mcpServers", []):
                    rep.warnings.append(f"MCP server '{name}' already defined by you in .mcp.json; leaving yours")
                    continue
                servers[name] = s
                if name not in owned:
                    owned.append(name)
        if servers or path.exists():
            _write_json(path, cfg)
            rep.written.append(".mcp.json")
        return owned

    def _bay_cmd(self, kit: Path) -> str:
        return ".agentbay/bay"

    def _shim(self, project: Path, kit: Path, rep: BuildReport) -> str:
        rel = Path(".agentbay/bay")
        p = project / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text('#!/bin/sh\n# generated by agentbay: control plane for this project\n'
                     f'exec python3 "{kit / "bay" / "cli.py"}" --project "$(cd "$(dirname "$0")/.." && pwd)" "$@"\n')
        p.chmod(0o755)
        rep.written.append(str(rel))
        return str(rel)

    def _settings(self, agents, project: Path, kit: Path, old: dict, rep: BuildReport,
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
            want = [f"Bash({self._bay_cmd(kit)}:*)"]
            for a in agents:
                want += [f"Bash({c}:*)" for c in a.clis]
            for p in want:
                if p not in allow:
                    allow.append(p)
                    owned.append(p)
                elif p in old.get("permissions", []):
                    owned.append(p)
            hook = f'python3 "{kit / "bay" / "hook.py"}"'
            for event, phase in (("PreToolUse", "pre"), ("PostToolUse", "post")):
                hooks.setdefault(event, []).append(
                    {"matcher": "Task|Agent", "hooks": [{"type": "command", "command": f"{hook} {phase}", "timeout": 10}]}
                )
        if not allow:
            perms.pop("allow")
        if not perms:
            cfg.pop("permissions")
        if not hooks:
            cfg.pop("hooks")
        _write_json(path, cfg)
        rep.written.append(".claude/settings.json")
        return owned

    def _coordinator(self, c: ResolvedAgent | None, workers, project: Path, kit: Path,
                     rep: BuildReport) -> list[str]:
        if c is None:
            self._claude_md(project, None, rep)
            return []
        rows = "\n".join(
            f"| `{w.name}` | {w.model} | {w.isolation} | {', '.join(w.layers)} | {w.description} |" for w in workers
        )
        doc = f"""<!-- generated by agentbay from {c.source.name}; edit the spec, not this file -->
{c.prompt}

## Worker catalog (generated)

| agent | model | isolation | layers | use when |
|---|---|---|---|---|
{rows}

Machine-readable: `.agentbay/catalog.json`.

## Control plane (run via Bash)

- `{self._bay_cmd(kit)} task new` → prints a fresh taskId
- `{self._bay_cmd(kit)} status` → running / finished runs from the ledger
- `{self._bay_cmd(kit)} log -n 20` → last ledger events
- `{self._bay_cmd(kit)} note <runId|taskId> "text"` → record a decision
- `{self._bay_cmd(kit)} reclaim <runId>` → mark a stuck run as reclaimed
- `{self._bay_cmd(kit)} describe <agent>` → full resolved spec for one agent
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

    def _catalog(self, workers, project: Path, rep: BuildReport) -> str:
        cat = [{
            "name": w.name, "version": w.version, "description": w.description, "model": w.model,
            "tools": w.tools, "layers": w.layers, "skills": sorted(w.skills), "clis": w.clis,
            "mcpServers": sorted(w.mcp_servers), "isolation": w.isolation, "budget": w.budget,
            "io": {"accepts": "TaskEnvelope/v1", "returns": "Result/v1"},
        } for w in workers]
        rel = ".agentbay/catalog.json"
        _write_json(project / rel, {"runtime": self.name, "builtAt": now(), "agents": cat})
        rep.written.append(rel)
        return rel

    def _ensure_gitignore(self, project: Path) -> None:
        gi = project / ".agentbay" / ".gitignore"
        if not gi.exists():
            gi.write_text("ledger/\n")
