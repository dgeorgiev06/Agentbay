"""agentbay.config.yaml: no committed example (`bay build` writes a minimal one, `bay config` prints every setting
from the schemas), the offline switch lives in the env, and a setting can lower a cap but never raise the env's limit."""
import subprocess
import sys

import yaml

from helpers import KIT, cleanup, kit_copy, project, tmpdir

from bay import config, lint, model


def test_no_committed_example_and_no_offline_env_copies():
    assert not (KIT / "agentbay.config.example.yaml").exists()
    assert not (KIT / "envs/local-feeds-offline.yaml").exists() and not (KIT / "envs/local-mail-offline.yaml").exists()
    for name in ("local-feeds", "local-mail"):
        assert "bind" in model.Kit(KIT).get("Environment", name).spec["offline"]


def test_config_prints_every_setting_from_the_schemas():
    text = config.describe(model.Kit(KIT, None))
    assert "offline: boolean (default false)" in text and "agent: string" in text and "secrets: object" in text
    assert "modes.feed-briefing:\n  lookback: string (default \"3d\")" in text and "  spendUsd: number" in text
    assert "modes.mail-briefing:" in text and "  important: array" in text and "modes.briefing:" not in text  # abstract
    assert "connectors.x-api:\n  userId: string" in text and "connectors.fake:" in text
    assert "envs:" not in text
    r = subprocess.run([sys.executable, "-m", "bay.cli", "config"], cwd=KIT, text=True, capture_output=True)
    assert r.returncode == 0 and r.stdout == text


def test_build_writes_a_minimal_config_and_keeps_an_existing_one():
    p = tmpdir() / "proj"
    p.mkdir()
    assert config.write_minimal(p) is True
    assert yaml.safe_load((p / config.NAME).read_text()) == {"apiVersion": "agentbay/v2"}
    assert not config.load(p).get("offline")
    (p / config.NAME).write_text("apiVersion: agentbay/v2\noffline: true\n")
    assert config.write_minimal(p) is False and config.load(p) == {"apiVersion": "agentbay/v2", "offline": True}
    q = tmpdir() / "proj"
    q.mkdir()
    r = subprocess.run([sys.executable, "-m", "bay.cli", "--project", str(q), "build"], cwd=KIT, text=True,
                       capture_output=True)
    assert r.returncode == 0 and f"+ {config.NAME}" in r.stdout and (q / config.NAME).read_text() == config.MINIMAL
    again = subprocess.run([sys.executable, "-m", "bay.cli", "--project", str(q), "build"], cwd=KIT, text=True,
                           capture_output=True)
    assert again.returncode == 0 and f"+ {config.NAME}" not in again.stdout


def test_caps_take_the_strictest_and_refuse_a_setting_above_the_env_limit():
    limits = {"spendUsd": 5, "monthlyItems": 3000, "maxItemsPerRun": 500}
    settings = {"spendUsd": 1, "maxItemsPerRun": 200}
    merged = config.effective_constraints({"maxItemsPerRun": 300, "spendUsd": 5}, settings)   # the mode's constraints
    got = config.caps(merged, limits, settings)
    assert (got["spendUsd"], got["maxItemsPerRun"], got["monthlyItems"]) == (1, 200, 3000)
    assert config.caps({}, {}, {"spendUsd": 99})["costPerPostUsd"] == config.COST_PER_POST_USD   # no env limit: no ceiling
    try:
        config.caps({}, limits, {"spendUsd": 6})
        raise AssertionError("expected ConfigError")
    except config.ConfigError as e:
        assert "spendUsd 6 raises the env limit 5" in str(e)


def test_a_call_with_a_raised_cap_fails_the_step_and_does_not_run_the_connector():
    from helpers import clock, system
    from bay import dispatch
    p = project({"modes": {"feed-briefing": {"spendUsd": 99}}})
    r = dispatch.Dispatcher(system(p), p, clock=clock).call("feed-briefing.sync", {})
    assert r["status"] == "failed" and "spendUsd 99 raises the env limit 5" in r["error"]
    assert not (p / ".agentbay/data/feeds/feed-briefing/corpus.db").exists()


def test_lint_reports_a_missing_readme_and_a_bad_fragment():
    k = kit_copy()
    try:
        assert not [e for e in lint.lint_self_description(model.Kit(k, None))]
        frag = k / "connectors/x-api/config.example.yaml"
        frag.write_text(frag.read_text() + "maxPages: 0\n")
        (k / "connectors/fake/README.md").unlink()
        (k / "connectors/fake-mail/config.example.yaml").unlink()
        errs = lint.lint_self_description(model.Kit(k, None))
        assert any(e.startswith("connectors/fake/: connector fake has no README.md") for e in errs)
        assert any(e.startswith("connectors/fake-mail/: connector fake-mail takes settings but has no "
                                "config.example.yaml") for e in errs)
        assert any(e.startswith("connectors/x-api/config.example.yaml: maxPages") for e in errs)
    finally:
        cleanup(k)
