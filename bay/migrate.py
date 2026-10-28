"""Migrations of user content across framework versions.

`plan()` is a dry run: it returns the changes and a unified diff and writes
nothing. `apply()` performs exactly the planned changes. Each migration is a
function (kit) -> list[Change]; add one per contract change and register it
in MIGRATIONS with the version it migrates to.

0.2.0: v0.1 AgentSpec (specs/*.yaml) -> Role (roles/*.yaml); v0.1 Layer
       folders (layers/*) are removed; their tools map to capability
       interfaces bound in framework envs.
0.3.0: project data - a v0.2 feed store (.agentbay/data/<dir>/posts.jsonl +
       state.json, local-store) becomes a corpus store (corpus.db, corpus-store,
       SQLite schema v1, internal state in state.json). Posts become post/v1
       items; only those the store would keep (source bound in feed-briefing's env,
       matching a current selector) are written. Cursors, coverage, budget, deletions and
       deletion-check times are kept, so the next sync is incremental and
       nothing deleted at the source comes back. The old files are renamed
       *.v0.2.bak, never deleted.
0.4.0: cap names maxPostsPerRun / monthlyPosts -> maxItemsPerRun / monthlyItems (user modes, envs,
       mode config schemas and the project's agentbay.config.yaml).

Data migrations (DATA_MIGRATIONS) work on the project given to plan()/apply()
(`bay migrate --project <repo>`); their changes are op `convert` with a
summary diff, since the target is a database, not text.
"""
from __future__ import annotations

import difflib
import importlib.util
import json
import re
import shutil
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Callable

import yaml

from . import __version__
from .util import iso, parse_time, utcnow

LAYER_CAPS = {  # v0.1 layer -> v0.2 capability interfaces
    "base": ["workspace.read/v1"],
    "code": ["workspace.read/v1", "workspace.write/v1"],
    "research": ["workspace.read/v1", "web.research/v1"],
    "review": ["workspace.read/v1", "git.read/v1"],
}


@dataclass
class Change:
    op: str            # create | delete | update | convert
    path: str          # relative to kit (convert: relative to the project)
    content: str = ""  # new content for create/update; the summary diff for convert
    note: str = ""
    run: Callable[[], None] | None = field(default=None, repr=False)   # convert: performs the change


def _v1_specs_to_roles(kit: Path) -> tuple[list[Change], list[str]]:
    changes, notes = [], []
    for f in sorted((kit / "specs").glob("*.yaml")):
        doc = yaml.safe_load(f.read_text()) or {}
        if doc.get("kind") != "AgentSpec":
            continue
        m, s = doc.get("metadata", {}), doc.get("spec", {})
        name = m.get("name", f.stem)
        if s.get("role") == "coordinator":
            changes.append(Change("delete", _rel(kit, f), note="coordinator specs are replaced by the Chief of Staff "
                                                              "and mode coordinator roles"))
            continue
        uses: list[str] = []
        for layer in s.get("layers", []) or ["base"]:
            for cap in LAYER_CAPS.get(layer, []):
                if cap not in uses:
                    uses.append(cap)
            if layer not in LAYER_CAPS:
                notes.append(f"{name}: layer '{layer}' has no v0.2 capability mapping; add an interface + env binding")
        role = {
            "apiVersion": "agentbay/v2", "kind": "Role",
            "metadata": {"name": name, "description": " ".join(str(m.get("description", "TODO")).split())},
            "spec": {
                "agent": "worker", "uses": uses,
                **({"inference": {"model": s["model"]}} if s.get("model") not in (None, "inherit") else {}),
                **({"isolation": s["isolation"]} if s.get("isolation", "none") != "none" else {}),
                **({"budget": s["budget"]} if s.get("budget") else {}),
                "prompt": s.get("prompt", "TODO"),
                "doneWhen": ["TODO a checkable statement (migrated from v0.1)"],
            },
        }
        target = kit / "roles" / f"{name}.yaml"
        fw = kit / "framework" / "roles" / f"{name}.yaml"
        if fw.exists():
            changes.append(Change("delete", _rel(kit, f), note=f"framework role '{name}' replaces this spec"))
            continue
        if target.exists():
            notes.append(f"{name}: roles/{name}.yaml already exists; left specs/{f.name} alone")
            continue
        changes.append(Change("create", f"roles/{name}.yaml", yaml.safe_dump(role, sort_keys=False, width=100),
                              note=f"AgentSpec {name} -> Role {name}"))
        changes.append(Change("delete", _rel(kit, f), note=f"replaced by roles/{name}.yaml"))
    for f in sorted((kit / "layers").glob("*/layer.yaml")):
        changes.append(Change("delete", _rel(kit, f.parent), note="v0.1 Layer removed; capabilities come from "
                                                                 "interfaces bound in an env"))
    return changes, notes


USER_GLOBS = ("modes/*/mode.yaml", "modes/*/types/*.json", "modes/*/playbook.md", "modes/*/features/*/*.md",
              "modes/*/features/*/*.yaml", "modes/*/skills/*/SKILL.md", "roles/*.yaml", "roles/skills/*/SKILL.md",
              "agents/*.yaml", "envs/*.yaml", "connectors/*/connector.yaml")


def _v02_names(kit: Path) -> tuple[list[Change], list[str]]:
    """0.3.0: user content naming the v0.2 feed contracts, roles or store gets the v0.3 names (bay/aliases.py,
    the same table that keeps the old names working for one release). Connector code is never rewritten:
    connectors still implementing a feed interface are listed as needing a hand port."""
    from . import aliases
    changes, notes = [], []
    roles = {f.stem for f in (kit / "roles").glob("*.yaml")} & set(aliases.ROLES)
    conns = {f.parent.name for f in (kit / "connectors").glob("*/connector.yaml")} & set(aliases.CONNECTORS)
    for pat in USER_GLOBS:
        for f in sorted(kit.glob(pat)):
            old = f.read_text(encoding="utf-8")
            new = aliases.rewrite_text(old, roles, conns)
            if new != old:
                changes.append(Change("update", _rel(kit, f), new,
                                      note="v0.2 names -> v0.3 (feed.* -> items.*, feed-* roles -> briefing-*, "
                                           "local-store -> corpus-store)"))
            if f.name == "connector.yaml":
                doc = yaml.safe_load(old) or {}
                impl = (doc.get("spec") or {}).get("implements")
                if any(i in aliases.IFACES for i in ([impl] if isinstance(impl, str) else impl or [])):
                    notes.append(f"{_rel(kit, f)}: connector implements a v0.2 feed interface; its code needs a hand "
                                 f"port to items.source/v1 or items.store/v1 (bay lint explains how). The YAML is "
                                 f"renamed, the code is not")
            if f.suffix == ".md" and re.search(r"\.posts\b|`posts`", new):
                notes.append(f"{_rel(kit, f)}: mentions `posts` from a store result; items.store/v1 returns `items` "
                             f"(item/v1, id '<source>:<extId>'); update the wording by hand")
    return changes, notes


CAP_GLOBS = ("modes/*/mode.yaml", "modes/*/config.schema.json", "envs/*.yaml")


def _cap_text(text: str) -> str:
    from .aliases import ITEM_CAPS
    for old, new in ITEM_CAPS.items():
        text = re.sub(rf"(?<![\w-]){old}(?![\w-])", new, text)
    return text


def _v03_caps(kit: Path) -> tuple[list[Change], list[str]]:
    """0.4.0: the cap names maxPostsPerRun / monthlyPosts become maxItemsPerRun / monthlyItems in user mode
    constraints, mode config schemas and env limits (bay/aliases.py ITEM_CAPS)."""
    changes = []
    for pat in CAP_GLOBS:
        for f in sorted(kit.glob(pat)):
            old = f.read_text(encoding="utf-8")
            new = _cap_text(old)
            if new != old:
                changes.append(Change("update", _rel(kit, f), new,
                                      note="cap names -> maxItemsPerRun / monthlyItems (0.4)"))
    return changes, []


MIGRATIONS = [("0.2.0", _v1_specs_to_roles), ("0.3.0", _v02_names), ("0.4.0", _v03_caps)]

# ------------------------------------------------------------------ project data
V02_MODE = "feed-briefing"                    # the only mode on the v0.2 feed store
POST_KEYS = ("id", "source", "url", "createdAt")     # what a v0.2 line must carry to become an item


def _corpus_module():
    path = Path(__file__).resolve().parent.parent / "framework" / "connectors" / "corpus-store" / "corpus_store.py"
    spec = importlib.util.spec_from_file_location("agentbay_migrate_corpus_store", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _post_to_item(p: dict) -> dict:
    """A shape-checked v0.2 post (_post_problem) as post/v1; times normalized to UTC ISO-8601 (`...Z`), as sync
    stores them, so ordering and `since` comparisons on createdAt hold."""
    ext = {k: p[k] for k in ("lang", "metrics") if k in p}
    created = iso(parse_time(p["createdAt"], utcnow()))
    return {"id": f"{p['source']}:{p['id']}", "extId": str(p["id"]), "source": p["source"], "kind": "post",
            "author": dict(p.get("author") or {}), "title": None, "text": p.get("text", ""), "url": p.get("url"),
            "createdAt": created, "fetchedAt": iso(parse_time(p["fetchedAt"], utcnow())) if p.get("fetchedAt")
            else created, "container": "home", "labels": ["home"], "threadId": None, **ext}


def _kind(v) -> str:
    return {dict: "an object", list: "a list", str: "a string", bool: "a boolean", type(None): "null"}.get(
        type(v), "a number")


def _post_problem(post) -> str | None:
    """Why a parsed v0.2 line cannot become an item, or None. Checked before anything reads its fields."""
    if not isinstance(post, dict):
        return f"expected a JSON object, got {_kind(post)}"
    missing = [k for k in POST_KEYS if not post.get(k)]
    if missing:
        return f"missing {', '.join(missing)}"
    for k, kinds in (("id", (str, int)), ("source", str), ("url", str), ("createdAt", str), ("fetchedAt", str),
                     ("text", str), ("author", dict), ("metrics", dict), ("lang", str)):
        v = post.get(k)
        if v is not None and (not isinstance(v, kinds) or isinstance(v, bool)):
            want = "a string or number" if k == "id" else _kind(kinds())
            return f'"{k}" must be {want}, got {_kind(v)} ({json.dumps(v)[:40]})'
    for k, v in (post.get("author") or {}).items():
        if not isinstance(v, str):
            return f'"author.{k}" must be a string, got {_kind(v)} ({json.dumps(v)[:40]})'
    for k, v in (post.get("metrics") or {}).items():
        if not isinstance(v, int) or isinstance(v, bool):
            return f'"metrics.{k}" must be a whole number, got {_kind(v)} ({json.dumps(v)[:40]})'
    try:
        parse_time(post["createdAt"], utcnow())
        if post.get("fetchedAt"):
            parse_time(post["fetchedAt"], utcnow())
    except ValueError:
        return '"createdAt" and "fetchedAt" must be ISO-8601 times like 2026-10-27T10:00:00Z'
    return None


STATE_SHAPE = {"cursors": dict, "coverage": dict, "budget": dict, "deleted": list, "checked": dict}


def _state_problem(old) -> str | None:
    """Why a parsed v0.2 state.json cannot be converted, or None."""
    if not isinstance(old, dict):
        return f"expected a JSON object, got {_kind(old)}"
    for k, kind in STATE_SHAPE.items():
        if old.get(k) is not None and not isinstance(old[k], kind):
            return f'"{k}" must be {_kind(kind())}, got {_kind(old[k])} ({json.dumps(old[k])[:40]})'
    for conn, c in (old.get("cursors") or {}).items():
        if not isinstance(c, dict):
            return f'"cursors.{conn}" must be an object ({{newestId, from, to, lastSync}}), got {_kind(c)}'
    if not all(isinstance(x, str) for x in old.get("deleted") or []):
        return '"deleted" must be a list of "<source>:<id>" strings'
    for month, use in (old.get("budget") or {}).items():
        if not (isinstance(use, dict) and all(isinstance(use.get(k, 0), (int, float)) for k in ("posts", "usd"))):
            return f'"budget.{month}" must be {{"posts": <number>, "usd": <number>}}'
    times = [*(old.get("coverage") or {}).values(),
             *(c.get(k) for c in (old.get("cursors") or {}).values() for k in ("from", "to", "lastSync"))]
    if not all(t is None or isinstance(t, str) for t in times):
        return '"coverage" and "cursors" times must be ISO-8601 strings or null'
    if not all(isinstance(v, str) for v in (old.get("checked") or {}).values()):
        return '"checked" must map "<source>:<id>" to an ISO-8601 time'
    return None


def _feed_scope(kit: Path, project: Path) -> tuple[dict | None, str]:
    """feed-briefing's scope as installed in `project`: {env, sources (connector -> source id), caps (connector ->
    selector capability table), selectors}, or None and why. The migrated store must already hold exactly
    this scope (the corpus-store invariant), so the conversion uses the same env and selectors sync would."""
    from . import config as cfgmod, model
    try:
        system = model.resolve(model.Kit(kit, project))
    except (model.ResolveError, model.SpecError, cfgmod.ConfigError) as e:
        first = e.gaps[0] if isinstance(e, model.ResolveError) else str(e)
        return None, f"the project does not resolve ({first}); fix what `bay validate` reports, then migrate"
    mode = system.modes.get(V02_MODE)
    if mode is None:
        return None, f"mode {V02_MODE} is not installed in this project, so the v0.2 posts have no store to go to"
    env, why = model.code_env(system.kit, system.kit.get("Mode", V02_MODE), model.STORE_IFACE, system.roles)
    conns = model.connectors_of(env.spec["bind"].get(model.SOURCE_IFACE)) if env else []
    docs = {cn: system.kit.get("Connector", cn) for cn in conns}
    return {"env": env.name if env else why, "selectors": mode.config["selectors"],
            "sources": {cn: d.spec.get("source") for cn, d in docs.items() if d},
            "caps": {cn: d.spec.get("selectors") or {} for cn, d in docs.items() if d}}, ""


def _v02_feed_store(kit: Path, project: Path) -> tuple[list[Change], list[str]]:
    from . import selector as selmod
    changes, notes = [], []
    key = selmod.native_key({})
    for posts_path in sorted((project / ".agentbay" / "data").glob("*/posts.jsonl")):
        d = posts_path.parent
        rel = posts_path.relative_to(project).as_posix()
        db = d / V02_MODE / "corpus.db"            # v0.2 had one feed store, owned by feed-briefing
        if db.exists():
            notes.append(f"{rel}: {db.relative_to(project).as_posix()} already exists; left the v0.2 files alone "
                         f"(move corpus.db aside to migrate again)")
            continue
        scope, why = _feed_scope(kit, project)
        if scope is None:
            notes.append(f"{rel}: nothing migrated: {why}")
            continue
        by_key: dict[str, dict] = {}
        bad: list[str] = []
        dups = 0
        for n, raw in enumerate(posts_path.read_bytes().splitlines(), 1):
            try:
                line = raw.decode("utf-8")
            except UnicodeDecodeError as e:
                bad.append(f"{rel}:{n}: not UTF-8 (byte 0x{raw[e.start]:02x} at column {e.start + 1})")
                continue
            if not line.strip():
                continue
            try:
                post = json.loads(line)
            except json.JSONDecodeError as e:
                bad.append(f"{rel}:{n}: not JSON ({e.msg} at column {e.colno})")
                continue
            except RecursionError:
                bad.append(f"{rel}:{n}: JSON nested too deeply to be a v0.2 post")
                continue
            problem = _post_problem(post)
            if problem:
                bad.append(f"{rel}:{n}: {problem}")
                continue
            k = f"{post['source']}:{post['id']}"
            dups += k in by_key
            by_key[k] = post                        # the last line wins, as in the v0.2 store
        if bad:
            notes.append(f"{rel}: {len(bad)} bad line(s), nothing migrated: {'; '.join(bad[:3])}"
                         f"{' ...' if len(bad) > 3 else ''}. Fix or delete those lines (each post needs "
                         f"{', '.join(POST_KEYS)}), then run the migration again")
            continue
        posts = list(by_key.values())
        state_path = d / "state.json"
        try:
            try:
                old = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
            except RecursionError:
                raise ValueError("JSON nested too deeply") from None
            problem = _state_problem(old)
            if problem:
                raise ValueError(problem)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
            where = f":{e.lineno}:{e.colno}" if isinstance(e, json.JSONDecodeError) else ""
            why = "not UTF-8" if isinstance(e, UnicodeDecodeError) else getattr(e, "msg", e)
            notes.append(f"{state_path.relative_to(project).as_posix()}{where}: not a valid v0.2 state file "
                         f"({why}); nothing migrated. Fix it, or move it aside to migrate the posts "
                         f"without cursors, coverage, budget and deletions (the next sync then refetches the window)")
            continue
        sels, sources = scope["selectors"], scope["sources"]
        cursors = {}
        for conn, c in (old.get("cursors") or {}).items():
            # v0.2 read each source's default stream: its cursor serves the selectors whose native query is empty
            ids = [s["id"] for s in sels
                   if conn in sources and selmod.native_key(selmod.split(s, scope["caps"][conn])[0]) == key]
            if ids:
                cursors[f"{conn}|{key}"] = {**{k: c[k] for k in ("from", "to", "lastSync") if k in c},
                                            **({"cursor": c["newestId"]} if c.get("newestId") else {}),
                                            "selectors": ids}
        bound = sorted({s for s in sources.values() if s})
        state = {"cursors": cursors, "coverage": old.get("coverage") or {"from": None, "to": None},
                 "budget": old.get("budget") or {}, "deleted": sorted(old.get("deleted") or []),
                 "checked": old.get("checked") or {}, "selectors": sels, "sources": bound}
        deleted = set(state["deleted"])
        cs = _corpus_module()
        now = utcnow()
        kept: dict[str, tuple[dict, list[str]]] = {}
        dropped = {"deleted": 0, "unbound": 0, "unmatched": 0}
        scrub_dups = 0
        for p in posts:
            it = cs.scrub_item(_post_to_item(p))       # match on exactly what will be stored, as sync does
            tags = selmod.match_ids(it, sels, now)
            why = ("deleted" if it["id"] in deleted else "unbound" if it["source"] not in bound
                   else "unmatched" if not tags else None)
            if why:
                dropped[why] += 1
            else:
                scrub_dups += it["id"] in kept          # two ids that differ only in a secret: one row, the last
                kept[it["id"]] = (it, tags)
        items = list(kept.values())
        by_src: dict[str, int] = {}
        for it, _ in items:
            by_src[it["source"]] = by_src.get(it["source"], 0) + 1
        tags_used = sorted({t for _, tags in items for t in tags})
        dbrel = db.relative_to(project).as_posix()
        drops = [f"{dropped['deleted']} on the deleted list dropped" if dropped["deleted"] else "",
                 f"{dropped['unbound']} from sources not bound in env {scope['env']} ({', '.join(bound) or 'none'}) "
                 f"dropped" if dropped["unbound"] else "",
                 f"{dropped['unmatched']} matching no selector dropped" if dropped["unmatched"] else "",
                 f"{scrub_dups} merged because their ids are the same once secrets are scrubbed"
                 if scrub_dups else ""]
        lines = [f"--- a/{rel} ({len(posts)} posts{f', {dups} duplicate line(s) merged' if dups else ''}) + "
                 f"{state_path.name}",
                 f"+++ b/{dbrel} (corpus store, SQLite schema v1) + {V02_MODE}/state.json",
                 f"+items: {len(items)} post/v1 ({', '.join(f'{s}: {n}' for s, n in sorted(by_src.items())) or 'none'}), "
                 f"matched: [{', '.join(tags_used)}]" + "".join(f"; {x}" for x in drops if x)]
        for ck, c in sorted(cursors.items()):
            lines.append(f"+state.cursors[{ck}]: " + json.dumps(c, sort_keys=True))
        lines += [f"+state.coverage: {json.dumps(state['coverage'], sort_keys=True)}",
                  f"+state.budget: {json.dumps(state['budget'], sort_keys=True)}",
                  f"+state.deleted: {len(state['deleted'])} id(s); state.checked: {len(state['checked'])} id(s)",
                  f"+state.selectors: {json.dumps(sels)}; state.sources: {json.dumps(bound)}",
                  f"-{rel} -> {rel}.v0.2.bak" + (f"; {state_path.name} -> {state_path.name}.v0.2.bak"
                                                  if state_path.exists() else "")]

        def run(db=db, items=items, state=state, posts_path=posts_path, state_path=state_path, cs=cs):
            new_state = db.with_name(cs.STATE_NAME)
            made_dir = not db.parent.exists()
            try:
                con = cs.open_rw(db)
            except BaseException:
                _remove_partial(db, new_state, made_dir)
                raise
            try:
                con.execute("BEGIN IMMEDIATE")
                for it, tags in items:
                    row = cs.item_row(it)
                    pk = con.execute(f"INSERT INTO items ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                                     list(row.values())).lastrowid
                    con.executemany("INSERT INTO item_selectors (item, selector) VALUES (?, ?)",
                                    [(pk, t) for t in tags])
                cs.save_state(new_state, state)
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                con.close()
                _remove_partial(db, new_state, made_dir)
                raise
            con.close()
            posts_path.rename(posts_path.with_name(posts_path.name + ".v0.2.bak"))
            if state_path.exists():
                state_path.rename(state_path.with_name(state_path.name + ".v0.2.bak"))

        changes.append(Change("convert", rel, "\n".join(lines) + "\n",
                              note=f"v0.2 feed store -> {dbrel} (cursors, coverage, budget and deletions kept)", run=run))
    return changes, notes


def _remove_partial(db: Path, state: Path, made_dir: bool) -> None:
    """A failed conversion leaves nothing behind: the database with its -wal/-shm, the state file (and its
    temp file), and the mode folder when this run created it."""
    for f in (db, db.with_name(db.name + "-wal"), db.with_name(db.name + "-shm"), state,
              state.with_name(state.name + ".tmp")):
        f.unlink(missing_ok=True)
    if made_dir and db.parent.exists() and not any(db.parent.iterdir()):
        db.parent.rmdir()


def _v03_config_caps(kit: Path, project: Path) -> tuple[list[Change], list[str]]:
    """0.4.0: the same cap renaming in the project's agentbay.config.yaml (modes.<mode> settings)."""
    f = project / "agentbay.config.yaml"
    if not f.exists():
        return [], []
    old = f.read_text(encoding="utf-8")
    new = _cap_text(old)
    if new == old:
        return [], []
    return [Change("update", _path(kit, f), new, note="cap names -> maxItemsPerRun / monthlyItems (0.4)")], []


DATA_MIGRATIONS = [("0.3.0", _v02_feed_store), ("0.4.0", _v03_config_caps)]


def _rel(kit: Path, p: Path) -> str:
    return str(p.relative_to(kit))


def _path(kit: Path, p: Path) -> str:
    """Kit-relative when inside the kit, else absolute (a project's own files)."""
    try:
        return str(p.resolve().relative_to(kit.resolve()))
    except ValueError:
        return str(p.resolve())


def _diff(kit: Path, changes: list[Change]) -> str:
    out = []
    for c in changes:
        if c.op == "convert":
            out.append(c.content)
            continue
        p = kit / c.path
        if c.op == "delete":
            old = "".join(x.read_text() for x in sorted(p.rglob("*")) if x.is_file()) if p.is_dir() else (
                p.read_text() if p.exists() else "")
            new = ""
        else:
            old = p.read_text() if p.exists() else ""
            new = c.content
        out += difflib.unified_diff(old.splitlines(True), new.splitlines(True),
                                    f"a/{c.path}" if old else "/dev/null", f"b/{c.path}" if new else "/dev/null")
    return "".join(out)


def _collect(kit: Path, to: str | None, project: Path | None = None):
    to = to or __version__
    changes, notes = [], []
    for ver, fn in MIGRATIONS:
        if _vt(ver) <= _vt(to):
            c, n = fn(kit)
            changes += c
            notes += n
    if project is not None:
        for ver, fn in DATA_MIGRATIONS:
            if _vt(ver) <= _vt(to):
                c, n = fn(kit, Path(project))
                changes += c
                notes += n
    return changes, notes


def _vt(v: str) -> tuple:
    return tuple(int(x) for x in v.split("."))


def plan(kit: Path, to: str | None = None, project: Path | None = None) -> dict:
    """Dry run. `project`: also plan data migrations of that project's .agentbay/data."""
    changes, notes = _collect(kit, to, project)
    return {"changes": [{"op": c.op, "path": c.path, "note": c.note} for c in changes],
            "diff": _diff(kit, changes), "notes": notes}


def apply(kit: Path, to: str | None = None, project: Path | None = None) -> dict:
    changes, notes = _collect(kit, to, project)
    for c in changes:
        p = kit / c.path
        if c.op == "convert":
            c.run()
        elif c.op == "delete":
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(c.content)
    for d in ("specs", "layers"):
        if (kit / d).is_dir() and not any((kit / d).iterdir()):
            (kit / d).rmdir()
    return {"changes": [{"op": c.op, "path": c.path, "note": c.note} for c in changes],
            "applied": len(changes), "notes": notes}


__all__ = ["plan", "apply", "Change", "asdict"]
