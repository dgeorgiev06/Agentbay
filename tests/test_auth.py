"""`bay auth <connector>`: the CLI names no connector; it runs the connector's declared `login` entry."""
import subprocess
import sys

from helpers import KIT, MemProvider, system

from bay import cli, connect, vault


def _ctx(conn_name="gmail-api", values=None):
    s = system(None)
    conn = s.kit.get("Connector", conn_name)
    env = cli._login_env(s, conn, None)
    http = connect.Http([], who="test")
    return cli.LoginContext(conn, env, MemProvider(values or {}), http, lambda url: None, say=lambda *_: None)


def test_auth_refuses_without_a_terminal_and_names_the_connector():
    r = subprocess.run([sys.executable, "-m", "bay.cli", "auth", "gmail-api"], cwd=KIT, stdin=subprocess.DEVNULL,
                       capture_output=True, text=True)
    assert r.returncode == 1 and "bay auth gmail-api needs an interactive terminal" in r.stderr


def test_cli_names_no_connector_and_logins_are_declared():
    src = (KIT / "bay/cli.py").read_text()
    assert "gmail" not in src.lower()
    s = system(None)
    have = {c.name: c.spec.get("login") for c in s.kit.docs["Connector"].values() if c.spec.get("login")}
    assert have == {"gmail-api": "cli_login"}


def test_login_env_is_the_one_env_binding_the_connector():
    s = system(None)
    assert cli._login_env(s, s.kit.get("Connector", "gmail-api"), None).name == "local-mail"


def test_login_context_gives_only_the_connectors_declared_secrets():
    ctx = _ctx(values={"GMAIL_CLIENT_ID": "cid-auth-test-0001", "X_BEARER_TOKEN": "nope"})
    assert ctx.secret("GMAIL_CLIENT_ID") == "cid-auth-test-0001"
    assert "cid-auth-test-0001" not in vault.redact("id cid-auth-test-0001")          # read secrets are redacted
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
