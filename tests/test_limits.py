"""`bay check --limits` (proposal 0009): what is counted, the ceiling, the ratchet and the exception."""
import subprocess

from helpers import tmpdir
from bay import limits

FILES = {
    "bay/cli.py": "sub.add_parser('a')\nsub.add_parser('b')\n",
    "bay/util.py": f"{'a' * 70}\x0c= {'b' * 70}\n# {'a' * 70}\r{'b' * 70}\n{'#' * 121}\n{'#' * 120}\n",
    "components/c/c.py": f"y = 1\nz = 2\n{'#' * 121}",
    "components/c/tests/test_c.py": f"def test_a():\n    pass\n\n\ndef test_b():\n    pass\n{'#' * 121}\n",
    "framework/roles/r.yaml": "x\n", "framework/rules/r.yaml": "x\n", "schemas/s.json": "{}\n",
    "schemas/data/d.json": "{}\n",
    "framework/kernel.yaml": "owns: []\nprotected: { paths: [components/c], mode: [], env: {}, connector: [] }\n",
    "components/u/u.py": f"w = 1\n{'#' * 121}\n", "components/u/tests/test_u.py": "def test_u():\n    pass\n",
}
NOW = {"bay_lines": 6, "kit_python_lines": 3, "cli_commands": 2, "framework_folders": 2, "schemas": 2,
       "top_level_folders": 4, "tests": 2, "long_lines": 4, "comment_lines": 6}
SOURCE = '#!/usr/bin/env python3\n"""one\ntwo\nthree"""\nx = 1  # c\ns = "# not a comment"\n'


def _yaml(ceilings):
    return "".join(f"{k}: {v}\n" for k, v in ceilings.items())


def test_limits_count_the_ceiling_the_ratchet_and_the_exception():
    repo = tmpdir()
    for p, text in {**FILES, limits.FILE: _yaml(NOW)}.items():
        (repo / p).parent.mkdir(parents=True, exist_ok=True)
        (repo / p).write_text(text)
    for args in (("init", "-q"), ("add", "-A"), ("commit", "-q", "-m", "c")):
        subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *args], check=True)
    assert limits.count(repo) == NOW and limits.check(repo, "HEAD") == ([], [])
    assert limits.comment_rows(SOURCE) == [(3, limits.DOCSTRING_LINE), (4, limits.DOCSTRING_LINE), (5, limits.COMMENT)]
    assert limits.comment_lines('def f():\n    """One line."""\n') == 0
    (repo / "bay/broken.py").write_text("def (:\n")
    try:
        limits.count(repo)
        raise AssertionError("a file that does not parse must stop the count")
    except RuntimeError as e:
        assert "bay/broken.py" in str(e)
    (repo / "bay/broken.py").unlink()
    (repo / "framework/kernel.yaml").rename(repo / "k.yaml")
    try:
        limits.check(repo, "HEAD")
        raise AssertionError("a missing kernel.yaml must stop the check")
    except RuntimeError as e:
        assert "framework/kernel.yaml does not exist" in str(e)
    (repo / "k.yaml").rename(repo / "framework/kernel.yaml")
    (repo / limits.FILE).write_text(_yaml({**NOW, "schemas": 5}))
    problems, _ = limits.check(repo, "HEAD")
    assert len(problems) == 1 and "exceptions" in problems[0]
    (repo / limits.FILE).write_text(_yaml({**NOW, "schemas": 5}))
    exc = "---\nexceptions:\n  - { measure: schemas, to: 5, reason: more }\n---\n"
    problems, notes = limits.check(repo, "HEAD", exc)
    assert problems == [] and "now 2" in notes[0] and (repo / limits.FILE).read_text() == _yaml({**NOW, "schemas": 5})
    problems, notes = limits.check(repo, "HEAD", exc, write=True)
    assert problems == [] and "now 2" in notes[0] and (repo / limits.FILE).read_text() == _yaml(NOW)
    low = _yaml({**NOW, "schemas": 1})
    (repo / limits.FILE).write_text(low)
    problems, notes = limits.check(repo, "HEAD")
    assert problems == [] and "now 2" in notes[0] and (repo / limits.FILE).read_text() == low
    assert limits.check(repo, "HEAD", write=True)[0] == [] and (repo / limits.FILE).read_text() == _yaml(NOW)
    (repo / limits.FILE).write_text(low)
    (repo / "schemas/t.json").write_text("{}\n")
    problems, _ = limits.check(repo, "HEAD", write=True)
    assert len(problems) == 1 and "schemas: 3 is over the ceiling 2" in problems[0]
    (repo / "schemas/t.json").unlink()
    (repo / limits.FILE).write_text(_yaml(NOW))
    (repo / "schemas/t.json").write_text("{}\n")
    problems, _ = limits.check(repo, "HEAD")
    assert len(problems) == 1 and "schemas: 3 is over the ceiling 2" in problems[0] and "exception" in problems[0]
    problems, notes = limits.check(repo, "HEAD", exc)
    assert problems == [] and "now 3" in notes[0] and (repo / limits.FILE).read_text() == _yaml(NOW)
    short = exc.replace("to: 5", "to: 2")
    problems, _ = limits.check(repo, "HEAD", short)
    assert len(problems) == 1 and "exception allows up to 2" in problems[0]
    (repo / "schemas/t.json").unlink()
    (repo / limits.FILE).write_text(_yaml({**NOW, "schemas": 9}))
    problems, notes = limits.check(repo)
    assert problems == [] and notes and (repo / limits.FILE).read_text() == _yaml({**NOW, "schemas": 9})
