"""B-6 (proposal 0006, Part F): needs/implements/reads/produces are versioned and agree."""
from helpers import KIT, kit_copy

from bay import lint, model


def has(k, *needles):
    ps = lint.run(k)
    for x in ps:
        if all(n in x for n in needles):
            return x
    raise AssertionError(f"no lint problem with {needles}; got:\n  " + "\n  ".join(ps))


def sub(k, rel, old, new):
    f = k / rel
    t = f.read_text()
    assert old in t, (rel, old)
    f.write_text(t.replace(old, new, 1))


def test_shipped_modes_and_connectors_declare_versioned_kinds():
    kit = model.Kit(KIT)
    assert model.item_kinds(KIT) == {"post": {1}, "email": {1}}
    assert kit.docs["Mode"]["feed-briefing"].spec["reads"] == ["post/v1"]
    assert kit.docs["Mode"]["mail-briefing"].spec["reads"] == ["email/v1"]
    assert "reads" not in kit.docs["Mode"]["briefing"].spec            # the abstract base declares none
    for c, kind in (("x-api", "post/v1"), ("fake", "post/v1"), ("gmail-api", "email/v1"), ("fake-mail", "email/v1")):
        assert kit.docs["Connector"][c].spec["produces"] == [kind]
    assert not [p for p in lint.lint_contract_versions(kit)]


def test_unversioned_and_unknown_names_are_refused():
    k = kit_copy()
    sub(k, "modes/feed-briefing/mode.yaml", "reads: [post/v1]", "reads: [post]")
    sub(k, "connectors/gmail-api/connector.yaml", "produces: [email/v1]", "produces: [letter/v1]")
    sub(k, "connectors/fake/connector.yaml", "implements: items.source/v1", "implements: [items.source/v1, x.feed]")
    sub(k, "modes/delivery/mode.yaml", "git.read/v1,", "git.read,")
    has(k, "modes/feed-briefing/mode.yaml", "mode feed-briefing reads: 'post' is unversioned")
    has(k, "connectors/gmail-api/connector.yaml", "unknown item kind 'letter/v1'")
    has(k, "connectors/fake/connector.yaml", "implements 'x.feed', which is unversioned")
    has(k, "modes/delivery/mode.yaml", "needs 'git.read', which is unversioned")


def test_version_mismatch_and_missing_producer_are_refused():
    k = kit_copy()
    v2 = (k / "schemas/data/email.v1.schema.json").read_text().replace("email/v1", "email/v2")
    (k / "schemas/data/email.v2.schema.json").write_text(v2)
    sub(k, "connectors/fake-mail/connector.yaml", "produces: [email/v1]", "produces: [email/v2]")
    sub(k, "connectors/x-api/connector.yaml", "produces: [post/v1]", "produces: [email/v1]")
    has(k, "mode mail-briefing reads email/v1, but in env local-mail-offline fake-mail produce email/v2: "
           "version mismatch")
    has(k, "mode feed-briefing reads post/v1, but no items.source/v1 connector env local-feeds binds (x-api) "
           "produces post", "forge.connect")
    sub(k, "connectors/fake/connector.yaml", "  produces: [post/v1]\n", "")
    has(k, "connector fake implements items.source/v1 but declares no spec.produces")
    sub(k, "modes/mail-briefing/mode.yaml", "  reads: [email/v1]", "")
    has(k, "mode mail-briefing needs items.source/v1 but declares no spec.reads")


# ------------------------------------------------------------------ B-7: no extension names another
def test_no_extension_names_another_b7():
    k = kit_copy()
    assert not lint.lint_extension_names(model.Kit(KIT))                              # shipped kit: no hit
    pb = "modes/mail-briefing/features/digest/playbook.md"
    (k / pb).write_text((k / pb).read_text() + "\nThreads come from gmail-api; see also feed-briefing.\n")
    sub(k, "connectors/x-api/x_api.py", "\n", "\n# tuned for feed-briefing\nimport fake\n")
    (k / "modes/mail-briefing/README.md").write_text((k / "modes/mail-briefing/README.md").read_text()
                                                     + "\nEnv local-mail binds gmail-api.\n")       # README: exempt
    (k / "connectors/x-api/tests/test_extra.py").write_text("import fake  # tests may pick a stand-in\n")
    sub(k, "framework/modes/forge/features/create/playbook.md", "stubbed HTTP layer", "fake HTTP layer")
    ps = lint.run(k)
    hits = [p for p in ps if "B-7" in p]
    # 0008: prose that names a mode or a connector in a playbook or a comment is fine; an import is not
    assert not any(pb in p or "forge/features/create/playbook.md" in p for p in ps), ps
    assert any("x_api.py:3: connector x-api imports fake of connector fake" in p for p in hits), hits
    assert not any("x_api.py:2" in p for p in hits), hits
    assert not any("README.md" in p or "tests/" in p for p in hits), hits
    assert not any("connector ledger" in p for p in hits)


def test_b7_catches_case_module_forms_nested_tests_and_referenced_files():
    """F-6 repros: case, the module form, the kernel's sys.modules keys (also inside import_module strings),
    a tests/ folder below the extension's top level, and a file the manifest references from outside."""
    k = kit_copy()
    sub(k, "connectors/x-api/x_api.py", "\n", "\n# see Gmail-API\nimport gmail_api\n"
        "m = importlib.import_module('agentbay_connector_gmail_api')\nsys.modules['agentbay_adapter_fake_mail']\n")
    (k / "connectors/x-api/lib/tests").mkdir(parents=True)
    (k / "connectors/x-api/lib/tests/helper.py").write_text("FROM = 'fake-mail'\nimport gmail_api\n")
    (k / "shared").mkdir()
    (k / "shared/x_entry.py").write_text("# tuned for Feed-Briefing\nimport gmail_api\n")
    edit = k / "connectors/fake/connector.yaml"
    edit.write_text(edit.read_text().replace("entry: fake.py", "entry: ../../shared/x_entry.py", 1))
    hits = [p for p in lint.lint_extension_names(model.Kit(k)) if "B-7" in p]
    assert any("x_api.py:3: connector x-api imports gmail_api of connector gmail-api" in p for p in hits), hits
    assert any("x_api.py:4: connector x-api uses the module key of connector gmail-api" in p for p in hits), hits
    assert any("x_api.py:5: connector x-api uses the module key of connector fake-mail" in p for p in hits), hits
    assert any("helper.py:2: connector x-api imports gmail_api of connector gmail-api" in p for p in hits), hits
    assert any("x_entry.py:2: connector fake imports gmail_api of connector gmail-api" in p for p in hits), hits
    assert not any("x_api.py:2" in p or "helper.py:1" in p or "x_entry.py:1" in p for p in hits), hits      # prose


def test_mixed_versions_of_a_read_kind_are_refused_f7():
    """F-7: one bound connector producing the read version does not excuse another producing a different one."""
    k = kit_copy()
    v2 = (k / "schemas/data/post.v1.schema.json").read_text().replace("post/v1", "post/v2")
    (k / "schemas/data/post.v2.schema.json").write_text(v2)
    sub(k, "connectors/fake/connector.yaml", "produces: [post/v1]", "produces: [post/v2]")
    sub(k, "envs/local-feeds.yaml", "items.source/v1: [x-api]", "items.source/v1: [x-api, fake]")
    has(k, "mode feed-briefing reads post/v1, but in env local-feeds fake produce post/v2: mixed versions of post")
