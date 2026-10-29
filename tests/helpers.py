"""Shared test helpers: temp kit copies, fake HTTP, fixed clock, in-memory secrets."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))

from bay import model, vault  # noqa: E402
from bay.connect import Response  # noqa: E402

NOW = datetime(2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc)


def clock():
    return NOW


_TMP = tempfile.TemporaryDirectory(prefix="agentbay-test-")   # one root per test run, removed at exit


def tmpdir() -> Path:
    """A fresh directory under the run's TemporaryDirectory (removed when the process exits)."""
    return Path(tempfile.mkdtemp(dir=_TMP.name))


def cleanup(p: Path) -> None:
    shutil.rmtree(p.parent if p.name in ("proj", "kit") else p, ignore_errors=True)


def kit_copy() -> Path:
    """A full copy of the kit to mutate."""
    d = tmpdir() / "kit"
    shutil.copytree(KIT, d, ignore=shutil.ignore_patterns(".git", "__pycache__", ".agentbay"))
    return d


def edit_yaml(path: Path, fn) -> None:
    doc = yaml.safe_load(path.read_text())
    fn(doc)
    path.write_text(yaml.safe_dump(doc, sort_keys=False))


def gaps(kit: Path, project: Path | None = None) -> list[str]:
    try:
        model.resolve(model.Kit(kit, project))
    except model.ResolveError as e:
        return e.gaps
    return []


def assert_gap(kit: Path, *needles: str, project: Path | None = None) -> str:
    gs = gaps(kit, project)
    for g in gs:
        if all(n in g for n in needles):
            return g
    raise AssertionError(f"no gap containing {needles}; got:\n  " + "\n  ".join(gs))


OFFLINE = {"local-feeds": "local-feeds-offline"}   # the shipped offline env (fake source, no network)


def project(config: dict | None = None, source: str = "fake") -> Path:
    """A project dir. source="fake" selects the shipped offline env via `envs:`; "x-api" uses local-feeds."""
    p = tmpdir() / "proj"
    p.mkdir()
    cfg = {"apiVersion": "agentbay/v2"}
    if source == "fake":
        cfg["envs"] = dict(OFFLINE)
    elif source != "x-api":
        raise ValueError(source)
    cfg.update(config or {})
    (p / "agentbay.config.yaml").write_text(yaml.safe_dump(cfg))
    return p


def kit_for(project_dir: Path | None) -> Path:
    return KIT


def system(project_dir: Path | None, kit: Path | None = None) -> model.System:
    return model.resolve(model.Kit(kit or KIT, project_dir))


class FakeHttp:
    """Routes (method, path) -> handler(params, headers, form) -> Response. Records every request."""

    def __init__(self, routes: dict):
        self.routes, self.log = routes, []

    def __call__(self, method, url, headers, body):
        from urllib.parse import parse_qsl, urlsplit
        u = urlsplit(url)
        params = dict(parse_qsl(u.query))
        form = dict(parse_qsl(body.decode())) if body else {}
        self.log.append({"method": method, "host": u.hostname, "path": u.path, "params": params,
                         "headers": headers, "form": form, "url": url})
        h = self.routes.get((method, u.path))
        if h is None:
            return Response(404, {}, b'{"error": "no route"}')
        return h(params, headers, form)


def jresp(obj, status=200, headers=None) -> Response:
    return Response(status, headers or {}, json.dumps(obj).encode())


SECRETS = {"X_CLIENT_ID": "cid-PUBLIC-1234", "X_CLIENT_SECRET": "csecret-SHOULD-NEVER-LEAK-9876",
           "X_REFRESH_TOKEN": "rt-SHOULD-NEVER-LEAK-0001"}


class MemProvider(vault.EnvProvider):
    """An env-style provider that can persist (like keychain), so token rotation can be asserted."""
    name = "mem"

    def __init__(self, values: dict):
        super().__init__(dict(values))

    def set(self, name, value):
        self.environ[name] = value
        return True


def self_describe(kit: Path, folder: Path) -> None:
    """Give a hand-written test extension its README.md and config.example.yaml, and reassemble the kit's
    agentbay.config.example.yaml (lint requires all three, 0006 Part A)."""
    from bay import config, model
    (folder / "README.md").write_text(f"# {folder.name}\n\nA test extension.\n")
    (folder / config.FRAGMENT).write_text("# lookback: 3d\n")
    (kit / config.EXAMPLE).write_text(config.example(model.Kit(kit)))
