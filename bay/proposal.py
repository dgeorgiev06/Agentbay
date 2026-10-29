"""Proposal front matter (proposal 0006, Part A: "Proposals declare crossings").

A proposal may start with a YAML block between `---` lines. Its `touches:` lists every core or
existing-extension path the change edits, one reason each:

    ---
    touches:
      - { path: bay/boundary.py, reason: the boundary check }
      - { path: "modes/x/features/y/", reason: ..., slice: 3, planned: true }
    ---

`path` is a glob (see boundary.match). `slice` and `planned` are informational: every listed entry is
an approved crossing. A pure extension has `touches: []`.
"""
from __future__ import annotations

from pathlib import Path

import yaml


class ProposalError(ValueError):
    pass


def front_matter(text: str) -> dict:
    """The YAML front matter of a proposal's text, or {} when it has none."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            try:
                doc = yaml.safe_load("\n".join(lines[1:i])) or {}
            except yaml.YAMLError as e:
                raise ProposalError(f"invalid front matter YAML: {e}") from e
            if not isinstance(doc, dict):
                raise ProposalError("front matter must be a mapping")
            return doc
    raise ProposalError("front matter opened with '---' on line 1 but never closed")


def touches(text: str) -> list[dict]:
    """The `touches:` entries of a proposal's text, checked: each has a string `path` and `reason`."""
    raw = front_matter(text).get("touches", [])
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ProposalError("touches: must be a list of {path, reason}")
    out = []
    for i, e in enumerate(raw):
        if not (isinstance(e, dict) and isinstance(e.get("path"), str) and e["path"].strip()
                and isinstance(e.get("reason"), str) and e["reason"].strip()):
            raise ProposalError(f"touches[{i}]: needs a non-empty `path` (glob) and `reason`")
        out.append(e)
    return out


def load_touches(path: Path) -> list[dict]:
    try:
        return touches(Path(path).read_text(encoding="utf-8"))
    except ProposalError as e:
        raise ProposalError(f"{path}: {e}") from e
