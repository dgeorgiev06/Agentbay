#!/usr/bin/env python3
"""Stdlib test runner: python3 tests/run.py [-k substring]. Also runs under pytest."""
from __future__ import annotations

import importlib.util
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(KIT))


def files() -> list[Path]:
    out = sorted(HERE.glob("test_*.py"))
    for base in (KIT / "connectors", KIT / "framework" / "connectors"):
        out += sorted(base.glob("*/tests/test_*.py"))
    return out


def main(argv: list[str]) -> int:
    k = argv[argv.index("-k") + 1] if "-k" in argv else ""
    passed = failed = 0
    for f in files():
        spec = importlib.util.spec_from_file_location(f"t_{f.parent.parent.name}_{f.stem}", f)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in sorted(n for n in dir(mod) if n.startswith("test_")):
            if k and k not in name:
                continue
            try:
                getattr(mod, name)()
                passed += 1
                print(f"✓ {f.stem}::{name}")
            except Exception:
                failed += 1
                print(f"✗ {f.stem}::{name}")
                traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
