"""Shared compare for the golden baselines: a failing compare means a behavior changed."""
from __future__ import annotations

import difflib
import json
import re

from helpers import KIT

GOLDEN = KIT / "tests" / "golden"
SHA12 = re.compile(r"\b[0-9a-f]{12}\b")


def normal(obj, replace: dict[str, str] | None = None):
    """JSON round trip with machine-specific strings replaced (temp folders) and 12-hex commit prefixes masked."""
    text = json.dumps(obj, sort_keys=True, ensure_ascii=False)
    for old, new in sorted((replace or {}).items(), key=lambda kv: -len(kv[0])):
        text = text.replace(old, new)
    return json.loads(SHA12.sub("<sha12>", text))


def compare(name: str, got, folder=GOLDEN) -> None:
    f = folder / f"{name}.json"
    text = json.dumps(got, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if not f.exists():
        folder.mkdir(exist_ok=True)
        f.write_text(text)
        raise AssertionError(f"{f} did not exist and was written from the current code; review it, commit it, "
                             f"and run again")
    want = f.read_text()
    if text != want:
        diff = list(difflib.unified_diff(want.splitlines(), text.splitlines(), "golden", "got", lineterm="", n=1))
        raise AssertionError(f"{name}: output differs from {f.relative_to(KIT)}:\n" + "\n".join(diff[:60]))
