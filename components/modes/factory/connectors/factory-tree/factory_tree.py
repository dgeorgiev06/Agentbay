"""factory-tree: factory.tree/v1. One git worktree per slice, the profile's checks inside it, and the merge."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from bay.connect import ConnectorError

from . import git_tree as g

INTEGRATION = "_integration"


class FactoryTree:
    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx
        self.project = Path(ctx.project)
        self.dirs = [Path(d) for d in (ctx.settings.get("modeDirs") or [])]
        self.rel_root = str(self._setting("worktreeRoot"))
        self.root = self.project / self.rel_root
        self.prefix = str(self._setting("branchPrefix"))

    def open(self, runId: str, sliceId: str) -> dict[str, Any]:
        base, integration = self._integration(runId)
        branch = self._slice_branch(runId, sliceId)
        path = self.root / runId / sliceId
        g.ensure_branch(self.project, branch, base)
        created = g.ensure_worktree(self.project, path, branch)
        return {"runId": runId, "sliceId": sliceId, "path": self._rel(path), "branch": branch, "base": base,
                "head": g.must(path, "rev-parse", "HEAD"), "created": created,
                "integration": self._rel(integration)}

    def checks(self, runId: str, sliceId: str, language: str | None = None,
               only: list[str] | None = None) -> dict[str, Any]:
        path = self._tree(runId, sliceId)
        base = self._base(runId)
        ran = self._run_profile(path, language, only)
        failed = [r["name"] for r in ran if not r["ok"]]
        out: dict[str, Any] = {"runId": runId, "sliceId": sliceId, "ran": ran, "failed": failed,
                               "changedFiles": g.changed_files(path, base),
                               "summary": f"{len(ran) - len(failed)}/{len(ran)} checks passed in {self._rel(path)}"}
        if failed:
            tails = "; ".join(f"{r['name']}: {r['tail'].splitlines()[-1][:120] if r['tail'] else 'no output'}"
                              for r in ran if not r["ok"])
            out["stopped"] = (f"{', '.join(failed)} failed in the slice's worktree ({tails}). The slice stays out of "
                              f"integration until they pass.")
        return out

    def integrate(self, runId: str, sliceId: str) -> dict[str, Any]:
        path = self._tree(runId, sliceId)
        base, integration = self._integration(runId)
        branch = self._slice_branch(runId, sliceId)
        left = g.dirty(path)
        if left:
            return {"runId": runId, "sliceId": sliceId, "merged": False, "branch": base,
                    "stopped": (f"{len(left)} file(s) in {self._rel(path)} are not committed ({', '.join(left[:5])}); "
                                f"a slice integrates from its branch, so commit the work in its own worktree first")}
        before = g.must(integration, "rev-parse", "HEAD")
        merged, conflicts = g.merge(integration, branch, f"factory {runId}: integrate {sliceId}")
        if not merged:
            return {"runId": runId, "sliceId": sliceId, "merged": False, "branch": base, "conflicts": conflicts,
                    "stopped": (f"{sliceId} conflicts with {base} in {', '.join(conflicts[:5])}; the merge was undone. "
                                f"Rebase the slice's branch on {base} in its own worktree and integrate again.")}
        ran = self._run_profile(integration, None, None)
        failed = [r["name"] for r in ran if not r["ok"]]
        if failed:
            g.reset_to(integration, before)
            return {"runId": runId, "sliceId": sliceId, "merged": False, "branch": base,
                    "checks": {"ran": ran, "failed": failed},
                    "stopped": (f"{sliceId} merges cleanly but {', '.join(failed)} fail on {base}; the merge was "
                                f"rolled back. The slice passes its own checks, so this is an interaction with an "
                                f"earlier slice: fix it in {sliceId} and integrate again.")}
        return {"runId": runId, "sliceId": sliceId, "merged": True, "branch": base,
                "commit": g.must(integration, "rev-parse", "HEAD"), "conflicts": [],
                "checks": {"ran": ran, "failed": []},
                "summary": f"{sliceId} is on {base}; {len(ran)} checks passed there"}

    def trees(self, runId: str) -> dict[str, Any]:
        base = self._base(runId)
        rows = [t for t in g.worktrees(self.project) if f"/{runId}/" in f"{t['worktree']}/"]
        trees = [{"path": self._rel(Path(t["worktree"])), "branch": t.get("branch", ""), "head": t.get("HEAD", "")}
                 for t in rows if not t["worktree"].endswith(INTEGRATION)]
        integration = next(({"path": self._rel(Path(t["worktree"])), "branch": base, "head": t.get("HEAD", "")}
                            for t in rows if t["worktree"].endswith(INTEGRATION)), {})
        return {"trees": trees, "integration": integration}

    def _integration(self, run_id: str) -> tuple[str, Path]:
        """The run's integration branch and its worktree, cut from HEAD the first time a slice opens."""
        base = self._base(run_id)
        path = self.root / run_id / INTEGRATION
        g.ignore_root(self.project, self.project / Path(self.rel_root).parts[0])
        g.ensure_branch(self.project, base, g.repo_head(self.project))
        g.ensure_worktree(self.project, path, base)
        return base, path

    def _slice_branch(self, run_id: str, slice_id: str) -> str:
        return f"{self.prefix}{run_id}/{slice_id}"

    def _base(self, run_id: str) -> str:
        """The run's integration branch. A slice's branch sits beside it, never under it: git refs are paths."""
        return f"{self.prefix}{run_id}/integration"

    def _tree(self, run_id: str, slice_id: str) -> Path:
        path = self.root / run_id / slice_id
        if not (path / ".git").exists():
            raise ConnectorError(f"slice {slice_id} of run {run_id} has no worktree at {self._rel(path)}; "
                                 f"factory.tree/v1.open cuts it, which the build and fix stages do first")
        return path

    def _run_profile(self, tree: Path, language: str | None, only: list[str] | None) -> list[dict[str, Any]]:
        commands = self._profile(language or str(self._setting("language")))
        names = [n for n in commands if only is None or n in only]
        return [g.run_command(tree, n, list(commands[n])) for n in names]

    def _profile(self, name: str) -> dict[str, list[str]]:
        for d in self.dirs:
            p = d / "languages" / f"{name}.yaml"
            if p.is_file():
                doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
                return dict(doc.get("commands") or {})
        have = sorted(q.stem for d in self.dirs for q in (d / "languages").glob("*.yaml"))
        raise ConnectorError(f"no language profile '{name}' (have: {', '.join(have) or 'none'})")

    def _setting(self, key: str) -> Any:
        """A setting, else the default in the mode's config schema, so the connector and `bay config` agree."""
        if key in self.ctx.settings:
            return self.ctx.settings[key]
        for d in self.dirs:
            p = d / "config.schema.json"
            if p.is_file():
                prop = (json.loads(p.read_text(encoding="utf-8")).get("properties") or {}).get(key) or {}
                if "default" in prop:
                    return prop["default"]
        raise ConnectorError(f"setting modes.factory.{key} has no value and no default")

    def _rel(self, path: Path) -> str:
        try:
            return str(path.resolve().relative_to(self.project.resolve()))
        except ValueError:
            return str(path)


def create(ctx: Any) -> FactoryTree:
    return FactoryTree(ctx)
