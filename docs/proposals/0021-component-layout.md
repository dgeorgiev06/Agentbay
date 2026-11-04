---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. The layout was decided by the owner in chat on 2026-11-04 and is followed here as given. Every line cited was read on feat/component-layout at 3.2.0 (main 9a36bd2). The counts are measured; the line estimates are estimates until the code is written (see Measured and estimated).
id: "0021"
status: draft
touches:
  - { path: bay/model.py, reason: "KINDS globs one level deeper (interfaces, mode, envs, connectors, component); the `components/*/data` glob of data_schema; a component's folder is read from its path; two messages that name components/<name>/ (+5 net lines)" }
  - { path: bay/contenttypes.py, reason: "scan finds `components/*/*/content-types/*/content-type.yaml`; the folder name must equal spec.kind (+3 lines)" }
  - { path: bay/graph.py, reason: "the `components/*/data/*.schema.json` glob one level deeper (one line wrapped, it would pass 120 characters)" }
  - { path: bay/boundary.py, reason: "_COMPONENT matches `components/(base|modes)/<name>/`; root() returns that folder, so every B-1 to B-4 decision and instance_names keep working (+1 line)" }
  - { path: bay/lint.py, reason: "the connector placement rule goes (-10); new: composition check, unused `composes`, the stray-folder message for the old flat layout, the extension-folder check at the new depth (+28; net +18)" }
  - { path: bay/scaffold.py, reason: "mode, connector and content-type scaffolds write into components/modes/<mode>/; a connector now needs a mode like an env does; new kind `content-type` (+24 lines)" }
  - { path: bay/cli.py, reason: "`bay new` accepts the kind `content-type` (+2 lines)" }
  - { path: bay/guard.py, reason: "LINT_CONFIG_DIR is components/base/python (the dir the ruff and mypy flags may name); no new line" }
  - { path: bay/templates/, reason: "NEW content-type/ templates (content-type.yaml, fields.schema.json, views.sql); the connector README and mode README text name the new folders" }
  - { path: schemas/mode.schema.json, reason: "optional `spec.composes` (a list of mode names); the Type description names components/<tier>/<mode>/types/" }
  - { path: schemas/component.schema.json, reason: "the description says components/base/<name>/ (a shared set lives only in base)" }
  - { path: schemas/content-type.schema.json, reason: "the description says <mode>/content-types/<kind>/ and that the folder name is the kind" }
  - { path: schemas/config.schema.json, reason: "the description names components/<tier>/<mode>/envs/<env>.yaml" }
  - { path: schemas/rules.schema.json, reason: "the description names components/<tier>/<mode>/features/..." }
  - { path: framework/kernel.yaml, reason: "every protected path and owns: glob moves under components/base/; claude-transcripts becomes components/base/improve/connectors/claude-transcripts; protection is not widened" }
  - { path: framework/roles/builder.yaml, reason: "the two lint commands name components/base/python/ruff.toml and mypy.ini" }
  - { path: framework/rules/conformance.yaml, reason: "two path mentions (forge mode file, folder wording)" }
  - { path: adapters/claude-code/claude_code.py, reason: "two messages name components/<mode>/ and components/cos/" }
  - { path: adapters/claude-code/tests/, reason: "skill source paths in test_adapter.py (8 lines)" }
  - { path: components/, reason: "git mv of all 17 top-level folders (242 tracked files) into components/base/ and components/modes/, and of the two connectors that sit inside content types (see What moves)" }
  - { path: components/base/forge/envs/framework-dev.yaml, reason: "its fs.write list repeats kernel.yaml's protected paths (the lint at lint.py:855 requires it)" }
  - { path: components/base/forge/features/create/, reason: "playbook text and rules: kind connector takes a mode, kind content-type is new; CreateReq.schema.json gets the same" }
  - { path: components/base/forge/connectors/scaffold/, reason: "the endpoint that calls bay.scaffold passes the mode for a connector and a content type" }
  - { path: components/modes/mail-briefing/, reason: "receives connectors/gmail-api, connectors/fake-mail and content-types/email; its envs, README and tests name the new paths" }
  - { path: components/modes/feed-briefing/, reason: "receives connectors/x-api, connectors/fake and content-types/post" }
  - { path: components/modes/todo/, reason: "receives content-types/todoitem; todo-rules path mentions" }
  - { path: components/base/improve/, reason: "receives connectors/claude-transcripts; its tests, README and golden test name the new paths" }
  - { path: tests/, reason: "about 376 lines name components/<name>: the fixtures and expected strings move to the new depth; cases are added to existing tests, no test function is added" }
  - { path: tests/golden/, reason: "not edited: no golden holds a components/<name> path (measured)" }
  - { path: README.md, reason: "layout block, the component definition, the lint commands, the new-source sentence (6 lines)" }
  - { path: docs/DESIGN.md, reason: "Components section: the two tiers, the folder rule, composition; paid for by cuts (see Cost)" }
  - { path: docs/INTERFACES.md, reason: "Components section: the placement rule is replaced by the layout, the recipe for a new source; paid for by cuts (see Cost)" }
  - { path: framework/limits.yaml, reason: "release step: bay_lines is written down to the real count" }
  - { path: bay/__init__.py, reason: "release step: version 4.0.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading section" }
exceptions:
  - { measure: bay_lines, to: 9610, reason: "9549 is the ceiling and the count. The estimate in Cost is +65 gross and -10 for the placement rule that goes, so +55; 9610 leaves a margin of 6. The release lowers the ceiling to the real count. If it must shrink, the first to go is the content-type scaffold (about 14 lines): a content type can be written by hand, as it is today." }
---

# 0021: One folder per mode

## Summary

Today `components/` is flat: 17 folders side by side. A mode, the connector that feeds it, and the content type of its items sit in three different folders, and only a naming habit says they belong together. This proposal gives every mode its own folder that holds everything it needs.

What you get:

- `components/base/` holds the framework and the shipped basics: the base modes `store`, `cos`, `forge`, `improve` and `delivery`, and the shared sets `tools`, `python` and `comments`.
- `components/modes/` holds your modes and third-party modes: `feed-briefing`, `mail-briefing`, `todo`, and later ones such as a Facebook messages mode.
- A mode keeps its own source connectors in `<mode>/connectors/` and its own content types in `<mode>/content-types/`. Gmail and the email type live inside `mail-briefing`; X and the post type inside `feed-briefing`; the to-do item type inside `todo`. There is no shared connectors folder and no shared types folder.
- If a second mode needs a connector (or a content type) of another mode, it says so in its `mode.yaml` with one line, `composes: [mail-briefing]`, and `bay check` verifies it. If many modes need it, it moves to `base/` through forge.extend.
- `bay new connector` and `bay new content-type` put the new files inside the mode you name, so a new mode and everything it needs grow in one folder.

What does not change: mode, connector, env and content-type names; the way an env binds a connector (one line, by name); data folders, store files and settings keys. Only the place on disk changes, and one optional line (`composes`) is new.

It is a pure move plus one rule. Nothing reads the old flat layout: a folder left at the old depth is a `bay check` error that names the `git mv` to run. The release is 4.0.0.

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

Two other globs move the same way: `components/*/data/*.schema.json` in `bay/model.py:71` and `bay/graph.py:149`. `boundary._COMPONENT` (`bay/boundary.py:20`) becomes `components/(base|modes)/([^/]+)/`; `root()` still returns the component folder and its name, so the boundary decisions that call it (`:194`, `:404`, `:451`) need no other edit. `bay/limits.py` needs none: its test pattern already accepts any depth under `components/` and its kit count asks the protected list, which moves in kernel.yaml.

The top-level connector (`components/gmail-api/connector.yaml`) and top-level content type are no longer patterns, so there is no second place to look. There is no fallback to the old layout. A mode left at `components/my-mode/` is not loaded, and `lint_ownership` (`bay/lint.py:956`, the same place that reports `OLD_FOLDERS`) reports it: the message reads `components/my-mode/: components holds only base/ and modes/; run git mv components/my-mode components/modes/my-mode`. The "extension folder without its manifest" check (`lint.py:966-974`) works at the new depth.

Names stay unique across the kit (a connector and a mode cannot share a name), so an env still binds `items.source/v1: [x-api]` by name. No path or `mode/connector` syntax is added; DOD-4 (a new source is one connector plus one binding line) holds.

### 2. The folder name is the kind

I read your rule as two checks, both on names:

1. **A content type's folder is its kind.** `content-types/post/` defines the kind `post`. Today `contenttypes._one` (`bay/contenttypes.py:153`) requires `metadata.name` to equal the folder name; it also requires `spec.kind` to equal it (+3 lines). Then `reads: [post/v1]` has exactly one place to look, and `ls content-types/` is the list of kinds the mode defines.
2. **A folder holds one kind of thing.** `connectors/<name>/` holds only `connector.yaml` manifests, `content-types/<name>/` only `content-type.yaml`, `envs/` only envs. The loader already refuses a manifest whose `kind:` is not the one its pattern expects (`bay/model.py:314`), and a manifest in the wrong folder matches no pattern, so the existing "folder without its manifest" lint reports it. Nothing new is needed for this half; it is written down in INTERFACES.

Existing rules stay: the manifest name equals its folder (`model.py:326`), an interface file is `<name>.v<N>.yaml`, and the tier folders are exactly `base` and `modes`.

### 3. Composition

Today the lint rule at `bay/lint.py:353-361` decides where a connector sits: one that reaches the network or secrets must be a top-level component, any other lives in its owner. That rule goes. A connector now always lives in a mode, so the question that remains is who may bind it.

**Declared.** A mode may list other modes it composes, in `mode.yaml`:

```yaml
spec:
  extends: store
  composes: [mail-briefing]      # may bind its connectors and read its content types
```

`composes` is a list of mode names, optional, not inherited, not transitive. `schemas/mode.schema.json` gets the property.

**Checked.** A new function in `bay/lint.py`, `lint_composition`, runs once over the kit:

- *Binding.* For every env, for every connector in its `bind:` and `offline.bind:`, the connector's component (read from its path) must be one of: the env's own component; any component under `components/base/`; or a mode in `composes` of the env's mode. Otherwise: `env X of mode M binds connector C, which lives in mode N; add composes: [N] to M's mode.yaml, or ask forge.extend to move C to components/base/`.
- *Reading.* For every kind in a mode's `reads:`, the content type must be defined in the mode itself, under `base/`, or in a composed mode. The existing check that a bound source produces what the mode reads (`lint.py:417-470`) is untouched.
- *Honest declarations.* A name in `composes` must be a mode under `components/modes/` that is not the mode itself, and at least one of its connectors or kinds must actually be used. An unused `composes` is an error: it stays small, and removing the last use removes the line.

Elevation to `base/` is not a lint feature: it is a `git mv` into `components/base/` plus the protected paths in kernel.yaml, which only forge.extend may write (B-1). After it, every mode may bind the connector with no `composes`.

This is the whole mechanism: one optional key and one function. I did not add a per-binding syntax such as `mail-briefing/gmail-api` in an env, because it would change the env schema, the resolver and every consumer of `connectors_of`, for the same check.

### 4. Base is placement, protection stays in kernel.yaml

`components/base/` tells a reader "this ships with the framework". It does not protect anything by itself, because `components/base/improve` and `components/base/delivery` are ordinary modes today (`tests/test_protection.py:404-441` assert it) and a single `components/base` entry would change that, would add 11 improve tests to the `tests` count, and would need an exception. So `framework/kernel.yaml` keeps its entry-by-entry list with the new prefix, and `owns:` keeps its three components:

- `components/cos` becomes `components/base/cos`, and likewise `forge`, `store`, `python`, `comments`, `improve/envs/improve-local.yaml`, `improve/connectors/*`, `improve/interfaces`, `tools/envs/*`, `tools/interfaces`.
- `components/claude-transcripts` becomes `components/base/improve/connectors/claude-transcripts` (still protected).
- `components/forge/envs/framework-dev.yaml` repeats the list in `fs.write`; the lint at `bay/lint.py:855` requires that, so it is rewritten with the same prefix.

`forge.create` writes only under `components/modes/`; it cannot create in `base/`. A user who hand-writes a folder under `base/` gets what a new folder in `modes/` gets today (B-2); moving it to base and protecting it is a forge.extend change to kernel.yaml.

### 5. What forge.create scaffolds

`bay/scaffold.py` builds the paths in one place (a `components/modes/` constant replaces nine inline `components/{name}` strings, lines 74-166). After the change:

| Kind | Needs | Writes |
|---|---|---|
| `mode` | name | `components/modes/<name>/` with `mode.yaml`, `playbook.md`, `README.md`, `types/`, `features/run/` (as today) |
| `connector` | `--mode <mode>`, `--implements` | `components/modes/<mode>/connectors/<name>/` with `connector.yaml`, `<module>.py`, `README.md`, `tests/` |
| `content-type` (new) | `--mode <mode>` | `components/modes/<mode>/content-types/<name>/` with `content-type.yaml`, `fields.schema.json`, `views.sql` from three templates |
| `env`, `feature` | `--mode <mode>` | as today, under `components/modes/<mode>/` |

`CreateReq.schema.json` gets the kind `content-type` and requires `target` for `connector` and `content-type`; the forge create playbook and `bay new` help say the same. `_find_interface` (`scaffold.py:166`) searches `components/*/*/interfaces/`. Protected mode, env and connector names are refused as today, and a connector scaffold into a protected mode is refused like a feature scaffold (`scaffold.py:89`). The generated TODO for a new source says to add a content type with `bay new content-type` when it produces a new kind, replacing the sentence "a content type component" in INTERFACES.

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

Nothing needs a composition: `improve` binds `claude-transcripts` in its own env; `mail-briefing` binds only its own connectors; `feed-briefing` and `todo` likewise. The shipped kit therefore declares no `composes`; the first mode that wants Gmail will be the first user.

Tests, goldens and READMEs travel inside their folders. The tests of a moved connector keep importing their own module by folder (`tests/run.py` puts a test file's folder on the path), so no test import changes.

## What references change

Counted on the working tree, excluding `docs/proposals/`, `docs/plans/`, `CHANGELOG.md` and `HANDOFF.md` (history, never edited). Lines that contain the text `components/`:

| Area | Lines | What changes |
|---|---|---|
| `bay/` | 29 | globs, messages, scaffold paths (the real code edits are in Touches) |
| `schemas/` | 5 | descriptions only; `mode.schema.json` also gains `composes` |
| `adapters/` | 10 | 2 in `claude_code.py` (messages), 8 in the adapter test |
| `framework/` | 16 | `kernel.yaml` 12, the builder role 2, conformance rules 2 |
| `docs/` + `README.md` | 14 | DESIGN 1, INTERFACES 7, README 6 |
| `tests/` | 376 | fixtures and expected strings |
| `components/` (inside) | 73 | READMEs, env lists, test paths |
| Total | 523 | |

By folder name, the literal `components/<name>` occurs 421 times in 50 files (feed-briefing 103, improve 63, store 40, python 34, cos 30, post 24, mail-briefing 22, forge 21, delivery 16, tools 16, x-api 16, email 14, gmail-api 6, comments 5, todo 5, claude-transcripts 4, todoitem 2). 23 files also build a path from `"components"` in Python (`KIT / "components" / name`); they are the ones a text replace misses.

Goldens: `tests/golden/*.json`, `components/*/tests/golden/*.json` contain no `components/<name>` path (grep: zero), so none changes. The guard-matrix golden is not edited.

Generated files (`.claude/agents/*`, `.agentbay/catalog.json`, skills, shims) name the lint config path; they are regenerated by `./bay.sh build`, not edited. `agentbay.config.yaml` holds no components path: it has `approve:` and `connectors.claude-transcripts.root`, a directory under `~`. `schemas/config.schema.json` mentions the path only in a description.

## The upgrade note for user projects

Goes into the CHANGELOG under Upgrading. There is no migration code; this is a recipe, and `bay check` tells you what is left.

1. Update, then run `./bay.sh check`. Every folder at the old depth is reported with the command that fixes it.
2. For each of your modes: `git mv components/<mode> components/modes/<mode>`.
3. For each of your source connectors: `git mv components/<connector> components/modes/<mode>/connectors/<connector>`, where `<mode>` is the mode that binds it. A connector that sat inside a content type (`components/<type>/connectors/<c>`) goes the same way.
4. For each of your content types: `git mv components/<type> components/modes/<mode>/content-types/<type>`, where `<mode>` is the mode whose source produces it. The folder name must equal the kind; `bay check` says so if it does not.
5. If two of your modes use one connector or type, keep it in the mode that owns it and add `composes: [<owner>]` to the other mode's `mode.yaml`. If the framework should own it, propose it with forge.extend.
6. If an env of yours lists `fs.write: [components/<x>, ...]`, give it the new path. `fs.write: [components]` needs nothing.
7. `agentbay.config.yaml` needs no change: its `modes:` and `connectors:` keys are names, not paths. Data folders, stores and the ledger are untouched.
8. Run `./bay.sh build`, so the agent files carry the new lint command paths.

Open branches: a rebase conflicts on every moved file; git follows renames, so `git rebase` usually resolves them. Say so in the CHANGELOG.

## Tests and limits

### Tests

- **Existing tests move to the new depth.** About 376 lines in `tests/` and 73 in `components/` change their path strings; 23 test or kit files build the path in Python. This is mechanical and is where most of the work is. `test_protection.py` (61 lines), `test_boundary.py` (56), `test_lint.py` (55), `test_inheritance.py` (46), `test_boundaries.py` (37), `test_resolver.py` (29), `test_contract_versions.py` (25), `test_roles.py` (17) and `test_content_types.py` (15) are the biggest.
- **New behaviour is added as cases of existing tests, not new functions.** (a) `test_lint.py`'s table of lint cases: the row at line 149 ("an internal connector that reaches outside the project", expects "must be a top-level component") is replaced by rows for a binding across modes with and without `composes`, an unused `composes`, a `reads` of a kind defined in another mode, and a content type whose folder differs from its kind. (b) `test_boundary.py:103` keeps its test; its expected folder becomes `components/modes/rss/` and a case for a stray `components/rss/` is added. (c) `components/base/forge/tests/test_forge.py` extends `test_bay_new_mode_is_lint_clean_and_resolves` to scaffold a connector and a content type into the new mode and check the files and a clean lint. (d) `test_cli_commands.py:137` (options each kind needs) gets the two new kinds.
- **Each fails on main.** On main there is no `composes`, no `content-type` kind, and `components/modes/` is not read, so every added case fails at the first assertion.
- **The test count does not grow: 463 stays 463.** If the plan step finds a case that cannot live in an existing function, it names the obsolete test it merges away (DOD-15).
- The two store goldens and the improve golden keep their bytes. The guard matrix needs no rename: its rows hold no component path.

### Limits

The nine measures, against the ceilings in `framework/limits.yaml` (counted today with `bay.limits.count`; all nine are at their ceiling):

| Measure | Ceiling = count | After (estimate) | Verdict |
|---|---|---|---|
| `bay_lines` | 9549 | about 9604 | over: exception, to 9610 |
| `kit_python_lines` | 5276 | 5276 | same files, same protected set |
| `tests` | 463 | 463 | no function added; the protected set is the same files |
| `long_lines` | 135 | 135 | one line in `graph.py:149` reaches 121 characters and is wrapped |
| `cli_commands` 16, `schemas` 16, `framework_folders` 2, `top_level_folders` 7, `comment_lines` 0 | | unchanged | no parser, no schema file, nothing under `framework/` or the root; no comment is written |

`bay_lines` estimate, by item: `model.py` +5, `boundary.py` +1, `contenttypes.py` +3, `lint.py` +28 for the composition check (about 22), the stray-folder message (4) and the extension-folder edit (2), minus 10 for the placement rule, `scaffold.py` +24 (paths 0, connector and content-type target 6, content-type kind 14, a mode guard 4), `cli.py` +2. That is +65 gross and +55 net. The payer I can name from the code is the placement rule (-10), already counted. The estimate cannot shrink without writing the code, so the exception is an upper bound with a margin of 6.

The path-only edits to `bay/` do not change line counts. `kit_python_lines` moves no file out of or into the protected set: `gmail-api`, `x-api`, `email`, `post` and `todoitem` were unprotected and stay unprotected; `claude-transcripts` stays protected at its new path.

Docs are at their word budget: `docs/DESIGN.md` is 2998 words and `docs/INTERFACES.md` is 2976 (budget 3000, `len(text.split())`). DESIGN gains the tier layout and the composition rule (about 45 words) and pays with its own cuts; INTERFACES replaces the Components paragraphs on folders and the placement rule (lines 42-61, about 190 words) with the layout table and composition (about 200 words), plus the new-source recipe (about 10). The plan step re-measures both on scratch copies, as 0016 did; I have not.

## Compatibility and safety

- **Breaks, with no alias (B-12).** Any component at the old depth stops loading, and `bay check` names the `git mv`. `bay new connector` without `--mode` stops working. Nothing else: manifests, names, bindings, settings, data and the ledger are unchanged.
- **apiVersion.** `agentbay/v4` stays. No manifest changes shape; `composes` is optional and additive. The release is 4.0.0 because a project's layout must change. I considered `agentbay/v5` and rejected it: it rewrites 92 manifests and the `$id` of every schema to say that a folder moved, and `schema_errors` (`bay/model.py:127`) already carries one special case for the last bump. If the owner or the reviewer reads DOD-11 as requiring a bump for a loader-path change, the cost is those files and a second special case.
- **Safety.** No secret is read, written or shown. Guard and sandbox rules are unchanged except the one path in `guard.py` that names the lint config folder; the guard-matrix golden proves no other decision moved. Protection is not widened or narrowed (section 4); the protected list is recomputed only by prefix, and `bay check --base` is run against the move to show the boundary report: every moved file is `core` or `extension` exactly as before.
- **Extensibility (DOD-4).** A new source is one connector (now inside its mode) and one binding line in the env. A source for another mode's kind adds one `composes` line, which is the only new edit and is the point of the rule.

## Out of scope

- Protecting all of `components/base/`, and moving `delivery` or `improve` out of the unprotected group.
- Content-type versions or a registry of kinds across projects; kinds stay global names.
- A syntax for binding a connector by path or `mode/connector`.
- Transitive composition, and composition of envs, skills or features (only connectors and content types).
- Any change to `extends:`, the one-level rule or the store.
- A migration command for user projects (the recipe is the note).
- A Facebook messages mode or any new mode.
- Regenerating the guard-matrix golden (0012 slice 8).

## Measured and estimated

Measured on 9a36bd2: the 17 folders and their file counts; 242 tracked files under `components/`; 421 literal `components/<name>` occurrences in 50 files; 523 lines by area; no golden holds a component path; the nine limit counts and that all are at their ceiling; DESIGN 2998 and INTERFACES 2976 words; 92 manifests say `apiVersion: agentbay/v4`; improve has no protected path above its connectors, interfaces and `improve-local`.

Estimated, and to be re-checked by the plan step: every line count of the code (`bay_lines` +55 net), the 463 test count staying put, the word budgets of the two docs, and the number of test lines to edit by hand versus by replace.

## Choices for you

1. **Base stays unprotected as a whole (recommended).** Protection stays entry by entry in kernel.yaml with the new prefix; `base/` is where things live, not what is locked. The alternative is to lock all of `base/`, which also locks `delivery` and most of `improve`, adds 11 tests to the count and needs a second exception.
2. **No `agentbay/v5` (recommended).** 4.0.0, the manifests stay v4, the break is the layout and is caught by one lint message.
3. **Content-type scaffold included (recommended).** About 14 lines and 3 templates, so a new mode really is scaffolded with its connectors and content types. It is the first thing to cut if `bay_lines` must stay lower.
