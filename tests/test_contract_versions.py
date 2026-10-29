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
