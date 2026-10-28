"""agentbay.config.yaml: per-project user settings.

    apiVersion: agentbay/v2
    secrets: { provider: env }                  # override env provider (e.g. on Linux)
    modes:
      feed-briefing:
        lookback: 3d
        maxItemsPerRun: 200
        features:
          digest: { extraRules: rules/digest-extra.yaml }
    connectors:
      x-api: { userId: "12345" }

Capabilities are bound only in envs/<env>.yaml (no override here).

Settings can only tighten: numeric caps take the minimum of mode constraint,
config and env limit.
"""
from __future__ import annotations

from pathlib import Path

import yaml

NAME = "agentbay.config.yaml"
CAPS = ("monthlyItems", "spendUsd", "maxItemsPerRun")
COST_PER_POST_USD = 0.005      # default price per post read (X API pay-per-use); config costPerPostUsd overrides


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
    if isinstance(doc, dict) and "bindings" in doc:
        raise ConfigError(f"{p}: `bindings` was removed in v0.2 (approved 2026-10-27); capabilities are bound only "
                          f"in envs/<env>.yaml. To run offline, select the shipped offline env instead: "
                          f"`envs: {{ local-feeds: local-feeds-offline }}`")
    errs = schema_errors(doc, schema("config"))
    if errs:
        raise ConfigError(f"{p}:\n    " + "\n    ".join(errs))
    return doc


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


def caps(constraints: dict, env_limits: dict, settings: dict) -> dict:
    """Strictest of mode constraints (already merged with config) and env hard limits."""
    out = {}
    for k in CAPS:
        vals = [v for v in (constraints.get(k), env_limits.get(k), settings.get(k)) if v is not None]
        if vals:
            out[k] = min(vals)
    out["costPerPostUsd"] = settings.get("costPerPostUsd", COST_PER_POST_USD)
    return out
