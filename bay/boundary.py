"""`bay check --base <ref>`: a deterministic check that a change stays inside its boundaries (proposal 0006, Part F)."""
from __future__ import annotations

import posixpath
import re
import subprocess
import tarfile
from dataclasses import dataclass, field, asdict
from pathlib import Path

import yaml

DOCS = ("README.md", "docs/DESIGN.md", "docs/INTERFACES.md")
OTHER = ("tests/", "HANDOFF.md", "docs/proposals/", "docs/plans/", "docs/research/", ".gitignore",
         ".gitattributes", ".editorconfig", "LICENSE", "LICENSE.md")
MANIFEST_KINDS = {"mode.yaml": "mode", "connector.yaml": "connector", "content-type.yaml": "contentType",
                  "component.yaml": "component"}
_COMPONENT = re.compile(r"components/([^/]+)/")
SHA = re.compile(r"^[0-9a-f]{7,40}$")
GIT_TIMEOUT = 60
ARCHIVE_TIMEOUT = 120

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def _glob_re(glob: str) -> str:
    out, i = [], 0
    while i < len(glob):
        if glob.startswith("**", i):
            out.append(".*")
            i += 2
            if glob.startswith("/", i):
                out[-1] = "(?:.*/)?"
                i += 1
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return "".join(out) + (".*" if glob.endswith("/") else "")


def match(glob: str, path: str) -> bool:
    """True when `path` matches `glob` (see the module docstring for the syntax)."""
    glob = glob.strip().removeprefix("./")
    return re.fullmatch(_glob_re(glob), path) is not None


def literal_prefix(glob: str) -> str:
    m = re.search(r"[*?]", glob)
    return glob[:m.start()] if m else glob


_NAME = re.compile(r"^[a-z][a-z0-9-]*$")


class ProtectedError(ValueError):
    """The `protected:` block of the component map is not what the loader accepts."""


def under(path: str, folder: str) -> bool:
    """True when `path` is `folder` or inside it (both kit-relative, `/`-separated)."""
    return path == folder or path.startswith(folder.rstrip("/") + "/")


def _names(value, what: str, pattern=_NAME) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(n, str) and pattern.match(n) for n in value):
        raise ProtectedError(f"{what} must be a list of names (lowercase letters, digits and hyphens)")
    if len(set(value)) != len(value):
        raise ProtectedError(f"{what} lists a name twice")
    return tuple(value)


def _folder(p) -> str:
    bad = not isinstance(p, str) or not p or p.startswith(("/", "~")) or "\\" in p
    if bad or posixpath.normpath(p) != p or p == "." or p.startswith("../") or p == "..":
        raise ProtectedError(f"paths: {p!r} must be a kit-relative folder in normal form (no '..', no leading '/', "
                             f"no trailing '/')")
    return p


@dataclass(frozen=True)
class Protection:
    """What only `forge.extend` may change, per the map's `protected:` block; a set that cannot be read is `closed`."""
    paths: tuple[str, ...] = ()
    names: dict = field(default_factory=dict)
    place: dict = field(default_factory=dict)
    closed: bool = False

    @classmethod
    def closed_set(cls) -> "Protection":
        return cls(closed=True)

    @classmethod
    def parse(cls, block) -> "Protection":
        """The `protected:` block; every key is required (an omitted list is not 'nothing protected')."""
        if not isinstance(block, dict) or set(block) != {"paths", "mode", "env", "connector"}:
            raise ProtectedError("must be a mapping with exactly the keys paths, mode, env and connector")
        raw = block["paths"]
        if not isinstance(raw, list) or not raw:
            raise ProtectedError("paths must be a non-empty list of folders")
        paths = tuple(_folder(p) for p in raw)
        if len(set(paths)) != len(paths):
            raise ProtectedError("paths lists a folder twice")
        env = block["env"]
        if not isinstance(env, dict):
            raise ProtectedError("env must map each protected env to {} or {modes: [...]}")
        place = {}
        for name, body in env.items():
            if not isinstance(name, str) or not _NAME.match(name) or not (body is None or isinstance(body, dict)):
                raise ProtectedError(f"env {name!r} must be a name mapped to {{}} or {{modes: [...]}}")
            if set(body or {}) - {"modes"}:
                raise ProtectedError(f"env {name}: the only key is modes")
            place[name] = _names((body or {}).get("modes", []), f"env {name}: modes", re.compile(r"^(\*|[a-z][a-z0-9-]*)$"))
        return cls(paths, {"mode": _names(block["mode"], "mode"), "env": tuple(place),
                           "connector": _names(block["connector"], "connector")}, place)

    def reserved(self, kind: str, name: str) -> bool:
        return self.closed or name in self.names.get(kind, ())

    def covers(self, path: str) -> bool:
        """`path` (kit-relative) is inside one of the protected folders (instances: see `Kit.covers`)."""
        path = posixpath.normpath(path)
        return self.closed or any(under(path, p) for p in self.paths)

    def may_place(self, mode: str, env: str) -> bool:
        """May `mode` put a role in `env`? An unprotected env is open; a protected env takes its listed modes."""
        if self.closed:
            return False
        if env not in self.place or mode in self.names.get("mode", ()):
            return True
        return "*" in self.place[env] or mode in self.place[env]

    def open_envs(self) -> list[str]:
        """The protected envs every unprotected mode may use, in the map's order."""
        return [e for e, modes in self.place.items() if "*" in modes]


def root(path: str) -> tuple[str, str] | None:
    """The component folder `path` is inside: (`components/x/`, `x`), or None."""
    m = _COMPONENT.match(path)
    return (m.group(0), m.group(1)) if m else None


@dataclass
class ComponentMap:
    owns: list[str]
    protected: Protection

    @classmethod
    def load(cls, path: Path) -> "ComponentMap":
        return cls.parse(Path(path).read_text(encoding="utf-8"))

    @classmethod
    def parse(cls, text: str) -> "ComponentMap":
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError as e:
            raise RuntimeError(f"{MAP}: not valid YAML ({' '.join(str(e).split())})") from None
        if doc is None:
            doc = {}
        if not isinstance(doc, dict):
            raise RuntimeError(f"{MAP}: the document must be a mapping with owns: and protected: keys, not a "
                               f"{type(doc).__name__}")
        owns = doc.get("owns") or []
        if not isinstance(owns, list) or not all(isinstance(g, str) for g in owns):
            raise RuntimeError(f"{MAP}: owns: must be a list of paths")
        if "protected" not in doc:
            raise RuntimeError(f"{MAP}: no protected: block; add one (paths, mode, env and connector), the check "
                               f"judges a change by the base's map")
        try:
            prot = Protection.parse(doc["protected"])
        except ProtectedError as e:
            raise RuntimeError(f"{MAP}: protected: {e}") from None
        return cls(owns, prot)

    def owner(self, path: str) -> str | None:
        """`kernel` when `path` is under one of the kernel's `owns:` globs."""
        return "kernel" if any(match(g, path) for g in self.owns) else None

    def protected_by(self, path: str) -> str | None:
        """Why `path` is protected (a folder of `protected.paths`, or a file of a protected mode), else None."""
        p = self.protected
        for d in p.paths:
            if under(path, d):
                return f"protected folder {d}/"
        rt = root(path)
        return f"protected mode {rt[1]}" if rt and p.reserved("mode", rt[1]) else None


def stray(paths: list[str], cmap: ComponentMap) -> list[str]:
    """B-4: the paths that are neither core docs, other, a repo-root file, core-owned nor in a component folder."""
    return [p for p in paths if p not in DOCS and not any(match(g, p) for g in OTHER) and "/" in p
            and not cmap.owner(p) and not root(p)]


def git(repo: Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


MAP = "framework/kernel.yaml"


def show(repo: Path, rev: str, path: str) -> str | None:
    """The text of `path` as committed at `rev`, or None when `rev` has no such file."""
    r = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", f"{rev}:{path}"], capture_output=True)
    if r.returncode:
        git(repo, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}")
        return None
    return git(repo, "show", f"{rev}:{path}")


def merge_base(repo: Path, base: str, head: str) -> str:
    """The commit `base...head` diffs against: the change is judged as of where it forked from base."""
    out = git(repo, "merge-base", base, head).strip()
    if not out:
        raise RuntimeError(f"{base} and {head} have no common ancestor")
    return out


def _try_git(repo: Path, args: tuple[str, ...], run) -> subprocess.CompletedProcess | None:
    try:
        return run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=GIT_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return None


def base_commit(repo: Path, base: str, run=subprocess.run) -> str:
    """The commit the working tree branched from `base`, so a branch is judged against what it started from."""
    r = _try_git(repo, ("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}"), run)
    if r is None or r.returncode != 0:
        remote = base.split("/")[0] if "/" in base else "<remote>"
        raise ValueError(f"base {base} does not resolve in this checkout; fetch {remote} (git fetch {remote}) "
                         f"and run the check again")
    r = _try_git(repo, ("merge-base", base, "HEAD"), run)
    sha = (r.stdout or "").strip() if r is not None and r.returncode == 0 else ""
    if not SHA.match(sha):
        raise ValueError(f"base {base} has no common ancestor with HEAD; fetch the remote and rebase the change")
    return sha


def renames(repo: Path, sha: str, run=subprocess.run) -> dict:
    """The files git sees as renamed between `sha` and the working tree: {old path: new path}."""
    r = _try_git(repo, ("diff", "-M", "--diff-filter=R", "--name-status", "-z", sha), run)
    names = (r.stdout or "").split("\0") if r is not None and r.returncode == 0 else []
    return dict(zip(names[1::3], names[2::3]))


def export(repo: Path, rev: str, dest: Path, run=subprocess.run) -> None:
    """The tree of `repo` at `rev` as plain files in `dest` (git archive, filter="data"); nothing in it is ever run."""
    tar = dest.parent / "base.tar"
    try:
        r = run(["git", "-C", str(repo), "archive", "--format=tar", "-o", str(tar), rev],
                capture_output=True, text=True, timeout=ARCHIVE_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as e:
        raise ValueError(f"cannot export {rev}: {e}") from None
    if r.returncode != 0:
        raise ValueError(f"cannot export {rev} with git archive: {(r.stderr or '').strip()[:200]}")
    try:
        with tarfile.open(tar) as t:
            t.extractall(dest, filter="data")
    except (tarfile.TarError, OSError) as e:
        raise ValueError(f"cannot extract {rev}: {type(e).__name__}: {str(e)[:200]}") from None


def map_at(repo: Path, base: str, head: str, mb: str | None = None) -> tuple[ComponentMap, str]:
    """The component map a change is judged by and its rev: the merge-base's, or head's when the change adds it."""
    mb = mb or merge_base(repo, base, head)
    text = show(repo, mb, MAP)
    if text is not None:
        return ComponentMap.parse(text), base
    status = git(repo, "diff", "--name-status", "--no-renames", "--no-relative", "--no-ext-diff",
                  f"{base}...{head}", "--", MAP).split("\t", 1)[0].strip()
    if status == "A":
        return ComponentMap.parse(show(repo, head, MAP)), head
    raise RuntimeError(f"{MAP} does not exist at {base} (merge-base {mb[:12]}) and this change does not add it; "
                       f"the boundary check needs the base's component map")


def proposal_touches(repo: Path, head: str, path: str) -> list[dict]:
    """The `touches:` of the proposal at `path` as committed at `head`; an uncommitted edit does not count."""
    from . import proposal
    text = show(repo, head, path)
    if text is None:
        raise RuntimeError(f"{path} is not committed at {head}; commit the proposal before running the check")
    try:
        return proposal.touches(text)
    except proposal.ProposalError as e:
        raise RuntimeError(f"{path} at {head}: {e}") from e


def changed(repo: Path, base: str, head: str = "HEAD") -> list[str]:
    """Every path the change adds, modifies or deletes; renames are split and the flags pin the user's git config."""
    out = git(repo, "-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", "--no-relative",
               "--no-ext-diff", "-z", f"{base}...{head}")
    parts = [p for p in out.split("\0")]
    paths = []
    for status, path in zip(parts[0::2], parts[1::2]):
        if status and path:
            paths.append(path)
    return list(dict.fromkeys(paths))


@dataclass
class Finding:
    path: str
    cls: str
    owner: str
    ok: bool
    rule: str = ""
    why: str = ""


@dataclass
class Report:
    base: str
    head: str
    proposal: str | None
    findings: list[Finding] = field(default_factory=list)
    doc_hits: list[dict] = field(default_factory=list)
    docs_checked: bool = False
    map_rev: str = ""

    @property
    def failures(self) -> list[Finding]:
        return [f for f in self.findings if not f.ok]

    @property
    def exit_code(self) -> int:
        return 1 if self.failures or self.doc_hits else 0

    def lines(self) -> list[str]:
        where = self.proposal or "the proposal"
        out = [f"{f.path}: {f.owner} - {f.why} - add it to touches: in {where} or move the change"
               for f in self.failures]
        if self.docs_checked:
            out += [f"{h['file']}:{h['line']}: names extension {h['contract']} '{h['name']}' outside a fenced "
                    f"example block (B-11) - describe the contract, or put the example in a fenced block"
                    for h in self.doc_hits]
        if self.map_rev and self.map_rev != self.base:
            out.append(f"component map: none at {self.base}; judged by {MAP} at {self.map_rev} (introduced here; "
                       f"every changed path outside other must be in touches:)")
        out.append(self.summary())
        return out

    def summary(self) -> str:
        by_cls: dict[str, int] = {}
        for f in self.findings:
            by_cls[f.cls] = by_cls.get(f.cls, 0) + 1
        by_rule: dict[str, int] = {}
        for f in self.failures:
            by_rule[f.rule] = by_rule.get(f.rule, 0) + 1
        s = (f"boundary {self.base}...{self.head}: {len(self.findings)} changed paths ("
             + ", ".join(f"{n} {c}" for c, n in sorted(by_cls.items())) + f"); {len(self.failures)} failing")
        if by_rule:
            s += " (" + ", ".join(f"{r}: {n}" for r, n in sorted(by_rule.items())) + ")"
        if self.docs_checked:
            s += f"; B-11 docs: {len(self.doc_hits)} hits"
        return s

    def to_json(self) -> dict:
        return {"base": self.base, "head": self.head, "proposal": self.proposal, "ok": self.exit_code == 0,
                "paths": [asdict(f) for f in self.findings], "failures": len(self.failures),
                "docs": {"checked": self.docs_checked, "hits": self.doc_hits}, "mapAt": self.map_rev or self.base}


def classify(path: str, cmap: ComponentMap, touches: list[dict], is_new, proposal: str | None,
             introduced: bool = False) -> Finding:
    """One changed path -> a Finding; a protected path passes only when `touches:` lists it, new extension or not."""
    f = _classify(path, cmap, touches, is_new, proposal, introduced)
    why = cmap.protected_by(path)
    if why and f.ok and f.cls != "other" and not any(match(t["path"], path) for t in touches):
        return Finding(path, f.cls, f.owner, False, "protected",
                       f"{why}: only forge.extend changes it, so it must be listed even when the folder is new")
    return f


def _classify(path: str, cmap: ComponentMap, touches: list[dict], is_new, proposal: str | None,
              introduced: bool = False) -> Finding:
    globs = [t["path"] for t in touches]
    listed = any(match(g, path) for g in globs)
    if path == proposal or any(match(g, path) for g in OTHER):
        return Finding(path, "other", "other", True)
    if path in DOCS:
        return Finding(path, "docs", "core docs", listed, "docs",
                       "" if listed else "core docs change only when the proposal lists them")
    comp = cmap.owner(path)
    if comp:
        return Finding(path, "core", comp, listed, "B-1", "" if listed else f"core path owned by {comp} (B-1)")
    rt = root(path)
    if rt:
        folder, name = rt
        label = f"component {name}"
        if is_new(folder):
            if introduced:
                return Finding(path, "extension", label, listed, "B-2",
                               "" if listed else "new component folder, judged by the component map this change "
                               "introduces: no new-extension pass, list it (B-2)")
            return Finding(path, "extension", label, True, "B-2")
        m = re.match(re.escape(folder) + r"features/([^/]+)/", path)
        if m:
            return Finding(path, "feature", f"{label} feature {m.group(1)}", listed, "B-3",
                           "" if listed else f"feature folder of an existing component; list {m.group(0)} (B-3)")
        return Finding(path, "extension", label, listed, "B-3",
                       "" if listed else "component-wide file of an existing component; list it (B-3)")
    if "/" not in path:
        return Finding(path, "other", "repo root", True)
    return Finding(path, "unowned", "unowned", listed, "unowned",
                   "" if listed else "not under any component or extension in framework/kernel.yaml")


def doc_hits(texts: dict[str, str], names: dict[str, str]) -> list[dict]:
    """B-11: each line of the core docs (outside fenced blocks) that names an extension instance."""
    rxs = [(n, c, re.compile(rf"(?<![\w.-]){re.escape(n)}(?![\w-]|\.\w)", re.I)) for n, c in sorted(names.items())]
    out = []
    for fname, text in texts.items():
        fence = ""
        for i, line in enumerate(text.splitlines(), 1):
            m = _FENCE.match(line)
            if not fence:
                if m and not (m.group(1)[0] == "`" and "`" in m.group(2)):
                    fence = m.group(1)
                    continue
            else:
                if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) and not m.group(2).strip():
                    fence = ""
                continue
            for n, c, rx in rxs:
                if rx.search(line):
                    out.append({"file": fname, "line": i, "name": n, "contract": c})
    return out


def instance_names(paths: list[str], cmap: ComponentMap) -> dict[str, str]:
    names = {}
    for p in paths:
        rt = root(p)
        if rt and p[len(rt[0]):] in MANIFEST_KINDS and cmap.owner(rt[0]) is None:
            names.setdefault(rt[1], MANIFEST_KINDS[p[len(rt[0]):]])
    return names


def check(repo: Path, base: str, head: str = "HEAD", proposal: str | None = None,
          touches: list[dict] | None = None, cmap: ComponentMap | None = None, docs: bool = False) -> Report:
    repo = Path(repo)
    mb = merge_base(repo, base, head)
    map_rev = base
    if cmap is None:
        cmap, map_rev = map_at(repo, base, head, mb)
    introduced = map_rev != base
    touches = [t for t in touches or [] if not t.get("planned")]
    at_base: set[str] = set()
    for f in git(repo, "-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "-z", mb).split("\0"):
        parts = f.split("/")
        at_base.update("/".join(parts[:i]).casefold() for i in range(1, len(parts) + 1) if f)

    def is_new(root: str) -> bool:
        """An extension root is new when no path at the merge-base matches it, ignoring case (F-4)."""
        return root.rstrip("/").casefold() not in at_base

    rep = Report(base, head, proposal, map_rev=map_rev)
    rep.findings = [classify(p, cmap, touches, is_new, proposal, introduced)
                    for p in changed(repo, base, head)]
    if docs:
        rep.docs_checked = True
        tree = git(repo, "ls-tree", "-r", "--name-only", head).splitlines()
        texts = {d: git(repo, "show", f"{head}:{d}") for d in DOCS if d in tree}
        rep.doc_hits = doc_hits(texts, instance_names(tree, cmap))
    return rep
