"""`bay check --base <ref>`: a deterministic check that a change stays inside its boundaries (proposal 0006, Part F).

It reads `git diff --name-status --no-renames <base>...<head>` and classifies each changed path (deletions
and both sides of a move included) with
framework/components.yaml and the proposal's `touches:`:

- core (B-1): under a component's `owns:`; passes only if a `touches:` glob matches.
- extension (B-2): under a contract's `at:`; passes if the extension is new in the diff or listed.
- feature (B-3): inside an existing mode, `features/<f>/` passes only when a `touches:` entry names that
  feature (its literal prefix reaches `<mode>/features/`); a whole-mode entry does not cover features.
  Mode-wide files (mode.yaml, playbook.md, ...) must be listed too.
- docs: README.md, docs/DESIGN.md, docs/INTERFACES.md change only when listed.
- other: tests/, the proposal, HANDOFF.md, proposal/research records and repo meta pass.
- a file in the repo root that no component owns (TODO.md, CLAUDE.md) passes: it is not framework code.
- anything else is unowned and fails unless listed (CI config under `.github/` included).

Inputs come from commits, never the working tree (F-14): the component map and the "is this extension new" tree
as of the merge-base of `<base>` and `<head>` (N-2: the side `<base>...<head>` diffs against; a change that edits
the map is judged by the map it edits), and the proposal's `touches:` as of `<head>`. Only a change that adds the
map (status A) is judged by its own map at `<head>`; it then gets no new-extension pass, so every changed path
outside other must be listed (N-1), and the report says so. Any other base without a map is an error.

B-11 (`--docs`): the core docs must not name a discovered extension instance (a mode, connector, env or
content-type folder name) outside a fenced block. Instances inside a core `owns:` path (the briefing base mode,
corpus-store) are core, not extensions, so naming them is allowed. Each hit fails the check.

Glob syntax for `owns:` and `touches:`: `*` and `?` stay within one path segment, `**` crosses
segments, and a trailing `/` means the folder and everything under it.
"""
from __future__ import annotations

import posixpath
import re
import subprocess
from dataclasses import dataclass, field, asdict
from pathlib import Path

import yaml

DOCS = ("README.md", "docs/DESIGN.md", "docs/INTERFACES.md")
OTHER = ("tests/", "HANDOFF.md", "docs/proposals/", "docs/plans/", "docs/research/", ".gitignore",
         ".gitattributes", ".editorconfig", "LICENSE", "LICENSE.md")
# contracts whose instance names B-11 forbids in the core docs
NAMED_CONTRACTS = ("mode", "connector", "env", "contentType")

_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


# ----------------------------------------------------------------- globs
def _glob_re(glob: str) -> str:
    out, i = [], 0
    while i < len(glob):
        if glob.startswith("**", i):
            out.append(".*")
            i += 2
            if glob.startswith("/", i):          # `a/**/b` also matches `a/b`
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


# ----------------------------------------------------------------- protection
PROTECTED_KINDS = ("mode", "env", "connector")      # the contracts whose instances can be protected
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
    """What only `forge.extend` may change, as the component map declares it (`protected:`): folders (`paths`), and
    by name the modes, envs and connectors that are protected wherever they sit. `place` says, for each protected
    env, which unprotected modes may put roles there (`*` = every one). A set that could not be read is `closed`:
    every name is reserved, every path covered, nothing may be placed - never open."""
    paths: tuple[str, ...] = ()
    names: dict = field(default_factory=dict)       # kind -> protected instance names (env: the keys of `place`)
    place: dict = field(default_factory=dict)       # env -> the unprotected modes that may use it
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
        """May `mode` put a role in `env`? Anything may use an unprotected env; a protected env belongs to the
        protected modes and to the unprotected modes its entry names."""
        if self.closed:
            return False
        if env not in self.place or mode in self.names.get("mode", ()):
            return True
        return "*" in self.place[env] or mode in self.place[env]

    def open_envs(self) -> list[str]:
        """The protected envs every unprotected mode may use, in the map's order."""
        return [e for e, modes in self.place.items() if "*" in modes]


# ----------------------------------------------------------------- the map
@dataclass
class Contract:
    component: str
    name: str
    at: list[str]

    def instance(self, path: str) -> str | None:
        """The instance root (`modes/x/`, `envs/x.yaml`) that `path` falls in, or None."""
        for pat in self.at:
            head, _, tail = pat.partition("<name>")
            rx = re.escape(head) + r"([^/]+?)" + re.escape(tail)
            m = re.match(rx + ("" if tail.endswith("/") else "$"), path)
            if m:
                return m.group(0)
        return None

    def instance_name(self, root: str) -> str:
        for pat in self.at:
            head, _, tail = pat.partition("<name>")
            m = re.fullmatch(re.escape(head) + r"([^/]+?)" + re.escape(tail), root)
            if m:
                return m.group(1)
        return root


@dataclass
class ComponentMap:
    owns: dict[str, list[str]]
    contracts: list[Contract]
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
            raise RuntimeError(f"{MAP}: the document must be a mapping with a components: key, not a "
                               f"{type(doc).__name__}")
        owns, contracts = {}, []
        comps = doc.get("components") or {}
        if not isinstance(comps, dict) or not all(isinstance(v, dict) for v in comps.values()):
            raise RuntimeError(f"{MAP}: components: must map each component name to a mapping")
        for comp, spec in comps.items():
            owns[comp] = list(spec.get("owns") or [])
            for cname, c in (spec.get("contracts") or {}).items():
                if c.get("at"):
                    contracts.append(Contract(comp, cname, list(c["at"])))
        if "protected" not in doc:
            raise RuntimeError(f"{MAP}: no protected: block; add one (paths, mode, env and connector), the check "
                               f"judges a change by the base's map")
        try:
            prot = Protection.parse(doc["protected"])
        except ProtectedError as e:
            raise RuntimeError(f"{MAP}: protected: {e}") from None
        return cls(owns, contracts, prot)

    def owner(self, path: str) -> str | None:
        """The core component owning `path`; the most specific `owns:` glob wins."""
        best = None
        for comp, globs in self.owns.items():
            for g in globs:
                if match(g, path) and (best is None or len(literal_prefix(g)) > best[0]):
                    best = (len(literal_prefix(g)), comp)
        return best[1] if best else None

    def extension(self, path: str) -> tuple[Contract, str] | None:
        for c in self.contracts:
            root = c.instance(path)
            if root:
                return c, root
        return None

    def protected_by(self, path: str) -> str | None:
        """Why `path` is protected (a folder of `protected.paths`, or a file of a protected mode, env or connector
        wherever its folder sits), else None."""
        p = self.protected
        for d in p.paths:
            if under(path, d):
                return f"protected folder {d}/"
        ext = self.extension(path)
        if ext and ext[0].name in PROTECTED_KINDS and p.reserved(ext[0].name, ext[0].instance_name(ext[1])):
            return f"protected {ext[0].name} {ext[0].instance_name(ext[1])}"
        return None


def stray(paths: list[str], cmap: ComponentMap) -> list[str]:
    """B-4: the paths that are neither core docs, other, a repo-root file, under a core `owns:` path nor in an
    extension folder."""
    return [p for p in paths if p not in DOCS and not any(match(g, p) for g in OTHER) and "/" in p
            and not cmap.owner(p) and not cmap.extension(p)]


# ----------------------------------------------------------------- git
def _git(repo: Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args)}: {r.stderr.strip()}")
    return r.stdout


MAP = "framework/components.yaml"


def show(repo: Path, rev: str, path: str) -> str | None:
    """The text of `path` as committed at `rev`, or None when `rev` has no such file."""
    r = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", f"{rev}:{path}"], capture_output=True)
    if r.returncode:
        _git(repo, "rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}")      # a bad rev is an error, not "absent"
        return None
    return _git(repo, "show", f"{rev}:{path}")


def merge_base(repo: Path, base: str, head: str) -> str:
    """The commit `base...head` diffs against: the change is judged as of where it forked from base."""
    out = _git(repo, "merge-base", base, head).strip()
    if not out:
        raise RuntimeError(f"{base} and {head} have no common ancestor")
    return out


def map_at(repo: Path, base: str, head: str, mb: str | None = None) -> tuple[ComponentMap, str]:
    """The component map a change is judged by, and the rev it was read at. Normally the merge-base's (N-2:
    the side `base...head` diffs against). Only when the change itself adds the map (status A in base...head)
    is head's map used; the caller then gives no new-extension pass (N-1). Any other base without a map is
    an error."""
    mb = mb or merge_base(repo, base, head)
    text = show(repo, mb, MAP)
    if text is not None:
        return ComponentMap.parse(text), base
    status = _git(repo, "diff", "--name-status", "--no-renames", "--no-relative", "--no-ext-diff",
                  f"{base}...{head}", "--", MAP).split("\t", 1)[0].strip()
    if status == "A":
        return ComponentMap.parse(show(repo, head, MAP)), head
    raise RuntimeError(f"{MAP} does not exist at {base} (merge-base {mb[:12]}) and this change does not add it; "
                       f"the boundary check needs the base's component map")


def proposal_touches(repo: Path, head: str, path: str) -> list[dict]:
    """The `touches:` of the proposal at `path` (repo-relative) as committed at `head`; an edit not yet
    committed does not count."""
    from . import proposal
    text = show(repo, head, path)
    if text is None:
        raise RuntimeError(f"{path} is not committed at {head}; commit the proposal before running the check")
    try:
        return proposal.touches(text)
    except proposal.ProposalError as e:
        raise RuntimeError(f"{path} at {head}: {e}") from e


def changed(repo: Path, base: str, head: str = "HEAD") -> list[str]:
    """Every path the change adds, modifies or deletes. Renames are split into a deletion and an addition so both
    sides of a move are classified; the flags pin everything the user's git config could change (rename
    detection, relative paths, path quoting, external diff drivers)."""
    out = _git(repo, "-c", "core.quotePath=false", "diff", "--name-status", "--no-renames", "--no-relative",
               "--no-ext-diff", "-z", f"{base}...{head}")
    parts = [p for p in out.split("\0")]
    paths = []
    for status, path in zip(parts[0::2], parts[1::2]):
        if status and path:
            paths.append(path)
    return list(dict.fromkeys(paths))


# ----------------------------------------------------------------- the check
@dataclass
class Finding:
    path: str
    cls: str                 # core | extension | feature | docs | other | unowned
    owner: str               # component, or `<contract> <instance>`, or a label
    ok: bool
    rule: str = ""           # B-1 | B-2 | B-3 | docs | unowned
    why: str = ""


@dataclass
class Report:
    base: str
    head: str
    proposal: str | None
    findings: list[Finding] = field(default_factory=list)
    doc_hits: list[dict] = field(default_factory=list)
    docs_checked: bool = False
    map_rev: str = ""        # the rev the component map was read at (base, or head when base has none)

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
    """One changed path -> a Finding. `is_new(root)` says whether an extension root is absent at base.
    `introduced`: the map is the one this change adds, so a new extension folder gets no pass (N-1).
    A path the map protects (`protected:`) passes only when `touches:` lists it: the new-extension pass does
    not reach a protected name, and a protected folder is never new."""
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
    ext = cmap.extension(path)
    if ext:
        c, root = ext
        label = f"{c.name} {c.instance_name(root)}"
        if is_new(root):
            if introduced:
                return Finding(path, "extension", label, listed, "B-2",
                               "" if listed else "new extension folder, judged by the component map this change "
                               "introduces: no new-extension pass, list it (B-2)")
            return Finding(path, "extension", label, True, "B-2")
        if c.name == "mode":
            m = re.match(re.escape(root) + r"features/([^/]+)/", path)
            if m:
                feat = m.group(0)
                ok = any(match(g, path) and literal_prefix(g).startswith(root + "features/") for g in globs)
                return Finding(path, "feature", f"{label} feature {m.group(1)}", ok, "B-3",
                               "" if ok else f"feature folder of an existing mode; list {feat} (B-3)")
            return Finding(path, "extension", label, listed, "B-3",
                           "" if listed else f"mode-wide file of an existing mode; list it (B-3)")
        return Finding(path, "extension", label, listed, "B-2",
                       "" if listed else f"existing {c.name} folder {root} (B-2)")
    if "/" not in path:                  # an ordinary repo-root file (TODO.md, .env.example): not framework code
        return Finding(path, "other", "repo root", True)
    return Finding(path, "unowned", "unowned", listed, "unowned",
                   "" if listed else "not under any component or extension in framework/components.yaml")


def doc_hits(texts: dict[str, str], names: dict[str, str]) -> list[dict]:
    """B-11: each line of the core docs (outside fenced blocks) that names an extension instance.
    `names` maps instance name -> contract name."""
    rxs = [(n, c, re.compile(rf"(?<![\w.-]){re.escape(n)}(?![\w-]|\.\w)", re.I)) for n, c in sorted(names.items())]
    out = []
    for fname, text in texts.items():
        fence = ""            # the open fence (CommonMark: closed by the same character, at least as long)
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
        ext = cmap.extension(p)
        if ext and ext[0].name in NAMED_CONTRACTS and cmap.owner(ext[1]) is None:   # core-owned: not an extension
            names.setdefault(ext[0].instance_name(ext[1]), ext[0].name)
    return names


def check(repo: Path, base: str, head: str = "HEAD", proposal: str | None = None,
          touches: list[dict] | None = None, cmap: ComponentMap | None = None, docs: bool = False) -> Report:
    repo = Path(repo)
    mb = merge_base(repo, base, head)                                # N-2: what base...head diffs against
    map_rev = base
    if cmap is None:
        cmap, map_rev = map_at(repo, base, head, mb)
    introduced = map_rev != base
    touches = [t for t in touches or [] if not t.get("planned")]     # planned entries authorize nothing yet
    at_base: set[str] = set()
    for f in _git(repo, "-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "-z", mb).split("\0"):
        parts = f.split("/")
        at_base.update("/".join(parts[:i]).casefold() for i in range(1, len(parts) + 1) if f)

    def is_new(root: str) -> bool:
        """An extension root is new when no path at the merge-base matches it, ignoring case (F-4: `modes/Mail/`
        next to `modes/mail/` is an edit of mail on a case-insensitive filesystem, not a new mode)."""
        return root.rstrip("/").casefold() not in at_base

    rep = Report(base, head, proposal, map_rev=map_rev)
    rep.findings = [classify(p, cmap, touches, is_new, proposal, introduced)
                    for p in changed(repo, base, head)]
    if docs:
        rep.docs_checked = True
        tree = _git(repo, "ls-tree", "-r", "--name-only", head).splitlines()
        texts = {d: _git(repo, "show", f"{head}:{d}") for d in DOCS if d in tree}
        rep.doc_hits = doc_hits(texts, instance_names(tree, cmap))
    return rep
