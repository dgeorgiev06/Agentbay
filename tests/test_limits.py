"""`bay check --limits` (proposal 0009): what is counted, the ceiling, the ratchet and the exception."""
import subprocess

from helpers import tmpdir
from bay import limits

FILES = {
    "bay/cli.py": "sub.add_parser('a')\nsub.add_parser('b')\n", "bay/util.py": "x = 1\n",
    "connectors/c/c.py": "y = 1\nz = 2",                                     # no final newline: still 2 lines
    "connectors/c/tests/test_c.py": "def test_a():\n    pass\n\n\ndef test_b():\n    pass\n",
    "framework/roles/r.yaml": "x\n", "framework/rules/r.yaml": "x\n", "schemas/s.json": "{}\n",
    "schemas/data/d.json": "{}\n",
}
NOW = {"bay_lines": 3, "kit_python_lines": 2, "cli_commands": 2, "framework_folders": 2, "schemas": 2,
       "top_level_folders": 4, "tests": 2}


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
    (repo / limits.FILE).write_text(_yaml({**NOW, "schemas": 5}))            # raised above the base's ceiling
    problems, _ = limits.check(repo, "HEAD")
    assert len(problems) == 1 and "exceptions" in problems[0]
    (repo / limits.FILE).write_text(_yaml({**NOW, "schemas": 5}))            # the ratchet lowered it: raise it again
    exc = "---\nexceptions:\n  - { measure: schemas, to: 5, reason: more }\n---\n"
    problems, notes = limits.check(repo, "HEAD", exc)
    assert problems == [] and "now 2" in notes[0]                            # allowed, then lowered to the count
    assert (repo / limits.FILE).read_text() == _yaml(NOW)
    (repo / "schemas/t.json").write_text("{}\n")
    problems, _ = limits.check(repo, "HEAD")
    assert len(problems) == 1 and "schemas: 3 is over the ceiling 2" in problems[0]
