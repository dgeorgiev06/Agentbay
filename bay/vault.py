"""Secret providers. Only the dispatcher calls these, and only for connectors.

Values never leave this process except to the connector that asked: they are
not printed, logged, written to the ledger, or put in prompts. Every value that
is resolved is registered with `redact()` so that any accidental echo (an
exception message, a ledger line, CLI output) is scrubbed as a last line of
defence.
"""
from __future__ import annotations

import fnmatch
import os
import re
import subprocess
import sys
from typing import Callable

_SEEN: set[str] = set()
SERVICE = "agentbay"
NAME_OK = re.compile(r"^[A-Z][A-Z0-9_]*$")


class SecretError(Exception):
    pass


def remember(value: str) -> None:
    if value and len(value) >= 4:
        _SEEN.add(value)


def redact(text: str) -> str:
    for v in sorted(_SEEN, key=len, reverse=True):
        text = text.replace(v, "***")
    return text


class EnvProvider:
    name = "env"

    def __init__(self, environ: dict | None = None):
        self.environ = os.environ if environ is None else environ

    def get(self, name: str) -> str | None:
        return self.environ.get(name) or None

    def set(self, name: str, value: str) -> bool:
        return False  # cannot persist across runs


class KeychainProvider:
    """macOS Keychain: `security find-generic-password -s agentbay -a <NAME> -w`."""
    name = "keychain"

    def __init__(self, run: Callable = subprocess.run, platform: str = sys.platform):
        self.run, self.platform = run, platform

    def _check(self):
        if self.platform != "darwin":
            raise SecretError("secrets provider 'keychain' needs macOS; set `secrets: {provider: env}` "
                              "in agentbay.config.yaml to read secrets from environment variables")

    def get(self, name: str) -> str | None:
        self._check()
        r = self.run(["security", "find-generic-password", "-s", SERVICE, "-a", name, "-w"],
                     capture_output=True, text=True)
        if r.returncode != 0:
            return None
        return r.stdout.rstrip("\n") or None

    def set(self, name: str, value: str) -> bool:
        """Store via `security -i` reading the command from stdin, so the value never appears in argv
        (argv is visible to every local user through ps)."""
        self._check()
        if any(c in value for c in '"\\\n\r'):
            raise SecretError(f"{name}: value contains a quote, backslash or newline, which cannot be passed to "
                              f"`security -i` safely; store it with Keychain Access instead")
        if not NAME_OK.match(name):
            raise SecretError(f"bad secret name {name!r}")
        cmd = f'add-generic-password -U -s {SERVICE} -a {name} -w "{value}"\n'
        r = self.run(["security", "-i"], input=cmd, capture_output=True, text=True)
        return r.returncode == 0


PROVIDERS = {"env": EnvProvider, "keychain": KeychainProvider}


def provider(name: str):
    if name not in PROVIDERS:
        raise SecretError(f"unknown secrets provider '{name}' (have: {', '.join(PROVIDERS)})")
    return PROVIDERS[name]()


def allowed(name: str, env_allow: list[str], connector_needs: list[str]) -> bool:
    return name in env_allow and any(fnmatch.fnmatchcase(name, pat) for pat in connector_needs)


class SecretAccessor:
    """What a connector gets: names it may read, nothing else. Values are cached in memory only."""

    def __init__(self, prov, env_allow: list[str], needs: list[str], connector: str):
        self._prov, self._allow, self._needs, self._who = prov, list(env_allow), list(needs), connector
        self._cache: dict[str, str] = {}
        self.warnings: list[str] = []

    def get(self, name: str, optional: bool = False) -> str | None:
        if not allowed(name, self._allow, self._needs):
            raise SecretError(f"{self._who}: secret {name} is not allowed (env allows {self._allow}, "
                              f"connector declares {self._needs})")
        if name not in self._cache:
            val = self._prov.get(name)
            if val is None:
                if optional:
                    return None
                hint = (f"`security add-generic-password -s {SERVICE} -a {name} -w`" if self._prov.name == "keychain"
                        else f"export {name}=...")
                raise SecretError(f"{self._who}: secret {name} not found in provider '{self._prov.name}' ({hint})")
            remember(val)
            self._cache[name] = val
        return self._cache[name]

    def store(self, name: str, value: str) -> None:
        """Persist a rotated secret (e.g. OAuth refresh token) back to the provider."""
        if not allowed(name, self._allow, self._needs):
            raise SecretError(f"{self._who}: secret {name} is not allowed")
        remember(value)
        self._cache[name] = value
        if not self._prov.set(name, value):
            self.warnings.append(
                f"{self._who}: {name} was rotated by the provider API but secrets provider "
                f"'{self._prov.name}' cannot store it; the stored value is now stale - re-authorize "
                f"and update {name} (or use provider keychain)")
