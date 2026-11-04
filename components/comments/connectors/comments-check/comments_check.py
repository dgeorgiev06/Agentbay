"""comments-check: standards.check/v1 for comments, one finding per comment line in every language the kit knows."""
import fnmatch
import tokenize
from pathlib import Path
from typing import Any

import yaml

from bay import limits

Row = dict[str, Any]

CONFIG = "agentbay.config.yaml"
CONNECTOR = "comments-check"
QUOTES = "\"'`"
LINE_COMMENT = "a comment"


def _languages(kit: Path) -> list[Row]:
    found = []
    for path in sorted(kit.glob("components/*/component.yaml")):
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError):
            continue
        spec = doc.get("spec") if isinstance(doc, dict) else None
        language = spec.get("language") if isinstance(spec, dict) else None
        if isinstance(language, dict):
            found.append(language)
    return found


def _rule_is_off(config_root: Path) -> bool:
    try:
        doc = yaml.safe_load((config_root / CONFIG).read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return False
    connectors = doc.get("connectors") if isinstance(doc, dict) else None
    settings = connectors.get(CONNECTOR) if isinstance(connectors, dict) else None
    return isinstance(settings, dict) and settings.get("rule") in ("off", False)


def _skip_string(text: str, start: int) -> int:
    quote, i = text[start], start + 1
    while i < len(text) and text[i] != quote:
        if text[i] == "\n" and quote != "`":
            return i
        i += 2 if text[i] == "\\" else 1
    return i + 1


def _lexed_rows(text: str, comments: Row) -> list[int]:
    marks, blocks = comments.get("line", []), comments.get("block", [])
    rows, i, row = [], 0, 1
    while i < len(text):
        block = next((pair for pair in blocks if text.startswith(pair[0], i)), None)
        if text[i] in QUOTES:
            end = _skip_string(text, i)
            row += text.count("\n", i, end)
            i = end
        elif any(text.startswith(mark, i) for mark in marks):
            rows.append(row)
            i = text.find("\n", i)
            if i < 0:
                break
        elif block:
            end = text.find(block[1], i + len(block[0]))
            end = len(text) if end < 0 else end + len(block[1])
            rows += range(row, row + text.count("\n", i, end) + 1)
            row += text.count("\n", i, end)
            i = end
        else:
            row += text[i] == "\n"
            i += 1
    return rows


def _rows(text: str, comments: Any) -> list[tuple[int, str]]:
    if comments == "python":
        return limits.comment_rows(text)
    return [(row, LINE_COMMENT) for row in _lexed_rows(text, comments)]


class CommentsCheck:
    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx

    def findings(self, root: str, configRoot: str) -> Row:
        tree, config_root = Path(root), Path(configRoot)
        if self.ctx.project.resolve() != self.ctx.kit.resolve() and _rule_is_off(config_root):
            return {"findings": [], "warnings": [f"{CONNECTOR} is off: rule: off in {CONFIG} of the base"]}
        languages = _languages(self.ctx.kit)
        found, warnings = [], []
        for path in sorted(tree.rglob("*")):
            rel = path.relative_to(tree)
            if path.is_symlink() or not path.is_file() or any(part.startswith(".") for part in rel.parts):
                continue
            language = next((x for x in languages if any(fnmatch.fnmatch(path.name, g) for g in x["files"])), None)
            if language is None:
                continue
            try:
                rows = _rows(path.read_text(encoding="utf-8"), language["comments"])
            except (OSError, ValueError, SyntaxError, tokenize.TokenError):
                warnings.append(f"{rel.as_posix()} cannot be read or parsed; its comments are not counted")
                continue
            found += [{"file": rel.as_posix(), "line": line, "rule": "comment", "message": message}
                      for line, message in rows]
        return {"findings": found, "warnings": warnings}


def create(ctx: Any) -> CommentsCheck:
    return CommentsCheck(ctx)
