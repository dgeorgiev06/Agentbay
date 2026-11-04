"""agentbay.config.yaml: per-project user settings."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

NAME = "agentbay.config.yaml"
CAPS = ("monthlyItems", "spendUsd", "maxItemsPerRun")
COST_PER_ITEM_USD = 0.005
FRAGMENT = "config.example.yaml"
MINIMAL = """\
# Settings for agentbay in this project. Every setting is optional; `bay config` lists them all.
# `offline: true` runs the shipped envs on fake sources (no network, no secrets, $0).
apiVersion: agentbay/v4
"""


class ConfigError(Exception):
    pass


def load(project: Path | None) -> dict:
    if project is None:
        return {}
    p = project / NAME
    if not p.exists():
        return {}
    from .model import schema, schema_errors
    doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    errs = schema_errors(doc, schema("config"))
    if "approvals" in doc:
        errs.append("`approvals` is now `approve: { from: [...] }`")
    if errs:
        raise ConfigError(f"{p}:\n    " + "\n    ".join(errs))
    return doc


def write_minimal(project: Path) -> bool:
    """Write the minimal agentbay.config.yaml unless the project has one. True when written."""
    p = project / NAME
    if p.exists():
        return False
    p.write_text(MINIMAL, encoding="utf-8")
    return True


def approve_from(cfg: dict) -> list:
    """`approve: { from: [terminal, chat] }`: where the owner may decide `bay approve`; the default is [terminal]."""
    return (cfg.get("approve") or {}).get("from") or ["terminal"]


def config_path(project: Path | None, rel: str) -> Path:
    p = Path(rel)
    if not p.is_absolute() and project is not None:
        p = project / p
    return p


def mode_settings(cfg: dict, mode: str) -> tuple[dict, dict]:
    """(mode settings without 'features', {feature: settings})"""
    m = dict((cfg.get("modes") or {}).get(mode) or {})
    feats = m.pop("features", {}) or {}
    return m, feats


def effective_constraints(mode_constraints: dict, settings: dict) -> dict:
    out = dict(mode_constraints)
    for k in CAPS:
        if k in settings:
            out[k] = min(out[k], settings[k]) if k in out else settings[k]
    return out


def raised(env_limits: dict, settings: dict) -> list[tuple[str, float, float]]:
    """(cap, setting, env limit) for each setting above the env's limit. The env is the ceiling."""
    return [(k, settings[k], env_limits[k]) for k in CAPS
            if k in settings and k in env_limits and settings[k] > env_limits[k]]


def caps(constraints: dict, env_limits: dict, settings: dict) -> dict:
    """Strictest of mode constraints and env limits; settings only tighten, so one above an env limit is refused."""
    over = raised(env_limits, settings)
    if over:
        raise ConfigError("; ".join(f"{k} {v} raises the env limit {lim}: a setting can only lower a cap"
                                    for k, v, lim in over))
    out = {}
    for k in CAPS:
        vals = [v for v in (constraints.get(k), env_limits.get(k)) if v is not None]
        if vals:
            out[k] = min(vals)
    out["costPerItemUsd"] = settings.get("costPerItemUsd", COST_PER_ITEM_USD)
    return out


def takes_settings(kind: str, doc) -> bool:
    """A mode takes settings with a config schema and when not abstract; a connector takes them with `config:`."""
    if kind == "Mode":
        return bool(doc.spec.get("config")) and not doc.spec.get("abstract")
    return bool(doc.spec.get("config"))


def _type(sch: dict) -> str:
    if "enum" in sch:
        return " | ".join(str(x) for x in sch["enum"])
    if "const" in sch:
        return str(sch["const"])
    t = sch.get("type", "any")
    return "/".join(t) if isinstance(t, list) else t


def _lines(props: dict, indent: int, prefix: str = "") -> list[str]:
    out = []
    for key, sch in props.items():
        default = f" (default {json.dumps(sch['default'])})" if "default" in sch else ""
        desc = " ".join(str(sch.get("description", "")).split())
        out.append(f"{' ' * indent}{prefix}{key}: {_type(sch)}{default}" + (f" - {desc}" if desc else ""))
        if isinstance(sch.get("properties"), dict):
            out += _lines(sch["properties"], indent + 2)
    return out


def describe(kit) -> str:
    """Every setting of agentbay.config.yaml with its type, default and description, read from the config schemas."""
    from . import model
    sch = model.schema("config")
    out = [f"{NAME}: every setting is optional. {sch['description']}", ""]
    out += _lines({k: v for k, v in sch["properties"].items() if k not in ("modes", "connectors")}, 0)
    out += ["", "modes.<name>.features.<feature>: {extraRules: <path>} - extra rules for one feature of any mode"]
    for md in sorted(kit.docs["Mode"].values(), key=lambda d: d.name):
        if not takes_settings("Mode", md):
            continue
        s = model.config_schema(kit, md, [])
        if s is not None:
            out += [f"modes.{md.name}:", *_lines(model.inline_refs(s).get("properties") or {}, 2)]
    for c in sorted(kit.docs["Connector"].values(), key=lambda d: d.name):
        if takes_settings("Connector", c):
            out += [f"connectors.{c.name}:", *_lines(c.spec["config"].get("properties") or {}, 2)]
    return "\n".join(out) + "\n"
