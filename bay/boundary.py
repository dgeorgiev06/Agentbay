"""`bay boundary`: a deterministic check that a change stays inside its boundaries (proposal 0006, Part F).

It reads `git diff --name-status --no-renames <base>...<head>` and classifies each changed path (deletions
and both sides of a move included) with
framework/components.yaml and the proposal's `touches:`:

- core (B-1): under a component's `owns:`; passes only if a `touches:` glob matches.
- extension (B-2): under a contract's `at:`; passes if the extension is new in the diff or listed.
- feature (B-3): inside an existing mode, `features/<f>/` passes only when a `touches:` entry names that
  feature (its literal prefix reaches `<mode>/features/`); a whole-mode entry does not cover features.
  Mode-wide files (mode.yaml, playbook.md, ...) must be listed too.
- docs: README.md, docs/DESIGN.md, docs/INTERFACES.md change only when listed.
- other: tests/, the proposal, HANDOFF.md, proposal/research records, repo meta and generated files pass
  (agentbay.config.example.yaml: `bay config example` assembles it from the extensions, lint fails when stale).
- anything else is unowned and fails unless listed (CI config under `.github/` included).

Inputs come from commits, never the working tree (F-14): the component map as of `<base>` (a change that edits
the map is judged by the map it edits; only when `<base>` has no map yet, the change that introduces it is judged
by its own map at `<head>`, and the report says so), and the proposal's `touches:` as of `<head>`.

B-11 (`--docs`): the core docs must not name a discovered extension instance (a mode, connector, env or
content-type folder name) outside a fenced block. Instances inside a core `owns:` path (the briefing base mode,
corpus-store) are core, not extensions, so naming them is allowed. Each hit fails the check.

Glob syntax for `owns:` and `touches:`: `*` and `?` stay within one path segment, `**` crosses
segments, and a trailing `/` means the folder and everything under it.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field, asdict
from pathlib import Path

import yaml

DOCS = ("README.md", "docs/DESIGN.md", "docs/INTERFACES.md")
OTHER = ("tests/", "HANDOFF.md", "docs/proposals/", "docs/research/", ".gitignore", ".gitattributes",
         ".editorconfig", "LICENSE", "LICENSE.md", "agentbay.config.example.yaml")
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

    @classmethod
    def load(cls, path: Path) -> "ComponentMap":
        return cls.parse(Path(path).read_text(encoding="utf-8"))

    @classmethod
    def parse(cls, text: str) -> "ComponentMap":
        doc = yaml.safe_load(text) or {}
        owns, contracts = {}, []
        for comp, spec in (doc.get("components") or {}).items():
            owns[comp] = list(spec.get("owns") or [])
            for cname, c in (spec.get("contracts") or {}).items():
                if c.get("at"):
                    contracts.append(Contract(comp, cname, list(c["at"])))
        return cls(owns, contracts)

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


def stray(paths: list[str], cmap: ComponentMap) -> list[str]:
    """B-4: the paths that are neither core docs, other, under a core `owns:` path nor in an extension folder."""
    return [p for p in paths if p not in DOCS and not any(match(g, p) for g in OTHER)
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


def map_at(repo: Path, base: str, head: str) -> tuple[ComponentMap, str]:
    """The component map a change is judged by, and the rev it was read at: `base`'s, or `head`'s when the map
    does not exist at base yet (the change introducing it)."""
    for rev in (base, head):
        text = show(repo, rev, MAP)
        if text is not None:
            return ComponentMap.parse(text), rev
    raise RuntimeError(f"{MAP} exists at neither {base} nor {head}")


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
            out.append(f"component map: none at {self.base}; judged by {MAP} at {self.map_rev} (introduced here)")
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


def classify(path: str, cmap: ComponentMap, touches: list[dict], is_new, proposal: str | None) -> Finding:
    """One changed path -> a Finding. `is_new(root)` says whether an extension root is absent at base."""
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
    map_rev = base
    if cmap is None:
        cmap, map_rev = map_at(repo, base, head)
    touches = [t for t in touches or [] if not t.get("planned")]     # planned entries authorize nothing yet
    at_base: set[str] = set()
    for f in _git(repo, "-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", "-z", base).split("\0"):
        parts = f.split("/")
        at_base.update("/".join(parts[:i]).casefold() for i in range(1, len(parts) + 1) if f)

    def is_new(root: str) -> bool:
        """An extension root is new when no path at base matches it, ignoring case (F-4: `modes/Mail/` next to
        `modes/mail/` is an edit of mail on a case-insensitive filesystem, not a new mode)."""
        return root.rstrip("/").casefold() not in at_base

    rep = Report(base, head, proposal, map_rev=map_rev)
    rep.findings = [classify(p, cmap, touches, is_new, proposal) for p in changed(repo, base, head)]
    if docs:
        rep.docs_checked = True
        tree = _git(repo, "ls-tree", "-r", "--name-only", head).splitlines()
        texts = {d: _git(repo, "show", f"{head}:{d}") for d in DOCS if d in tree}
        rep.doc_hits = doc_hits(texts, instance_names(tree, cmap))
    return rep
