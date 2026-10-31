"""Protection is declared in the component map (proposal 0008, stage 5 part F): framework/components.yaml `protected:`.
The guard policy, the resolver, lint and `bay check --base` read it, a protected name is reserved, a block that is
missing or malformed fails closed, `improve.findings/v1.decide` is ownerOnly (D4), and framework-dev names every
protected path it may write (D9)."""
import json
import subprocess
import sys

import yaml
from helpers import KIT, cleanup, edit_yaml, gaps, kit_copy, project, system, tmpdir
from layout import PROTECTED_INSTANCES
from test_improve import D, findings, proj, scan

from bay import boundary, dispatch, lint, model
from bay.adapter import get
from bay.guard import Guard

MAP = "framework/components.yaml"


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


# ----------------------------------------------------------------- the guard reads the map
def test_the_shipped_map_declares_what_the_old_fixed_list_protected():
    kit = model.Kit(KIT)
    assert not hasattr(model, "PROTECTED") and not hasattr(model, "USER_FRAMEWORK_ENVS")
    assert kit.protected.paths == ("framework", "bay", "schemas", "adapters") and not kit.protected.closed
    # the four folders in the old order and spelling, then each protected instance where it sits (stage 5 part G)
    assert kit.protected_paths() == ["framework", "bay", "schemas", "adapters", *PROTECTED_INSTANCES]
    assert set(kit.protected.names["env"]) == {e for e, d in kit.docs["Environment"].items() if d.root == "framework"}
    assert set(kit.protected.names["connector"]) == {c for c, d in kit.docs["Connector"].items() if d.root == "framework"}
    assert set(kit.protected.names["mode"]) == {m for m, d in kit.docs["Mode"].items() if d.root == "framework"}
    assert kit.protected.open_envs() == ["workspace", "research"]
    assert model.schema_errors(model.load_yaml(KIT / MAP), model.schema("components")) == []
    assert lint.lint_protection(kit) == [] and lint.lint_owner_only(kit) == []


def test_a_role_without_forge_extend_cannot_write_a_path_the_map_lists():
    k = _built(lambda d: d["protected"]["paths"].append("vault"))
    try:
        pol, decide = _guard(k)
        assert pol["protected"] == ["framework", "bay", "schemas", "adapters", "vault", *PROTECTED_INSTANCES]
        put ={"file_path": "vault/key.txt", "content": "x"}
        # workspace writes "." and delivery's builder works there, yet the map says only forge.extend may write vault/
        assert decide("Write", put, "builder--delivery") == "deny"
        assert decide("Write", {"file_path": "src/app.py", "content": "x"}, "builder--delivery") == "pass"
        assert decide("Write", put, "builder--forge--local-authoring") == "deny"
        # forge.extend's env does not name it, so the guard denies it there too: the lint says what to add (D9)
        assert decide("Write", put, "builder--forge--framework-dev") == "deny"
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("env framework-dev writes protected paths but not vault" in e for e in errs), errs
        edit_yaml(k / "envs/framework-dev.yaml", lambda d: d["spec"]["fs"]["write"].insert(4, "vault"))
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
        edit_yaml(k / "modes/delivery/mode.yaml", lambda d: d["spec"]["roles"].update({"builder": "workspace"}))
        edit_yaml(k / "envs/workspace.yaml", lambda d: d["spec"]["fs"].update({"write": ["vault", "src"]}))
        g = [x for x in gaps(k) if "can write vault" in x]
        assert g and "only forge.extend may change the framework" in g[0], gaps(k)
        kit = model.Kit(k)
        assert model.protected_writes(kit, kit.get("Environment", "workspace")) == ["vault"]
    finally:
        cleanup(k)


def test_lint_keeps_framework_dev_in_step_with_the_map_both_ways():
    k = kit_copy()
    try:
        edit_yaml(k / "envs/framework-dev.yaml", lambda d: d["spec"]["fs"]["write"].remove("adapters"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("framework-dev writes protected paths but not adapters" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:                                  # a moved instance the env stops naming is reported, with its path
        edit_yaml(k / "envs/framework-dev.yaml", lambda d: d["spec"]["fs"]["write"].remove("modes/cos"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("framework-dev writes protected paths but not modes/cos" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:                                  # an instance path the map no longer lists is stale in fs.write
        assert not [e for e in lint.lint_protection(model.Kit(k, k)) if "fs.write names" in e]   # listed: fine
        edit_yaml(k / MAP, lambda d: d["protected"]["connector"].remove("ledger"))
        errs = lint.lint_protection(model.Kit(k, k))
        assert any("fs.write names connectors/ledger" in e for e in errs), errs
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
        pol.pop("protected")                                  # a policy without the key: the guard fails open, check says so
        (k / ".agentbay/guard.json").write_text(json.dumps(pol))
        assert [w for w in lint.warnings(model.Kit(k, k)) if "guard.json" in w]
    finally:
        cleanup(k)


# ----------------------------------------------------------------- fail closed
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
            # closed means closed: every name reserved, every path covered, nobody may be placed anywhere protected
            assert kit.protected.reserved("mode", "anything") and kit.covers("src/app.py")
            assert not kit.protected.may_place("delivery", "workspace")
            assert gaps(k), label                                    # nothing resolves
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


# ----------------------------------------------------------------- reserved names
def test_a_name_is_protected_wherever_it_sits_and_is_defined_once():
    """Stage 5 part G: one folder per kind, so there is no second place for a protected name. The map protects an
    instance by name wherever it sits; naming an ordinary one puts its path in the policy and asks framework-dev to
    name it (D9); `Kit` loads no name twice."""
    put = {"file_path": "connectors/fake/fake.py", "content": "x"}
    k = _built()
    try:
        assert model.Kit(k, k).get("Connector", "fake").root == "user"
        _, decide = _guard(k)
        assert decide("Write", put, "builder--forge--local-authoring") == "pass"          # an ordinary connector
    finally:
        cleanup(k)
    k = _built(lambda d: d["protected"]["connector"].append("fake"))
    try:
        kit = model.Kit(k, k)
        assert kit.get("Connector", "fake").root == "framework" and kit.protected_paths()[-1] == "connectors/fake"
        pol, decide = _guard(k)
        assert pol["protected"][-1] == "connectors/fake"
        assert decide("Write", put, "builder--forge--local-authoring") == "deny"
        assert decide("Write", put, "builder--forge--framework-dev") == "deny"            # until framework-dev names it
        errs = lint.lint_protection(kit)
        assert any("env framework-dev writes protected paths but not connectors/fake" in e for e in errs), errs
    finally:
        cleanup(k)
    k = kit_copy()
    try:                                  # a name defined twice (an interface in both places) is an error, not a pick
        (k / "interfaces").mkdir()
        src = k / "framework/interfaces/items.store.v1.yaml"
        (k / "interfaces/items.store.v1.yaml").write_text(src.read_text())
        assert any("Interface 'items.store/v1' is defined twice" in e for e in model.Kit(k).errors)
    finally:
        cleanup(k)


def test_a_user_mode_may_place_roles_only_in_the_protected_envs_the_map_opens_to_it():
    k = kit_copy()
    try:
        edit_yaml(k / "modes/delivery/mode.yaml", lambda d: d["spec"]["roles"].update({"builder": "local-authoring"}))
        assert any("works in the framework env local-authoring" in g and "research and workspace" not in g
                   and "workspace and research" in g for g in gaps(k)), gaps(k)
        edit_yaml(k / MAP, lambda d: d["protected"]["env"].update({"local-authoring": {"modes": ["delivery"]}}))
        assert not [g for g in gaps(k) if "works in the framework env" in g]
        edit_yaml(k / MAP, lambda d: d["protected"]["env"].update({"local-authoring": {}, "workspace": {"modes": []}}))
        edit_yaml(k / "modes/delivery/mode.yaml", lambda d: d["spec"]["roles"].update({"builder": "workspace"}))
        assert any("works in the framework env workspace" in g for g in gaps(k)), gaps(k)
    finally:
        cleanup(k)


# ----------------------------------------------------------------- bay check --base
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
    "protected": {"paths": ["adapters"], "mode": ["cos"], "env": {"cos-local": {}}, "connector": ["ledger"]},
    "components": {"kernel": {"owns": ["bay/"], "contracts": {
        "mode": {"at": ["modes/<name>/"]}, "env": {"at": ["envs/<name>.yaml"]}, "connector": {"at": ["connectors/<name>/"]},
        "adapter": {"at": ["adapters/<name>/"]}}}}}
BASE = {"bay/cli.py": "x\n", "modes/cos/mode.yaml": "x\n", "modes/cos/features/run/playbook.md": "x\n",
        "modes/mail/mode.yaml": "x\n", "envs/cos-local.yaml": "x\n", "envs/mine.yaml": "x\n",
        "connectors/ledger/connector.yaml": "x\n", "connectors/gmail/connector.yaml": "x\n",
        "adapters/claude-code/adapter.yaml": "x\n"}


def _check(change, touches=(), base=BASE, mapdoc=BOUNDARY_MAP):
    repo = _repo(base, change, mapdoc)
    return boundary.check(repo, "HEAD~1", "HEAD", None, [{"path": t, "reason": "r"} for t in touches])


def test_an_edit_to_a_protected_component_without_touches_fails_check_base():
    for path in ("modes/cos/mode.yaml", "envs/cos-local.yaml", "connectors/ledger/connector.yaml",
                 "adapters/claude-code/adapter.yaml"):
        rep = _check({path: "y\n"})
        assert [f.path for f in rep.failures] == [path] and rep.exit_code == 1, path
        assert not _check({path: "y\n"}, touches=[path]).failures, path
    # a feature of a protected mode keeps its B-3 rule: a whole-mode entry does not list it
    rep = _check({"modes/cos/features/run/playbook.md": "y\n"}, touches=["modes/cos/"])
    assert [f.rule for f in rep.failures] == ["B-3"]
    # an unprotected component of the same kinds is unchanged: edits still need touches (B-2), new ones do not
    assert [f.path for f in _check({"modes/mail/mode.yaml": "y\n"}).failures] == ["modes/mail/mode.yaml"]
    assert not _check({"modes/news/mode.yaml": "y\n", "envs/new.yaml": "y\n", "connectors/rss/connector.yaml": "y\n"}).failures


def test_a_new_folder_of_a_protected_name_or_in_a_protected_folder_is_not_a_new_extension():
    base = {k: v for k, v in BASE.items() if not k.startswith(("modes/cos", "envs/cos-local", "connectors/ledger"))}
    for path in ("modes/cos/mode.yaml", "envs/cos-local.yaml", "connectors/ledger/ledger.py", "adapters/other/adapter.yaml"):
        rep = _check({path: "y\n"}, base=base)
        assert [f.path for f in rep.failures] == [path] and rep.failures[0].rule == "protected", path
        assert "only forge.extend" in rep.lines()[0] and "even when the folder is new" in rep.lines()[0]
        assert not _check({path: "y\n"}, touches=[path], base=base).failures, path
    assert not _check({"modes/cosmos/mode.yaml": "y\n", "connectors/ledger2/connector.yaml": "y\n"}, base=base).failures


def test_a_malformed_protected_block_makes_check_base_refuse_and_the_judging_map_is_the_bases():
    for bad in ({"protected": ["adapters"]}, {"protected": None},
                {"protected": {"paths": ["../x"], "mode": [], "env": {}, "connector": []}},
                {"protected": {"paths": ["x"], "mode": [], "env": {}}}):
        try:
            _check({"bay/cli.py": "y\n"}, mapdoc={**BOUNDARY_MAP, **bad})
            raise AssertionError(bad)
        except RuntimeError as e:
            assert "protected:" in str(e), e
    # the change that deletes the block is judged by the base's block (N-2), and the map is core: it needs touches too
    no_block = {k: v for k, v in BOUNDARY_MAP.items() if k != "protected"}
    rep = _check({MAP: yaml.safe_dump(no_block), "adapters/claude-code/adapter.yaml": "y\n"})
    assert {f.path for f in rep.failures} == {"adapters/claude-code/adapter.yaml", MAP}
    assert not _check({MAP: yaml.safe_dump(no_block), "adapters/claude-code/adapter.yaml": "y\n"},
                      touches=[MAP, "adapters/claude-code/adapter.yaml"]).failures


# ----------------------------------------------------------------- case variants of a protected name
def test_a_user_mode_named_cos_or_forge_in_another_case_is_stopped_everywhere():
    """A protected name is matched exactly, but a folder `modes/Cos/` is the same folder as `modes/cos/` on a
    case-insensitive filesystem. Three things stop it: `bay new` (names are lowercase), the boundary check (a
    case-only new folder is not a new extension, F-4) and the case-collision lint on the tracked paths (F-4)."""
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
            assert not [p for p in (k / "modes").iterdir() if p.name in ("Cos", "FORGE")]
    finally:
        cleanup(k)
    variants = {"modes/Cos/mode.yaml": "y\n", "modes/FORGE/mode.yaml": "y\n", "connectors/LEDGER/connector.yaml": "y\n",
                "envs/Cos-Local.yaml": "y\n"}
    base = {**BASE, "modes/forge/mode.yaml": "x\n"}
    for path in variants:
        rep = _check({path: variants[path]}, base=base)
        assert [f.path for f in rep.failures] == [path] and rep.exit_code == 1, path
    repo = _repo(base, variants, BOUNDARY_MAP)
    errs = lint.lint_case_and_manifests(SimpleNamespace(root=repo))
    for want in ("modes/Cos", "modes/FORGE", "connectors/LEDGER", "envs/Cos-Local.yaml"):
        assert any(want in e and "differs only in case" in e for e in errs), (want, errs)
    assert not lint.lint_case_and_manifests(SimpleNamespace(root=_repo(base, {}, BOUNDARY_MAP)))


# ----------------------------------------------------------------- approvals still pass the gate
def _cli_approve(k, cid, *args):
    return subprocess.run([sys.executable, str(k / "bay/cli.py"), "approve", cid, *args, "--project", str(k)],
                          capture_output=True, text=True, input="")


def test_approval_from_chat_and_from_the_terminal_both_pass_the_gate():
    k = kit_copy()
    try:
        (k / "agentbay.config.yaml").write_text(yaml.safe_dump({"apiVersion": "agentbay/v2", "approvals": {"chat": True}}))
        get("claude-code").build(system(k, k), k, k)
        pol, decide = _guard(k)
        assert pol["protected"] == ["framework", "bay", "schemas", "adapters", *PROTECTED_INSTANCES]
        assert decide("Bash", {"command": ".agentbay/bay approve C-1 --via chat --quote ok"}, None) != "deny"   # the main thread relays
        assert decide("Bash", {"command": ".agentbay/bay approve C-1"}, "builder--forge--framework-dev") == "deny"
        d = dispatch.Dispatcher(system(k, k), k)
        ok = {"status": "done", "summary": "s"}
        chat = d.submit(d.call("forge.extend", {"goal": "a small change"})["callId"], "propose", ok)["callId"]
        r = _cli_approve(k, chat, "--via", "chat", "--quote", "approve the proposal")
        assert r.returncode == 0, r.stderr
        assert d.show(chat)["next"]["step"] == "implement"
        tty = d.submit(d.call("forge.extend", {"goal": "another change"})["callId"], "propose", ok)["callId"]
        assert d.approve(tty, True, by="user@tty")["next"]["step"] == "implement"
        assert _cli_approve(k, tty).returncode != 0           # a plain CLI call without a TTY is still refused
    finally:
        cleanup(k)


# ----------------------------------------------------------------- improve is an ordinary mode (part H)
WRITERS = ("builder--forge--local-authoring", "builder--delivery")


def test_improve_is_an_ordinary_mode_while_its_env_and_connectors_stay_protected():
    kit = model.Kit(KIT)
    assert set(kit.protected.names["mode"]) == {"cos", "forge"} and "modes/improve" not in kit.protected_paths()
    assert not kit.protected.reserved("mode", "improve")
    s = model.resolve(kit)
    assert [s.modes[m].root for m in ("improve", "cos", "forge", "delivery")] == ["user", "framework", "framework", "user"]
    # D3: the env and the nine connectors stay protected; only improve (and the protected modes) may use improve-local
    assert "improve-local" in kit.protected.names["env"] and kit.protected.may_place("improve", "improve-local")
    assert not kit.protected.may_place("delivery", "improve-local") and kit.protected.may_place("delivery", "workspace")
    for c in ("improve-detect", "improve-store", "claude-transcripts", "ledger", "git", "artifact-graph"):
        assert kit.protected.reserved("connector", c), c
    assert lint.lint_protection(kit) == []
    k = kit_copy()
    try:                                      # a user mode cannot put a role in improve-local
        edit_yaml(k / "modes/delivery/mode.yaml", lambda d: d["spec"]["roles"].update({"builder": "improve-local"}))
        assert any("works in the framework env improve-local" in g for g in gaps(k)), gaps(k)
    finally:
        cleanup(k)


def test_improve_files_are_writable_like_any_user_mode_and_its_env_and_connectors_are_not():
    k = _built()
    try:
        _, decide = _guard(k)
        for who in WRITERS:
            for path in ("modes/improve/mode.yaml", "modes/improve/README.md", "modes/improve/features/scan/playbook.md"):
                assert decide("Write", {"file_path": path, "content": "x"}, who) == "pass", (who, path)
                assert decide("Edit", {"file_path": path, "old_string": "a", "new_string": "b"}, who) == "pass", (who, path)
            for path in ("envs/improve-local.yaml", "connectors/improve-store/store.py", "connectors/improve-detect/pipeline.py",
                         "connectors/claude-transcripts/parser.py", "modes/cos/mode.yaml", "modes/forge/mode.yaml"):
                assert decide("Write", {"file_path": path, "content": "x"}, who) == "deny", (who, path)
        # improve's own analyst writes nothing; forge.extend's builder writes protected paths only (D9), so a change to
        # improve goes through a mode-fix task (forge.create's builder), not forge.extend
        assert decide("Write", {"file_path": "modes/improve/mode.yaml", "content": "x"}, "analyst--improve") == "deny"
        assert decide("Write", {"file_path": "modes/improve/mode.yaml", "content": "x"}, "builder--forge--framework-dev") == "deny"
        assert decide("Write", {"file_path": "modes/cos/mode.yaml", "content": "x"}, "builder--forge--framework-dev") == "pass"
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
        scaffold.create(k, "feature", "extra", target="improve")           # a feature may be added to an ordinary mode
        assert (k / "modes/improve/features/extra").is_dir()
    finally:
        cleanup(k)


def test_check_base_treats_a_new_improve_folder_as_a_new_extension_but_not_its_connectors_or_cos():
    shipped = yaml.safe_load((KIT / MAP).read_text())                   # the real map, as the base's map
    change = {"modes/improve/mode.yaml": "y\n", "modes/cos/mode.yaml": "y\n", "connectors/improve-store/connector.yaml": "y\n",
              "connectors/mine/connector.yaml": "y\n"}
    rep = boundary.check(_repo({"bay/cli.py": "x\n"}, change, shipped), "HEAD~1", "HEAD", None, [])
    assert sorted(f.path for f in rep.failures) == ["connectors/improve-store/connector.yaml", "modes/cos/mode.yaml"], \
        [(f.path, f.rule) for f in rep.failures]
    assert {f.rule for f in rep.failures} == {"protected"}


# ----------------------------------------------------------------- D4: improve.findings decide is ownerOnly
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

    def user_mode(k):                       # a user mode, listing the capability and `by: user@tty` as the old file could
        def add(d):
            d["spec"]["needs"].append("improve.findings/v1")
            d["spec"]["features"]["research"]["steps"].append(
                {"id": "decide", "run": DECIDE, "with": {"id": "F-1", "decision": "approve", "by": "user@tty"}})
        edit_yaml(k / "modes/delivery/mode.yaml", add)

    def improve_mode(k):                    # the improve mode itself
        edit_yaml(k / "modes/improve/mode.yaml", lambda d: d["spec"]["features"]["backlog"]["steps"].append(
            {"id": "decide", "run": DECIDE, "with": {"id": "F-1", "decision": "approve", "by": "user@tty"}}))

    def not_in_needs(k):                    # refused for what it is, not for a missing `needs`
        edit_yaml(k / "modes/delivery/mode.yaml", lambda d: d["spec"]["features"]["research"]["steps"].append(
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
        D(p).run_capability("improve", DECIDE, {"id": fid, "decision": "approve", "by": "user@tty"})   # the owner's command
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
        r = cli("--via", "chat", "--quote", "yes", "--sha", "abcdef12")
        assert r.returncode != 0 and "decided at a terminal" in r.stderr             # never from chat
        r = cli("--defer", "--reason", "later")                                        # `bay approve <F-id>` still decides
        assert r.returncode == 0, r.stderr
        assert [f for f in findings(p) if f["id"] == fid][0]["status"] == "deferred"
    finally:
        cleanup(p)
