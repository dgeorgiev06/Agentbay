"""No core file names a content type or a connector (proposal 0006 B-1/B-7 and 0008 slice 5).

Core = bay/, framework/ (its modes own no content type), schemas/, adapters/ and coordinator/ (python, json and
yaml files; folders named tests and fixtures are skipped). The names are found, not listed: the folders of
content-types/ (and each type's `kind` and view names), the view names of modes/*/views.yaml, and the folders of
connectors/.

What counts as naming (identifiers and string literals only, never prose):
  * an identifier (variable, attribute, function, class, keyword, parameter, dict key) one of whose snake_case or
    camelCase segments is a content type name (`post_rows`, `emailView`), or that is a connector name;
  * a string without whitespace that has a content type name as a segment or a connector name as a token
    (`"post"`, `"email/v1"`, `"x-api"`, `"fake:7"`);
  * in any string, even a sentence: a ref `<type>/v<N>`, a view name of a type or of a mode (`v_posts`,
    `v_threads`), or a type or connector name in quotes or backticks (`'email'`, "`post`").
A sentence that merely uses the English word (`steps post interim results`, `the email address`) is not a hit.

Exceptions are ALLOWED below: the exact (file, name, place) with the reason it is not a content-type reference.
The place is the identifier, the Python expression that holds the string (`au.get('email')`) or the key path in a
data file, so a new `kind == "email"` in an allowlisted file is still a hit.
An entry that no longer matches fails the test, so the list only shrinks."""
from __future__ import annotations

import ast
import json
import re

import yaml
from helpers import KIT

from bay import contenttypes

CORE = ("bay", "framework", "schemas", "adapters", "coordinator")
SKIP = {"tests", "fixtures", "__pycache__"}
SUFFIXES = {".py", ".json", ".yaml", ".yml"}

ALLOWED = {
    ("bay/selector.py", "email", "au.get('email')"):
        "the `email` field of an item/v1 author ({handle, name, email}); a field of the base record, not a content type",
    ("framework/connectors/corpus-store/corpus_store.py", "email", "au.get('email')"):
        "the same item/v1 author field, read when a row is stored",
    ("framework/connectors/corpus-store/corpus_store.py", "email", "'email' not in author"):
        "the same author field, checked when a handle holds an address",
    ("framework/connectors/corpus-store/corpus_store.py", "email", "{'email': author.pop('handle'), **author}"):
        "the same author field, written when a handle holds an address",
    ("schemas/data/item.v1.schema.json", "email", "/properties/author/properties: email"):
        "the item/v1 author's `email` property, the base record every type extends",
    ("adapters/claude-code/claude_code.py", "post", "('PostToolUse', 'post')"):
        "Claude Code's PostToolUse hook event and its `post` phase, not a content type",
    ("adapters/claude-code/claude_code.py", "post", "post"):
        "a local variable: the text after the generated block's end marker",
    ("adapters/claude-code/claude_code.py", "post", "('PreToolUse', 'PostToolUse')"):
        "Claude Code's hook event names, not a content type",
}


def names(root=KIT) -> tuple[set[str], set[str], set[str]]:
    """(content type names and kinds, view names of types and modes, connector names)."""
    types, _ = contenttypes.scan(root)
    kinds = set(types) | {t.kind for t in types.values()}
    views = {v for t in types.values() for v in t.docs}
    for f in root.glob("modes/*/views.yaml"):
        views |= set((yaml.safe_load(f.read_text()) or {}).get("views") or {})
    conns = {d.name for d in (root / "connectors").iterdir() if d.is_dir()}
    return kinds, views, conns


def segments(s: str) -> set[str]:
    return {p.lower() for p in re.split(r"[^A-Za-z0-9]+", re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", s)) if p}


def in_literal(kinds, views, conns, s: str) -> list[str]:
    """The names a string literal (or dict key) refers to, by the rules in the module docstring."""
    found = []
    word = not re.search(r"\s", s)
    for n in kinds:
        if (word and n in segments(s)) or re.search(rf"(?<![\w]){re.escape(n)}/v\d+|(?<!\w)([\"'`]){re.escape(n)}\1", s):
            found.append(n)
    for v in views:
        if re.search(rf"(?<![\w]){re.escape(v)}(?![\w])", s):
            found.append(v)
    for c in conns:
        quoted = re.search(rf"(?<!\w)([\"'`]){re.escape(c)}\1", s)
        if (word and re.search(rf"(?<![\w-]){re.escape(c)}(?![\w-])", s)) or quoted:
            found.append(c)
    return found


def in_identifier(kinds, conns, ident: str) -> list[str]:
    return [n for n in kinds if n in segments(ident)] + [c for c in conns if ident == c]


def python_hits(src: str, kinds, views, conns):
    """(name, what) pairs; `what` is the identifier, or for a string the expression that holds it (its parent
    node, e.g. `au.get('email')`), so an ALLOWED entry covers that expression and not the literal everywhere."""
    tree = ast.parse(src)
    parent = {c: n for n in ast.walk(tree) for c in ast.iter_child_nodes(n)}
    for node in ast.walk(tree):
        idents = []
        if isinstance(node, ast.Name):
            idents = [node.id]
        elif isinstance(node, ast.Attribute):
            idents = [node.attr]
        elif isinstance(node, ast.arg):
            idents = [node.arg]
        elif isinstance(node, ast.keyword) and node.arg:
            idents = [node.arg]
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            idents = [node.name]
        elif isinstance(node, ast.alias):
            idents = [node.name, node.asname or ""]
        for i in idents:
            for n in in_identifier(kinds, conns, i):
                yield n, i
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            for n in in_literal(kinds, views, conns, node.value):
                yield n, ast.unparse(parent.get(node, node))[:120]


def data_hits(doc, kinds, views, conns, path=""):
    """(name, what) pairs; `what` is the key path to the string plus the string, so an ALLOWED entry covers
    that place in the file and not the word everywhere."""
    if isinstance(doc, dict):
        for k, v in doc.items():
            yield from data_hits(k, kinds, views, conns, path)
            yield from data_hits(v, kinds, views, conns, f"{path}/{k}")
    elif isinstance(doc, list):
        for v in doc:
            yield from data_hits(v, kinds, views, conns, path)
    elif isinstance(doc, str):
        for n in in_literal(kinds, views, conns, doc):
            yield n, f"{path}: {doc[:60]}"


def core_files(root=KIT):
    for top in CORE:
        base = root / top
        if base.is_dir():
            for f in sorted(base.rglob("*")):
                if f.is_file() and f.suffix in SUFFIXES and not SKIP & set(f.relative_to(root).parts):
                    yield f


def scan(root=KIT) -> set[tuple[str, str, str]]:
    kinds, views, conns = names(root)
    out = set()
    for f in core_files(root):
        rel = str(f.relative_to(root))
        text = f.read_text()
        if f.suffix == ".py":
            hits = python_hits(text, kinds, views, conns)
        else:
            try:
                doc = json.loads(text) if f.suffix == ".json" else yaml.safe_load(text)
            except yaml.YAMLError:                  # a template with {{placeholders}}: read it line by line
                doc = text.splitlines()
            hits = data_hits(doc, kinds, views, conns)
        out |= {(rel, n, lit) for n, lit in hits}
    return out


def test_names_are_found_not_listed():
    kinds, views, conns = names()
    assert {"post", "email"} <= kinds and {"v_posts", "v_email", "v_threads"} <= views
    assert {"x-api", "gmail-api", "fake-mail", "fake"} <= conns


def test_no_core_file_names_a_content_type_or_a_connector():
    got = scan()
    unexplained = sorted(h for h in got if h not in ALLOWED)
    assert not unexplained, "core names a content type or connector: " + "; ".join(map(str, unexplained))
    stale = sorted(set(ALLOWED) - got)
    assert not stale, f"ALLOWED entries that no longer match anything (delete them): {stale}"
    assert all(ALLOWED.values())


def test_the_rule_counts_identifiers_and_literals_but_not_prose():
    kinds, views, conns = {"post", "email"}, {"v_posts"}, {"x-api", "fake"}
    hit = lambda s: in_literal(kinds, views, conns, s)          # noqa: E731
    for s in ("post", "email/v1", "x-api", "fake:7", "v_posts", "SELECT 1 FROM v_posts", "kind = 'email'", "see `post`"):
        assert hit(s), s
    for s in ("steps post interim results", "the email address of the sender", "a fake name here", "postmaster"):
        assert not hit(s), s
    assert in_identifier(kinds, conns, "post_rows") == ["post"] and in_identifier(kinds, conns, "emailView") == ["email"]
    assert in_identifier(kinds, conns, "postprocess") == [] and in_identifier(kinds, conns, "fake") == ["fake"]
    assert list(python_hits("def post_rows(item):\n    return item['kind'] == 'post'\n", kinds, views, conns)) == \
        [("post", "post_rows"), ("post", "item['kind'] == 'post'")]
