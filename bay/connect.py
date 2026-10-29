"""Connector runtime: load connector code and hand it a narrow Context.

Only the dispatcher calls `instantiate`. A connector gets:
  * its own config (agentbay.config.yaml connectors.<name>)
  * a SecretAccessor limited to names allowed by BOTH the env and the connector
  * an Http client that refuses any host outside the env network allowlist
    BEFORE the request is made
  * a data dir inside the env's fs.write paths
  * instances of the connectors bound to capabilities it declares in needs
"""
from __future__ import annotations

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


def urllib_transport(method: str, url: str, headers: dict, body: bytes | None) -> Response:  # pragma: no cover
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
    caps: dict = field(default_factory=dict)          # budget caps for this call (strictest wins)
    settings: dict = field(default_factory=dict)      # calling mode's settings (lookback, retention, ...)
    sources: dict = field(default_factory=dict)       # connector name -> instance (needs.capabilities)
    clock: Callable[[], datetime] = utcnow
    window: str | None = None                         # how far back the source API reaches
    source_id: str | None = None
    cost_per_post: float | None = None                # connector-declared price per item read (None: use caps)
    exact_labels: bool = False                        # items.source: items carry their full label set (replace, not add)
    change_feed: bool = False                         # items.source: the cursor replays every change (Gmail history)
    selectors: dict = field(default_factory=dict)     # items.source: selector capability table (field -> native|local)
    kit: Path | None = None
    project: Path | None = None
    warnings: list[str] = field(default_factory=list)

    def now(self) -> datetime:
        return self.clock()


def _load_module(c: model.Doc):
    path = c.dir / c.spec["entry"]
    mod_name = f"agentbay_connector_{c.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(mod_name, path)
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


def instantiate(system: model.System, env_name: str, conn_name: str, iface: str, project: Path, *,
                transport: Transport | None = None, provider=None, caps: dict | None = None,
                settings: dict | None = None, clock=None):
    env = system.env(env_name)
    c = system.kit.get("Connector", conn_name)
    if c is None:
        raise ConnectorError(f"unknown connector '{conn_name}'")
    mod = _load_module(c)
    needs = c.spec.get("needs", {})
    allow_net = env.spec.get("network", {}).get("allow", [])
    net = [h for h in needs.get("network", []) if model.host_allowed(h, allow_net)]
    prov = secrets_provider(system, env, provider) if needs.get("secrets") else vault.EnvProvider({})
    acc = vault.SecretAccessor(prov, env.spec.get("secrets", {}).get("allow", []), needs.get("secrets", []), conn_name)
    sources = {}
    for sub in needs.get("capabilities", []):
        for cn in model.connectors_of(env.spec["bind"].get(sub)):
            sources[cn] = instantiate(system, env_name, cn, sub, project, transport=transport, provider=provider,
                                      caps=caps, settings=settings, clock=clock)
    ctx = Context(
        name=conn_name, interface=iface, env=env_name,
        config=dict((system.kit.config.get("connectors") or {}).get(conn_name) or {}),
        secrets=acc, http=Http(net, transport, conn_name), data_dir=data_dir(env, project, system.kit.root, c),
        caps=dict(caps or {}), settings=dict(settings or {}), sources=sources, clock=clock or utcnow,
        window=c.spec.get("window"), source_id=c.spec.get("source"), cost_per_post=c.spec.get("costPerPostUsd"),
        exact_labels=bool(c.spec.get("exactLabels")), change_feed=bool(c.spec.get("changeFeed")),
        selectors=dict(c.spec.get("selectors") or {}),
        kit=system.kit.root, project=project)
    inst = mod.create(ctx)
    inst.ctx = ctx
    return inst
