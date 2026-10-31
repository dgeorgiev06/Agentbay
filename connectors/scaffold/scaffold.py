"""forge.scaffold/v1 -> bay.scaffold (the single source of truth for templates)."""
from bay import boundary, config, scaffold
from bay.connect import ConnectorError
from bay.proposal import ProposalError, front_matter

SENSITIVE = ("bay/dispatch.py", "bay/guard.py", "bay/cli.py", "bay/vault.py", "bay/secretscan.py", "bay/connect.py",
             "bay/ledger.py", "bay/boundary.py", "adapters/", "framework/components.yaml", "framework/rules/",
             "schemas/config.schema.json", "schemas/event.schema.json")      # a touch at, under or above these needs a plan


def kit_project(ctx):
    """fs paths are project-relative; forge's project must be the agentbay checkout it writes."""
    if ctx.project is None or ctx.project.resolve() != ctx.kit.resolve():
        raise ConnectorError(f"forge writes the agentbay checkout, but the project is {ctx.project}; build the kit "
                             f"into itself and call forge from there: ./bay.sh build --project {ctx.kit}")
    return ctx.project


class Scaffold:
    def __init__(self, ctx):
        self.ctx = ctx

    def create(self, kind, name, target=None, implements=None, intent=None) -> dict:
        return scaffold.create(kit_project(self.ctx), kind, name, target=target, implements=implements, intent=intent)

    def proposal(self, path=None) -> dict:
        """A proposal's front matter status, approvedBy and date (informational; only `bay approve` passes the gate),
        and `plan`: whether the plan step runs (approvals.plan, `large` unless set; no docs/plans/<id>.md yet)."""
        root, named = kit_project(self.ctx), isinstance(path, str)
        found = next((x for x in ([path] if named else path or []) if x.startswith("docs/proposals/")), "")
        p = (root / found).resolve()
        if not p.is_relative_to((root / "docs" / "proposals").resolve()) or not p.is_file():
            if named:
                raise ConnectorError(f"no proposal at {path} (docs/proposals/<id>.md)")
            return {"path": "", "plan": False, "why": ""}          # the propose step named no proposal file
        try:
            fm = front_matter(p.read_text(encoding="utf-8"))
        except ProposalError as e:
            raise ConnectorError(f"{found}: {e}") from e
        want, raw = (config.load(root).get("approvals") or {}).get("plan") or "large", fm.get("touches")
        hits = [boundary.literal_prefix(str(e.get("path"))) for e in raw if isinstance(e, dict)] if isinstance(raw, list) else None
        why = next((w for w, hit in (("approvals.plan is always", want == "always"), ("touches: is missing or unreadable", hits is None),
                                     ("touches: lists 10 or more paths", len(hits or ()) >= 10), ("the front matter has exceptions:", "exceptions" in fm),
                                     ("touches: includes a security-sensitive path", any(boundary.under(s, t) or boundary.under(t, s)
                                                                                          for s in SENSITIVE for t in hits or ()))) if hit), "")
        return {"path": found, **{k: str(fm[k]) for k in ("status", "approvedBy", "date") if fm.get(k)},
                "plan": want != "never" and bool(why) and not (root / "docs" / "plans" / f"{p.stem}.md").exists(), "why": why}


def create(ctx):
    return Scaffold(ctx)
