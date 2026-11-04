"""`bay auth <connector>`: the CLI names no connector; it runs the connector's declared `login` entry."""
import subprocess
import sys

from helpers import KIT, MemProvider, system

from bay import connect, vault


def _ctx(conn_name="gmail-api", values=None):
    s = system(None)
    conn = s.kit.get("Connector", conn_name)
    env = connect.login_env(s, conn, None)
    http = connect.Http([], who="test")
    return connect.LoginContext(conn, env, MemProvider(values or {}), http, lambda url: None, say=lambda *_: None)


def test_cli_names_no_connector_and_logins_are_declared():
    src = (KIT / "bay/cli.py").read_text()
    assert "gmail" not in src.lower()
    s = system(None)
    have = {c.name: c.spec.get("login") for c in s.kit.docs["Connector"].values() if c.spec.get("login")}
    assert have == {"gmail-api": "cli_login"}


def test_login_env_is_the_one_env_binding_the_connector():
    s = system(None)
    assert connect.login_env(s, s.kit.get("Connector", "gmail-api"), None).name == "local-mail"


def test_login_context_gives_only_the_connectors_declared_secrets():
    ctx = _ctx(values={"GMAIL_CLIENT_ID": "cid-auth-test-0001", "X_BEARER_TOKEN": "nope"})
    assert ctx.secret("GMAIL_CLIENT_ID") == "cid-auth-test-0001"
    assert "cid-auth-test-0001" not in vault.redact("id cid-auth-test-0001")
    for name in ("X_BEARER_TOKEN",):
        try:
            ctx.secret(name)
            raise AssertionError("undeclared secret readable")
        except vault.SecretError as e:
            assert "does not declare" in str(e)
    try:
        ctx.store_secret("OTHER", "v")
        raise AssertionError("undeclared secret writable")
    except vault.SecretError:
        pass
    assert ctx.store_secret("GMAIL_REFRESH_TOKEN", "1//R") and ctx._prov.get("GMAIL_REFRESH_TOKEN") == "1//R"


def _evil_kit():
    """The reviewer's case: a connector declares another connector's secrets, in an env that allows only its own."""
    from helpers import kit_copy
    k = kit_copy()
    d = k / "components/modes/feed-briefing/connectors/evil"
    d.mkdir(parents=True)
    (d / "connector.yaml").write_text(
        "apiVersion: agentbay/v4\nkind: Connector\nmetadata: {name: evil, description: test, version: 0.1.0}\n"
        "spec:\n  implements: items.source/v1\n  produces: [post/v1]\n  entry: evil.py\n  login: login\n"
        "  source: evil\n  window: 7d\n  selectors: {}\n"
        "  needs: { secrets: [EVIL_TOKEN, X_REFRESH_TOKEN, GMAIL_REFRESH_TOKEN], network: [evil.example] }\n")
    (d / "evil.py").write_text("def create(ctx): pass\ndef login(ctx): pass\n")
    import yaml
    env = yaml.safe_load((k / "components/modes/mail-briefing/envs/local-mail.yaml").read_text())
    env["metadata"]["name"] = "evil-env"
    env["spec"]["bind"]["items.source/v1"] = ["evil"]
    env["spec"]["secrets"] = {"provider": "env", "allow": ["EVIL_TOKEN"]}
    (k / "components/modes/feed-briefing/envs/evil-env.yaml").write_text(yaml.safe_dump(env, sort_keys=False))
    return k


def test_login_secret_access_equals_sync_access():
    from helpers import MemProvider
    k = _evil_kit()
    s = system(None, kit=k)
    conn = s.kit.get("Connector", "evil")
    env = connect.login_env(s, conn, None)
    assert env.name == "evil-env"
    prov = MemProvider({"X_REFRESH_TOKEN": "xsecret-123", "GMAIL_REFRESH_TOKEN": "gmail-orig"})
    ctx = connect.LoginContext(conn, env, prov,connect.Http([], who="t"), lambda u: None, say=lambda *_: None)
    for op in (lambda: ctx.secret("X_REFRESH_TOKEN"), lambda: ctx.store_secret("GMAIL_REFRESH_TOKEN", "attacker")):
        try:
            op()
            raise AssertionError("login reached a secret its env does not allow")
        except vault.SecretError as e:
            assert "not allowed" in str(e)
    assert prov.get("GMAIL_REFRESH_TOKEN") == "gmail-orig"
    try:
        connect.login_env(s, conn, "local-mail")
        raise AssertionError("login went through an env that does not bind the connector")
    except connect.ConnectorError as e:
        assert "does not bind connector evil" in str(e)
    from bay import lint
    errs = [e for e in lint.run(k) if "connector evil declares a `login`" in e]
    assert errs, lint.run(k)
