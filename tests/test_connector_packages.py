"""A connector may be several modules: its folder is its package, so siblings import as `from . import x`."""
from helpers import cleanup, kit_copy

from bay import connect, lint, model


def load(k, name="fake"):
    return connect._load_module(model.Kit(k).get("Connector", name))


def add_siblings(k, value):
    folder = k / "components/modes/feed-briefing/connectors/fake"
    (folder / "helper.py").write_text(f"VALUE = {value}\n")
    (folder / "more.py").write_text("from . import helper\n\n\ndef twice():\n    return helper.VALUE * 2\n")
    entry = folder / "fake.py"
    entry.write_text(entry.read_text() + "\nfrom . import helper\nfrom .more import twice\n\nHELPER = helper.VALUE\n"
                     "TWICE = twice()\n")


def test_a_two_file_connector_loads_and_its_relative_imports_resolve():
    k = kit_copy()
    try:
        add_siblings(k, 7)
        mod = load(k)
        assert (mod.HELPER, mod.TWICE) == (7, 14) and hasattr(mod, "create")
        assert mod.__name__ == "agentbay_connector_fake" and mod.helper.__name__ == "agentbay_connector_fake.helper"
    finally:
        cleanup(k)


def test_a_later_load_does_not_see_the_siblings_of_an_earlier_one():
    first, second = kit_copy(), kit_copy()
    try:
        add_siblings(first, 7)
        add_siblings(second, 8)
        assert load(first).TWICE == 14
        assert load(second).TWICE == 16
        assert load(first).TWICE == 14
    finally:
        cleanup(first)
        cleanup(second)


def test_a_sibling_named_like_another_connectors_entry_is_still_caught_by_b7():
    k = kit_copy()
    try:
        assert not [p for p in lint.lint_extension_names(model.Kit(k)) if "B-7" in p]
        folder = k / "components/modes/feed-briefing/connectors/x-api"
        (folder / "fake.py").write_text("Y = 1\n")
        entry = folder / "x_api.py"
        entry.write_text(entry.read_text() + "\nfrom .fake import Y\n")
        hits = [p for p in lint.lint_extension_names(model.Kit(k)) if "B-7" in p]
        assert any("connector x-api imports .fake of connector fake" in p for p in hits), hits
        entry.write_text(entry.read_text() + "\nimport gmail_api\n")
        hits = [p for p in lint.lint_extension_names(model.Kit(k)) if "B-7" in p]
        assert any("connector x-api imports gmail_api of connector gmail-api" in p for p in hits), hits
    finally:
        cleanup(k)
