"""python-check: standards.check/v1 for Python, ruff and mypy --strict on one folder with the base's config."""
import configparser
import json
import os
import re
import subprocess
import tempfile
import tokenize
import tomllib
from pathlib import Path
from typing import Any

from bay import standards

Row = dict[str, Any]

RUFF_TIMEOUT = 60
MYPY_TIMEOUT = 120
CONFIG_DIR = Path("components") / "python"
INLINE = (
    (re.compile(r"^#\s*mypy:"), "mypy-inline", "an inline mypy: configuration comment"),
    (re.compile(r"\btype:\s*ignore"), "type-ignore", "a type: ignore comment"),
)
NO_TYPE_CHECK = "a no_type_check decorator or import"
STUB_SHADOW = "a .pyi stub next to a .py of the same name; mypy checks the stub in place of the code"
SYMLINK = "a symlinked .py file; the tools do not check it"


def _row(file: str, line: int, rule: str, message: str) -> Row:
    return {"file": file, "line": line, "rule": rule, "message": message}


def _has_ruff_table(path: Path) -> bool:
    try:
        return "ruff" in tomllib.loads(path.read_text(encoding="utf-8")).get("tool", {})
    except (OSError, ValueError):
        return False


def _ruff_config(config_root: Path, defaults: Path, is_kit: bool) -> Path:
    if not is_kit and (config_root / "ruff.toml").is_file():
        return config_root / "ruff.toml"
    pyproject = config_root / "pyproject.toml"
    if not is_kit and pyproject.is_file() and _has_ruff_table(pyproject):
        return pyproject
    return defaults / "ruff.toml"


def _mypy_config(config_root: Path, defaults: Path, is_kit: bool) -> Path:
    own = config_root / "mypy.ini"
    return own if not is_kit and own.is_file() else defaults / "mypy.ini"


def _sets_own_targets(config: Path) -> bool:
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read(config, encoding="utf-8")
    except configparser.Error:
        return False
    section = parser["mypy"] if parser.has_section("mypy") else {}
    return "files" in section or "packages" in section


def _targets(root: Path) -> list[str]:
    args = []
    for entry in sorted(root.iterdir()):
        if entry.is_file() and entry.suffix == ".py":
            if entry.stem.isidentifier():
                args += ["-m", entry.stem]
        elif entry.is_dir() and entry.name.isidentifier():
            outside_tests = [p for p in entry.rglob("*.py") if "tests" not in p.relative_to(root).parts]
            if outside_tests:
                args += ["-p", entry.name]
    return args


def _run(module: str, args: list[str], root: Path, timeout: int) -> tuple[str, str | None]:
    try:
        done = standards.run_module(module, args, root, timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return "", f"{module} did not finish: {type(e).__name__}"
    if done.returncode not in (0, 1):
        return done.stdout, f"{module} exited with {done.returncode}"
    return done.stdout, None


def _ruff(root: Path, config: Path) -> tuple[list[Row], str | None]:
    args = ["check", "--no-cache", "--ignore-noqa", "--output-format", "json", "--config", str(config), "."]
    out, problem = _run("ruff", args, root, RUFF_TIMEOUT)
    if problem:
        return [], problem
    try:
        items = json.loads(out)
        return [_row(os.path.relpath(os.path.realpath(item["filename"]), os.path.realpath(root)),
                     (item.get("location") or {}).get("row", 0),
                     item.get("code") or "invalid-syntax", item["message"]) for item in items], None
    except (ValueError, KeyError, TypeError):
        return [], "ruff printed no JSON array on stdout"


def _mypy(root: Path, config: Path) -> tuple[list[Row], str | None]:
    own_targets = _sets_own_targets(config)
    targets = [] if own_targets else _targets(root)
    if not targets and not own_targets:
        return [], None
    with tempfile.TemporaryDirectory(prefix="agentbay-mypy-") as cache:
        args = ["--config-file", str(config), "--cache-dir", cache, "--output", "json", *targets]
        out, problem = _run("mypy", args, root, MYPY_TIMEOUT)
    if problem:
        return [], problem
    try:
        items = [json.loads(line) for line in out.splitlines() if line.strip()]
        return [_row(item["file"], item["line"], item.get("code") or "mypy", item["message"])
                for item in items if item.get("severity") == "error"], None
    except (ValueError, KeyError, TypeError):
        return [], "mypy printed output that is not JSON"


def _token_rows(rel: str, tokens: list[tokenize.TokenInfo]) -> list[Row]:
    rows = []
    for token in tokens:
        if token.type == tokenize.NAME and token.string == "no_type_check":
            rows.append(_row(rel, token.start[0], "no-type-check", NO_TYPE_CHECK))
        elif token.type == tokenize.COMMENT:
            rows += [_row(rel, token.start[0], rule, message) for pattern, rule, message in INLINE
                     if pattern.search(token.string)]
    return rows


def _visible(root: Path, pattern: str) -> list[Path]:
    paths = sorted(root.rglob(pattern))
    return [p for p in paths if not any(part.startswith(".") for part in p.relative_to(root).parts)]


def _layout_rows(root: Path) -> list[Row]:
    rows = []
    for stub in _visible(root, "*.pyi"):
        if stub.with_suffix(".py").exists():
            rows.append(_row(stub.relative_to(root).as_posix(), 0, "stub-shadow", STUB_SHADOW))
    for path in _visible(root, "*.py"):
        if path.is_symlink():
            rows.append(_row(path.relative_to(root).as_posix(), 0, "symlink", SYMLINK))
    return rows


def _inline_rows(root: Path) -> list[Row]:
    rows = _layout_rows(root)
    for path in _visible(root, "*.py"):
        if path.is_symlink():
            continue
        try:
            with tokenize.open(path) as f:
                tokens = list(tokenize.generate_tokens(f.readline))
        except (OSError, SyntaxError, ValueError, tokenize.TokenError):
            continue
        rows += _token_rows(path.relative_to(root).as_posix(), tokens)
    return rows


class PythonCheck:
    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx

    def findings(self, root: str, configRoot: str) -> Row:
        tree, config_root = Path(root), Path(configRoot)
        is_kit = self.ctx.project.resolve() == self.ctx.kit.resolve()
        defaults = (config_root if is_kit else self.ctx.kit) / CONFIG_DIR
        ruff_rows, ruff_problem = _ruff(tree, _ruff_config(config_root, defaults, is_kit))
        mypy_rows, mypy_problem = _mypy(tree, _mypy_config(config_root, defaults, is_kit))
        out: Row = {"findings": ruff_rows + mypy_rows + _inline_rows(tree)}
        stopped = [p for p in (ruff_problem, mypy_problem) if p]
        if stopped:
            out["stopped"] = "; ".join(stopped)
        return out


def create(ctx: Any) -> PythonCheck:
    return PythonCheck(ctx)
