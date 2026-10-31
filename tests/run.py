#!/usr/bin/env python3
"""Stdlib test runner: python3 tests/run.py [FILE ...] [-k substring] [-q] [-j N]. Also runs under pytest.

FILE names test files to run (a path or a name such as test_lint); none runs them all. -q prints only failures (with
their traceback) and the summary. Files run in parallel, one worker per CPU (-j N sets the number, -j 1 runs them in
order in this process); the tests of one file always run in order, and output comes out in file order."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor
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


def run_file(f: Path, k: str, quiet: bool) -> tuple[str, int, int, list[tuple[float, str]]]:
    """Run one file's tests in order: (its output, passed, failed, [(seconds, name)])."""
    passed = failed = 0
    times: list[tuple[float, str]] = []
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
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
    return buf.getvalue(), passed, failed, times


def main(argv: list[str]) -> int:
    k = argv[argv.index("-k") + 1] if "-k" in argv else ""
    quiet = "-q" in argv
    try:
        jobs = int(argv[argv.index("-j") + 1]) if "-j" in argv else len(os.sched_getaffinity(0))
    except (ValueError, IndexError):
        print("usage: tests/run.py [FILE ...] [-k substring] [-q] [-j N]")
        return 2
    asked = [a for i, a in enumerate(argv) if not a.startswith("-") and (i == 0 or argv[i - 1] not in ("-k", "-j"))]
    todo = [f for f in files() if not asked or any(f.stem == Path(a).stem for a in asked)]
    start = time.perf_counter()
    if jobs > 1 and len(todo) > 1:
        with ProcessPoolExecutor(max_workers=min(jobs, len(todo))) as pool:
            results = list(pool.map(run_file, todo, [k] * len(todo), [quiet] * len(todo)))
    else:
        results = [run_file(f, k, quiet) for f in todo]
    for out, *_ in results:
        print(out, end="")
    passed, failed = sum(r[1] for r in results), sum(r[2] for r in results)
    times = [t for r in results for t in r[3]]
    wall = time.perf_counter() - start
    slow = ", ".join(f"{n} {t:.1f}s" for t, n in sorted(times, reverse=True)[:15])
    print(f"{'' if quiet else chr(10)}slowest 15: {slow}")
    print(f"{passed} passed, {failed} failed in {wall:.1f}s ({'1 worker' if jobs <= 1 else f'{jobs} workers'})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
