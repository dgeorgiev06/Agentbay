"""Deterministic checks named by rules (`check: <name>[:<arg>]`).

Each check takes (output, ctx) and returns {"ok": bool, "detail": str}. They run
in code before review; results go to the reviewer and into the call result.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

URL = re.compile(r"https://[^\s\"'<>)\]]+")


@dataclass
class CheckContext:
    store_urls: Callable[[], set[str]] | None = None   # urls and ids (<source>:<extId>) of stored items
    kit: Path | None = None
    secrets: Callable[[str], str] | None = None          # redact function


def _cited(output) -> list[str]:
    """Every url anywhere in the output, plus every entry of a `citations` list (item ids or urls)."""
    found = set(URL.findall(json.dumps(output, ensure_ascii=False)))

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "citations" and isinstance(v, list):
                    found.update(x for x in v if isinstance(x, str))
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(output)
    return sorted(found)


def citations_resolve(output, ctx: CheckContext, arg=None) -> dict:
    refs = _cited(output)
    if not refs:
        return {"ok": False, "detail": "no citations found in output"}
    known = ctx.store_urls() if ctx.store_urls else set()
    missing = [u for u in refs if u not in known]
    if missing:
        return {"ok": False, "detail": f"{len(missing)} citation(s) are not stored items: {', '.join(missing[:5])}"}
    return {"ok": True, "detail": f"all {len(refs)} citation(s) resolve to stored items"}


def citations_min(output, ctx: CheckContext, arg=None) -> dict:
    n = int(arg or 1)
    bad = []

    def walk(o, path):
        if isinstance(o, dict):
            if "citations" in o and isinstance(o["citations"], list) and len(o["citations"]) < n:
                bad.append(f"{path or '<root>'} has {len(o['citations'])}")
            for k, v in o.items():
                walk(v, f"{path}/{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{path}/{i}")

    walk(output, "")
    if bad:
        return {"ok": False, "detail": f"fewer than {n} citations: " + "; ".join(bad[:5])}
    return {"ok": True, "detail": f"every citations list has >= {n} entries"}


def no_secrets(output, ctx: CheckContext, arg=None) -> dict:
    text = json.dumps(output, ensure_ascii=False)
    if ctx.secrets and ctx.secrets(text) != text:
        return {"ok": False, "detail": "output contains a secret value"}
    if re.search(r"(?i)(bearer\s+[a-z0-9._-]{20,}|refresh_token\"?\s*[:=]\s*\"?[a-z0-9._-]{20,})", text):
        return {"ok": False, "detail": "output contains something that looks like a token"}
    return {"ok": True, "detail": "no secret values in output"}


def lint_clean(output, ctx: CheckContext, arg=None) -> dict:
    from . import lint
    problems = lint.run(ctx.kit) if ctx.kit else []
    if problems:
        return {"ok": False, "detail": f"{len(problems)} lint problem(s); first: {problems[0]}"}
    return {"ok": True, "detail": "bay check: lint clean"}


REGISTRY: dict[str, Callable] = {
    "citations_resolve": citations_resolve,
    "citations_min": citations_min,
    "no_secrets": no_secrets,
    "lint_clean": lint_clean,
}


def known(name: str) -> bool:
    return name.split(":")[0] in REGISTRY


def run(name: str, output, ctx: CheckContext) -> dict:
    fn, _, arg = name.partition(":")
    if fn not in REGISTRY:
        return {"ok": False, "detail": f"unknown check '{fn}' (have: {', '.join(REGISTRY)})"}
    return REGISTRY[fn](output, ctx, arg or None)
