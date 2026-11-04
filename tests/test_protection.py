"""Protection is declared in the component map (proposal 0008, stage 5 part F): framework/kernel.yaml `protected:`."""
import json
import subprocess
import sys

import yaml
from helpers import KIT, cleanup, edit_yaml, gaps, kit_copy, project, system, tmpdir
from improve_fixtures import D, findings, proj, scan

from bay import boundary, dispatch, lint, model
from bay.adapter import get
from bay.guard import Guard

MAP = "framework/kernel.yaml"
EXPECTED_PROTECTED = [
    "components/base/cos", "components/base/forge",
    "components/base/improve/envs/improve-local.yaml", "components/base/tools/envs/workspace.yaml",
    "components/base/tools/envs/research.yaml",
    "components/base/improve/connectors/claude-transcripts", "components/base/store",
    "components/base/improve/connectors/artifact-graph", "components/base/improve/connectors/git",
    "components/base/improve/connectors/improve-detect", "components/base/improve/connectors/improve-store",
    "components/base/improve/connectors/ledger",
    "components/base/improve/interfaces", "components/base/tools/interfaces",
    "components/base/python", "components/base/comments",
    "components/base/tools/envs/plan-writer.yaml",
]


def _guard(k, agent=None):
    pol = json.loads((k / ".agentbay/guard.json").read_text())
    g = Guard(pol, k, ci=False)

    def decide(tool, ti, who=agent):
        payload = {"tool_name": tool, "tool_input": ti, "cwd": str(k)}
        if who:
            payload.update(agent_type=who, agent_id="a1")
        return g.decide(payload)[0]
    return pol, decide


def _built(edit=None):
    k = kit_copy()
    if edit:
        edit_yaml(k / MAP, edit)
    get("claude-code").build(system(k, k), k, k)
    return k


def test_the_shipped_map_declares_what_the_old_fixed_list_protected():
    kit = model.Kit(KIT)
    assert not hasattr(model, "PROTECTED") and not hasattr(model, "USER_FRAMEWORK_ENVS")
    assert kit.protected.paths == ("framework", "bay", "schemas", "adapters", *EXPECTED_PROTECTED[:-1]) and not kit.protected.closed
    assert kit.protected_paths == ["framework", "bay", "schemas", "adapters", *EXPECTED_PROTECTED]
    assert set(kit.protected.names["env"]) == {e for e, d in kit.docs["Environment"].items() if d.root == "framework"}
    assert set(kit.protected.names["connector"]) == {c for c, d in kit.docs["Connector"].items() if d.root == "framework"}
    assert set(kit.protected.names["mode"]) == {m for m, d in kit.docs["Mode"].items() if d.root == "framework"}
    assert kit.protected.open_envs() == ["plan-writer", "workspace", "research"]
    assert model.schema_errors(model.load_yaml(KIT / MAP), model.schema("components")) == []
    assert lint.lint_protection(kit) == [] and lint.lint_owner_only(kit) == []


def test_a_role_without_forge_extend_cannot_write_a_path_the_map_lists():
    k = _built(lambda d: d["protected"]["paths"].append("vault"))
    try:
        pol, decide = _guard(k)
        assert pol["protected"] == ["framework", "bay", "schemas", "adapters", *EXPECTED_PROTECTED[:-1], "vault", EXPECTED_PROTECTED[-1]]
        put ={"file_path": "vault/key.txt", "content": "x"}
        assert decide("Write", put, "builder--delivery") == "deny"
        assert decide("Write", {"file_path": "src/app.py", "content": "x"}, "builder--delivery") == "pass"
        assert decide("Write", put, "builder--forge--local-authoring") == "deny"
        assert decide("Write", put, "builder--forge--framework-dev") == "deny"
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("env framework-dev writes protected paths but not vault" in e for e in errs), errs
        edit_yaml(k / "components/base/forge/envs/framework-dev.yaml", lambda d: d["spec"]["fs"]["write"].insert(4,
                "vault"))
        get("claude-code").build(system(k, k), k, k)
        _, decide = _guard(k)
        assert decide("Write", put, "builder--forge--framework-dev") == "pass"
        assert decide("Write", put, "builder--delivery") == "deny"
        assert lint.lint_protection(model.Kit(k, k)) == []
    finally:
        cleanup(k)


def test_a_protected_folder_that_a_non_extender_env_names_is_a_resolver_gap():
    k = kit_copy()
    try:
        edit_yaml(k / MAP, lambda d: d["protected"]["paths"].append("vault"))
        edit_yaml(k / "components/base/delivery/mode.yaml",
                lambda d: d["spec"]["roles"].update({"builder": "workspace"}))
        edit_yaml(k / "components/base/tools/envs/workspace.yaml", lambda d: d["spec"]["fs"].update({"write": ["vault",
                "src"]}))
        g = [x for x in gaps(k) if "can write vault" in x]
        assert g and "only forge.extend may change the framework" in g[0], gaps(k)
        kit = model.Kit(k)
        assert model.protected_writes(kit, kit.get("Environment", "workspace")) == ["vault"]
    finally:
        cleanup(k)


def test_lint_keeps_framework_dev_in_step_with_the_map_both_ways():
    k = kit_copy()
    try:
        edit_yaml(k / "components/base/forge/envs/framework-dev.yaml",
                lambda d: d["spec"]["fs"]["write"].remove("adapters"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("framework-dev writes protected paths but not adapters" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:
        edit_yaml(k / "components/base/forge/envs/framework-dev.yaml",
                lambda d: d["spec"]["fs"]["write"].remove("components/base/cos"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("framework-dev writes protected paths but not components/base/cos" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:
        assert not [e for e in lint.lint_protection(model.Kit(k, k)) if "fs.write names" in e]
        edit_yaml(k / MAP, lambda d: d["protected"]["mode"].remove("cos"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("fs.write names components/base/cos" in e for e in errs), errs
        edit_yaml(k / MAP, lambda d: d["protected"]["mode"].append("cos"))
        edit_yaml(k / MAP, lambda d: d["protected"]["connector"].remove("ledger"))
        edit_yaml(k / MAP, lambda d: d["protected"]["env"].pop("improve-local"))
        errs = lint.lint_protection(model.Kit(k, k))
        for nested in ("components/base/improve/connectors/ledger", "components/base/improve/envs/improve-local.yaml"):
            assert any(f"fs.write names {nested}," in e for e in errs), (nested, errs)
    finally:
        cleanup(k)


def test_closure_every_env_a_protected_mode_maps_and_connector_a_protected_env_binds_is_protected():
    k = kit_copy()
    try:
        edit_yaml(k / MAP, lambda d: d["protected"]["env"].pop("local-authoring"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("protected mode forge puts roles in env local-authoring" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:
        edit_yaml(k / MAP, lambda d: d["protected"]["connector"].remove("scaffold"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("protected env local-authoring binds connector scaffold" in e for e in errs), errs
        edit_yaml(k / MAP, lambda d: d["protected"]["mode"].append("ghost"))
        assert any("protected mode 'ghost' does not exist" in e for e in lint.lint_protection(model.Kit(k, k)))
    finally:
        cleanup(k)


def test_a_stale_guard_policy_is_reported_by_check():
    k = _built()
    try:
        assert not [w for w in lint.warnings(model.Kit(k, k)) if "guard.json" in w]
        edit_yaml(k / MAP, lambda d: d["protected"]["paths"].append("vault"))
        ws = [w for w in lint.warnings(model.Kit(k, k)) if "guard.json" in w]
        assert len(ws) == 1 and "rebuild it" in ws[0], ws
        pol = json.loads((k / ".agentbay/guard.json").read_text())
        pol.pop("protected")
        (k / ".agentbay/guard.json").write_text(json.dumps(pol))
        assert [w for w in lint.warnings(model.Kit(k, k)) if "guard.json" in w]
    finally:
        cleanup(k)


def test_a_missing_or_malformed_protected_block_fails_closed():
    bad = {
        "missing": lambda d: d.pop("protected"),
        "null": lambda d: d.update(protected=None),
        "a list": lambda d: d.update(protected=["framework"]),
        "no paths": lambda d: d["protected"].update(paths=[]),
        "paths not a list": lambda d: d["protected"].update(paths="framework"),
        "path escapes": lambda d: d["protected"].update(paths=["../kit"]),
        "absolute path": lambda d: d["protected"].update(paths=["/etc"]),
        "dot": lambda d: d["protected"].update(paths=["."]),
        "no mode key": lambda d: d["protected"].pop("mode"),
        "env a list": lambda d: d["protected"].update(env=["cos-local"]),
        "env modes not a list": lambda d: d["protected"]["env"].update({"workspace": {"modes": "*"}}),
        "unknown key": lambda d: d["protected"].update(extra=[]),
        "name with a slash": lambda d: d["protected"]["connector"].append("a/b"),
        "a name twice": lambda d: d["protected"]["mode"].append("cos"),
    }
    for label, edit in bad.items():
        k = kit_copy()
        try:
            edit_yaml(k / MAP, edit)
            kit = model.Kit(k, k)
            assert kit.protected.closed, label
            assert any("protected" in e and MAP in e for e in kit.errors), (label, kit.errors)
            assert kit.protected.reserved("mode", "anything") and kit.covers("src/app.py")
            assert not kit.protected.may_place("delivery", "workspace")
            assert gaps(k), label
            assert any(MAP in e and "protected" in e for e in lint.run(kit=kit)), label
            try:
                get("claude-code").build(system(k, k), k, k)
                raise AssertionError(f"{label}: built a guard policy from a map with no readable protected: block")
            except model.ResolveError:
                pass
            assert not (k / ".agentbay/guard.json").exists(), label
        finally:
            cleanup(k)


def test_a_map_that_is_not_yaml_or_not_there_fails_closed_too():
    k = kit_copy()
    try:
        (k / MAP).write_text("components: [unclosed\n")
        assert model.Kit(k).protected.closed
        (k / MAP).unlink()
        kit = model.Kit(k)
        assert kit.protected.closed and kit.errors
    finally:
        cleanup(k)


def test_a_closed_set_leaves_no_adapter_path_open_either():
    """Even if a caller resolved around the errors, the adapter itself refuses to write a policy from a closed set."""
    k = kit_copy()
    try:
        s = system(k, k)
        s.kit.protected = boundary.Protection.closed_set()
        try:
            get("claude-code").build(s, k, k)
            raise AssertionError("built from a closed protection set")
        except model.SpecError as e:
            assert "protected: block" in str(e)
        assert not (k / ".agentbay/guard.json").exists()
    finally:
        cleanup(k)


def test_a_name_is_protected_wherever_it_sits_and_is_defined_once():
    """Stage 5 part G: one folder per kind, so there is no second place for a protected name."""
    put = {"file_path": "components/modes/feed-briefing/connectors/fake/fake.py", "content": "x"}
    k = _built()
    try:
        assert model.Kit(k, k).get("Connector", "fake").root == "user"
        _, decide = _guard(k)
        assert decide("Write", put, "builder--forge--local-authoring") == "pass"
    finally:
        cleanup(k)
    k = _built(lambda d: d["protected"]["connector"].append("fake"))
    try:
        kit = model.Kit(k, k)
        assert kit.get("Connector", "fake").root == "framework" and kit.protected_paths[-1] == "components/modes/feed-briefing/connectors/fake"
        pol, decide = _guard(k)
        assert pol["protected"][-1] == "components/modes/feed-briefing/connectors/fake"
        assert decide("Write", put, "builder--forge--local-authoring") == "deny"
        assert decide("Write", put, "builder--forge--framework-dev") == "deny"
        errs = lint.lint_protection(kit)
        assert any("env framework-dev writes protected paths but not components/modes/feed-briefing/connectors/fake" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:
        src = k / "components/base/store/interfaces/items.store.v2.yaml"
        (k / "components/base/improve/interfaces/items.store.v2.yaml").write_text(src.read_text())
        assert any("Interface 'items.store/v2' is defined twice" in e for e in model.Kit(k).errors)
    finally:
        cleanup(k)


def test_a_user_mode_may_place_roles_only_in_the_protected_envs_the_map_opens_to_it():
    k = kit_copy()
    try:
        edit_yaml(k / "components/base/delivery/mode.yaml",
                lambda d: d["spec"]["roles"].update({"builder": "local-authoring"}))
        assert any("works in the framework env local-authoring" in g and "research and workspace" not in g
                   and "plan-writer and workspace and research" in g for g in gaps(k)), gaps(k)
        edit_yaml(k / MAP, lambda d: d["protected"]["env"].update({"local-authoring": {"modes": ["delivery"]}}))
        assert not [g for g in gaps(k) if "works in the framework env" in g]
        edit_yaml(k / MAP, lambda d: d["protected"]["env"].update({"local-authoring": {}, "workspace": {"modes": []}}))
        edit_yaml(k / "components/base/delivery/mode.yaml",
                lambda d: d["spec"]["roles"].update({"builder": "workspace"}))
        assert any("works in the framework env workspace" in g for g in gaps(k)), gaps(k)
    finally:
        cleanup(k)


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *args],
                          check=True, capture_output=True, text=True).stdout


def _repo(base: dict, change: dict, mapdoc: dict):
    repo = tmpdir()
    _git(repo, "init", "-q", "-b", "main")
    for files in ({MAP: yaml.safe_dump(mapdoc), **base}, change):
        for p, text in files.items():
            (repo / p).parent.mkdir(parents=True, exist_ok=True)
            (repo / p).write_text(text)
        _git(repo, "add", "-A")
        _git(repo, "commit", "-q", "--allow-empty", "-m", "c")
    return repo


BOUNDARY_MAP = {
    "protected": {"paths": ["adapters", "components/base/improve/connectors/ledger"], "mode": ["cos"],
            "env": {"cos-local": {}}, "connector": ["ledger"]},
    "owns": ["bay/", "adapters/"]}
BASE = {"bay/cli.py": "x\n", "components/base/cos/mode.yaml": "x\n",
        "components/base/cos/features/run/playbook.md": "x\n",
        "components/modes/mail/mode.yaml": "x\n", "components/base/cos/envs/cos-local.yaml": "x\n",
        "components/modes/feed-briefing/envs/mine.yaml": "x\n",
        "components/base/improve/connectors/ledger/connector.yaml": "x\n",
        "components/modes/gmail/connector.yaml": "x\n",
        "adapters/claude-code/adapter.yaml": "x\n",
        "components/modes/feed-briefing/mode.yaml": "x\n", "components/base/improve/component.yaml": "x\n"}


def _check(change, touches=(), base=BASE, mapdoc=BOUNDARY_MAP):
    repo = _repo(base, change, mapdoc)
    return boundary.check(repo, "HEAD~1", "HEAD", None, [{"path": t, "reason": "r"} for t in touches])


def test_an_edit_to_a_protected_component_without_touches_fails_check_base():
    for path in ("components/base/cos/mode.yaml", "components/base/cos/envs/cos-local.yaml", "components/base/improve/connectors/ledger/connector.yaml",
                 "adapters/claude-code/adapter.yaml"):
        rep = _check({path: "y\n"})
        assert [f.path for f in rep.failures] == [path] and rep.exit_code == 1, path
        assert not _check({path: "y\n"}, touches=[path]).failures, path
    rep = _check({"components/base/cos/features/run/playbook.md": "y\n"}, touches=["components/base/cos/"])
    assert not rep.failures
    mail = "components/modes/mail/mode.yaml"
    assert [f.path for f in _check({mail: "y\n"}).failures] == [mail]
    new_modes = {"components/modes/news/mode.yaml": "y\n", "components/modes/news/envs/new.yaml": "y\n",
                 "components/modes/rss/connector.yaml": "y\n"}
    assert not _check(new_modes).failures


def test_a_new_folder_of_a_protected_name_or_in_a_protected_folder_is_not_a_new_extension():
    base = {k: v for k, v in BASE.items() if not k.startswith(("components/base/cos", "components/base/improve"))}
    for path in ("components/base/cos/mode.yaml", "components/base/cos/envs/cos-local.yaml",
            "components/base/improve/connectors/ledger/ledger.py", "adapters/other/adapter.yaml"):
        rep = _check({path: "y\n"}, base=base)
        assert [f.path for f in rep.failures] == [path] and rep.failures[0].rule == ("B-1" if path.startswith("adapters") else "protected"), path
        assert path.startswith("adapters") or "only forge.extend" in rep.lines()[0] and "even when the folder is new" in rep.lines()[0]
        assert not _check({path: "y\n"}, touches=[path], base=base).failures, path
    similar = {"components/modes/cosmos/mode.yaml": "y\n", "components/modes/ledger2/connector.yaml": "y\n"}
    assert not _check(similar, base=base).failures


def test_a_malformed_protected_block_makes_check_base_refuse_and_the_judging_map_is_the_bases():
    for bad in ({"protected": ["adapters"]}, {"protected": None},
                {"protected": {"paths": ["../x"], "mode": [], "env": {}, "connector": []}},
                {"protected": {"paths": ["x"], "mode": [], "env": {}}}):
        try:
            _check({"bay/cli.py": "y\n"}, mapdoc={**BOUNDARY_MAP, **bad})
            raise AssertionError(bad)
        except RuntimeError as e:
            assert "protected:" in str(e), e
    no_block = {k: v for k, v in BOUNDARY_MAP.items() if k != "protected"}
    rep = _check({MAP: yaml.safe_dump(no_block), "adapters/claude-code/adapter.yaml": "y\n"})
    assert {f.path for f in rep.failures} == {"adapters/claude-code/adapter.yaml", MAP}
    assert not _check({MAP: yaml.safe_dump(no_block), "adapters/claude-code/adapter.yaml": "y\n"},
                      touches=[MAP, "adapters/claude-code/adapter.yaml"]).failures


def test_a_user_mode_named_cos_or_forge_in_another_case_is_stopped_everywhere():
    """`components/base/Cos/` is `components/base/cos/` on a case-insensitive filesystem: three checks stop it."""
    from types import SimpleNamespace

    from bay import scaffold
    k = kit_copy()
    try:
        for kind, name in (("mode", "Cos"), ("mode", "FORGE"), ("connector", "Ledger"), ("env", "Workspace")):
            try:
                scaffold.create(k, kind, name, implements="items.source/v1")
                raise AssertionError(f"bay new {kind} {name} was allowed")
            except scaffold.ScaffoldError as e:
                assert "lowercase" in str(e), str(e)
            assert not [p for p in (k / "components").iterdir() if p.name in ("Cos", "FORGE")]
    finally:
        cleanup(k)
    variants = {"components/base/Cos/mode.yaml": "y\n", "components/base/FORGE/mode.yaml": "y\n",
                "components/base/improve/connectors/LEDGER/connector.yaml": "y\n",
                "components/base/cos/envs/Cos-Local.yaml": "y\n"}
    base = {**BASE, "components/base/forge/mode.yaml": "x\n"}
    for path in variants:
        rep = _check({path: variants[path]}, base=base)
        assert [f.path for f in rep.failures] == [path] and rep.exit_code == 1, path
    repo = _repo(base, variants, BOUNDARY_MAP)
    errs = lint.lint_case_and_manifests(SimpleNamespace(root=repo))
    for want in ("components/base/Cos", "components/base/FORGE", "connectors/LEDGER", "envs/Cos-Local.yaml"):
        assert any(want in e and "differs only in case" in e for e in errs), (want, errs)
    assert lint.lint_case_and_manifests(SimpleNamespace(root=_repo(base, {}, BOUNDARY_MAP))) == [
        "components/modes/gmail/: extension folder without its manifest mode.yaml"]


def _cli_approve(k, cid, *args):
    return subprocess.run([sys.executable, str(k / "bay/cli.py"), "approve", cid, *args, "--project", str(k)],
                          capture_output=True, text=True, input="")


def test_approval_from_chat_and_from_the_terminal_both_pass_the_gate():
    k = kit_copy()
    try:
        (k / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v4", "approve": {"from": ["terminal", "chat"]}}))
        get("claude-code").build(system(k, k), k, k)
        pol, decide = _guard(k)
        assert pol["protected"] == ["framework", "bay", "schemas", "adapters", *EXPECTED_PROTECTED]
        assert decide("Bash", {"command": ".agentbay/bay approve C-1 --via chat --quote ok"}, None) != "deny"
        assert decide("Bash", {"command": ".agentbay/bay approve C-1"}, "builder--forge--framework-dev") == "deny"
        d = dispatch.Dispatcher(system(k, k), k)
        ok = {"status": "done", "summary": "s"}
        chat = d.submit(d.call("forge.extend", {"goal": "a small change"})["callId"], "propose", ok)["callId"]
        r = _cli_approve(k, chat, "--via", "chat", "--quote", "approve the proposal")
        assert r.returncode == 0, r.stderr
        assert d.show(chat)["next"]["step"] == "implement"
        tty = d.submit(d.call("forge.extend", {"goal": "another change"})["callId"], "propose", ok)["callId"]
        assert d.approve(tty, True, by="user@tty")["next"]["step"] == "implement"
        assert _cli_approve(k, tty).returncode != 0
    finally:
        cleanup(k)


WRITERS = ("builder--forge--local-authoring", "builder--delivery")


def test_improve_is_an_ordinary_mode_while_its_env_and_connectors_stay_protected():
    kit = model.Kit(KIT)
    assert set(kit.protected.names["mode"]) == {"cos", "forge",
            "store"} and "components/base/improve" not in kit.protected_paths
    assert not kit.protected.reserved("mode", "improve")
    s = model.resolve(kit)
    assert [s.modes[m].root for m in ("improve", "cos", "forge", "delivery")] == ["user", "framework", "framework", "user"]
    assert "improve-local" in kit.protected.names["env"] and kit.protected.may_place("improve", "improve-local")
    assert not kit.protected.may_place("delivery", "improve-local") and kit.protected.may_place("delivery", "workspace")
    for c in ("improve-detect", "improve-store", "claude-transcripts", "ledger", "git", "artifact-graph"):
        assert kit.protected.reserved("connector", c), c
    assert lint.lint_protection(kit) == []
    k = kit_copy()
    try:
        edit_yaml(k / "components/base/delivery/mode.yaml",
                lambda d: d["spec"]["roles"].update({"builder": "improve-local"}))
        assert any("works in the framework env improve-local" in g for g in gaps(k)), gaps(k)
    finally:
        cleanup(k)


def test_improve_files_are_writable_like_any_user_mode_and_its_env_and_connectors_are_not():
    k = _built()
    try:
        _, decide = _guard(k)
        for who in WRITERS:
            for path in ("components/base/improve/mode.yaml", "components/base/improve/README.md",
                    "components/base/improve/features/scan/playbook.md"):
                assert decide("Write", {"file_path": path, "content": "x"}, who) == "pass", (who, path)
                assert decide("Edit", {"file_path": path, "old_string": "a", "new_string": "b"}, who) == "pass", (who, path)
            for path in ("components/base/improve/envs/improve-local.yaml", "components/base/improve/connectors/improve-store/store.py", "components/base/improve/connectors/improve-detect/pipeline.py",
                         "components/base/improve/connectors/claude-transcripts/parser.py", "components/base/cos/mode.yaml", "components/base/forge/mode.yaml"):
                assert decide("Write", {"file_path": path, "content": "x"}, who) == "deny", (who, path)
        assert decide("Write", {"file_path": "components/base/improve/mode.yaml", "content": "x"},
                "analyst--improve") == "deny"
        assert decide("Write", {"file_path": "components/base/improve/mode.yaml", "content": "x"},
                "builder--forge--framework-dev") == "deny"
        assert decide("Write", {"file_path": "components/base/cos/mode.yaml", "content": "x"},
                "builder--forge--framework-dev") == "pass"
    finally:
        cleanup(k)


def test_bay_new_no_longer_calls_improve_a_protected_name():
    from bay import scaffold
    k = kit_copy()
    try:
        try:
            scaffold.create(k, "mode", "improve")
            raise AssertionError("the existing mode was overwritten")
        except scaffold.ScaffoldError as e:
            assert "protected name" not in str(e) and "already exists" in str(e), str(e)
        try:
            scaffold.create(k, "feature", "extra", target="improve")
            raise AssertionError("a feature was added to a base mode")
        except scaffold.ScaffoldError as e:
            assert "lives in components/base/" in str(e), str(e)
        assert not (k / "components/base/improve/features/extra").exists()
    finally:
        cleanup(k)


def test_check_base_treats_a_new_improve_folder_as_a_new_extension_but_not_its_connectors_or_cos():
    shipped = yaml.safe_load((KIT / MAP).read_text())
    change = {"components/base/improve/mode.yaml": "y\n", "components/base/cos/mode.yaml": "y\n", "components/base/improve/connectors/improve-store/connector.yaml": "y\n",
              "components/modes/mine/connector.yaml": "y\n"}
    rep = boundary.check(_repo({"bay/cli.py": "x\n"}, change, shipped), "HEAD~1", "HEAD", None, [])
    assert sorted(f.path for f in rep.failures) == ["components/base/cos/mode.yaml", "components/base/improve/connectors/improve-store/connector.yaml"], \
        [(f.path, f.rule) for f in rep.failures]
    assert {f.rule for f in rep.failures} == {"protected"}


DECIDE = "improve.findings/v1.decide"


def _calls_decide(mode_edit):
    k = kit_copy()
    try:
        mode_edit(k)
        return k, gaps(k), lint.run(kit=model.Kit(k))
    except Exception:
        cleanup(k)
        raise


def test_no_step_in_any_mode_may_call_improve_findings_decide():
    assert model.Kit(KIT).get("Interface", "improve.findings/v1").spec["endpoints"]["decide"]["ownerOnly"] is True

    def user_mode(k):
        def add(d):
            d["spec"]["needs"].append("improve.findings/v1")
            d["spec"]["features"]["research"]["steps"].append(
                {"id": "decide", "run": DECIDE, "with": {"id": "F-1", "decision": "approve", "by": "user@tty"}})
        edit_yaml(k / "components/base/delivery/mode.yaml", add)

    def improve_mode(k):
        edit_yaml(k / "components/base/improve/mode.yaml", lambda d: d["spec"]["features"]["backlog"]["steps"].append(
            {"id": "decide", "run": DECIDE, "with": {"id": "F-1", "decision": "approve", "by": "user@tty"}}))

    def not_in_needs(k):
        edit_yaml(k / "components/base/delivery/mode.yaml", lambda d: d["spec"]["features"]["research"]["steps"].append(
            {"id": "decide", "run": DECIDE}))

    for edit, mode in ((user_mode, "delivery"), (improve_mode, "improve"), (not_in_needs, "delivery")):
        k, resolver, linted = _calls_decide(edit)
        try:
            assert any(DECIDE in g and "ownerOnly" in g and "bay approve <F-id>" in g for g in resolver), (edit.__name__, resolver)
            assert not [g for g in resolver if "does not list" in g and DECIDE in g], resolver
            assert any(DECIDE in p and "ownerOnly" in p and f"{mode}." in p for p in linted), (edit.__name__, linted)
        finally:
            cleanup(k)


def test_bay_approve_of_a_backlog_item_from_a_terminal_still_works_and_the_owner_path_is_open():
    p = proj(transcripts=False)
    try:
        scan(D(p))
        fid = findings(p)[0]["id"]
        D(p).run_capability("improve", DECIDE, {"id": fid, "decision": "approve", "by": "user@tty"})
        assert [f for f in findings(p) if f["id"] == fid][0]["status"] == "approved"
    finally:
        cleanup(p)
    p = proj(transcripts=False)
    try:
        scan(D(p))
        fid = findings(p)[0]["id"]

        def cli(*a):
            return subprocess.run([sys.executable, str(KIT / "bay/cli.py"), "--project", str(p), "approve", fid, *a],
                                  capture_output=True, text=True, input="yes\n")
        r = cli("--via", "chat", "--quote", "yes")
        assert r.returncode != 0 and "approvals from chat are off" in r.stderr
        cfg = p / "agentbay.config.yaml"
        cfg.write_text(cfg.read_text() + "approve: {from: [chat]}\n")
        r = cli("--via", "chat", "--quote", "yes please")
        assert r.returncode == 0, r.stderr
        h = [f for f in findings(p) if f["id"] == fid][0]["history"][-1]
        assert h["status"] == "approved" and h["by"] == "user@chat-via-cos"
        from bay import ledger
        assert any((e.get("data") or {}).get("quote") == "yes please" for e in ledger.read(p))
    finally:
        cleanup(p)
