#!/usr/bin/env python3
"""Stdlib test runner: python3 tests/run.py [-k substring] [-q]. Also runs under pytest.

-q prints only failures (with their traceback) and the summary line."""
from __future__ import annotations

import importlib.util
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(KIT))


def files() -> list[Path]:
    out = sorted(HERE.glob("test_*.py"))
    for base in (KIT / "connectors", KIT / "content-types"):
        out += sorted(base.glob("*/tests/test_*.py"))
    return out


def main(argv: list[str]) -> int:
    k = argv[argv.index("-k") + 1] if "-k" in argv else ""
    quiet = "-q" in argv
    passed = failed = 0
    times: list[tuple[float, str]] = []
    start = time.perf_counter()
    for f in files():
        spec = importlib.util.spec_from_file_location(f"t_{f.parent.parent.name}_{f.stem}", f)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in sorted(n for n in dir(mod) if n.startswith("test_")):
            if k and k not in name:
                continue
            t0 = time.perf_counter()
            try:
                getattr(mod, name)()
                passed += 1
                if not quiet:
                    print(f"✓ {f.stem}::{name}")
            except Exception:
                failed += 1
                print(f"✗ {f.stem}::{name}")
                traceback.print_exc()
            times.append((time.perf_counter() - t0, f"{f.stem}::{name}"))
    wall = time.perf_counter() - start
    slow = ", ".join(f"{n} {t:.1f}s" for t, n in sorted(times, reverse=True)[:15])
    print(f"{'' if quiet else chr(10)}slowest 15: {slow}")
    print(f"{passed} passed, {failed} failed in {wall:.1f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
