"""`bay config example`: agentbay.config.example.yaml assembled from each extension's config.example.yaml (0006 Part A)."""
import subprocess
import sys

import yaml

from helpers import KIT, cleanup, kit_copy

from bay import config, lint, model


def test_the_shipped_example_is_the_assembled_one():
    assert (KIT / config.EXAMPLE).read_text() == config.example(model.Kit(KIT, None))
    r = subprocess.run([sys.executable, "-m", "bay.cli", "config", "example", "--stdout"], cwd=KIT,
                       text=True, capture_output=True)
    assert r.returncode == 0 and r.stdout == (KIT / config.EXAMPLE).read_text()


def test_fragments_indent_under_their_name_and_comment_blocks_stay_comments():
    assert config.fragment("x", "a: 1   # one\nb:\n  - 2\n") == "  x:\n    a: 1   # one\n    b:\n      - 2"
    assert config.fragment("y", "# fixture: f.json   # optional\n") == "  # y:\n  #   fixture: f.json   # optional"


def test_example_holds_every_settings_taker_and_the_offline_switch():
    cfg = yaml.safe_load((KIT / config.EXAMPLE).read_text())
    text = (KIT / config.EXAMPLE).read_text()
    assert set(cfg["modes"]) == {"feed-briefing", "mail-briefing"} and "  # improve:" in text
    assert "briefing:\n" not in text.replace("feed-briefing:", "").replace("mail-briefing:", "")   # abstract: no entry
    assert "x-api" in cfg["connectors"] and "  # gmail-api:" in text and "  # claude-transcripts:" in text
    assert cfg["envs"] == {"local-feeds": "local-feeds-offline", "local-mail": "local-mail-offline"}


def test_lint_reports_a_stale_example_a_missing_readme_and_a_bad_fragment():
    k = kit_copy()
    try:
        assert not [e for e in lint.lint_self_description(model.Kit(k, None))]
        frag = k / "connectors/x-api/config.example.yaml"
        frag.write_text(frag.read_text() + "maxPages: 0\n")
        (k / "connectors/fake/README.md").unlink()
        (k / "connectors/fake-mail/config.example.yaml").unlink()
        errs = lint.lint_self_description(model.Kit(k, None))
        assert "agentbay.config.example.yaml is stale; run bay config example" in errs
        assert any(e.startswith("connectors/fake/: connector fake has no README.md") for e in errs)
        assert any(e.startswith("connectors/fake-mail/: connector fake-mail takes settings but has no "
                                "config.example.yaml") for e in errs)
        assert any(e.startswith("connectors/x-api/config.example.yaml: maxPages") for e in errs)
    finally:
        cleanup(k)


def test_lint_fails_when_two_envs_substitute_the_same_env():
    k = kit_copy()
    try:
        assert not lint.lint_substitutes(model.Kit(k, None))
        src = (k / "envs/local-mail-offline.yaml").read_text()
        (k / "envs/local-mail-offline2.yaml").write_text(src.replace("name: local-mail-offline",
                                                                     "name: local-mail-offline2"))
        errs = lint.lint_substitutes(model.Kit(k, None))
        assert len(errs) == 1 and "local-mail-offline, local-mail-offline2" in errs[0]
        assert "substitutes: local-mail" in errs[0] and errs[0] in lint.run(k)
    finally:
        cleanup(k)
