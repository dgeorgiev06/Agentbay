"""Claude Code (interactive) runtime adapter, v2.

Mapping (a unit is one role in one mode and one env: <role>--<mode>, plus --<env> when the mode runs that
role in several envs):
  worker role unit         -> .claude/agents/<unit>.md (model from the agent profile's tier map)
  Chief of Staff + mode
  coordinator playbooks    -> .agentbay/COORDINATOR.md, imported from CLAUDE.md (your main session)
  mode skills -> .claude/skills/<mode>--<skill>/, role skills -> .claude/skills/<role>--<skill>/ (a mode's
  skills include those it inherits via extends; SKILL.md `name:` is rewritten to the folder name)
  role data access         -> .agentbay/roles/<unit>/use  (unit fixed inside; read-only endpoints only; its
                              mode's data in its env only)
  coordinator commands     -> .claude/settings.json permissions.allow, explicit prefixes only
                              (Bash(.agentbay/bay call:*), ... status, log, note, submit, task,
                              catalog) - no wildcard
  per-unit Bash scope      -> .agentbay/guard.json + PreToolUse(Bash) hook bay/guard.py: a subagent may run
                              only its own use shim and its env's narrow command prefixes
  ledger hooks             -> .claude/settings.json hooks (Pre/PostToolUse on Task|Agent)
  catalog                  -> .agentbay/catalog.json, built by bay.registry (runtime-neutral:
                              modes, endpoints with resolved schemas, roles, project workflows)

Guarantees: idempotent; only touches files recorded in
.agentbay/manifest.json; merges with user CLAUDE.md, .claude/settings.json and
.mcp.json, never clobbers; clean restores the originals.

Known limits of this runtime:
  * permissions.allow is session-wide in Claude Code and subagent `tools`
    takes bare tool names, so per-role Bash scope is enforced by the guard
    hook (keyed on the hook input's agent_type), and connector access by the
    dispatcher behind each role's use shim
  * subagents cannot spawn subagents, so mode coordinators run as playbooks in
    the main thread
"""
from __future__ import annotations

import json
import shlex
import shutil
from pathlib import Path

import yaml

from bay import registry, workflows
from bay.adapter import BuildReport
from bay.dispatch import use_shim
from bay.ledger import now
from bay.model import PROTECTED, ROOT_COORDINATOR, ResolvedRole, SpecError, System, skill_front_matter
from bay.protocol import WORKER_CONTRACT

MARK_BEGIN = "<!-- agentbay:begin (generated; run ./bay build) -->"
MARK_END = "<!-- agentbay:end -->"
HOOK_TAG = "bay/hook.py"
GUARD_TAG = "bay/guard.py"
BAY = ".agentbay/bay"
# The only control-plane commands the main thread is pre-approved for. Everything else
# (build, clean, secret, mode new, ...) prompts. Subagents get none of these (guard).
# Safety rule: nothing that runs code is pre-approved. call/submit run connector code, so they prompt.
COORDINATOR_CMDS = ("show", "status", "note", "catalog")
# Writes that sit under a pre-approved command: each is its own prefix (`show reclaim`, `note dispatch`, `note review`)
# so one `ask` rule keeps the prompt they always had. `ask` is checked before `allow`.
ASKED_UNDER_COORDINATOR_CMDS = ("show reclaim", "note dispatch", "note review")
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
GUARD_MATCHER = "Bash|Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep"


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


def _within(p: Path, root: Path) -> bool:
    try:
        p.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _remove_each(target: list, items: list) -> None:
    """Remove the first occurrence of each of `items` that `target` holds."""
    for p in items:
        if p in target:
            target.remove(p)


def _owns_hook(h: dict) -> bool:
    """Whether a hook entry runs one of our commands (the dispatch hook or the guard)."""
    return any(tag in x.get("command", "") for x in h.get("hooks", []) for tag in (HOOK_TAG, GUARD_TAG))


def _strip_owned_hooks(hooks: dict) -> None:
    """Drop our hook entries from the Pre/PostToolUse lists, and a list that is left empty."""
    for event in ("PreToolUse", "PostToolUse"):
        hooks[event] = [h for h in hooks.get(event, []) if not _owns_hook(h)]
        if not hooks[event]:
            hooks.pop(event)


def _claim(target: list, want: list, previously_owned: list) -> list[str]:
    """Add each of `want` that `target` lacks; return those we now own (added now, or added by an earlier build)."""
    owned = []
    for p in want:
        if p not in target:
            target.append(p)
            owned.append(p)
        elif p in previously_owned:
            owned.append(p)
    return owned


def _want_deny(kit: Path, project: Path) -> list[str]:
    """Session-wide floor (main thread and subagents): no file tool edits the control plane, Claude Code config
    or the kit; store and call state are not read by file tools.
    `Edit(...)` covers every editing tool (Write/MultiEdit/NotebookEdit path rules never match)."""
    want = ["Edit(/.agentbay/**)", "Edit(/.claude/**)", "Read(/.agentbay/data/**)", "Read(/.agentbay/calls/**)"]
    if not _within(kit, project):
        want.append(f"Edit(/{kit.resolve()}/**)")
    elif kit.resolve() != project.resolve():              # kit nested inside the project
        want.append(f"Edit(/{kit.resolve().relative_to(project.resolve()).as_posix()}/**)")
    want.append("Edit(/agentbay.config.yaml)")           # the owner's settings (approvals.chat among them)
    return want


def _want_ask() -> list[str]:
    """`bay approve` in any spelling always asks the user first (the main thread relays chat approvals
    only through this prompt); a subagent is refused by the guard hook either way. So do the writes that share a
    prefix with a pre-approved command (`show reclaim`, `note dispatch`, `note review`)."""
    spellings = (BAY, "./bay.sh", "bay", "bay.sh", "python3 -m bay.cli", "python3 bay/cli.py", "python3 */bay/cli.py")
    return [f"Bash({s} {verb}:*)" for verb in ("approve", *ASKED_UNDER_COORDINATOR_CMDS) for s in spellings]


def _install_hooks(hooks: dict, kit: Path) -> None:
    """Our guard hook first among the PreToolUse hooks, our dispatch hook last in Pre and PostToolUse."""
    guard = f'python3 "{kit / "bay" / "guard.py"}"'
    hooks.setdefault("PreToolUse", []).insert(
        0, {"matcher": GUARD_MATCHER,
            # a failing/crashing/timed-out guard blocks the call (Claude Code >= 2.1.295)
            "hooks": [{"type": "command", "command": guard, "timeout": 10, "onFailure": "block"}]})
    hook = f'python3 "{kit / "bay" / "hook.py"}"'
    for event, phase in (("PreToolUse", "pre"), ("PostToolUse", "post")):
        hooks.setdefault(event, []).append(
            {"matcher": "Task|Agent", "hooks": [{"type": "command", "command": f"{hook} {phase}", "timeout": 10}]})


def _drop_empty(cfg: dict, perms: dict, hooks: dict) -> None:
    """Remove the permission lists, `permissions` and `hooks` that hold nothing."""
    for key in ("allow", "deny", "ask"):
        if not perms[key]:
            perms.pop(key)
    if not perms:
        cfg.pop("permissions")
    if not hooks:
        cfg.pop("hooks")


def _without(playbook: str, uninstalled: dict) -> str:
    """Drop playbook bullets (and their indented continuation lines) about endpoints not installed here."""
    out, skipping = [], False
    for line in playbook.splitlines():
        if line.lstrip().startswith("- "):
            skipping = any(t in line for t in uninstalled)
        elif not line.startswith((" ", "\t")):
            skipping = False
        if not skipping:
            out.append(line)
    return "\n".join(out) + "\n"


def _same(a: str, b: str) -> bool:
    """Same content, ignoring JSON formatting."""
    if a == b:
        return True
    try:
        return json.loads(a) == json.loads(b)
    except (json.JSONDecodeError, ValueError):
        return False


def _empty(p: Path) -> bool:
    text = p.read_text().strip()
    if not text:
        return True
    try:
        d = json.loads(text)
    except json.JSONDecodeError:
        return False
    return d in ({}, {"mcpServers": {}})


def _rename_skill(p: Path, name: str) -> None:
    """Set the copied SKILL.md's front-matter `name:` to its namespaced folder name (Claude Code wants them equal).
    The front matter is parsed as YAML (CRLF normalised) and written back with `name` first; a malformed block
    (`bay check` reports it) removes the copied skill and stops the build rather than writing a broken file."""
    if not p.exists():
        return
    try:
        meta, body = skill_front_matter(p.read_text(encoding="utf-8"))
    except SpecError as e:
        shutil.rmtree(p.parent, ignore_errors=True)
        raise SpecError(f"skill {name}: SKILL.md: {e}; run `bay check`") from e
    meta = {"name": name, **{k: v for k, v in meta.items() if k != "name"}}
    head = yaml.safe_dump(meta, sort_keys=False, width=float("inf"), allow_unicode=True, default_flow_style=False)
    p.write_text("---\n" + head + "---\n" + body, encoding="utf-8")


class ClaudeCodeAdapter:
    name = "claude-code"

    # ---------- public contract ----------
    def build(self, system: System, project: Path, kit: Path) -> BuildReport:
        rep = BuildReport(self.name)
        old = self._manifest(project)
        # files that existed before agentbay first touched the project are merged and restored, never deleted
        # (recorded on the first build; an empty list is a real answer, not "unknown")
        if "preexisting" in old:
            preexisting = old["preexisting"]
        else:
            preexisting = [f for f in ("CLAUDE.md", ".claude/settings.json", ".mcp.json") if (project / f).exists()]
        originals = old["originals"] if "originals" in old else {f: (project / f).read_text() for f in preexisting}
        man = {"runtime": self.name, "builtAt": now(), "kit": str(kit), "preexisting": preexisting,
               "originals": originals, "files": [], "mcpServers": [], "permissions": [], "denies": []}

        system = system.for_project(project)            # forge.extend only into the agentbay checkout
        units = system.subagents()                 # unit name -> worker unit
        for sub, role in sorted(units.items()):
            man["files"].append(self._write_agent(sub, role, system, project, rep))
        for sk, src in sorted(self._skills(system, units).items()):
            dst = project / ".claude" / "skills" / sk
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            _rename_skill(dst / "SKILL.md", sk)
            man["files"].append(str(dst.relative_to(project)))
            rep.written.append(str(dst.relative_to(project)) + "/")
        man["files"].append(self._shim(project, kit, rep))
        man["files"] += self._role_shims(units, project, kit, rep)
        man["files"].append(self._guard_policy(system, units, project, kit, rep))
        man["files"] += self._commands(project, kit, rep)
        man["mcpServers"] = self._mcp(system, project, old, rep)
        man["permissions"], man["denies"] = self._settings(units, project, kit, old, rep)
        man["files"] += self._coordinator(system, units, project, kit, rep)
        man["files"].append(self._catalog(system, units, project, rep))
        man["files"].append(self._ensure_gitignore(project))

        for f in set(old.get("files", [])) - set(man["files"]):
            self._rm(project / f, rep)

        _write_json(project / ".agentbay" / "manifest.json", man)
        if units:
            rep.warnings.append("Per-role Bash scope is enforced by the agentbay guard hook; restart Claude Code "
                                "and accept the workspace trust prompt so hooks run.")
        return rep

    def clean(self, project: Path) -> BuildReport:
        rep = BuildReport(self.name)
        old = self._manifest(project)
        runtime = [d for d in ("ledger", "data", "calls") if (project / ".agentbay" / d).exists()]
        for f in old.get("files", []):
            if f == ".agentbay/.gitignore" and runtime:
                continue                    # keeps your ledger/data/calls out of git while they exist
            self._rm(project / f, rep)
        self._mcp(None, project, old, rep)
        self._settings({}, project, Path(old.get("kit", ".")), old, rep, remove_only=True)
        self._claude_md(project, None, rep)
        pre = set(old.get("preexisting", ["CLAUDE.md", ".claude/settings.json", ".mcp.json"]))
        for f, text in (old.get("originals") or {}).items():
            p = project / f
            if p.exists() and _same(p.read_text(), text):
                p.write_text(text)                     # restore exact original formatting
        for f in ("CLAUDE.md", ".claude/settings.json", ".mcp.json"):
            p = project / f
            if f not in pre and p.exists() and _empty(p):
                self._rm(p, rep)                       # we created it and nothing of yours is in it
        roles_dir = project / ".agentbay" / "roles"
        for d in sorted(roles_dir.glob("*"), reverse=True) if roles_dir.is_dir() else []:
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        for d in (".claude/agents", ".claude/skills", ".claude/commands", ".claude", ".agentbay/roles"):
            p = project / d
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
        (project / ".agentbay" / "manifest.json").unlink(missing_ok=True)
        ab = project / ".agentbay"
        if ab.is_dir() and not any(ab.iterdir()):
            ab.rmdir()                      # runtime data (ledger/, data/, calls/) is yours and is kept
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
        prof, _ = system.kit.profile()
        names = (prof.get("tools") or {}) if prof else {}          # the profile's tool-name mapping
        fm = ["---", f"name: {sub}", f"description: {json.dumps(r.description)}",
              f"tools: {', '.join(names.get(x, x) for x in tools)}", f"model: {r.inference.model}", "---"]
        extras = [f"## Where you work\nRole `{r.name}` in mode `{r.mode}`, env `{r.env}`. "
                  f"Your step plan (in the task block) gives the feature's playbook, rules and definition of done; "
                  f"they are your definition of done for that step."]
        extras.append("## Done when\n" + "\n".join(f"- {d}" for d in r.done_when))
        if r.rules:
            extras.append("## Rules\n" + "\n".join(f"- {x}" for x in r.rules))
        if r.skills:
            extras.append("## Skills\nUse these skills when relevant (the playbooks call each by the name in "
                          "parentheses): " + ", ".join(f"`{sid}` ({sk})" for sk, sid in sorted(r.skill_names.items())
                                                    if sid in r.skills) + ".")
        if r.bay_uses:
            extras.append("## Data access\nRead data only through your role's shim, never from files:\n"
                          + "\n".join(f"- `{use_shim(r.unit)} {u} '<json>'`" for u in r.bay_uses))
        bash = ([use_shim(r.unit)] if r.bay_uses else []) + r.clis
        if bash:
            extras.append("## Allowed Bash\nA guard hook allows only these, one simple command at a time "
                          "(no pipes, ;, &&, redirects or $()): " + ", ".join(f"`{c}`" for c in bash) + ".")
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

    def _skills(self, system: System, units) -> dict[str, Path]:
        out: dict[str, Path] = {}
        for r in units.values():
            out.update(r.skills)
        for m in system.modes.values():
            out.update(m.skills)
            if m.coordinator_unit is not None:
                out.update(m.coordinator_unit.skills)
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

    def _role_shims(self, units, project: Path, kit: Path, rep: BuildReport) -> list[str]:
        out = []
        for sub, r in sorted(units.items()):
            if not r.bay_uses:
                continue
            rel = Path(use_shim(sub))
            p = project / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                "#!/bin/sh\n"
                f"# generated by agentbay: read-only data access for role {r.name} in mode {r.mode}, env {r.env}.\n"
                "# The unit is fixed here; arguments are <capability>/v<N>.<endpoint> '<json>' only.\n"
                f'exec python3 -E {shlex.quote(str(kit / "bay" / "use_shim.py"))} '
                f'{shlex.quote(sub)} "$(cd "$(dirname "$0")/../../.." && pwd)" "$@"\n')
            p.chmod(0o755)
            rep.written.append(str(rel))
            out.append(str(rel))
        return out

    def _guard_policy(self, system: System, units, project: Path, kit: Path, rep: BuildReport) -> str:
        subs = {}
        for sub, r in sorted(units.items()):
            fs = system.env(r.env).spec.get("fs", {})
            subs[sub] = {"role": r.name, "mode": r.mode, "env": r.env, "shim": use_shim(sub) if r.bay_uses else None,
                         "clis": list(r.clis),
                         # `~/...` or absolute read paths are for the env's connectors (e.g. transcripts), never roles
                         "read": [x for x in fs.get("read", ["."]) if not x.startswith(("~", "/"))],
                         # only `access: write` roles with file-writing tools get writable paths
                         "write": list(fs.get("write", [])) if r.access == "write" and WRITE_TOOLS & set(r.tools)
                         else []}
        is_kit = project.resolve() == kit.resolve()
        # The shim is auto-allowed only when the kit is outside the project. If the kit is the project
        # or sits inside it, roles may be able to edit code the shim runs, so it prompts instead.
        pol = {"project": str(project.resolve()), "kit": str(kit.resolve()),
               "protected": list(PROTECTED) if is_kit else [], "autoAllowShim": not _within(kit, project),
               "subagents": subs}
        rel = ".agentbay/guard.json"
        _write_json(project / rel, pol)
        rep.written.append(rel)
        return rel

    def _settings(self, units, project: Path, kit: Path, old: dict, rep: BuildReport,
                  remove_only: bool = False) -> tuple[list[str], list[str]]:
        path = project / ".claude" / "settings.json"
        cfg = _read_json(path, {})
        perms = cfg.setdefault("permissions", {})
        allow = perms.setdefault("allow", [])
        deny = perms.setdefault("deny", [])
        _remove_each(allow, old.get("permissions", []))
        ask = perms.setdefault("ask", [])
        _remove_each(deny, old.get("denies", []))
        _remove_each(ask, old.get("denies", []))
        hooks = cfg.setdefault("hooks", {})
        _strip_owned_hooks(hooks)
        owned: list[str] = []
        owned_deny: list[str] = []
        if not remove_only:
            owned_deny = (_claim(deny, _want_deny(kit, project), old.get("denies", []))
                          + _claim(ask, list(dict.fromkeys(_want_ask())), old.get("denies", [])))
            # main-thread control plane: explicit subcommands only, never a wildcard over .agentbay/bay.
            # Subagent command prefixes are NOT added here (allow rules are session-wide); the guard
            # hook scopes them per role instead.
            want = [f"Bash({BAY} {c}:*)" for c in COORDINATOR_CMDS]
            owned = _claim(allow, list(dict.fromkeys(want)), old.get("permissions", []))
            _install_hooks(hooks, kit)
        _drop_empty(cfg, perms, hooks)
        _write_json(path, cfg)
        rep.written.append(".claude/settings.json")
        return owned, owned_deny

    def _coordinator(self, system: System, units, project: Path, kit: Path, rep: BuildReport) -> list[str]:
        # The root coordinator is a mode like any other; its playbook is this document's preamble, so it is
        # excluded from the per-mode sections below (otherwise its prose would be emitted twice).
        root = system.modes.get(ROOT_COORDINATOR)
        if root is None or not root.playbook:
            raise ValueError(f"no `{ROOT_COORDINATOR}` mode with a playbook: the main thread has no coordinator "
                             f"prose to build .agentbay/COORDINATOR.md from (expected "
                             f"framework/modes/{ROOT_COORDINATOR}/playbook.md)")
        cos = _without(root.playbook, system.uninstalled).strip()
        ep_rows, role_rows, books = [], [], []
        for m in system.modes.values():
            for f in m.features.values():
                rv = next((s for s in f.steps if s.kind == "review"), None)
                review = f"{f.review['role']} ({rv.inference.tier}, {rv.inference.model})" if f.review and rv \
                    and rv.inference else "-"
                ep_rows.append(f"| `{m.name}.{f.name}` | {f.in_type or '-'} -> {f.out_type or '-'} | "
                               f"{', '.join(f.effects)} | {review} | {f.description or m.purpose} |")
            if m.coordinator and m.playbook and m.name != ROOT_COORDINATOR:
                coord = system.roles[m.coordinator]
                books.append(f"### Mode `{m.name}` - coordinator role `{coord.name}`\n\n{coord.prompt}\n\n"
                             + _without(m.playbook, system.uninstalled).strip().replace("# ", "#### ", 1))
        for sub, r in sorted(units.items()):
            role_rows.append(f"| `{sub}` | {r.inference.model} | {r.mode} | {r.env} | {r.description} |")
        skills: dict[str, tuple[str, str]] = {}      # runtime name -> (owner, the playbooks' short name)
        for m in system.modes.values():
            for sid in m.skills:
                skills[sid] = (f"mode {m.name}", sid[len(m.name) + 2:])
        for r in [*units.values(), *(m.coordinator_unit for m in system.modes.values() if m.coordinator_unit)]:
            for sk, sid in r.skill_names.items():
                if sid in r.skills and sid not in skills:
                    skills[sid] = (f"role {r.name}", sk)
        skill_rows = [f"| `{sid}` | {own} | {sk} |" for sid, (own, sk) in sorted(skills.items())]
        doc = f"""<!-- generated by agentbay; edit framework/modes/cos/, modes/ and roles/, not this file -->
{cos}

## Mode features (generated)

| endpoint | in -> out | effects | review | use when |
|---|---|---|---|---|
{chr(10).join(ep_rows)}

## Worker subagents (generated)

| subagent_type | model | mode | env | role |
|---|---|---|---|---|
{chr(10).join(role_rows)}

## Skills (generated)

Each mode's skills live in its own namespace; playbooks name a skill by its short name.

| skill | from | playbooks call it |
|---|---|---|
{chr(10).join(skill_rows) or '| - | - | - |'}

Machine-readable: `.agentbay/catalog.json`.

## Mode coordinator playbooks (run in this main thread)

{chr(10).join(books) or '_none_'}

## Control plane (run via Bash)

Pre-approved (read-only): `{BAY} show|status|note|catalog`, except `show reclaim`, `note dispatch` and
`note review`, which ask. `call` and `submit` run connector code, so Claude Code asks the user each time; so
does everything else (build, clean, secret, scaffolds). Subagents run no `{BAY}` command but their own
`{BAY} plan`.

- `{BAY} call <mode>.<endpoint> '<json>'` -> run an endpoint; returns a result or the next step plan
- `{BAY} submit <callId> <stepId> '<json>'` -> hand back a step's output (or a gate approval)
- `{BAY} note task` -> prints a fresh taskId
- `{BAY} status` / `{BAY} status --log -n 20` -> calls, steps and agent runs from the ledger; the raw events
- `{BAY} note <runId|taskId|callId> "text"` -> record a decision
- `{BAY} note dispatch <taskId> --agent <subagent_type> ...` -> log a subagent dispatch (asks)
- `{BAY} note review <taskId> '<review.verdict/v1 json>'` -> record a review run outside a framework step (asks)
- `{BAY} show reclaim <runId>` -> mark a stuck run as reclaimed (asks)
- `{BAY} approve <callId|runId> --via chat --quote "<the user's exact message>"` -> relay a gate approval from
  chat; only if the user set `approvals: {{ chat: true }}` and their latest message clearly approves that gate (asks)
- `{BAY} describe <mode|role>` -> full resolved definition (asks)
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

    def _catalog(self, system: System, units, project: Path, rep: BuildReport) -> str:
        """The catalog is runtime-neutral system truth: bay.registry builds and writes it."""
        rel = registry.write(system, units, project, runtime=self.name,
                             workflows=workflows.catalog_entries(system))
        rep.written.append(rel)
        return rel

    def _ensure_gitignore(self, project: Path) -> str:
        gi = project / ".agentbay" / ".gitignore"
        if not gi.exists():
            gi.write_text("ledger/\ndata/\ncalls/\n")
        return ".agentbay/.gitignore"
