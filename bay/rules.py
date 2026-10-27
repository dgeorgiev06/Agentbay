"""Feature rules (modes/<mode>/features/<feature>/rules.yaml).

Rules stack with mode constraints, role rules and project extraRules.
Strictest wins: when two rules share an id, the higher level is kept
(must/must_not > should) and the statements are both kept.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

LEVEL_RANK = {"should": 1, "must": 2, "must_not": 2}


class RulesError(Exception):
    pass


@dataclass
class Rule:
    id: str
    level: str
    statement: str
    applies_to: str
    check: str | None = None
    refs: list[str] = field(default_factory=list)
    kinds: list[str] | None = None        # when: {kind: ...}
    source: str = ""
    line: int = 0

    def for_executor(self) -> bool:
        return self.applies_to in ("executor", "both")

    def for_reviewer(self) -> bool:
        return self.applies_to in ("reviewer", "both")

    def applies(self, inp: dict | None) -> bool:
        if self.kinds is None or inp is None:
            return True
        return inp.get("kind") in self.kinds

    def as_dict(self) -> dict:
        d = {"id": self.id, "level": self.level, "statement": self.statement, "appliesTo": self.applies_to}
        if self.check:
            d["check"] = self.check
        if self.refs:
            d["refs"] = self.refs
        if self.kinds:
            d["when"] = {"kind": self.kinds}
        return d


class _LineLoader(yaml.SafeLoader):
    pass


def _construct_mapping(loader, node, deep=False):
    m = yaml.SafeLoader.construct_mapping(loader, node, deep=deep)
    m["__line__"] = node.start_mark.line + 1
    return m


_LineLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)


def _strip(o):
    if isinstance(o, dict):
        return {k: _strip(v) for k, v in o.items() if k != "__line__"}
    if isinstance(o, list):
        return [_strip(x) for x in o]
    return o


def raw(path: Path) -> tuple[dict, dict]:
    """(document without line markers, {rule index: line})"""
    if not path.exists():
        raise FileNotFoundError(f"{path}: rules file not found")
    try:
        doc = yaml.load(path.read_text(encoding="utf-8"), Loader=_LineLoader)
    except yaml.YAMLError as e:
        raise RulesError(f"{path}: invalid YAML: {e}") from e
    lines = {}
    if isinstance(doc, dict):
        for i, r in enumerate(doc.get("rules") or []):
            if isinstance(r, dict):
                lines[i] = r.get("__line__", 0)
    return _strip(doc), lines


def load(path: Path) -> list[Rule]:
    from .model import schema, schema_errors
    doc, lines = raw(path)
    errs = schema_errors(doc, schema("rules"))
    if errs:
        raise RulesError(f"{path}:\n    " + "\n    ".join(errs))
    out = []
    for i, r in enumerate(doc["rules"]):
        kinds = (r.get("when") or {}).get("kind")
        if isinstance(kinds, str):
            kinds = [kinds]
        out.append(Rule(r["id"], r["level"], r["statement"].strip(), r["appliesTo"], r.get("check"),
                        r.get("refs", []), kinds, str(path), lines.get(i, 0)))
    return out


def stack(base: list[Rule], extra: list[Rule]) -> list[Rule]:
    """Project rules stack on feature rules; strictest wins on id clashes."""
    out = {r.id: r for r in base}
    for r in extra:
        cur = out.get(r.id)
        if cur is None:
            out[r.id] = r
            continue
        level = r.level if LEVEL_RANK[r.level] > LEVEL_RANK[cur.level] else cur.level
        applies = cur.applies_to if cur.applies_to == r.applies_to else "both"
        out[r.id] = Rule(r.id, level, f"{cur.statement} AND {r.statement}", applies, cur.check or r.check,
                         list(dict.fromkeys(cur.refs + r.refs)), cur.kinds, cur.source, cur.line)
    return list(out.values())
