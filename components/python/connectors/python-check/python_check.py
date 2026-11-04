"""python-check: standards.check/v1 for Python, ruff and mypy --strict on one folder with the base's config."""
import ast
import configparser
import io
import json
import os
import re
import subprocess
import tempfile
import tokenize
import tomllib
from pathlib import Path
from typing import Any, NamedTuple

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
TYPE_CHECKING_USE = (
    "TYPE_CHECKING used other than as the whole test of an if with no else or elif; mypy skips the code it thinks "
    "is unreachable, so write a plain `if TYPE_CHECKING:` block holding only imports"
)
PLATFORM_CHECK = (
    "a sys.platform or sys.version_info check; mypy skips the branch it thinks is unreachable, "
    "so do not branch on it in checked code"
)
UNNAMEABLE_FILE = "a top-level .py file whose name is not a valid module name; mypy skips it, so rename it"
UNNAMEABLE_FOLDER = "a top-level folder with Python whose name is not a valid package name; mypy skips it, so rename it"
SYS_PROBES = ("platform", "version_info")
HIDDEN = "a .py file in a dot-folder; the tools do not check it, so move it out of the dot-folder"
UNCHECKED_FOLDERS = (".git", ".agentbay")


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


def _holds_python(entry: Path, root: Path) -> bool:
    return any("tests" not in p.relative_to(root).parts for p in entry.rglob("*.py"))


def _targets(root: Path) -> tuple[list[str], list[Row]]:
    args: list[str] = []
    unnameable: list[Row] = []
    for entry in sorted(root.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.is_file() and entry.suffix == ".py":
            if entry.stem.isidentifier():
                args += ["-m", entry.stem]
            else:
                unnameable.append(_row(entry.name, 0, "unchecked", UNNAMEABLE_FILE))
        elif entry.is_dir() and _holds_python(entry, root):
            if entry.name.isidentifier():
                args += ["-p", entry.name]
            else:
                unnameable.append(_row(entry.name, 0, "unchecked", UNNAMEABLE_FOLDER))
    return args, unnameable


def _run(module: str, args: list[str], root: Path, timeout: int) -> tuple[str, str | None]:
    try:
        done = standards.run_module(module, args, root, timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return "", f"{module} did not finish: {type(e).__name__}"
    if done.returncode not in (0, 1):
        return done.stdout, f"{module} exited with {done.returncode}"
    return done.stdout, None


def _unchecked_rows(root: Path, config: Path) -> list[Row]:
    args = ["check", "--no-cache", "--no-respect-gitignore", "--show-files", "--config", str(config), "."]
    out, _ = _run("ruff", args, root, RUFF_TIMEOUT)
    listed = {os.path.realpath(line) for line in out.splitlines()}
    return [_row(p.relative_to(root).as_posix(), 0, "unchecked", "a .py file that ruff did not check")
            for p in _visible(root, "*.py") if not p.is_symlink() and os.path.realpath(p) not in listed]


def _ruff(root: Path, config: Path) -> tuple[list[Row], str | None]:
    args = ["check", "--no-cache", "--ignore-noqa", "--output-format", "json", "--config", str(config),
            "--no-respect-gitignore", "."]
    out, problem = _run("ruff", args, root, RUFF_TIMEOUT)
    if problem:
        return [], problem
    try:
        items = json.loads(out)
        found = [_row(os.path.relpath(os.path.realpath(item["filename"]), os.path.realpath(root)),
                      (item.get("location") or {}).get("row", 0),
                      item.get("code") or "invalid-syntax", item["message"]) for item in items]
        return found + _unchecked_rows(root, config), None
    except (ValueError, KeyError, TypeError):
        return [], "ruff printed no JSON array on stdout"


def _mypy(root: Path, config: Path) -> tuple[list[Row], str | None]:
    own_targets = _sets_own_targets(config)
    targets, unnameable = ([], []) if own_targets else _targets(root)
    if not targets and not own_targets:
        return unnameable, None
    with tempfile.TemporaryDirectory(prefix="agentbay-mypy-") as cache:
        args = ["--config-file", str(config), "--cache-dir", cache, "--output", "json", *targets]
        out, problem = _run("mypy", args, root, MYPY_TIMEOUT)
    if problem:
        return [], problem
    try:
        items = [json.loads(line) for line in out.splitlines() if line.strip()]
        return [_row(item["file"], item["line"], item.get("code") or "mypy", item["message"])
                for item in items if item.get("severity") == "error"] + unnameable, None
    except (ValueError, KeyError, TypeError):
        return [], "mypy printed output that is not JSON"


class Aliases(NamedTuple):
    type_checking: set[str]
    sys_modules: set[str]
    sys_probes: set[str]


def _aliases(tree: ast.AST) -> Aliases:
    found = Aliases({"TYPE_CHECKING"}, {"sys"}, set())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in ("typing", "typing_extensions"):
            for alias in node.names:
                if alias.name == "TYPE_CHECKING" and alias.asname:
                    found.type_checking.add(alias.asname)
        elif isinstance(node, ast.ImportFrom) and node.module == "sys":
            for alias in node.names:
                if alias.name in SYS_PROBES:
                    found.sys_probes.add(alias.asname or alias.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "sys" and alias.asname:
                    found.sys_modules.add(alias.asname)
    return found


def _is_type_checking(node: ast.AST, aliases: Aliases) -> bool:
    if isinstance(node, ast.Name):
        return node.id in aliases.type_checking
    return isinstance(node, ast.Attribute) and node.attr == "TYPE_CHECKING"


def _is_sys_probe(node: ast.AST, aliases: Aliases) -> bool:
    if isinstance(node, ast.Name):
        return node.id in aliases.sys_probes
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        return node.attr in SYS_PROBES and node.value.id in aliases.sys_modules
    return False


def _reads_sys_probe(node: ast.AST, aliases: Aliases) -> bool:
    return any(_is_sys_probe(inner, aliases) for inner in ast.walk(node))


def _is_platform_check(node: ast.AST, aliases: Aliases) -> bool:
    if isinstance(node, ast.Compare):
        return _reads_sys_probe(node, aliases)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        return node.func.attr == "startswith" and _is_sys_probe(node.func.value, aliases)
    return False


def _reachability_rows(rel: str, source: str) -> list[Row]:
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return []
    aliases = _aliases(tree)
    plain_tests = {id(node.test) for node in ast.walk(tree)
                   if isinstance(node, ast.If) and not node.orelse and _is_type_checking(node.test, aliases)}
    rows = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.expr):
            continue
        if _is_type_checking(node, aliases) and id(node) not in plain_tests:
            rows.append(_row(rel, node.lineno, "type-checking-use", TYPE_CHECKING_USE))
        elif _is_platform_check(node, aliases):
            rows.append(_row(rel, node.lineno, "platform-check", PLATFORM_CHECK))
    return rows


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
    return rows + _hidden_rows(root)


def _hidden_rows(root: Path) -> list[Row]:
    rows = []
    for path in sorted(root.rglob("*.py")):
        parts = path.relative_to(root).parts
        if any(part.startswith(".") and part not in UNCHECKED_FOLDERS for part in parts[:-1]):
            rows.append(_row(path.relative_to(root).as_posix(), 0, "hidden", HIDDEN))
    return rows


def _inline_rows(root: Path) -> list[Row]:
    rows = _layout_rows(root)
    for path in _visible(root, "*.py"):
        if path.is_symlink():
            continue
        try:
            with tokenize.open(path) as f:
                source = f.read()
            tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
        except (OSError, SyntaxError, ValueError, tokenize.TokenError):
            continue
        rel = path.relative_to(root).as_posix()
        rows += _token_rows(rel, tokens)
        if "tests" not in path.relative_to(root).parts:
            rows += _reachability_rows(rel, source)
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
