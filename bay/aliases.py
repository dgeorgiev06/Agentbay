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
    role feed-analyst       -> analyst               (0.3 named it briefing-analyst; roles are framework-level since 0.4)
    role feed-lead          -> lead                  (0.3: briefing-lead)
    connector local-store   -> corpus-store          (unless you define a connector with the old name)
"""
from __future__ import annotations

import ast
import re

IFACES = {"feed.source/v1": "items.source/v1", "feed.store/v1": "items.store/v1"}
DATA = {"feed.post/v1": "post/v1", "feed.coverage/v1": "items.coverage/v1"}
ROLES = {"feed-analyst": "analyst", "feed-lead": "lead"}
CONNECTORS = {"local-store": "corpus-store"}
SYNC = "items.store/v1.sync"
OLD_FETCH = {"sinceId", "startTime", "maxPosts"}
HINT = "run `bay migrate` to see the rewrite and `bay migrate --confirm` to apply it"
HINT_04 = "run `bay migrate` to see the 0.4 rewrite and `bay migrate --confirm` to apply it"
# 0.3 roles merged into the five framework roles in 0.4 (lead, analyst, researcher, builder, reviewer)
ROLES_04 = {"briefing-analyst": "analyst", "improve-analyst": "analyst", "auditor": "analyst",
            "briefing-lead": "lead", "improve-lead": "lead", "forge-lead": "lead"}


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
    names.update({old: new for old, new in ROLES_04.items() if old not in kit.docs["Role"]})
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
                if kind == "Mode" and old in {**ROLES, **ROLES_04}:
                    d.renamed[new] = old
                if old in ROLES_04:
                    warnings.append(f"{d.rel}: role `{old}` is deprecated (0.3) and now resolves to the framework "
                                    f"role `{new}`; roles are framework-level since 0.4 and modes customize them "
                                    f"(playbooks, skills, rules); {HINT_04}")
                else:
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


# ------------------------------------------------------------------ 0.3 roles/agents/envs shape (bay migrate 0.4.0)
# 0.4 (proposal 0005 Part A): roles are five generic framework roles; a mode's `roles:` map says which env each
# works in (feature and step overrides of the same shape); one framework agent profile maps tiers to models;
# an env may cap tiers. The 0.3 shape keeps working for one release (0.4.x): `apply_shape` translates it when
# the kit loads, with a warning per file, and `bay migrate` (bay/migrate.py `_v03_shape`) rewrites it.
#
#    mode `roles: [a, b]`                 -> `roles: {a: <env of a's 0.3 agent>, ...}`
#    endpoint `agents: {role: agent}`     -> endpoint `roles: {role: <that agent's env>}` (+ tier from its model)
#    review `model`, mode `inference`     -> `tier` / `effort` on the review block and the role steps they changed
#    env `models: [...]`                  -> `tiers: [...]`
#    agents/<a>.yaml {runtime, model, env} (user space) -> read for the above, then folded away by bay migrate
#    a role's `uses`                      -> ignored: a role reads the read-only endpoints of its mode's needs
#    old role names                       -> lead / analyst (ROLES_04); user role files -> mode skills (migrate)

LEGACY_TIERS = {"haiku": "fast", "sonnet": "balanced", "opus": "deep"}
# The 0.3 agents shipped with the kit: name -> (model, effort, env)
SHIPPED_AGENTS = {
    "analyst": ("sonnet", "medium", "local-feeds"), "lead": ("inherit", "medium", "local-feeds"),
    "author": ("sonnet", "medium", "local-authoring"), "critic": ("opus", "high", "workspace"),
    "forge-main": ("inherit", "medium", "local-authoring"), "framework-builder": ("opus", "high", "framework-dev"),
    "improve-main": ("inherit", "medium", "improve-local"), "improver": ("sonnet", "medium", "improve-local"),
    "worker": ("sonnet", "medium", "workspace"),
}
# The 0.3 roles shipped with the kit: name -> (agent, inference model, inference effort)
OLD_ROLES = {
    "briefing-analyst": ("analyst", None, None), "briefing-lead": ("lead", None, None),
    "feed-analyst": ("analyst", None, None), "feed-lead": ("lead", None, None),
    "auditor": ("improver", None, None), "improve-analyst": ("improver", None, None),
    "improve-lead": ("improve-main", None, None), "forge-lead": ("forge-main", None, None),
    "builder": ("worker", None, None), "researcher": ("worker", "sonnet", None), "reviewer": ("critic", "opus", "high"),
}
OLD_ROLE_ENV = {"researcher": "research"}    # 0.4 moved web research out of env workspace
# What those roles read or used (their `uses`); since 0.4 access comes from the mode's needs
OLD_ROLE_USES = {
    "briefing-analyst": ["items.store/v1"], "briefing-lead": ["items.store/v1"], "feed-analyst": ["items.store/v1"],
    "feed-lead": ["items.store/v1"], "auditor": ["improve.findings/v1", "artifacts.read/v1", "workspace.read/v1"],
    "improve-analyst": ["improve.findings/v1", "session.events/v1"], "improve-lead": ["improve.findings/v1"],
    "forge-lead": ["workspace.read/v1"], "builder": ["workspace.read/v1", "workspace.write/v1"],
    "researcher": ["workspace.read/v1", "web.research/v1"], "reviewer": ["workspace.read/v1", "git.read/v1"],
}


def agents_table(kit) -> dict[str, tuple]:
    """0.3 agents: the shipped ones and the user's per-role agent files (which win)."""
    out = dict(SHIPPED_AGENTS)
    for n, d in kit.legacy_agents.items():
        out[n] = (d.spec["model"], d.spec.get("effort", "medium"), d.spec["env"])
    return out


def old_role(kit, name: str) -> tuple:
    """(agent, inference model, inference effort) a 0.3 role had: a user role file, else the shipped table."""
    if name in kit.user_roles:
        s = kit.user_roles[name]["doc"].get("spec") or {}
        inf = s.get("inference") or {}
        return s.get("agent"), inf.get("model"), inf.get("effort")
    return OLD_ROLES.get(name, (None, None, None))


def old_uses(kit, name: str) -> list[str]:
    """Capability interfaces a 0.3 role used (its `uses`, without endpoints)."""
    if name in kit.user_roles:
        uses = (kit.user_roles[name]["doc"].get("spec") or {}).get("uses") or []
        return [re.sub(r"(/v[0-9]+)\..*$", r"\1", u) for u in uses]
    return list(OLD_ROLE_USES.get(name, []))


def old_env(kit, name: str, agents: dict) -> str | None:
    if name in OLD_ROLE_ENV:
        return OLD_ROLE_ENV[name]
    a = agents.get(old_role(kit, name)[0] or "")
    return a[2] if a else None


def _renamed(kit, d) -> dict:
    """new role name -> 0.3 name, for the mode and its ancestors."""
    out, cur = {}, d
    while cur is not None:
        out = {**cur.renamed, **out}
        cur = kit.docs["Mode"].get(cur.parent) if cur.parent else None
    return out


def legacy_keys(spec: dict) -> list[str]:
    """The 0.3 shape keys a (raw) mode spec uses."""
    found = []
    if isinstance(spec.get("roles"), list):
        found.append("`roles:` list form")
    for ep_name, e in (spec.get("endpoints") or {}).items():
        if "agents" in (e or {}):
            found.append(f"endpoint {ep_name} `agents:`")
        if "model" in ((e or {}).get("review") or {}):
            found.append(f"endpoint {ep_name} review `model`")
    if "inference" in spec:
        found.append("`inference`")
    return found


def shape_mode(kit, d, agents: dict) -> bool:
    """Translate a merged mode spec from the 0.3 shape in place. Step and review tiers are set only where the
    0.3 rule (mode step > mode default > role > agent) picked another model or effort than the 0.4 rule (step >
    feature > role default) now does."""
    s = d.spec
    if not legacy_keys(s):
        return False
    import copy
    d.before_shape = copy.deepcopy(s)
    renamed = _renamed(kit, d)
    if isinstance(s.get("roles"), list):
        s["roles"] = {rn: old_env(kit, renamed.get(rn, rn), agents) for rn in s["roles"]}
    # 0.3 roles carried their own `uses`; 0.4 grants a mode's needs, so the mode needs what its roles used
    s["needs"] = list(dict.fromkeys([*(s.get("needs") or []),
                                     *(u for rn in s["roles"] for u in old_uses(kit, renamed.get(rn, rn)))]))
    inf = s.pop("inference", None) or {}
    roles = kit.docs["Role"]

    def was(rn, sid, agent=None, model=None, effort=None):
        ag, r_model, r_effort = old_role(kit, renamed.get(rn, rn))
        a = agents.get(agent or ag or "")
        st, df = (inf.get("steps") or {}).get(sid) or {}, inf.get("default") or {}
        return (model or st.get("model") or df.get("model") or r_model or (a[0] if a else None),
                effort or st.get("effort") or df.get("effort") or r_effort or (a[1] if a else None) or "medium")

    def settle(target, rn, model, effort, feature=None):
        spec = roles[rn].spec if rn in roles else {}
        tier = LEGACY_TIERS.get(model or "")
        now_tier = (feature or {}).get("tier") or spec.get("tier")
        now_effort = (feature or {}).get("effort") or spec.get("effort", "medium")
        if tier and tier != now_tier and "tier" not in target:
            target["tier"] = tier
        if effort != now_effort and "effort" not in target:
            target["effort"] = effort

    done: set[int] = set()
    for e in (s.get("endpoints") or {}).values():
        over = e.pop("agents", None) or {}
        if over:
            e["roles"] = {**{rn: (agents.get(ag) or (None, None, None))[2] for rn, ag in over.items()},
                          **(e.get("roles") or {})}
        steps = (s.get("workflows") or {}).get(e.get("workflow"), [])
        for st in steps:
            if "role" in st and id(st) not in done:
                done.add(id(st))
                settle(st, st["role"], *was(st["role"], st["id"], over.get(st["role"])), feature=e)
        rv = e.get("review") or {}
        model = rv.pop("model", None)
        if rv.get("role") and rv.get("when") == "always":
            sid = next((x["id"] for x in steps if "review" in x), "review")
            settle(rv, rv["role"], *was(rv["role"], sid, over.get(rv["role"]), model, rv.get("effort")))
    return True


def apply_shape(kit) -> list[str]:
    """Translate the 0.3 shape (after extends) in place; one warning per file."""
    warnings: list[str] = []
    agents = agents_table(kit)
    for n, d in sorted(kit.legacy_agents.items()):
        warnings.append(f"{d.rel}: per-role agent files are deprecated (0.3); agent {n} now only gives env "
                        f"{d.spec['env']} to the modes whose roles named it and model {d.spec['model']} as a tier. "
                        f"The framework agent profile runs every role (`agent:` in agentbay.config.yaml); {HINT_04}")
    for d in kit.docs["Role"].values():
        if "uses" in d.spec:
            d.spec.pop("uses")
            warnings.append(f"{d.rel}: `uses` is deprecated and ignored (0.4): a role reads the read-only endpoints "
                            f"of the needs of the mode it works in, through its env")
    for d in kit.docs["Environment"].values():
        if "models" in d.spec:
            models = d.spec.pop("models")
            tiers = [t for t in ("fast", "balanced", "deep") if any(LEGACY_TIERS.get(m) == t for m in models)]
            if len(tiers) < 3 and "tiers" not in d.spec:
                d.spec["tiers"] = tiers or ["fast"]
            warnings.append(f"{d.rel}: `models` is deprecated (0.3): model names belong to the agent profile; it "
                            f"now resolves to `tiers: [{', '.join(d.spec.get('tiers', tiers))}]`; {HINT_04}")
    for d in kit.docs["Mode"].values():
        shape_mode(kit, d, agents)
        found = legacy_keys(d.raw)
        if found:
            envs = ", ".join(f"{k}: {v}" for k, v in (d.spec.get("roles") or {}).items())
            warnings.append(f"{d.rel}: {', '.join(found)} is deprecated (0.3 shape) and now resolves to "
                            f"`roles: {{{envs}}}` (role -> env; features and steps may override it) and tiers; "
                            f"{HINT_04}")
    return warnings
