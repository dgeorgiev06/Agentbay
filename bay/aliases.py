"""Deprecated v0.2 names, kept working for one release (0.3.x).

v0.3 replaced the feed contracts with the shared briefing layer. User content written for v0.2 still loads:
the old names resolve to the new ones when the kit is loaded, and `bay lint` / `bay validate` warn on every
file that uses one. `bay migrate` (dry run; `--confirm` to apply) rewrites the files for good, using the same
table (`rewrite_text`). Connector *code* cannot be rewritten: a connector still implementing the old
feed.source/v1 or feed.store/v1 says how to port it by hand. That is a load error when an env binds it, and
a warning (the connector is skipped) when none does, so one leftover file does not stop the kit.

    feed.source/v1          -> items.source/v1
    feed.store/v1[.<ep>]    -> items.store/v1[.<ep>]   (sync input maxPosts -> maxItems)
    feed.post/v1            -> post/v1               (data schema $ref)
    feed.coverage/v1        -> items.coverage/v1     (data schema $ref)
    role feed-analyst       -> briefing-analyst      (unless you define a role with the old name)
    role feed-lead          -> briefing-lead         (same)
    connector local-store   -> corpus-store          (unless you define a connector with the old name)
"""
from __future__ import annotations

import ast
import re

IFACES = {"feed.source/v1": "items.source/v1", "feed.store/v1": "items.store/v1"}
DATA = {"feed.post/v1": "post/v1", "feed.coverage/v1": "items.coverage/v1"}
ROLES = {"feed-analyst": "briefing-analyst", "feed-lead": "briefing-lead"}
CONNECTORS = {"local-store": "corpus-store"}
SYNC = "items.store/v1.sync"
OLD_FETCH = {"sinceId", "startTime", "maxPosts"}
HINT = "run `bay migrate` to see the rewrite and `bay migrate --confirm` to apply it"


def _iface(v: str) -> str | None:
    for old, new in IFACES.items():
        if v == old or v.startswith(old + "."):
            return new + v[len(old):]
    return None


class Resolver:
    """Rewrites one doc's spec in memory and records what it used."""

    def __init__(self, names: dict[str, str]):
        self.names = names          # exact-match names (roles, connectors) that are aliased in this kit
        self.used: dict[str, str] = {}

    def value(self, v):
        if isinstance(v, str):
            new = _iface(v) or self.names.get(v)
            if new:
                self.used[v] = new
                return new
            return v
        if isinstance(v, list):
            return [self.value(x) for x in v]
        if isinstance(v, dict):
            return {self.value(k): self.value(x) for k, x in v.items()}
        return v


def apply(kit) -> list[str]:
    """Resolve deprecated names in user docs in place; return one warning per file (and old name)."""
    names = {old: new for old, new in ROLES.items() if old not in kit.docs["Role"]}
    names.update({old: new for old, new in CONNECTORS.items() if old not in kit.docs["Connector"]})
    warnings: list[str] = []
    for kind in ("Mode", "Role", "Environment", "Connector"):
        for d in list(kit.docs[kind].values()):
            if d.root != "user":
                continue
            if kind == "Connector":
                err = old_connector(d)
                if err:
                    binders = _binders(kit, d.name)
                    if binders:                      # an env would run it: the kit cannot work until it is ported
                        kit.errors.append(f"{err} It is bound in env {', '.join(binders)}.")
                    else:                            # nothing runs it: the rest of the kit still builds
                        warnings.append(f"{err} No env binds it, so it is skipped until it is ported.")
                        del kit.docs[kind][d.name]
                    continue
            r = Resolver(names if kind in ("Mode", "Environment") else {})
            d.spec = r.value(d.spec)
            if kind == "Mode":
                for steps in (d.spec.get("workflows") or {}).values():
                    for st in steps:
                        w = st.get("with")
                        if st.get("run") == SYNC and isinstance(w, dict) and "maxPosts" in w:
                            st["with"] = {("maxItems" if k == "maxPosts" else k): v for k, v in w.items()}
                            r.used["with: { maxPosts }"] = "with: { maxItems }"
            for old, new in sorted(r.used.items()):
                warnings.append(f"{d.rel}: `{old}` is deprecated (v0.2) and now resolves to `{new}`; {HINT}")
    return warnings


def _binders(kit, name: str) -> list[str]:
    """Envs (after alias resolution) that bind connector `name` to any capability."""
    out = []
    for env in kit.docs["Environment"].values():
        for b in (env.spec.get("bind") or {}).values():
            if name in ([b] if isinstance(b, str) else list(b or [])):
                out.append(env.name)
                break
    return sorted(out)


def old_connector(d) -> str | None:
    """A user connector still implementing a v0.2 feed interface cannot be aliased: its code has the old shape."""
    impl = d.spec.get("implements")
    impl = [impl] if isinstance(impl, str) else list(impl or [])
    old = [i for i in impl if i in IFACES]
    if not old:
        return None
    fetch = ""
    try:
        tree = ast.parse((d.dir / d.spec["entry"]).read_text(encoding="utf-8"))
        for n in ast.walk(tree):
            if isinstance(n, ast.FunctionDef) and n.name == "fetch":
                args = {a.arg for a in n.args.args + n.args.kwonlyargs}
                if args & OLD_FETCH:
                    fetch = f" Its fetch({', '.join(a.arg for a in n.args.args if a.arg != 'self')}) is the v0.2 signature."
    except (OSError, SyntaxError, KeyError):
        pass
    if "feed.store/v1" in old:
        return (f"{d.rel}: connector {d.name} implements feed.store/v1, which v0.3 replaced with items.store/v1 "
                f"(framework connector corpus-store). Bind corpus-store instead, or port this store by hand to "
                f"interfaces/items.store.v1.yaml; `bay migrate` cannot rewrite connector code.")
    return (f"{d.rel}: connector {d.name} implements feed.source/v1, which v0.3 replaced with items.source/v1; it "
            f"needs a hand port.{fetch} The new fetch(query, since, cursor, maxItems, checkIds) returns "
            f"{{items, cursor, truncated, billed, checked, deleted}} where each item is item/v1 (post/v1 for posts: "
            f"id '<source>:<extId>', extId, kind); declare spec.selectors (which selector fields the API handles). "
            f"connectors/fake/fake.py is a small example. `bay migrate` rewrites YAML names only, not code.")


def data_ref(ref: str) -> str:
    return DATA.get(ref, ref)


# ------------------------------------------------------------------ text rewrite (bay migrate 0.3.0)
_WORD = r"(?<![\w.-]){}(?![\w-])"


def rewrite_text(text: str, roles: set[str], connectors: set[str]) -> str:
    """The same table applied to file text (keeps comments and layout). `roles`/`connectors`: names the user
    defines, which are not aliased."""
    for old, new in {**IFACES, **DATA}.items():
        text = re.sub(re.escape(old) + r"(?![\w])", new, text)
    for table, mine in ((ROLES, roles), (CONNECTORS, connectors)):
        for old, new in table.items():
            if old not in mine:
                text = re.sub(_WORD.format(re.escape(old)), new, text)
    return "".join(_rename_sync_input(block) for block in _list_items(text.splitlines(keepends=True)))


def _list_items(lines: list[str]) -> list[list[str]]:
    """Lines grouped by YAML list item (`- ...` plus every deeper or blank line after it), so a workflow
    step's keys stay together whether `with:` is flow-form or block-form. Lines outside items are their own
    group."""
    blocks: list[list[str]] = []
    indent = None                            # indent of the `-` that opened the current item
    for ln in lines:
        m = re.match(r"(\s*)(-\s|\S)?", ln)
        here = len(m.group(1))
        if indent is not None and (not ln.strip() or here > indent):
            blocks[-1].append(ln)
            continue
        indent = here if (m.group(2) or "").startswith("-") else None
        blocks.append([ln])
    return blocks


def _rename_sync_input(block: list[str]) -> str:
    text = "".join(block)
    return re.sub(r"\bmaxPosts(\s*:)", r"maxItems\1", text) if SYNC in text else text


# ------------------------------------------------------------------ 0.3 cap names (bay migrate 0.4.0)
# The budget caps count items, not posts, since 0.3. 0.4 names them so; the 0.3 names keep working for one
# release (0.4.x) in mode constraints, env limits, mode config schemas and agentbay.config.yaml.
ITEM_CAPS = {"maxPostsPerRun": "maxItemsPerRun", "monthlyPosts": "monthlyItems"}
HINT_04 = "run `bay migrate` to see the 0.4 rewrite and `bay migrate --confirm` to apply it"


def rename_caps(d) -> list[str]:
    """In place: the 0.3 cap names of one mapping become the item names (the stricter value wins if both are
    set). Returns the old names found."""
    used = []
    if isinstance(d, dict):
        for old, new in ITEM_CAPS.items():
            if old in d:
                v = d.pop(old)
                d[new] = min(d[new], v) if isinstance(d.get(new), (int, float)) else v
                used.append(old)
    return used


def _cap_warning(where: str, used: list[str]) -> str:
    names = ", ".join(f"`{o}` -> `{ITEM_CAPS[o]}`" for o in used)
    return f"{where}: {names} (cap names counting posts are deprecated since 0.4; the caps count items); {HINT_04}"


def apply_caps(kit) -> list[str]:
    """Rename 0.3 cap names in mode constraints and env limits (raw docs, before extends) and flag mode config
    schemas that still declare them (renamed in memory when a mode resolves)."""
    import json
    warnings = []
    for d in kit.docs["Mode"].values():
        used = rename_caps(d.spec.get("constraints"))
        if used:
            warnings.append(_cap_warning(f"{d.rel} constraints", used))
        cfg = d.dir / d.spec["config"] if d.spec.get("config") else None
        if cfg and cfg.exists() and d.dir in cfg.parents:
            try:
                props = (json.loads(cfg.read_text(encoding="utf-8")).get("properties") or {})
            except ValueError:
                props = {}
            used = [o for o in ITEM_CAPS if o in props]
            if used:
                warnings.append(_cap_warning(str(cfg.relative_to(kit.root)) if kit.root in cfg.parents else str(cfg),
                                             used))
    for d in kit.docs["Environment"].values():
        used = rename_caps(d.spec.get("limits"))
        if used:
            warnings.append(_cap_warning(f"{d.rel} limits", used))
    return warnings


def config_caps(config: dict) -> list[str]:
    """The same renaming in agentbay.config.yaml modes.<mode> settings."""
    warnings = []
    for mode, settings in ((config or {}).get("modes") or {}).items():
        used = rename_caps(settings)
        if used:
            warnings.append(_cap_warning(f"agentbay.config.yaml modes.{mode}", used))
    return warnings
