---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. The layout was decided by the owner in chat on 2026-11-04 and is followed here as given. Every line cited was read on feat/component-layout at 3.2.0 (main 9a36bd2). The counts and line costs were measured by plan 0021 on a scratch copy of the tree, where the plan and this proposal differ the plan wins; readable code is expected to cost about 5 lines more than the measured version (see Measured and estimated).
id: "0021"
status: draft
touches:
  - { path: bay/model.py, reason: "KINDS globs one level deeper (interfaces, mode, envs, connectors, component); the `components/*/data` glob of data_schema; a component's folder is read from its path; two messages that name components/<name>/ (0 net lines, measured)" }
  - { path: bay/contenttypes.py, reason: "scan finds `components/*/*/content-types/*/content-type.yaml`; the folder name must equal spec.kind (+2 lines)" }
  - { path: bay/graph.py, reason: "the `components/*/data/*.schema.json` glob one level deeper (one line wrapped, it would pass 120 characters; +1 line)" }
  - { path: bay/boundary.py, reason: "_COMPONENT matches `components/(base|modes)/<name>/`; root() returns that folder, so every B-1 to B-4 decision keeps working. instance_names (B-11) does not: it names a component only from a manifest at the folder root, so it also names the folder of every manifest under components/modes/, nested ones included (+2 measured, +3 written plainly)" }
  - { path: bay/lint.py, reason: "the fs.write sync regex at :864 (matches no new path, so the check passes vacuously); the connector placement rule goes (-9); new: composition check with _home (about +33, the env uses add 3), the FOLDER_MANIFESTS table that replaces the root-only manifest check (+6), the stray-folder message with TIERS (+4); regexes and messages 0; net +37 measured" }
  - { path: bay/scaffold.py, reason: "mode, connector and content-type scaffolds write into components/modes/<mode>/; one _mode_dir helper for every kind that needs a mode (+11, it replaces the feature branch's and the env's own checks, -6); the content-type branch and KINDS entry (+9); net +14 measured" }
  - { path: bay/cli.py, reason: "`bay new` accepts the kind `content-type`; the --mode check becomes `args.kind != mode`; the USAGE text names the new depth (0 net lines, measured)" }
  - { path: bay/guard.py, reason: "LINT_CONFIG_DIR is components/base/python (the dir the ruff and mypy flags may name); no new line" }
  - { path: bay/templates/, reason: "the connector README and mode README text name the new folders" }
  - { path: bay/templates/content-type/, reason: "NEW: content-type.yaml, fields.schema.json, views.sql (13, 10 and 1 lines, not Python)" }
  - { path: schemas/mode.schema.json, reason: "optional `spec.composes` (a list of mode names); the Type description names components/<tier>/<mode>/types/" }
  - { path: schemas/component.schema.json, reason: "the description says components/base/<name>/ (a shared set lives only in base)" }
  - { path: schemas/content-type.schema.json, reason: "the description says <mode>/content-types/<kind>/ and that the folder name is the kind" }
  - { path: schemas/config.schema.json, reason: "the description names components/<tier>/<mode>/envs/<env>.yaml" }
  - { path: schemas/rules.schema.json, reason: "the description names components/<tier>/<mode>/features/..." }
  - { path: framework/kernel.yaml, reason: "every protected path and owns: glob moves under components/base/; claude-transcripts becomes components/base/improve/connectors/claude-transcripts; protection is not widened" }
  - { path: framework/roles/builder.yaml, reason: "the two lint commands name components/base/python/ruff.toml and mypy.ini" }
  - { path: framework/rules/conformance.yaml, reason: "rule C-7 restates the old placement rule in prose (a source connector is a component of its own); it is reworded to the new folder rule, not just given a new path; two other path mentions" }
  - { path: adapters/claude-code/claude_code.py, reason: "messages name components/<mode>/ and components/cos/; the f-string at :430 builds components/{mode} and is not caught by the text rewrite, so it is edited by hand" }
  - { path: adapters/claude-code/tests/, reason: "skill source paths in test_adapter.py (8 lines)" }
  - { path: components/, reason: "git mv of all 17 top-level folders (242 tracked files) into components/base/ and components/modes/, and of the two connectors that sit inside content types (see What moves). This touch must stay: it is the only reason the boundary check passes the move (see Compatibility and safety)" }
  - { path: components/forge/envs/framework-dev.yaml, reason: "the move window: the first commit adds `components` to fs.write (one path, before docs) so the builder can move and edit the unprotected components; a later commit takes it out again, as in 0010 (see section 6)" }
  - { path: components/base/forge/envs/framework-dev.yaml, reason: "after the move: its fs.write list repeats kernel.yaml's protected paths with the new prefix (the lint at lint.py:855 requires it); the closing commit restores it to the protected list plus plan-writer.yaml, requirements-dev.txt, docs, tests and README.md" }
  - { path: components/base/forge/features/create/, reason: "playbook text and rules: kind connector takes a mode, kind content-type is new (rule R-7 also covers it); CreateReq.schema.json gets the new kind and requires target for every kind but mode" }
  - { path: components/forge/interfaces/forge.scaffold.v1.yaml, reason: "the `kind` enum gains content-type; the `target` description covers every kind but mode. The contract version stays v1 (see Choices, 2)" }
  - { path: components/python/connectors/python-check/python_check.py, reason: "CONFIG_DIR at :21 names the lint config folder; one line changed in place (protected kit code, no line count change)" }
  - { path: components/todo/connectors/todo-rules/, reason: "todo_rules.py:11 derives the kit root as parents[4] and its test tests/test_todo_rules.py:13 does the same; both become parents[5] at the new depth" }
  - { path: components/gmail-api/README.md, reason: "the relative link ../store/README.md at :41 becomes ../../../../base/store/README.md; without it the improve golden's doc-stale count goes from 0 to 1" }
  - { path: components/modes/mail-briefing/, reason: "receives connectors/gmail-api, connectors/fake-mail and content-types/email; its envs, README and tests name the new paths" }
  - { path: components/modes/feed-briefing/, reason: "receives connectors/x-api, connectors/fake and content-types/post" }
  - { path: components/modes/todo/, reason: "receives content-types/todoitem; todo-rules path mentions" }
  - { path: components/base/improve/, reason: "receives connectors/claude-transcripts; its tests, README and golden test name the new paths" }
  - { path: tests/, reason: "310 of the 415 text substitutions are here; about 89 fixture lines in 10 test files are edited by hand (fixtures built at the old depth, f-string paths, one relative entry, parents[4]); cases are added to existing tests, no test function is added" }
  - { path: tests/golden/, reason: "not edited: no golden holds a components/<name> path (measured); the guard-matrix test's window list gains `components` in the first commit and loses it in the closing one" }
  - { path: README.md, reason: "the component definition, the lint commands, the env path, the folder map, the bay new row and the Adding things text (6 edits, no word budget)" }
  - { path: docs/DESIGN.md, reason: "Components section: the two tiers, the folder rule, composition; the placement paragraph goes (2998 -> 2997 words)" }
  - { path: docs/INTERFACES.md, reason: "Components section: the placement rule is replaced by composition and the two refusals, the layout, the recipe for a new source (2987 -> 2988 words)" }
  - { path: framework/limits.yaml, reason: "release step: bay_lines is written down to the real count" }
  - { path: bay/__init__.py, reason: "release step: version 4.0.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading section" }
exceptions:
  - { measure: bay_lines, to: 9620, reason: "9549 is the ceiling and the count. The scratch copy measured 9605 (+56: lint.py +37, scaffold.py +14, boundary.py +2, contenttypes.py +2, graph.py +1; model.py, cli.py and guard.py 0), written densely. Readable code adds about 5 lines, so 9620 leaves a small margin. The release lowers the ceiling to the real count. If it must shrink, the first to go is the content-type scaffold (9 lines): a content type can be written by hand, as it is today; then the unused-composes check (3 lines)." }
---

# 0021: One folder per mode

## Summary

Today `components/` is flat: 17 folders side by side. A mode, the connector that feeds it, and the content type of its items sit in three different folders, and only a naming habit says they belong together. This proposal gives every mode its own folder that holds everything it needs.

What you get:

- `components/base/` holds the framework and the shipped basics: the base modes `store`, `cos`, `forge`, `improve` and `delivery`, and the shared sets `tools`, `python` and `comments`.
- `components/modes/` holds your modes and third-party modes: `feed-briefing`, `mail-briefing`, `todo`, and later ones such as a Facebook messages mode.
- A mode keeps its own source connectors in `<mode>/connectors/` and its own content types in `<mode>/content-types/`. Gmail and the email type live inside `mail-briefing`; X and the post type inside `feed-briefing`; the to-do item type inside `todo`. There is no shared connectors folder and no shared types folder.
- If a second mode needs a connector (or a content type) of another mode, it says so in its `mode.yaml` with one line, `composes: [mail-briefing]`, and `bay check` verifies it. If many modes need it, it moves to `base/` through forge.extend.
- `bay new connector` and `bay new content-type` put the new files inside the mode you name, so a new mode and everything it needs grow in one folder. `bay new` no longer scaffolds into a base mode; those change through forge.extend.

What does not change: mode, connector, env and content-type names; the way an env binds a connector (one line, by name); data folders, store files and settings keys. Only the place on disk changes, and one optional line (`composes`) is new.

It is a pure move plus one rule. Nothing reads the old flat layout: a folder left at the old depth is a `bay check` error that names the `git mv` to run. The release is 4.0.0.

What the build needs from you:

- **The framework-dev write window.** The framework-dev builder may not edit or move the unprotected components (`feed-briefing`, `mail-briefing`, `todo`, `gmail-api`, `x-api`, `post`, `email`, `todoitem`, `delivery`); the guard blocks it, and the golden guard matrix confirms it. 0010 hit the same problem and opened a move window. This work does the same: the plan's first commit adds `components` to framework-dev's `fs.write`, and a later commit takes it out again before release. You read the diff of the first commit, then run `./bay.sh build`. You run `./bay.sh build` again after the move (step 2) and after the window is closed (step 8). Nine commits in all (see section 6).
- **Four decisions at the gate** (see Choices for you), each with a recommendation: `base/` as placement only; no `agentbay/v5`; keep the content-type scaffold; both halves of "folder name = kind".

What it costs: `bay_lines` rises from 9549 to a measured 9605 and needs an exception to 9620. Every other limit (`tests` 463, `kit_python_lines` 5276, `long_lines` 135 and the rest) is unchanged. DESIGN goes 2998 -> 2997 words and INTERFACES 2987 -> 2988, both inside the 3000 budget.

What checking the plan against the code changed in this proposal: five places silently stop working at the new depth (the `fs.write` sync regex, B-11's instance names, the kit root that `todo_rules.py` derives from its own file, one relative README link, and the check that a nested folder holds its own manifest). The folder rule is a real new check, not existing behaviour. And the boundary report of the move passes only because the touches list `components/`.

## The layout

```
components/
  base/                         framework and shipped basics
    store/  cos/  forge/  improve/  delivery/        modes
    tools/  python/  comments/                       shared sets (component.yaml)
    improve/connectors/claude-transcripts/           beside improve's other connectors
  modes/                        yours and third-party
    feed-briefing/   connectors/{x-api,fake}   content-types/post
    mail-briefing/   connectors/{gmail-api,fake-mail}   content-types/email
    todo/            connectors/todo-rules     content-types/todoitem
```

Inside any mode (base or modes) the folders are the ones that exist today: `envs/`, `features/`, `interfaces/`, `skills/`, `types/`, `data/`, `tests/`, `connectors/`. The only new folder name is `content-types/`. The old `types/` keeps meaning request and response types (`Digest`, `AddReq`); a content type is a different thing and gets its own name, as you decided.

## The design

### 1. Discovery at the new depth

Every manifest sits at a fixed place, and the loader finds it by pattern. The patterns in `bay/model.py:28-35` (`KINDS`) gain one level; nothing else about loading changes:

| Kind | Today | After |
|---|---|---|
| Mode | `components/*/mode.yaml` | `components/*/*/mode.yaml` |
| Environment | `components/*/envs/*.yaml` | `components/*/*/envs/*.yaml` |
| Interface | `components/*/interfaces/*.yaml` | `components/*/*/interfaces/*.yaml` |
| Connector | `components/*/connector.yaml` and `components/*/connectors/*/connector.yaml` | `components/*/*/connectors/*/connector.yaml` |
| Component | `components/*/component.yaml` | `components/base/*/component.yaml` |
| Content type | `components/*/content-type.yaml` (`bay/contenttypes.py:275`) | `components/*/*/content-types/*/content-type.yaml` |

Two other globs move the same way: `components/*/data/*.schema.json` in `bay/model.py:71` and `bay/graph.py:149`. `boundary._COMPONENT` (`bay/boundary.py:20`) becomes `components/(base|modes)/([^/]+)/`; `root()` still returns the component folder and its name, so the boundary decisions that call it (`:194`, `:404`) need no other edit. `bay/limits.py` needs none: its test pattern already accepts any depth under `components/` and its kit count asks the protected list, which moves in kernel.yaml.

The top-level connector (`components/gmail-api/connector.yaml`) and top-level content type are no longer patterns, so there is no second place to look. There is no fallback to the old layout. A mode left at `components/my-mode/` is not loaded, and `lint_case_and_manifests` (`bay/lint.py:950`, next to `OLD_FOLDERS` at :947) reports it with one line per stray folder: `components/my-mode/: components holds only base/ and modes/; run git mv components/my-mode components/modes/my-mode`. B-4 already reports every file of a stray folder, so that line comes on top of them.

Names stay unique across the kit (a connector and a mode cannot share a name), so an env still binds `items.source/v1: [x-api]` by name. No path or `mode/connector` syntax is added; DOD-4 (a new source is one connector plus one binding line) holds.

**Five places that fail open at the new depth.** Plain path edits are not enough; each of these keeps passing while checking nothing, so each gets a test that fails on main:

- *The fs.write sync regex* (`bay/lint.py:864`, `_protected_paths_in_sync`) matches none of the new paths, so the check that every `fs.write` path is protected passes vacuously. It becomes `components/(?:base|modes)/...`.
- *B-11's instance names* (`boundary.instance_names`, `bay/boundary.py:448-454`). It names a component only from a manifest at the folder root. After the move `gmail-api`, `x-api`, `post`, `email`, `todoitem` and `claude-transcripts` are no longer names B-11 looks for (measured: 14 names before, 8 after). The fix also names the folder of every manifest under `components/modes/`, nested ones included. That adds `fake`, `fake-mail` and `todo-rules`, with no hit in today's docs. Base connectors stay out on purpose: naming all of them would make `ledger` and `git` hit the core docs 4 times (measured). So `claude-transcripts` drops out of B-11 as a base part; if the owner wants it kept, the price is those 4 hits.
- *The kit root derived from depth.* `todo_rules.py` finds the kit root as `parents[4]` from its own file; it becomes `parents[5]`, in the module and in its test.
- *A relative link.* `components/gmail-api/README.md:41` links `../store/README.md`; it gains `../` for each level it moved. Without that the improve golden's doc-stale count goes from 0 to 1.
- *The nested manifest check.* The existing "extension folder without its manifest" lint looks only at `components/<x>/`. With only the regex fixed, three misplaced manifests pass lint clean (see section 2).

### 2. The folder name is the kind

I read your rule as two checks, both on names:

1. **A content type's folder is its kind.** `content-types/post/` defines the kind `post`. Today `contenttypes._one` (`bay/contenttypes.py:153`) requires `metadata.name` to equal the folder name; it also requires `spec.kind` to equal it (+2 lines). Then `reads: [post/v1]` has exactly one place to look, and `ls content-types/` is the list of kinds the mode defines. It keeps one version of a kind in the kit at a time, which matches the store: it already refuses a second version ("move the folder aside and sync again", `test_content_types.py:149`).
2. **A folder holds one kind of thing.** This half is new behaviour. It is a table in `bay/lint.py`, `FOLDER_MANIFESTS`: five rows of folder patterns, each with the manifest that folder must hold. It replaces the root-only "extension folder without its manifest" check (+6 lines). The loader already refuses a manifest whose `kind:` is not the one its pattern expects (`bay/model.py:314`), but a manifest in the wrong folder simply matches no pattern, and nothing reports it. Three cases pass lint clean today and are reported by the table:
   - a connector manifest at a mode root (`components/modes/rss/connector.yaml`, which is what a user gets from `git mv components/gmail-api components/modes/gmail-api`);
   - `connectors/foo/` with no manifest;
   - a `connector.yaml` inside `content-types/bar/`.

   The same table gives the per-tier rule: `components/modes/<x>/` must hold a `mode.yaml`.

For connectors I read "the folder name equals its kind" as the slot: `connectors/<name>/` holds a `connector.yaml`. I do not read it as `metadata.name` equal to an interface name. `metadata.name` equal to the folder is already enforced (`model.py:326`).

Existing rules stay: an interface file is `<name>.v<N>.yaml`, and the tier folders are exactly `base` and `modes`.

### 3. Composition

Today the lint rule at `bay/lint.py:353-361` decides where a connector sits: one that reaches the network or secrets must be a top-level component, any other lives in its owner. That rule goes (-9). A connector now always lives in a mode, so the question that remains is who may bind it.

**Declared.** A mode under `components/modes/` may list other modes it composes, in `mode.yaml`:

```yaml
spec:
  extends: store
  composes: [mail-briefing]      # may bind its connectors and read its content types
```

`composes` is a list of mode names, optional and not transitive. It is forbidden in a base mode. Only an abstract base can be extended (`model.py:250`) and every base lives in `base/`, so forbidding it there makes the question of inheriting `composes` moot, with no merge code and no extra line (one condition in the check). `schemas/mode.schema.json` gets the property.

**Checked.** A new function in `bay/lint.py`, `lint_composition`, runs once over the kit, called from `run()` after `lint_extension_names`. A helper `_home(path)` returns the `components/<tier>/<name>` folder above a manifest. The function is three plain loops:

1. Collect the envs the mode uses (`model.mode_envs`, which includes envs placed from other modes) plus the envs in its own folder.
2. For those envs, collect the connectors in their `bind:` and `offline.bind:`, and the content types in the mode's `reads:`, each with its home folder.
3. Any home under `components/modes/` other than the mode itself and its `composes` is an error: `mode M uses env X, which binds connector C, which lives in mode N; add composes: [N] to M's mode.yaml, or ask forge.extend to move C to components/base/`. Homes under `components/base/` are always allowed.

- *Envs a mode uses count as uses.* A mode can map a role to another user mode's env (`may_place` restricts only protected envs) and so bind that mode's connectors with no `composes`. Counting the envs the mode uses closes that hole with the same rule. It is the binding check, not "composition of envs", so it is in scope (it adds 3 lines).
- *Reading.* For every kind in a mode's `reads:`, the content type must be defined in the mode itself, under `base/`, or in a composed mode. The existing check that a bound source produces what the mode reads (`lint.py:417-470`) is untouched.
- *Honest declarations.* A name in `composes` must be another mode under `components/modes/`, named from a mode under `components/modes/`, and it must be used at least once. An unused `composes` is an error: it stays small, and removing the last use removes the line.

Elevation to `base/` is not a lint feature: it is a `git mv` into `components/base/` plus the protected paths in kernel.yaml, which only forge.extend may write (B-1). After it, every mode may bind the connector with no `composes`.

This is the whole mechanism: one optional key and one function. I did not add a per-binding syntax such as `mail-briefing/gmail-api` in an env, because it would change the env schema, the resolver and every consumer of `connectors_of`, for the same check.

### 4. Base is placement, protection stays in kernel.yaml

`components/base/` tells a reader "this ships with the framework". It does not protect anything by itself, because `components/base/improve` and `components/base/delivery` are ordinary modes today (`tests/test_protection.py:404-441` assert it) and a single `components/base` entry would change that, would add 11 tests to the `tests` count (measured, 463 -> 474), and would need a second exception. It would also widen what only forge.extend writes, which is a security change of its own. So `framework/kernel.yaml` keeps its entry-by-entry list with the new prefix, and `owns:` keeps its three components. With the list changing only by prefix, the guard-matrix test passes unchanged (measured).

- `components/cos` becomes `components/base/cos`, and likewise `forge`, `store`, `python`, `comments`, `improve/envs/improve-local.yaml`, `improve/connectors/*`, `improve/interfaces`, `tools/envs/*`, `tools/interfaces`.
- `components/claude-transcripts` becomes `components/base/improve/connectors/claude-transcripts` (still protected).
- `components/forge/envs/framework-dev.yaml` repeats the list in `fs.write`; the lint at `bay/lint.py:855` requires that, so it is rewritten with the same prefix.

`forge.create` and `bay new` write only under `components/modes/`; they cannot create in `base/`, so "placement only" still means users do not scaffold into base. A user who hand-writes a folder under `base/` gets what a new folder in `modes/` gets today (B-2); moving it to base and protecting it is a forge.extend change to kernel.yaml.

The case-alias defence moves with the layout. It now rests on `components/base/<Name>/` aliases (the inode guard and the casefolded `at_base`) and on the scaffold's lowercase rule and the loader's name pattern. `test_protection.py`'s case test (`:345-371`) keeps its premise at the same depth: `components/base/Cos/mode.yaml` beside `components/base/cos/`. A user mode `components/modes/Cos/` is no longer a case alias of anything protected.

### 5. What forge.create scaffolds

`bay/scaffold.py` builds the paths in one place (a `MODES = "components/modes"` constant replaces nine inline `components/{name}` strings, lines 74-166). One helper, `_mode_dir(kit, kind, target)`, serves every kind that needs a mode: it requires `--mode`, refuses a protected mode, finds `components/modes/<target>/mode.yaml`, and otherwise says the mode lives in `components/base/` (and changes through forge.extend) or does not exist. It replaces the feature branch's own checks and the env's. After the change:

| Kind | Needs | Writes |
|---|---|---|
| `mode` | name | `components/modes/<name>/` with `mode.yaml`, `playbook.md`, `README.md`, `types/`, `features/run/` (as today) |
| `connector` | `--mode <mode>`, `--implements` | `components/modes/<mode>/connectors/<name>/` with `connector.yaml`, `<module>.py`, `README.md`, `tests/` |
| `content-type` (new) | `--mode <mode>` | `components/modes/<mode>/content-types/<name>/` with `content-type.yaml`, `fields.schema.json`, `views.sql` (`v_{{name}}`) from three templates |
| `env`, `feature` | `--mode <mode>` | as today, under `components/modes/<mode>/` |

`bay new connector x` and `bay new content-type x` without `--mode` name `--mode`. `CreateReq.schema.json` gets the kind `content-type` and requires `target` for every kind but `mode`; the forge create playbook, its rules (R-7's `when` also covers content-type) and the `bay new` help say the same. `forge.scaffold.v1.yaml` gets the enum and a `target` description for every kind but mode. The contract stays v1: `target` is now required for a connector, but that is enforced in code and the schema keeps it optional; the contract is `dispatcherOnly` and its only callers (`bay new`, `forge.create`) change in the same commit. The endpoint in `components/base/forge/connectors/scaffold/` already passes `target`, so it is not touched. `_find_interface` (`scaffold.py:166`) searches `components/*/*/interfaces/`. Protected mode, env and connector names are refused as today, and a connector scaffold into a protected mode is refused like a feature scaffold. The generated TODO for a new source says to add a content type with `bay new content-type` when it produces a new kind, replacing the sentence "a content type component" in INTERFACES.

One behaviour change follows: `bay new feature x --mode delivery` worked on main, because delivery is unprotected. Now it says the mode lives in `components/base/` and changes through forge.extend. That is intended, and the CHANGELOG says so.

### 6. The order of work and the framework-dev write window

framework-dev's `fs.write` lists only protected paths, `docs`, `tests` and `README.md`. The builder can neither `git mv` nor edit the unprotected components, and the guard reads `.agentbay/guard.json` as built, so a widened list takes effect only after you run `./bay.sh build`. As in 0010, the plan opens a move window and closes it again. Each step is one commit, followed by `python3 tests/run.py` and `./bay.sh check --limits` (both green):

1. **Open the window.** framework-dev's `fs.write` gains `components` (one path, before `docs`). You read this diff, because the builder is widening its own write list, then run `./bay.sh build`. Nothing else changes, so the suite and limits are trivially green. The guard-matrix test's `window` list gains `components` in the same position.
2. **The move** (one commit; the tree is red in between, as in 0010 part 1a): the 19 `git mv`, the path rewrite, the 18 path builders, the globs and regexes, removal of the placement rule, kernel.yaml and the protected list with the new prefix, the depth fixes, and every fixture. Then you run `./bay.sh build`. Between this commit and that build the guard names the old paths, so the builder cannot write `components/base/...`; the coordinator asks for the build right away.
3. The folder table and the stray-folder line (`FOLDER_MANIFESTS`, `TIERS`, the content-type rule).
4. B-11 names (`instance_names`).
5. Composition (`composes` in the schema, `lint_composition` with `_home`).
6. Scaffold (`scaffold.py`, `cli.py`, the templates, `forge.scaffold.v1.yaml`, `CreateReq.schema.json`, the create playbook and rules).
7. Docs (README, DESIGN, INTERFACES and conformance C-7).
8. **Close the window.** framework-dev's `fs.write` loses `components`, and the guard-matrix `window` goes back. You run `./bay.sh build`. (8b, only if you choose `agentbay/v5`: the apiVersion bump.)
9. **Release 4.0.0** (CHANGELOG with Upgrading, `bay/__init__.py`, and `./bay.sh check --limits --write ...` once).

Steps 3 to 6 are independent of each other after step 2; docs come after 5 and 6, so they describe what exists. Review checks that step 8 happened: framework-dev's `fs.write` at release equals the protected list plus `plan-writer.yaml`, `requirements-dev.txt`, `docs`, `tests` and `README.md`. Step 2 is large (242 renames, about 60 edited files) and cannot be split, because every intermediate state fails lint (27 problems with the moves alone); it is mechanical, and `git show -M --stat` shows that it is renames plus the listed edits.

## What moves

All with `git mv`, so history follows. 17 top-level folders (242 tracked files, counted with `git ls-files components`) plus the two connectors that sit inside content types today: 19 moves.

| Today | After | Files |
|---|---|---|
| `components/cos` | `components/base/cos` | 13 |
| `components/forge` | `components/base/forge` | 17 |
| `components/improve` | `components/base/improve` | 62 |
| `components/delivery` | `components/base/delivery` | 8 |
| `components/store` | `components/base/store` | 29 |
| `components/tools` | `components/base/tools` | 9 |
| `components/python` | `components/base/python` | 8 |
| `components/comments` | `components/base/comments` | 7 |
| `components/claude-transcripts` | `components/base/improve/connectors/claude-transcripts` | 6 |
| `components/feed-briefing` | `components/modes/feed-briefing` | 12 |
| `components/mail-briefing` | `components/modes/mail-briefing` | 16 |
| `components/todo` | `components/modes/todo` | 18 |
| `components/x-api` | `components/modes/feed-briefing/connectors/x-api` | 5 |
| `components/post` | `components/modes/feed-briefing/content-types/post` | 9 |
| `components/post/connectors/fake` | `components/modes/feed-briefing/connectors/fake` (moved out of the content type) | in the 9 |
| `components/gmail-api` | `components/modes/mail-briefing/connectors/gmail-api` | 8 |
| `components/email` | `components/modes/mail-briefing/content-types/email` | 10 |
| `components/email/connectors/fake-mail` | `components/modes/mail-briefing/connectors/fake-mail` (moved out of the content type) | in the 10 |
| `components/todoitem` | `components/modes/todo/content-types/todoitem` | 5 |

The two nested connectors move first (`post/connectors/fake`, `email/connectors/fake-mail`), then the base and mode folders, then the connectors and content types into their modes, then the emptied `connectors/` folders go.

Nothing needs a composition: `improve` binds `claude-transcripts` in its own env; `mail-briefing` binds only its own connectors; `feed-briefing` and `todo` likewise. The shipped kit therefore declares no `composes`; the first mode that wants Gmail will be the first user.

Tests, goldens and READMEs travel inside their folders. The tests of a moved connector keep importing their own module by folder (`tests/run.py` puts a test file's folder on the path), so no test import changes.

## What references change

Counted on a scratch copy of the tree, excluding `docs/proposals/`, `docs/plans/`, `CHANGELOG.md` and `HANDOFF.md` (history, never edited). A regex rewrite of `components/<old>` makes **415 text substitutions in 47 files**:

| Area | Substitutions |
|---|---|
| `tests/` | 310 |
| `components/` (inside) | 73 |
| `framework/` | 22 |
| `adapters/` | 7 |
| `README.md` | 2 |
| `docs/` | 1 |
| Total | 415 |

A text rewrite misses **18 path builders in 12 Python files** (`KIT / "components" / name`), which are rewritten by hand with the globs and regexes in `bay/`. It also misses f-strings such as `f"components/{home}"` and `f"components/{mode}"` (test_adapter, test_lint, `claude_code.py:430`), the glob in `tests/test_core_names.py:43` and the relative entry in a `test_contract_versions` fixture (`../../../../shared/x_entry.py` needs one more `../`).

Goldens: `tests/golden/*.json` and `components/*/tests/golden/*.json` contain no `components/<name>` path (grep: zero), so none is edited. The guard-matrix golden is not edited either. The improve golden stays at its bytes only if the gmail-api link is fixed (section 1).

Generated files (`.claude/agents/*`, `.agentbay/catalog.json`, skills, shims) name the lint config path; they are regenerated by `./bay.sh build`, not edited. `agentbay.config.yaml` holds no components path: it has `approve:` and `connectors.claude-transcripts.root`, a directory under `~`. `schemas/config.schema.json` mentions the path only in a description.

## The upgrade note for user projects

Goes into the CHANGELOG under Upgrading. There is no migration code; this is a recipe, and `bay check` tells you what is left. The framework-dev write window and its builds are a maintainer matter; users do nothing for them.

1. Update, then run `./bay.sh check`. Every folder at the old depth is reported with the command that fixes it.
2. For each of your modes: `git mv components/<mode> components/modes/<mode>`. The rule per tier is now checked: `components/modes/<x>/` must hold a `mode.yaml`, a connector manifest at a mode root is an error, and `connectors/<x>/` and `content-types/<x>/` must hold their own manifest.
3. For each of your source connectors: `git mv components/<connector> components/modes/<mode>/connectors/<connector>`, where `<mode>` is the mode that binds it. A connector that sat inside a content type (`components/<type>/connectors/<c>`) goes the same way.
4. For each of your content types: `git mv components/<type> components/modes/<mode>/content-types/<type>`, where `<mode>` is the mode whose source produces it. The folder name must equal the kind; `bay check` says so if it does not.
5. If two of your modes use one connector or type, keep it in the mode that owns it and add `composes: [<owner>]` to the other mode's `mode.yaml`. If the framework should own it, propose it with forge.extend. `composes` is not allowed in a base mode.
6. If an env of yours lists `fs.write: [components/<x>, ...]`, give it the new path. `fs.write: [components]` needs nothing.
7. Things that now behave differently:
   - *Copied modes carry their connectors.* Copying a mode folder copies the connectors and content types inside it, and their names are global, so the copy fails with "defined twice" until you rename them or leave them out.
   - *Kit roots derived from depth.* Code that derives the kit root from its own file's folder depth (`parents[4]` and similar) shifts by one level.
   - *Relative links* between components gain `../` for the extra level.
   - *`bay new connector` and `bay new content-type` need `--mode`.*
   - *`bay new` no longer targets a base mode.* `bay new feature x --mode delivery` now says the mode lives in `components/base/` and changes through forge.extend.
8. `agentbay.config.yaml` needs no change: its `modes:` and `connectors:` keys are names, not paths. Data folders, stores and the ledger are untouched.
9. Run `./bay.sh build`, so the agent files carry the new lint command paths.

Open branches: a rebase conflicts on every moved file; git follows renames, so `git rebase` usually resolves them. Say so in the CHANGELOG.

## Tests and limits

### Tests

- **Existing tests move to the new depth.** The text rewrite covers 310 substitutions in `tests/`. About 89 fixture lines in 10 test files are edited by hand: fixtures that build components at the old depth (24 tests in test_boundary, test_protection, test_inheritance, test_roles, test_resolver and test_auth), f-string paths, the `parents[5]` fix in `todo_rules.py` and its test, one `../` in a contract-versions fixture, and `comments_cases.py` building `components/base/clang`. Copying `feed-briefing` in test_roles now copies its connectors and content types, so that copy ignores `envs`, `connectors` and `content-types`. This is mechanical and is where most of the work is.
- **New behaviour is added as cases of existing tests, not new functions.**
  - (a) `test_lint.py`'s table of lint cases: the two placement rows (:149-152) are replaced by five rows: a binding across modes without `composes`; the same with `composes` (clean); an unused `composes`; `composes` in a base mode; a role placed in another user mode's env. A sixth row covers a content type whose `spec.kind` differs from its folder.
  - (b) `test_boundary.py:96-103` (`test_lint_rejects_case_collisions_and_extension_folders_without_manifest`) gains the stray `components/rss/` line (its `git mv` message) and the three folder-table cases; its fixtures move to `components/modes/...`. `test_boundary.py:174` adds a nested connector name to its doc text and expects a B-11 hit.
  - (c) `components/base/forge/tests/test_forge.py` extends `test_bay_new_mode_is_lint_clean_and_resolves` to scaffold a content type and a connector into the new mode and check the files and a clean lint.
  - (d) `test_cli_commands.py:136` (`test_new_checks_the_options_its_kind_needs`) checks that `new connector x` and `new content-type x` without `--mode` name `--mode`.
- **Each fails on main.** On main there is no `composes`, no `content-type` kind, no folder table and no `components/modes/`, so every added case fails at the first assertion.
- **The test count does not grow: 463 stays 463.** Rows and assertions, not functions. Locking all of `base/` would cost +11.
- The two store goldens and the improve golden keep their bytes. The guard-matrix golden is not edited; its test's write list gains `components` in step 1 and loses it in step 8.

### Limits

The nine measures, against the ceilings in `framework/limits.yaml` (all nine are at their ceiling today). Measured on a scratch copy with the code written densely:

| Measure | Ceiling = count | After (measured) | Verdict |
|---|---|---|---|
| `bay_lines` | 9549 | 9605 | over: exception, to 9620 |
| `kit_python_lines` | 5276 | 5276 | `python_check.py` changes one line in place; same files, same protected set |
| `tests` | 463 | 463 | no function added |
| `long_lines` | 135 | 135 | the `graph.py:149` line is wrapped; the content-type message is kept under 121 characters; `scaffold.py`'s `produces:` line was already over 120 and stays one line |
| `cli_commands` 16, `schemas` 16, `framework_folders` 2, `top_level_folders` 7, `comment_lines` 0 | | unchanged | no parser, no schema file, nothing under `framework/` or the root; no comment is written; the templates are not Python |

`bay_lines` +56 measured, by file: `lint.py` +37 (composition and `_home` about +33, the folder table +6, the stray line with `TIERS` +4, the placement rule -9, regexes and messages 0), `scaffold.py` +14 (content-type branch 9, `_mode_dir` 11, minus the feature's and env's own checks 6), `boundary.py` +2, `contenttypes.py` +2, `graph.py` +1, and `model.py`, `cli.py` and `guard.py` 0. Written plainly, with no packed lines, composition and `instance_names` need about 5 lines more; 9620 covers that with a small margin. The release runs `--write` once, which writes the real count as the new ceiling. If the exception must be lower, the first cut is the content-type scaffold (-9), then the unused-`composes` check (-3).

`kit_python_lines` moves no file out of or into the protected set: `gmail-api`, `x-api`, `email`, `post` and `todoitem` were unprotected and stay unprotected; `claude-transcripts` stays protected at its new path.

Docs are at their word budget (3000, `len(text.split())`). Measured by applying draft text to copies of both files:

- **DESIGN.md 2998 -> 2997.** The component and components-intro text gain 9 words, the manifest and mode-contents rows net -2, the placement paragraph (:42-43, 35 words) becomes the composition rule and elevation to base (-8), and line 19 changes "component" to "connector" (0).
- **INTERFACES.md 2987 -> 2988.** The components intro names both tiers (+4), the folder list gains `content-types/<kind>/ (the folder is the kind)` (+4), the placement-rule paragraph becomes composition and the two refusals (-6), the new-source recipe gains `--mode` and `<mode>/connectors/bsky/` (-1 net).
- No draft line names an instance outside a fence (B-11). The builder re-counts both files before the docs commit.
- README has no budget; it gets six edits. conformance.yaml C-7 is reworded: "A component is a folder under `components/base/` or `components/modes/` that holds one mode, with its connectors and content types, or one shared set. A connector is code behind a capability interface and lives in the mode that binds it."

## Compatibility and safety

- **Breaks, with no alias (B-12).** Any component at the old depth stops loading, and `bay check` names the `git mv`. `bay new connector` and `bay new content-type` without `--mode` stop working, and `bay new` no longer scaffolds into a base mode. Nothing else: manifests, names, bindings, settings, data and the ledger are unchanged.
- **apiVersion.** `agentbay/v4` stays, release 4.0.0; see Choices for you, 2, for the counter-argument and the optional separate commit.
- **Safety.** No secret is read, written or shown. Guard and sandbox rules are unchanged except the one path in `guard.py` that names the lint config folder; the guard-matrix golden proves no other decision moved. Protection is not widened or narrowed (section 4); the protected list is recomputed only by prefix. The one widening is the temporary write window, which you read and which is closed before release (section 6).
- **The boundary report of the move.** I ran `bay check --base <base> --proposal 0021` on the scratch tree: 516 changed paths, 0 failing. Counted by side: the old paths show as 198 unowned and 44 core; the new paths show as 242 extension; the rest are 32 core, docs and other. So "every moved file is core or extension exactly as before" is not true. The check judges a change by the base's map and the head's `root()`, so the old paths are unowned or core and every new path, protected ones included, is a new extension. The move passes only because `touches:` lists `components/`. That touch must stay.
- **Extensibility (DOD-4).** A new source is one connector (now inside its mode) and one binding line in the env. A source for another mode's kind adds one `composes` line, which is the only new edit and is the point of the rule.
- **Other risks.** Open branches conflict on the moved files (git follows renames). deadcode and standards compare with renames in mind (0010, 0011), and `test_moving_files_have_no_deadcode_findings` passed on the mechanical tree; a finding that is new only because of the move would be a bug in that matching. A user's flat connector is silent without step 3 of the order, which is why steps 2 and 3 ship in the same release.

## Out of scope

- Protecting all of `components/base/`, and moving `delivery` or `improve` out of the unprotected group.
- Content-type versions or a registry of kinds across projects; kinds stay global names.
- A syntax for binding a connector by path or `mode/connector`.
- Transitive composition, and composition of envs, skills or features (only connectors and content types, and the envs a mode uses, counted as uses of their connectors).
- Any change to `extends:`, the one-level rule or the store.
- A migration command for user projects (the recipe is the note).
- A Facebook messages mode or any new mode.
- Regenerating the guard-matrix golden (0012 slice 8).

## Measured and estimated

Measured on 9a36bd2 (and on a scratch copy with the full change applied, by plan 0021): the 17 folders and their file counts; 242 tracked files under `components/`; 415 text substitutions in 47 files and 18 path builders in 12 Python files; no golden holds a component path; the nine limit counts, all at their ceiling, and their values after the change (`bay_lines` 9605, the rest unchanged); the boundary report of the move (198 old unowned, 44 old core, 242 new extension); DESIGN 2998 -> 2997 and INTERFACES 2987 -> 2988 words; 92 manifests say `apiVersion: agentbay/v4`; lint, resolve and the three composition cases clean on the scratch tree; the full suite at the mechanical stage (530 passed, 46 failing for the causes listed under Tests).

Still estimated: the 5 lines that readable code adds to the dense version (hence 9620), and the 89 fixture lines to edit by hand. The builder re-checks both while writing the code.

## Choices for you

Each is a decision you confirm or change at the gate. My recommendation is stated first.

1. **Base is placement only (recommended).** Decision for you at the gate. Protection stays entry by entry in kernel.yaml with the new prefix; `base/` is where things live, not what is locked, and `bay new` does not scaffold into it. The alternative is to lock all of `base/`: it also locks `delivery` and most of `improve`, adds 11 tests to the count (463 -> 474, measured), needs a second exception and widens what only forge.extend writes.
2. **No `agentbay/v5`, release 4.0.0 (recommended).** Decision for you at the gate. For a bump: 0010 bumped to v4 for its layout move ("the layout is a breaking change to where extensions live"), INTERFACES lists the component folder as contract 0, and a reviewer may read DOD-11 that way. Against a bump: no manifest changes shape (`composes` is optional and additive); a manifest left at the old depth is never loaded, so a version check would never fire on it, and the stray-folder and folder-table messages are what a user meets; a bump rewrites 92 manifests and every `$id` and keeps the special case at `model.py:127`, for no extra signal. The one input contract that tightens is `forge.scaffold/v1.create` (`target` for a connector, enforced in code); keep v1 and name it in the CHANGELOG. If you read DOD-11 strictly, the bump becomes a separate, mechanical commit 8b. It costs 0 net `bay_lines` (the one message changes from v4 to v5), and nothing else in the plan changes.
3. **Content-type scaffold included (recommended).** Decision for you at the gate. You asked that forge.create scaffold a mode "with its connectors and content types inside it". Measured cost: 9 lines in `scaffold.py` (the branch plus the `KINDS` entry), 0 in `cli.py`, and three templates of 13, 10 and 1 lines. The three generated files pass `contenttypes._one` and lint. It is the first thing to cut if `bay_lines` must stay lower.
4. **Folder name equals kind, both halves (recommended).** Decision for you at the gate. Half 1: a content type's `spec.kind` must equal its folder (+2 lines). Half 2: every folder holds the manifest its place names, as a real new check, the `FOLDER_MANIFESTS` table (+6 lines). I read "equals its kind" for connectors as the slot (`connectors/<name>/` holds a `connector.yaml`), not as `metadata.name` equal to an interface name. The alternative is half 1 only, which leaves three misplaced-manifest cases passing lint clean.
