"""`bay check --base` (proposal 0006, Part F: B-1, B-2, B-3, B-11), the component map and proposal front matter."""
from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

from helpers import KIT, tmpdir
from bay import boundary, lint, model, proposal

MAP = {"components": {
    "kernel": {"owns": ["bay/", "schemas/"],
               "contracts": {"mode": {"at": ["modes/<name>/"]}, "env": {"at": ["envs/<name>.yaml"]},
                             "connector": {"at": ["connectors/<name>/"]}}},
    "briefing": {"owns": ["bay/selector.py", "modes/briefing/"],
                 "contracts": {"contentType": {"at": ["content-types/<name>/"]}}}}}

BASE_FILES = {
    "framework/components.yaml": yaml.safe_dump(MAP),
    "bay/cli.py": "x\n", "bay/selector.py": "x\n", "schemas/a.json": "{}\n",
    "modes/briefing/mode.yaml": "x\n",
    "modes/mail/mode.yaml": "x\n", "modes/mail/features/digest/playbook.md": "x\n",
    "modes/mail/features/ask/playbook.md": "x\n",
    "connectors/gmail/connector.yaml": "x\n", "envs/local.yaml": "x\n",
    "README.md": "# kit\n", "tests/test_x.py": "x\n",
}


MAP_PATH = "framework/components.yaml"


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *args],
                          check=True, capture_output=True, text=True).stdout


def _repo(change: dict[str, str], moves: tuple = ()) -> Path:
    repo = tmpdir()
    _git(repo, "init", "-q", "-b", "main")
    for i, files in enumerate((BASE_FILES, change)):
        for p, text in files.items():
            (repo / p).parent.mkdir(parents=True, exist_ok=True)
            (repo / p).write_text(text)
        if i:
            for old, new in moves:
                (repo / new).parent.mkdir(parents=True, exist_ok=True)
                _git(repo, "mv", old, new)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "--allow-empty", "-m", "c")
    return repo


def _check(change, touches=(), docs=False, prop=None):
    repo = _repo(change)
    return boundary.check(repo, "HEAD~1", "HEAD", prop, [{"path": t, "reason": "r"} for t in touches], docs=docs)


def _failing(rep) -> list[str]:
    return [f.path for f in rep.failures]


def test_core_edit_fails_without_touches_and_passes_with():
    rep = _check({"bay/cli.py": "y\n", "bay/selector.py": "y\n"})
    assert _failing(rep) == ["bay/cli.py", "bay/selector.py"] and rep.exit_code == 1
    assert {f.owner for f in rep.failures} == {"kernel", "briefing"}       # most specific owns: wins
    line = rep.lines()[0]
    assert line.startswith("bay/cli.py: kernel - core path owned by kernel (B-1) - add it to touches: in")
    rep = _check({"bay/cli.py": "y\n", "bay/selector.py": "y\n"}, touches=["bay/*.py"])
    assert _failing(rep) == [] and rep.exit_code == 0


def test_moves_and_deletions_are_classified_on_both_sides():
    """F-1: a rename is a deletion plus an addition, whatever the user's git config says about renames."""
    repo = _repo({}, moves=(("bay/cli.py", "tests/cli.py"),))
    _git(repo, "config", "diff.renames", "copies")
    _git(repo, "config", "diff.relative", "true")
    rep = boundary.check(repo, "HEAD~1", "HEAD", None, [])
    assert _failing(rep) == ["bay/cli.py"] and rep.failures[0].rule == "B-1"
    repo = _repo({}, moves=(("modes/mail", "modes/post"),))
    rep = boundary.check(repo, "HEAD~1", "HEAD", None, [])
    assert set(_failing(rep)) == {"modes/mail/mode.yaml", "modes/mail/features/digest/playbook.md",
                                  "modes/mail/features/ask/playbook.md"}
    assert {f.rule for f in rep.failures} <= {"B-2", "B-3"}
    _r = _repo({})
    _git(_r, "rm", "-q", "connectors/gmail/connector.yaml")
    _git(_r, "commit", "-q", "-m", "d")
    rep = boundary.check(_r, "HEAD~1", "HEAD", None, [])
    assert _failing(rep) == ["connectors/gmail/connector.yaml"] and rep.failures[0].rule == "B-2"


def test_case_only_new_folder_is_not_a_new_extension():
    """F-4: `modes/Mail/` beside `modes/mail/` is the same folder on a case-insensitive filesystem."""
    rep = _check({"modes/Mail/features/x/playbook.md": "y\n", "connectors/GMAIL/connector.yaml": "y\n"})
    assert set(_failing(rep)) == {"modes/Mail/features/x/playbook.md", "connectors/GMAIL/connector.yaml"}
    assert not _failing(_check({"modes/post/mode.yaml": "y\n"}))


def test_lint_rejects_case_collisions_and_extension_folders_without_manifest():
    from types import SimpleNamespace
    repo = _repo({"modes/Mail/x.md": "y\n", "connectors/rss/feed.py": "y\n"})
    errs = lint.lint_case_and_manifests(SimpleNamespace(root=repo))
    assert any("differs only in case" in e and "modes/Mail" in e and "modes/mail" in e for e in errs), errs
    assert any(e.startswith("connectors/rss/: extension folder without its manifest connector.yaml") for e in errs)
    assert not lint.lint_case_and_manifests(SimpleNamespace(root=_repo({})))


def test_planned_touches_authorize_nothing_f10():
    repo = _repo({"bay/cli.py": "y\n"})
    planned = [{"path": "bay/", "reason": "r", "slice": 9, "planned": True}]
    assert _failing(boundary.check(repo, "HEAD~1", "HEAD", None, planned)) == ["bay/cli.py"]
    assert not _failing(boundary.check(repo, "HEAD~1", "HEAD", None, [{**planned[0], "planned": False}]))


def test_new_extension_folder_passes():
    rep = _check({"connectors/x-api/connector.yaml": "x\n", "modes/feed/mode.yaml": "x\n",
                  "modes/feed/features/digest/playbook.md": "x\n", "envs/new.yaml": "x\n",
                  "content-types/post/type.yaml": "x\n", "tests/test_y.py": "x\n"})
    assert _failing(rep) == [] and rep.exit_code == 0
    assert {f.cls for f in rep.findings} == {"extension", "other"}


def test_existing_extension_edit_fails_unless_listed():
    rep = _check({"connectors/gmail/connector.yaml": "y\n", "envs/local.yaml": "y\n"})
    assert _failing(rep) == ["connectors/gmail/connector.yaml", "envs/local.yaml"]
    assert all(f.rule == "B-2" for f in rep.failures)
    rep = _check({"connectors/gmail/connector.yaml": "y\n", "envs/local.yaml": "y\n"},
                 touches=["connectors/gmail/", "envs/local.yaml"])
    assert _failing(rep) == []


def test_feature_folder_in_existing_mode_needs_its_own_listing():
    change = {"modes/mail/features/digest/playbook.md": "y\n", "modes/mail/mode.yaml": "y\n"}
    rep = _check(change)
    assert {f.path: f.rule for f in rep.failures} == {"modes/mail/features/digest/playbook.md": "B-3",
                                                     "modes/mail/mode.yaml": "B-3"}
    # a whole-mode entry covers mode-wide files but not a feature folder
    rep = _check(change, touches=["modes/mail/"])
    assert _failing(rep) == ["modes/mail/features/digest/playbook.md"]
    assert "list modes/mail/features/digest/" in rep.failures[0].why
    rep = _check(change, touches=["modes/mail/mode.yaml", "modes/mail/features/digest/"])
    assert _failing(rep) == []
    # another feature stays unlisted
    rep = _check({"modes/mail/features/ask/playbook.md": "y\n"}, touches=["modes/mail/features/digest/"])
    assert _failing(rep) == ["modes/mail/features/ask/playbook.md"]


def test_feature_folder_in_new_mode_passes():
    rep = _check({"modes/news/mode.yaml": "x\n", "modes/news/features/digest/playbook.md": "x\n"})
    assert _failing(rep) == []


def test_docs_and_unowned_paths():
    rep = _check({"README.md": "# kit\nnew\n", "tools/x.sh": "x\n", "docs/proposals/0009.md": "p\n"},
                 prop="docs/proposals/0009.md")
    assert {f.path: f.rule for f in rep.failures} == {"README.md": "docs", "tools/x.sh": "unowned"}
    assert rep.lines()[0].endswith("add it to touches: in docs/proposals/0009.md or move the change")
    rep = _check({"README.md": "# kit\nnew\n", "tools/x.sh": "x\n"}, touches=["README.md", "tools/**"])
    assert _failing(rep) == []


def test_repo_root_files_pass_but_a_core_edit_does_not_and_the_kernel_owns_the_changelog():
    """0008 item 1: a stray TODO.md is not framework code; an owned path still needs touches."""
    rep = _check({"TODO.md": "x\n", "notes.txt": "x\n", ".env.example": "x\n"})
    assert _failing(rep) == [] and rep.exit_code == 0
    rep = _check({"TODO.md": "x\n", "notes.txt": "x\n", "bay/cli.py": "y\n"})
    assert _failing(rep) == ["bay/cli.py"]
    shipped = boundary.ComponentMap.load(KIT / "framework/components.yaml")
    assert shipped.owner("CHANGELOG.md") == "kernel"
    assert not any(f.ok is False for f in [boundary.classify("TODO.md", shipped, [], lambda r: False, None)])
    f = boundary.classify("CHANGELOG.md", shipped, [], lambda r: False, None)
    assert not f.ok and f.rule == "B-1"


def test_docs_check_names_instances_outside_fences_and_fails():
    readme = "# kit\nUse the gmail connector.\n```\nmodes/mail/ and local\n```\nSee git.read/v1 and mailbox.\n"
    rep = _check({"README.md": readme}, touches=["README.md"], docs=True)
    assert [(h["file"], h["line"], h["name"]) for h in rep.doc_hits] == [("README.md", 2, "gmail")]
    assert rep.exit_code == 1 and "README.md:2: names extension connector 'gmail'" in rep.lines()[0]
    assert "B-11 docs: 1 hits" in rep.summary() and not rep.failures
    clean = _check({"README.md": "# kit\nUse a connector.\n```\ngmail\n```\n"}, touches=["README.md"], docs=True)
    assert clean.doc_hits == [] and clean.exit_code == 0
    texts = {"docs/DESIGN.md": "a `modes/news/` b\n~~~\nnews\n~~~\n"}
    assert [h["line"] for h in boundary.doc_hits(texts, {"news": "mode"})] == [1]


def test_docs_check_fences_follow_commonmark_and_names_ignore_case():
    """F-5: a ``` line inside a ~~~ block does not close it (nor does a shorter fence), so text after the real
    close is checked; names match in any case."""
    names = {"news": "mode"}
    t = "~~~\n```\n~~~\nnews here\n"                       # ``` inside ~~~ must not toggle
    assert [h["line"] for h in boundary.doc_hits({"d": t}, names)] == [4]
    t = "````\nnews\n```\nstill fenced news\n````\nnews after\n"   # shorter fence does not close
    assert [h["line"] for h in boundary.doc_hits({"d": t}, names)] == [6]
    t = "```\nnews\n``` not a close\n```\nNEWS\n"
    assert [h["line"] for h in boundary.doc_hits({"d": t}, names)] == [5]


def test_glob_matching():
    m = boundary.match
    assert m("bay/", "bay/x/y.py") and not m("bay/", "bayx/y.py")
    assert m("bay/*.py", "bay/cli.py") and not m("bay/*.py", "bay/adapters/base.py")
    assert m("bay/**/*.py", "bay/adapters/base.py") and m("bay/**/*.py", "bay/cli.py")
    assert m("interfaces/items.*", "interfaces/items.source.v1.yaml") and not m("interfaces/items.*", "interfaces/x.yaml")
    assert m("modes/*/features/digest/", "modes/mail/features/digest/playbook.md")
    assert m("./README.md", "README.md") and m("bay/cl?.py", "bay/cli.py")
    assert boundary.literal_prefix("modes/mail/features/*/") == "modes/mail/features/"


def test_front_matter_parser():
    text = "---\ntouches:\n  - { path: bay/, reason: why }\n  - { path: x/, reason: later, slice: 2, planned: true }\n---\n# T\n"
    t = proposal.touches(text)
    assert [e["path"] for e in t] == ["bay/", "x/"] and t[1]["planned"] is True
    assert proposal.touches("# no front matter\n") == []
    assert proposal.touches("---\ntouches: []\n---\n") == []
    for bad in ("---\ntouches: [{path: bay/}]\n---\n", "---\ntouches: bay/\n---\n", "---\ntouches: []\n"):
        try:
            proposal.touches(bad)
        except proposal.ProposalError:
            continue
        raise AssertionError(f"accepted: {bad!r}")


SLICES_BUILT = {1, 2, 3, 7}   # step-1 slices (some or all of them) landed on this branch (HANDOFF.md)


def test_proposal_0006_declares_its_crossings():
    t = proposal.load_touches(KIT / "docs/proposals/0006-component-contracts-and-content-types.md")
    paths = {e["path"] for e in t}
    assert {"bay/boundary.py", "bay/proposal.py", "framework/components.yaml"} <= paths
    assert all(e.get("planned") for e in t if e.get("slice", 1) not in SLICES_BUILT)   # other slices are not built yet


def test_shipped_component_map_is_valid_and_lint_checks_it():
    doc = model.load_yaml(KIT / "framework/components.yaml")
    assert model.schema_errors(doc, model.schema("components")) == []
    cmap = boundary.ComponentMap.load(KIT / "framework/components.yaml")
    assert cmap.owner("bay/selector.py") == "briefing" and cmap.owner("bay/cli.py") == "kernel"
    assert cmap.extension("modes/forge/mode.yaml")[1] == "modes/forge/"
    assert cmap.extension("framework/modes/forge/mode.yaml") is None       # no second place for an instance
    kit = model.Kit(KIT)
    assert lint.lint_components(kit) == []
    bad = tmpdir()
    (bad / "framework").mkdir()
    (bad / "framework/components.yaml").write_text(yaml.safe_dump(
        {"components": {"kernel": {"owns": ["nowhere/"], "contracts": {"mode": {"at": ["modes/"]}}}}}))
    kit.root = bad
    errs = lint.lint_components(kit)
    assert len(errs) == 1 and "components schema" in errs[0]
    (bad / "framework/components.yaml").write_text(yaml.safe_dump({"components": {"kernel": {"owns": ["nowhere/"]}}}))
    errs = lint.lint_components(kit)
    assert len(errs) == 1 and "owns 'nowhere/'" in errs[0]


def test_ownership_lint_names_stray_tracked_files_b4():
    repo = _repo({"TODO.md": "x\n", "notes.txt": "x\n", "tools/x.sh": "x\n", "framework/stray.yaml": "x\n",
                  "docs/DESIGN.md": "x\n", "adapters/claude-code/adapter.yaml": "x\n"})
    (repo / "untracked.txt").write_text("x\n")                 # only tracked files count
    assert boundary.stray(["bay/cli.py", "modes/mail/mode.yaml", "tests/test_x.py", "README.md", "notes.txt",
                           "TODO.md", "tools/x.sh"],
                          boundary.ComponentMap.load(repo / "framework/components.yaml")) == ["tools/x.sh"]
    kit = model.Kit(KIT)
    kit.root = repo
    errs = lint.lint_ownership(kit)
    assert [e.split(":", 1)[0] for e in errs] == ["adapters/claude-code/adapter.yaml", "framework/components.yaml",
                                                  "framework/stray.yaml", "tools/x.sh"]   # MAP owns neither
    assert "(B-4)" in errs[0] and "framework/components.yaml" in errs[0]
    kit.root = tmpdir()                                            # not a git checkout: nothing to check
    assert lint.lint_ownership(kit) == []
    kit.root = KIT
    assert lint.lint_ownership(kit) == []                          # the shipped kit has no stray file


def test_a_change_to_the_component_map_is_judged_by_the_base_map_f14():
    new_map = {"components": {**MAP["components"],
                              "plugins": {"owns": ["plugins/core.py"],
                                          "contracts": {"plugin": {"at": ["plugins/<name>/"]}}}}}
    change = {"framework/components.yaml": yaml.safe_dump(new_map), "plugins/p/x.py": "x\n",
              ".github/workflows/ci.yml": "on: push\n"}
    rep = _check(change, touches=["framework/components.yaml"])
    assert _failing(rep) == [".github/workflows/ci.yml", "plugins/p/x.py"]      # head's map would pass plugins/p/
    assert {f.cls for f in rep.failures} == {"unowned"} and rep.map_rev == "HEAD~1"
    assert not any(ln.startswith("component map:") for ln in rep.lines())
    rep = _check(change, touches=["framework/components.yaml", "plugins/p/", ".github/"])
    assert not _failing(rep)


def test_a_map_introduced_by_the_change_judges_that_change_and_says_so_f14():
    repo = tmpdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / "README.md").write_text("# kit\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "c")
    (repo / "framework").mkdir()
    (repo / "framework/components.yaml").write_text(yaml.safe_dump(MAP))
    (repo / "bay").mkdir()
    (repo / "bay/cli.py").write_text("x\n")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "c")
    rep = boundary.check(repo, "HEAD~1", "HEAD", None, [])
    assert rep.map_rev == "HEAD" and "bay/cli.py" in _failing(rep)
    assert ("component map: none at HEAD~1; judged by framework/components.yaml at HEAD (introduced here; every "
            "changed path outside other must be in touches:)") in rep.lines()


def _commit(repo: Path, files: dict[str, str | None]) -> None:
    for p, text in files.items():
        if text is None:
            _git(repo, "rm", "-q", "-r", p)
            continue
        (repo / p).parent.mkdir(parents=True, exist_ok=True)
        (repo / p).write_text(text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "--allow-empty", "-m", "c")


def test_a_map_introduced_by_the_change_gives_no_new_extension_pass_n1():
    # the reviewer's backdoor: base has no map; the change adds one that makes bay/<name> an extension folder
    evil = {"components": {"kernel": {"owns": ["bay/cli.py"],
                                      "contracts": {"mode": {"at": ["modes/<name>/"]},
                                                    "adapter": {"at": ["adapters/<name>/", "bay/<name>"]}}}}}
    repo = tmpdir()
    _git(repo, "init", "-q", "-b", "main")
    _commit(repo, {"README.md": "# kit\n", "modes/mail/mode.yaml": "x\n",
                   "modes/mail/features/digest/playbook.md": "x\n"})
    _commit(repo, {MAP_PATH: yaml.safe_dump(evil), "bay/backdoor.py": "# evil\n", "modes/new/mode.yaml": "x\n",
                   "modes/mail/features/digest/playbook.md": "y\n", "tests/test_y.py": "x\n"})
    rep = boundary.check(repo, "HEAD~1", "HEAD", None, [])
    assert rep.map_rev == "HEAD" and rep.exit_code == 1
    assert _failing(rep) == ["bay/backdoor.py", MAP_PATH, "modes/mail/features/digest/playbook.md",
                             "modes/new/mode.yaml"]                       # no new-extension pass; tests/ is other
    assert "no new-extension pass" in next(f.why for f in rep.failures if f.path == "bay/backdoor.py")
    ok = [{"path": t} for t in (MAP_PATH, "bay/backdoor.py", "modes/mail/features/digest/", "modes/new/")]
    assert not _failing(boundary.check(repo, "HEAD~1", "HEAD", None, ok))


def test_a_base_without_a_map_fails_unless_the_change_adds_it_n1():
    repo = tmpdir()
    _git(repo, "init", "-q", "-b", "main")
    _commit(repo, {"README.md": "# kit\n"})
    _commit(repo, {"bay/backdoor.py": "# evil\n"})
    try:
        boundary.check(repo, "HEAD~1", "HEAD", None, [])
        raise AssertionError("judged without a component map")
    except RuntimeError as e:
        assert "does not exist at HEAD~1" in str(e) and "this change does not add it" in str(e)
    # a map that only exists on base's side after the fork is not the change adding it
    _git(repo, "checkout", "-q", "-b", "pr", "HEAD")
    _git(repo, "checkout", "-q", "main")
    _commit(repo, {MAP_PATH: yaml.safe_dump(MAP)})
    _git(repo, "checkout", "-q", "pr")
    _commit(repo, {"bay/cli.py": "x\n"})
    try:
        boundary.check(repo, "main", "pr", None, [])
        raise AssertionError("judged without the merge-base's component map")
    except RuntimeError as e:
        assert "does not exist at main" in str(e)


def test_new_and_the_map_are_decided_at_the_merge_base_n2():
    # the reviewer's stale fork: main deletes a mode (and drops bay/ from kernel owns) after pr forked; pr edits it
    repo = _repo({})
    _git(repo, "checkout", "-q", "-b", "pr")
    _git(repo, "checkout", "-q", "main")
    loose = {"components": {"kernel": {"owns": ["schemas/"], "contracts": MAP["components"]["kernel"]["contracts"]}}}
    _commit(repo, {"modes/mail": None, MAP_PATH: yaml.safe_dump(loose)})
    _git(repo, "checkout", "-q", "pr")
    _commit(repo, {"modes/mail/mode.yaml": "y\n", "bay/cli.py": "y\n"})
    rep = boundary.check(repo, "main", "pr", None, [])
    assert _failing(rep) == ["bay/cli.py", "modes/mail/mode.yaml"]     # existing at the fork, core in its map
    assert {f.rule for f in rep.failures} == {"B-1", "B-3"} and rep.map_rev == "main"


def test_a_malformed_component_map_is_a_one_line_error_n3():
    for text, want in (("components: [unclosed\n", "not valid YAML"), ("- a\n", "must be a mapping"),
                       ("components: [a]\n", "components: must map")):
        try:
            boundary.ComponentMap.parse(text)
            raise AssertionError(f"parsed {text!r}")
        except RuntimeError as e:
            assert want in str(e) and "\n" not in str(e), str(e)
        repo = _repo({})
        _commit(repo, {MAP_PATH: text})
        _commit(repo, {"bay/cli.py": "z\n"})
        try:
            boundary.check(repo, "HEAD~1", "HEAD", None, [])
            raise AssertionError("checked against a malformed map")
        except RuntimeError as e:
            assert want in str(e)


def test_only_committed_touches_count_f14():
    prop = "docs/proposals/0099-x.md"
    repo = _repo({"bay/cli.py": "y\n", prop: "---\ntouches: []\n---\n# x\n"})
    (repo / prop).write_text("---\ntouches:\n  - { path: bay/cli.py, reason: r }\n---\n# x\n")   # not committed
    t = boundary.proposal_touches(repo, "HEAD", prop)
    assert t == [] and _failing(boundary.check(repo, "HEAD~1", "HEAD", prop, t)) == ["bay/cli.py"]
    _git(repo, "commit", "-q", "-am", "c")
    t = boundary.proposal_touches(repo, "HEAD", prop)
    assert not _failing(boundary.check(repo, "HEAD~2", "HEAD", prop, t))
    try:
        boundary.proposal_touches(repo, "HEAD", "docs/proposals/0100-uncommitted.md")
        raise AssertionError("an uncommitted proposal was read")
    except RuntimeError as e:
        assert "is not committed at HEAD" in str(e)
