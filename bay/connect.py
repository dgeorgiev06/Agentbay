"""Connector runtime: only the dispatcher loads connector code, and hands it a narrow Context."""
from __future__ import annotations

import fnmatch
import importlib.util
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from . import model, vault
from .util import utcnow


class ConnectorError(Exception):
    """Raised by connectors. Messages must never include secret values (they are redacted anyway)."""


class NetworkDenied(ConnectorError):
    pass


@dataclass
class Response:
    status: int
    headers: dict
    body: bytes

    def json(self):
        return json.loads(self.body.decode("utf-8") or "null")


Transport = Callable[[str, str, dict, bytes | None], Response]


def urllib_transport(method: str, url: str, headers: dict, body: bytes | None) -> Response:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return Response(r.status, dict(r.headers), r.read())
    except urllib.error.HTTPError as e:
        return Response(e.code, dict(e.headers or {}), e.read() or b"")


class Http:
    """HTTPS client with an allowlist check before every request."""

    def __init__(self, allow: list[str], transport: Transport | None = None, who: str = "connector"):
        self.allow, self.transport, self.who = list(allow), transport or urllib_transport, who
        self.requests = 0

    def request(self, method: str, url: str, *, params: dict | None = None, headers: dict | None = None,
                data: dict | None = None) -> Response:
        u = urllib.parse.urlsplit(url)
        host = u.hostname or ""
        if u.scheme != "https":
            raise NetworkDenied(f"{self.who}: refusing non-HTTPS URL for host {host}")
        if not model.host_allowed(host, self.allow):
            raise NetworkDenied(f"{self.who}: host {host} is not in the env network allowlist {self.allow}; "
                                f"add it to the env's network.allow if this connector should reach it")
        if params:
            q = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            url = f"{url}?{q}"
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        hdrs = dict(headers or {})
        if body is not None:
            hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
        self.requests += 1
        return self.transport(method, url, hdrs, body)


@dataclass
class Context:
    name: str
    interface: str
    env: str
    config: dict
    secrets: vault.SecretAccessor
    http: Http
    data_dir: Path
    caps: dict = field(default_factory=dict)
    settings: dict = field(default_factory=dict)
    sources: dict = field(default_factory=dict)
    clock: Callable[[], datetime] = utcnow
    window: str | None = None
    source_id: str | None = None
    cost_per_item: float | None = None
    exact_labels: bool = False
    change_feed: bool = False
    selectors: dict = field(default_factory=dict)
    kit: Path | None = None
    project: Path | None = None
    warnings: list[str] = field(default_factory=list)

    def now(self) -> datetime:
        return self.clock()


def _load_module(c: model.Doc):
    """The connector's entry module, loaded as a package of its folder after dropping modules of any earlier load."""
    path = c.dir / c.spec["entry"]
    mod_name = f"agentbay_connector_{c.name.replace('-', '_')}"
    for stale in [k for k in sys.modules if k == mod_name or k.startswith(f"{mod_name}.")]:
        del sys.modules[stale]
    spec = importlib.util.spec_from_file_location(mod_name, path, submodule_search_locations=[str(c.dir)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    if not hasattr(mod, "create"):
        raise ConnectorError(f"connector {c.name}: {path.name} must define create(ctx)")
    return mod


def secrets_provider(system: model.System, env: model.Doc, override=None):
    if override is not None:
        return override
    name = (system.kit.config.get("secrets") or {}).get("provider") or env.spec.get("secrets", {}).get("provider", "keychain")
    return vault.provider(name)


def data_dir(env: model.Doc, project: Path, kit: Path, conn: model.Doc) -> Path:
    """Connector data lives under the project root (fs paths are always project-relative)."""
    fs = env.spec.get("fs", {})
    writes = conn.spec.get("needs", {}).get("fs", {}).get("write") or fs.get("write") or ["."]
    return project / writes[0]


def _net(env: model.Doc, conn: model.Doc) -> list[str]:
    return [h for h in conn.spec.get("needs", {}).get("network", [])
            if model.host_allowed(h, env.spec.get("network", {}).get("allow", []))]


def _accessor(prov, env: model.Doc, conn: model.Doc) -> vault.SecretAccessor:
    """A secret accessor limited to the names that both the env allows and the connector declares."""
    return vault.SecretAccessor(prov, env.spec.get("secrets", {}).get("allow", []),
                                conn.spec.get("needs", {}).get("secrets", []), conn.name)


class LoginContext:
    """The API a `login` entry gets from `bay auth`: a sync's secret access, allowed http and browser; trusted code."""

    def __init__(self, conn, env, prov, http, open_browser, say=print):
        self.connector, self.env, self.http, self.open_browser, self.say = conn.name, env.name, http, open_browser, say
        self._prov = prov
        self._declared = list(conn.spec.get("needs", {}).get("secrets", []))
        self._acc = _accessor(prov, env, conn)
        self.provider = prov.name

    def _check(self, name: str) -> None:
        if not any(fnmatch.fnmatchcase(name, p) for p in self._declared):
            raise vault.SecretError(f"connector {self.connector} does not declare secret {name} (needs.secrets)")

    def secret(self, name: str) -> str | None:
        self._check(name)
        return self._acc.get(name, optional=True)

    def store_secret(self, name: str, value: str) -> bool:
        self._check(name)
        n = len(self._acc.warnings)
        self._acc.store(name, value)
        return len(self._acc.warnings) == n


def login_env(system: model.System, conn: model.Doc, name: str | None) -> model.Doc:
    """The env to log in through: --env (which must bind the connector), else the one env that binds it."""
    envs = system.kit.docs["Environment"]

    def binds(e: model.Doc) -> bool:
        return any(conn.name in model.connectors_of(v) for v in (e.spec.get("bind") or {}).values())

    if name:
        if name not in envs:
            raise ConnectorError(f"unknown env '{name}'")
        if not binds(envs[name]):
            raise ConnectorError(f"env {name} does not bind connector {conn.name}; a login goes through an env that "
                                 f"uses it")
        return envs[name]
    found = [e for e in envs.values() if binds(e)]
    if len(found) != 1:
        which = ", ".join(e.name for e in found) or "none"
        raise ConnectorError(f"{len(found)} envs bind connector {conn.name} ({which}); name one with --env")
    return found[0]


def login(system: model.System, conn_name: str, env_name: str | None) -> None:
    """Run the connector's declared `login` entry through the env that binds it (`bay auth <connector>`)."""
    import webbrowser
    conn = system.kit.get("Connector", conn_name)
    if conn is None:
        raise ConnectorError(f"unknown connector '{conn_name}'")
    entry = conn.spec.get("login")
    if not entry:
        have = sorted(c.name for c in system.kit.docs["Connector"].values() if c.spec.get("login"))
        raise ConnectorError(f"connector {conn.name} declares no `login` entry (connectors with one: "
                             f"{', '.join(have) or 'none'})")
    env = login_env(system, conn, env_name)
    fn = getattr(_load_module(conn), entry, None)
    if not callable(fn):
        raise ConnectorError(f"connector {conn.name}: {conn.spec['entry']} has no function {entry} (its declared `login`)")
    fn(LoginContext(conn, env, secrets_provider(system, env), Http(_net(env, conn), who=f"bay auth {conn.name}"),
                    webbrowser.open))


def instantiate(system: model.System, env_name: str, conn_name: str, iface: str, project: Path, *,
                transport: Transport | None = None, provider=None, caps: dict | None = None,
                settings: dict | None = None, clock=None):
    env = system.env(env_name)
    c = system.kit.get("Connector", conn_name)
    if c is None:
        raise ConnectorError(f"unknown connector '{conn_name}'")
    mod = _load_module(c)
    needs = c.spec.get("needs", {})
    prov = secrets_provider(system, env, provider) if needs.get("secrets") else vault.EnvProvider({})
    acc = _accessor(prov, env, c)
    sources = {}
    for sub in [*needs.get("capabilities", []), *needs.get("optional", [])]:
        for cn in model.connectors_of(env.spec["bind"].get(sub)):
            sources[cn] = instantiate(system, env_name, cn, sub, project, transport=transport, provider=provider,
                                      caps=caps, settings=settings, clock=clock)
    ctx = Context(
        name=conn_name, interface=iface, env=env_name,
        config=dict((system.kit.config.get("connectors") or {}).get(conn_name) or {}),
        secrets=acc, http=Http(_net(env, c), transport, conn_name), data_dir=data_dir(env, project, system.kit.root, c),
        caps=dict(caps or {}), settings=dict(settings or {}), sources=sources, clock=clock or utcnow,
        window=c.spec.get("window"), source_id=c.spec.get("source"), cost_per_item=c.spec.get("costPerItemUsd"),
        exact_labels=bool(c.spec.get("exactLabels")), change_feed=bool(c.spec.get("changeFeed")),
        selectors=dict(c.spec.get("selectors") or {}),
        kit=system.kit.root, project=project)
    inst = mod.create(ctx)
    inst.ctx = ctx
    return inst
