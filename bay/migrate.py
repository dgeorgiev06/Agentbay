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
       SQLite schema v1). Posts become post/v1 items tagged with feed-briefing's
       default selector `home`; cursors, coverage, budget, deletions and
       deletion-check times are kept, so the next sync is incremental and
       nothing deleted at the source comes back. The old files are renamed
       *.v0.2.bak, never deleted.

Data migrations (DATA_MIGRATIONS) work on the project given to plan()/apply()
(`bay migrate --project <repo>`); their changes are op `convert` with a
summary diff, since the target is a database, not text.
"""
from __future__ import annotations

import difflib
import importlib.util
import json
import shutil
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Callable

import yaml

from . import __version__

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


MIGRATIONS = [("0.2.0", _v1_specs_to_roles)]

# ------------------------------------------------------------------ project data
FEED_DEFAULT_SELECTORS = [{"id": "home"}]     # modes/feed-briefing/config.schema.json default
V02_MODE = "feed-briefing"                    # the only mode on the v0.2 feed store
POST_KEYS = ("id", "source", "url", "createdAt")     # what a v0.2 line must carry to become an item


def _corpus_module():
    path = Path(__file__).resolve().parent.parent / "framework" / "connectors" / "corpus-store" / "corpus_store.py"
    spec = importlib.util.spec_from_file_location("agentbay_migrate_corpus_store", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _post_to_item(p: dict) -> dict:
    ext = {k: p[k] for k in ("lang", "metrics") if k in p}
    return {"id": f"{p['source']}:{p['id']}", "extId": str(p["id"]), "source": p["source"], "kind": "post",
            "author": dict(p.get("author") or {}), "title": None, "text": p.get("text", ""), "url": p.get("url"),
            "createdAt": p["createdAt"], "fetchedAt": p.get("fetchedAt", p["createdAt"]),
            "container": "home", "labels": ["home"], "threadId": None, **ext}


def _v02_feed_store(project: Path) -> tuple[list[Change], list[str]]:
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
        by_key: dict[str, dict] = {}
        bad: list[str] = []
        dups = 0
        for n, line in enumerate(posts_path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                post = json.loads(line)
            except json.JSONDecodeError as e:
                bad.append(f"{rel}:{n}: not JSON ({e.msg} at column {e.colno})")
                continue
            missing = [k for k in POST_KEYS if not (isinstance(post, dict) and post.get(k))]
            if missing:
                bad.append(f"{rel}:{n}: missing {', '.join(missing)}")
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
            old = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
            if not isinstance(old, dict):
                raise ValueError("expected a JSON object")
        except (json.JSONDecodeError, ValueError) as e:
            where = f":{e.lineno}:{e.colno}" if isinstance(e, json.JSONDecodeError) else ""
            notes.append(f"{state_path.relative_to(project).as_posix()}{where}: not a valid v0.2 state file "
                         f"({getattr(e, 'msg', e)}); nothing migrated. Fix it, or move it aside to migrate the posts "
                         f"without cursors, coverage, budget and deletions (the next sync then refetches the window)")
            continue
        cursors = {}
        for conn, c in (old.get("cursors") or {}).items():
            cursors[f"{conn}|{key}"] = {**{k: c[k] for k in ("from", "to", "lastSync") if k in c},
                                        **({"cursor": c["newestId"]} if c.get("newestId") else {}),
                                        "selectors": ["home"]}
        state = {"cursors": cursors, "coverage": old.get("coverage") or {"from": None, "to": None},
                 "budget": old.get("budget") or {}, "deleted": sorted(old.get("deleted") or []),
                 "checked": old.get("checked") or {}, "selectors": FEED_DEFAULT_SELECTORS}
        deleted = set(state["deleted"])
        items = [_post_to_item(p) for p in posts if f"{p['source']}:{p['id']}" not in deleted]
        by_src: dict[str, int] = {}
        for it in items:
            by_src[it["source"]] = by_src.get(it["source"], 0) + 1
        dbrel = db.relative_to(project).as_posix()
        lines = [f"--- a/{rel} ({len(posts)} posts{f', {dups} duplicate line(s) merged' if dups else ''}) + "
                 f"{state_path.name}",
                 f"+++ b/{dbrel} (corpus store, SQLite schema v1)",
                 f"+items: {len(items)} post/v1 ({', '.join(f'{s}: {n}' for s, n in sorted(by_src.items())) or 'none'}), "
                 f"matched: [home]" + (f"; {len(posts) - len(items)} on the deleted list dropped" if len(posts) != len(items) else "")]
        for ck, c in sorted(cursors.items()):
            lines.append(f"+state.cursors[{ck}]: " + json.dumps(c, sort_keys=True))
        lines += [f"+state.coverage: {json.dumps(state['coverage'], sort_keys=True)}",
                  f"+state.budget: {json.dumps(state['budget'], sort_keys=True)}",
                  f"+state.deleted: {len(state['deleted'])} id(s); state.checked: {len(state['checked'])} id(s)",
                  f"+state.selectors: {json.dumps(FEED_DEFAULT_SELECTORS)}",
                  f"-{rel} -> {rel}.v0.2.bak" + (f"; {state_path.name} -> {state_path.name}.v0.2.bak"
                                                  if state_path.exists() else "")]

        def run(db=db, items=items, state=state, posts_path=posts_path, state_path=state_path):
            cs = _corpus_module()
            con = cs.open_rw(db)
            try:
                con.execute("BEGIN IMMEDIATE")
                for it in items:
                    row = cs.item_row(it)
                    pk = con.execute(f"INSERT INTO items ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
                                     list(row.values())).lastrowid
                    con.execute("INSERT INTO item_selectors (item, selector) VALUES (?, 'home')", (pk,))
                cs.save_state(con, state)
                con.execute("COMMIT")
            except BaseException:
                if con.in_transaction:
                    con.execute("ROLLBACK")
                con.close()
                db.unlink(missing_ok=True)
                raise
            con.close()
            posts_path.rename(posts_path.with_name(posts_path.name + ".v0.2.bak"))
            if state_path.exists():
                state_path.rename(state_path.with_name(state_path.name + ".v0.2.bak"))

        changes.append(Change("convert", rel, "\n".join(lines) + "\n",
                              note=f"v0.2 feed store -> {dbrel} (cursors, coverage, budget and deletions kept)", run=run))
    return changes, notes


DATA_MIGRATIONS = [("0.3.0", _v02_feed_store)]


def _rel(kit: Path, p: Path) -> str:
    return str(p.relative_to(kit))


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
                c, n = fn(Path(project))
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
