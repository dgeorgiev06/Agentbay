# Plan 0021: one folder per mode

## Summary

This plan is for proposal 0021 (51ace41 on feat/component-layout, main 9a36bd2, 3.2.0). It implements nothing.
I checked the proposal against the code. Then I applied the move and the code changes to a scratch copy of the
tree, so most numbers below are measured. Where this plan and the proposal differ, the plan wins, and the proposal
is amended before the gate (see "Before the gate").

- **The layout works as designed.** After the 19 `git mv` moves, a path rewrite and six glob and regex edits, the
  kit lints clean and resolves (7 modes, 44 features, 16 connectors), and `bay_lines` falls by 8.
- **The guard blocks the build as the proposal describes it.** framework-dev's `fs.write` lists only protected
  paths, `docs`, `tests` and `README.md`. The builder can neither `git mv` nor edit `feed-briefing`, `mail-briefing`,
  `todo`, `gmail-api`, `x-api`, `post`, `email`, `todoitem` or `delivery`. The golden guard matrix confirms it
  ("outside the role's writable paths"). 0010 hit the same problem and opened a move window. This plan does the same:
  commit 1 widens the list and the last code commit narrows it again.
- **Five places silently stop working at the new depth, and the proposal names none of them:**
  - the fs.write sync regex (`bay/lint.py:864`);
  - B-11's instance names (`bay/boundary.py:448-454`), which lose six names;
  - the kit root that `todo_rules.py` derives from its own file (`parents[4]`);
  - a relative README link;
  - the check that a nested folder holds its manifest. The proposal says this check needs nothing new, but three
    misplaced manifests pass lint clean.
- **Costs, measured on the scratch copy:**
  - `bay_lines` 9549 -> 9605 (+56). The proposal estimated +55; the per-file numbers differ. The exception should be
    9620, not 9610: readable code costs a few lines more than my scratch version.
  - `tests` 463 -> 463, `kit_python_lines` 5276 -> 5276, `long_lines` 135 -> 135.
  - DESIGN 2998 -> 2997 words, INTERFACES 2987 -> 2988 (the proposal said 2976).
- **The four flagged choices.** I agree with three of the proposal's recommendations: base/ as placement only, no
  `agentbay/v5`, and keeping the content-type scaffold. On the fourth, I read the folder-name rule more strictly
  than the proposal: one new check, by a table.

## What I measured and how

All runs were on scratch trees under the scratchpad (`p21/`). I made a `git archive` of HEAD, turned it into a git
repo, and committed. Nothing was run in the repo itself.

1. **Base.** `./bay.sh check --limits`: lint clean, 9 measures within their ceilings, all at their ceiling.
   `python3 tests/run.py`: 576 passed in 153 s. The `tests` measure counts 463 of them.
2. **Moves only** (the 19 `git mv`, nothing else). Lint gives 27 problems, which fall into two kinds:
   - protected connectors no longer exist (the loader patterns are one level short);
   - `components/base/` and `components/modes/` are reported as "extension folder without its manifest".
3. **Mechanical.** The moves, plus:
   - a regex rewrite of `components/<old>` in every tracked text file except `docs/proposals/`, `docs/plans/`,
     `CHANGELOG.md` and `HANDOFF.md`: 415 substitutions in 47 files (tests 310, components 73, framework 22,
     adapters 7, README 2, docs 1);
   - 18 Python path builders (`"components" / "x"`) in 12 files;
   - `KINDS` and the two data globs in `bay/model.py`, the `contenttypes.scan` glob, the `graph.py` glob,
     `boundary._COMPONENT`, the two regexes in `bay/lint.py` and `guard.LINT_CONFIG_DIR`;
   - removing the placement rule.

   Result: lint clean, resolve clean, `bay_lines` 9541, the other measures unchanged. The suite: 530 passed and
   46 failed. The failures, by cause:

| Cause | Tests | Fix |
|---|---|---|
| Fixtures that build components at the old depth (`components/mail`, `rss`, `news`, `evil`, `old`, `note`, `clang`, `mine`, `Cos`) | 24 (test_boundary 10, test_protection 5, test_inheritance 4, test_roles 3, test_resolver 1, test_auth 1) | move the fixture to `components/modes/<x>/` (or `base/` for the protected-name cases); I checked that test_boundary passes once its fixture paths move |
| The new code is not written yet (scaffold, lint table rows) | 7 (test_forge 6, test_lint 1) | items 4 and 6 |
| `todo_rules.py` derives the kit root as `parents[4]` | 8 (test_todo_rules 6, test_todo 2) | `parents[5]` in the module and in its test |
| Path strings built by f-string (`f"components/{home}"`, `f"components/{mode}"`) | 3 (test_adapter, test_lint, test_core_names glob `components/*/views.yaml`) | by hand |
| A relative `entry: ../../../../shared/x_entry.py` in a fixture | 1 (test_contract_versions) | one more `../` |
| `comments_cases.py` builds a `components/clang` component | 1 (test_python_check) | `components/base/clang` |
| improve golden: doc-stale count 0 -> 1 | 1 (test_improve_golden) | the link `../store/README.md` in gmail-api's README needs `../../../../base/store/README.md` |
| copying `feed-briefing` now copies its connectors and content type, so their names are defined twice | 1 of the test_roles 3 | `ignore_patterns("envs", "connectors", "content-types")` |

4. **Full.** The mechanical tree plus the code in items 3 to 6 below, written plainly but densely. Lint is clean,
   and `bay new mode`, `content-type`, `connector`, `env` and `feature` all scaffold into `components/modes/notes/`.
   The only lint problem in that scratch mode is the standards-step warning, which the same scaffold also gets on
   the base. Composition is reported in three cases:
   - a binding to `gmail-api` without `composes`;
   - with `composes: [mail-briefing]`, the binding is clean;
   - an unused `composes: [todo]` is reported.

   The new folder table reports `components/modes/rss/connector.yaml`, `connectors/foo/` (no manifest) and
   `content-types/bar/connector.yaml`. All three pass lint clean today.

   Measures: `bay_lines` 9605, `long_lines` 135 (after shortening one message), `tests` 463, `kit_python_lines` 5276.
5. **Boundary report of the move** (`bay check --base <base> --proposal 0021`): 516 changed paths, 0 failing.
   - Old side: 198 unowned and 44 core.
   - New side: 242 extension.
   - The rest: 32 core, docs and other.
6. **Protecting all of base** (a scratch `protected.paths` of `components/base`): `tests` 463 -> 474 (+11), and
   `kit_python_lines` stays the same.

## Where the proposal is wrong or incomplete

1. **The guard (missing).** Nothing in the proposal lets the framework-dev builder move or edit unprotected
   components. Fix: the move window (build order 1 and 9). It is a protected-env change, and the owner sees it at
   the gate.
2. **`bay/lint.py:864`** (`_protected_paths_in_sync`). `re.fullmatch(r"components/([^/]+)(?:/envs/...|/connectors/...)?")`
   matches none of the new paths, so the check that each `fs.write` path is protected passes vacuously. It needs
   `components/(?:base|modes)/`. The proposal does not list it.
3. **`boundary.instance_names`.** The proposal says it "keeps working". It only names a component from a manifest at
   the folder root. After the move, `gmail-api`, `x-api`, `post`, `email`, `todoitem` and `claude-transcripts` are no
   longer names B-11 looks for (measured: 14 names before, 8 after). Fix: also name the folder of every manifest
   under `components/modes/`, nested ones included. That adds `fake`, `fake-mail` and `todo-rules`, with no hit in
   today's docs. Base connectors stay out on purpose: naming all of them makes `ledger` and `git` hit the core docs
   4 times (measured). `claude-transcripts` drops out of B-11 as a base part. +2 lines.
4. **Folder name equals kind, part 2.** The proposal says "the existing folder-without-manifest lint reports it". It
   does not. That lint looks only at `components/<x>/`. With only the regex fixed, three cases pass lint clean:
   - a connector manifest at a mode root (`components/modes/rss/connector.yaml`, which is what a user gets from
     `git mv components/gmail-api components/modes/gmail-api`);
   - `connectors/foo/` with no manifest;
   - a `connector.yaml` inside `content-types/bar/`.

   Fix: a table of folder patterns and the manifest each must hold (item 3). +6 lines.
5. **Citations.** The stray-folder message belongs in `lint_case_and_manifests` (`lint.py:950`, next to
   `OLD_FOLDERS` at :947), not `lint_ownership`. B-4 already reports every file of a stray folder, so the new
   message is one line per folder on top of them.
6. **The boundary claim.** "Every moved file is core or extension exactly as before" is false. The check judges a
   change by the base's map and the head's `root()`. So the old paths show as unowned (198) or core (44), and every
   new path shows as a new extension, protected ones included. It passes only because `touches:` lists
   `components/`. The proposal must say this, and the `components/` touch must stay.
7. **Missed references:**
   - `components/python/connectors/python-check/python_check.py:21` (`CONFIG_DIR`, protected kit code);
   - `todo_rules.py:11` and `tests/test_todo_rules.py:13` (`parents[4]`);
   - `components/gmail-api/README.md:41` (the relative link);
   - `components/forge/interfaces/forge.scaffold.v1.yaml` (`kind` enum, `target` description);
   - `bay/cli.py:42-43` (the USAGE text);
   - `bay/lint.py:401` (message);
   - `tests/test_core_names.py:43` (glob);
   - `adapters/claude-code/claude_code.py:430` (f-string, not caught by text replace).
8. **Not needed.** `components/forge/connectors/scaffold/` already passes `target` (`scaffold.py` connector
   `create(kind, name, target, ...)`). Drop it from the touches.
9. **Docs.**
   - INTERFACES is 2987 words, not 2976.
   - DESIGN states the placement rule too (`:42-43`, 35 words). Its removal pays for the new text.
   - `framework/rules/conformance.yaml` C-7 restates the placement rule in prose ("a source connector reaches outside
     the project and is a component of its own ..."). It needs rewording, not a path edit.
10. **`composes` "not inherited".** Only an abstract base can be extended (`model.py:250`), and every base lives in
    `base/`. The plan forbids `composes` in a base mode, which makes inheritance moot with no merge code. It costs no
    extra line (one condition in the check).
11. **A hole in composition.** A mode can map a role to another user mode's env (`may_place` restricts only protected
    envs) and so bind that mode's connectors with no `composes`. Fix: the envs a mode uses count as uses, with the
    same rule (item 5). This is in scope: it is the binding check, not "composition of envs".
12. **Changes the proposal does not mention:**
    - copying a mode folder copies its connectors and content types, and their names are global, so the copy fails
      with "defined twice";
    - code that derives the kit root from its own depth shifts by one level;
    - relative links between components gain `../`.

    All three go into the upgrade note.

## The flagged choices

1. **base/ as placement only, or protected: placement only (agree).**
   - Locking `components/base` adds 11 tests to the `tests` count (measured, 463 -> 474), which needs a second
     exception.
   - It locks `improve` and `delivery`, which `tests/test_protection.py:404-441` keep unprotected.
   - It widens what only forge.extend writes, which is a security change of its own.

   With entry-by-entry protection, the list changes only by prefix, and the guard-matrix test passes unchanged
   (measured). One addition: `bay new` targets only `components/modes/` (item 6). "Placement only" then still means
   users do not scaffold into base.
2. **No agentbay/v5, release 4.0.0: agree, with the counter-argument stated.**
   - For a bump: 0010 bumped to v4 for its layout move ("the layout is a breaking change to where extensions live"),
     and INTERFACES lists the component folder as contract 0. A reviewer may read DOD-11 that way.
   - Against a bump: no manifest changes shape (`composes` is optional and additive). A manifest left at the old
     depth is never loaded, so a version check would never fire on it; the stray-folder and folder-table lint
     messages are what a user meets. A bump rewrites 92 manifests and every `$id`, and keeps the special case at
     `model.py:127`, for no extra signal.
   - The one input contract that tightens is `forge.scaffold/v1.create`: `target` is now required for a connector,
     enforced in code; the schema keeps it optional. It is `dispatcherOnly`, and its only callers (`bay new`,
     `forge.create`) change in the same commit. Keep v1 and name it in the CHANGELOG. If the owner reads DOD-11
     strictly, the bump is a separate, mechanical commit 8b. It costs 0 `bay_lines` net (the one message changes
     from v4 to v5).
3. **Content-type scaffold: keep (agree).** The owner asked that forge.create scaffold a mode "with its connectors
   and content types inside it". Measured cost: 9 lines in `scaffold.py` (the branch plus the `KINDS` entry), 0 in
   `cli.py` (the `--mode` check unifies), and 3 templates of 13, 10 and 1 lines. The three generated files pass
   `contenttypes._one` and lint. It is still the first thing to cut if `bay_lines` must shrink.
4. **Folder name equals kind: both halves, and half 2 as a real check.**
   - Half 1, content types: `spec.kind` must equal the folder, +2 lines in `contenttypes._one`. It keeps one version
     of a kind in the kit at a time. That matches the store, which already refuses a second version ("move the
     folder aside and sync again", `test_content_types.py:149`).
   - Half 2, every folder holds the manifest its place names: a five-row table in `lint.py`, replacing the root-only
     check, +6 lines.

   I read "folder name equals its kind" for connectors as the slot (`connectors/<name>/` holds a `connector.yaml`),
   not as `metadata.name` equal to an interface name. `metadata.name` equal to the folder is already enforced
   (`model.py:326`).

## Before the gate (amendments to the proposal, R-12)

1. **Touches.**
   - Add:
     - `components/forge/envs/framework-dev.yaml` (the move window, and after it the new prefixes);
     - `components/python/connectors/python-check/python_check.py`;
     - `components/todo/connectors/todo-rules/` (module and test);
     - `components/gmail-api/README.md`;
     - `components/forge/interfaces/forge.scaffold.v1.yaml`;
     - `bay/templates/content-type/`;
     - `framework/rules/conformance.yaml` (C-7 reworded).
   - Change the reasons for:
     - `bay/boundary.py` (`instance_names`, +3 lines in all);
     - `bay/lint.py` (the fs.write regex, the folder table, net +37 measured);
     - `bay/scaffold.py` (+14 measured);
     - `bay/cli.py` (0);
     - `bay/model.py` (0);
     - `bay/contenttypes.py` (+2).
   - Remove `components/base/forge/connectors/scaffold/`.
2. **Exception.** `bay_lines` to **9620** (measured 9605 with dense code; readable composition code adds about 5).
3. **Design text.**
   - Section 2 half 2 becomes the folder table.
   - Section 3 counts the envs a mode uses, and forbids `composes` in a base mode.
   - Section 1 names `instance_names` and the `lint.py:864` regex.
   - The boundary paragraph in Compatibility states the measured report (item 6 above).
4. **Upgrade note.** Add the move-window build steps (none for users), the three changes in item 12 above, and the
   per-tier manifest rule: `components/modes/<x>/` must hold a `mode.yaml`.
5. **Counts.** INTERFACES is 2987. References: 415 text substitutions in 47 files, plus 18 path builders in 12 Python
   files. The test fixtures to hand-edit are about 89 lines in 10 test files.

## Build order

Each step is one commit, and each is followed by `python3 tests/run.py` and `./bay.sh check --limits` (both green).
The coordinator asks the owner for a `./bay.sh build` where marked, because the guard reads `.agentbay/guard.json`
as built.

1. **Open the move window.** In `components/forge/envs/framework-dev.yaml`, `fs.write` gains `components` (one path,
   before `docs`). The owner reads this diff, then runs the **build**. Nothing else changes, so the suite and limits
   are trivially green.
2. **The move** (one commit; the tree is red in between, as in 0010 part 1a). It contains:
   - the 19 `git mv`, in this order:
     - `post/connectors/fake` and `email/connectors/fake-mail` first;
     - then the 8 base and 3 modes folders;
     - then `claude-transcripts`, `x-api`, `post`, `gmail-api`, `email` and `todoitem` into their modes;
     - then remove the empty `connectors/` folders that are left;
   - the path rewrite;
   - the 18 path builders;
   - `KINDS`, the data globs, `contenttypes.scan`, `graph.py` (wrapped), `_COMPONENT`, `guard.LINT_CONFIG_DIR`,
     `python_check.CONFIG_DIR`;
   - the two `lint.py` regexes (`:864` and the root-manifest loop, as a plain `components/(?:base|modes)` regex for
     now);
   - removing the placement rule (it fails every moved connector otherwise);
   - `kernel.yaml` and framework-dev's protected list with the new prefix;
   - the depth fixes (`todo_rules`, the README link, the f-strings);
   - every fixture in the table above;
   - the two placement rows of `test_lint.py:149-152` become the composition rows only in step 5, so this commit
     deletes them.

   Then the **build**.
3. **The folder table and the stray-folder line.** `FOLDER_MANIFESTS` replaces the root check, and `TIERS` with one
   message line per stray folder. Also the content-type rule `spec.kind == folder`.
4. **B-11 names.** `instance_names` covers nested manifests under `components/modes/`.
5. **Composition.** `spec.composes` in `schemas/mode.schema.json`, and `lint_composition` with `_home`.
6. **Scaffold.** `scaffold.py`, `cli.py`, the three templates, `forge.scaffold.v1.yaml`, `CreateReq.schema.json`, and
   forge create's playbook and rules.
7. **Docs.** README, DESIGN, INTERFACES and conformance C-7, with the word counts below.
8. **Close the move window.** framework-dev's `fs.write` loses `components`. Then the **build**. (8b, only if the
   owner chooses v5: the apiVersion bump.)
9. **Release 4.0.0.** The CHANGELOG with Upgrading, `bay/__init__.py`, and
   `./bay.sh check --limits --write --base origin/main --proposal docs/proposals/0021-component-layout.md` once.

Steps 3 to 6 are independent of each other after step 2. Docs come after 5 and 6, so they describe what exists.

## Files and tests per item

**1. Move window.**
- Files: `components/forge/envs/framework-dev.yaml`.
- Tests: the lint sync (`_protected_paths_in_sync`) accepts `components`, because it covers every protected
  component path. `tests/test_guard_matrix.py:239` pins framework-dev's write list as `[*FOUR, *moved, *window]`,
  so `window` (`:238`) gains `"components"` in this commit, in the same position as in the env. Step 8 takes it out
  again.

**2. The move.**
- Files:
  - `bay/model.py` (`KINDS` :29-34, :71, messages :127 and :781);
  - `bay/contenttypes.py:275`;
  - `bay/graph.py:149` (two lines);
  - `bay/boundary.py:20`;
  - `bay/guard.py:29`;
  - `bay/lint.py` (:353-361 removed, :864, :968, the messages :401 and :975);
  - `bay/scaffold.py:166` (`_find_interface` glob only; the rest is step 6);
  - `bay/cli.py:42-43` (text);
  - `framework/kernel.yaml`;
  - `framework/roles/builder.yaml`;
  - `adapters/claude-code/claude_code.py:430`;
  - every moved folder;
  - `components/modes/todo/connectors/todo-rules/todo_rules.py`;
  - `components/modes/mail-briefing/connectors/gmail-api/README.md`;
  - `components/base/forge/envs/framework-dev.yaml`.
- Tests: the fixture edits listed under "What I measured" step 3. No test is added or removed.
- Keep `test_protection.py`'s case test (`:345-371`), but move its premise to a case alias at the same depth
  (`components/base/Cos/mode.yaml` beside `components/base/cos/`). A user mode `components/modes/Cos/` is no longer a
  case alias of anything protected: the scaffold's lowercase rule and the loader's name pattern stop it.
- `test_boundary.py`: rewrite the fixture paths to `components/modes/...`; I ran this and it passes, apart from the
  pure glob test `:200`, whose literal must stay as it was.

**3. Folder table and stray line.**
- Files: `bay/lint.py` (`lint_case_and_manifests`).
- Tests:
  - `test_boundary.py:96-103` (`test_lint_rejects_case_collisions_and_extension_folders_without_manifest`) gains the
    stray `components/rss/` line (its git mv message) and the three cases measured above;
  - `test_lint.py`'s case table gains a row for a content type whose `spec.kind` differs from its folder.

  Each fails on main: main has no tier folders, and the message text is new.

**4. B-11 names.**
- Files: `bay/boundary.py` (`instance_names`). Write it plainly:

  ```python
  for p in paths:
      rt = root(p)
      file = posixpath.basename(p)
      if rt is None or file not in MANIFEST_KINDS or cmap.owner(rt[0]):
          continue
      if p == rt[0] + file or p.startswith("components/modes/"):
          names.setdefault(posixpath.basename(posixpath.dirname(p)), MANIFEST_KINDS[file])
  ```

- Tests: `test_boundary.py:174` (`test_docs_check_names_instances_outside_fences_and_fails`) adds a nested connector
  name in its doc text and expects a hit.

**5. Composition.**
- Files: `schemas/mode.schema.json` (`composes`: array of names, with the description), and `bay/lint.py`:
  - `_home(path)`: the `components/<tier>/<name>` folder above a manifest;
  - `lint_composition(kit)`, called from `run()` after `lint_extension_names`.
- The function is three plain loops, with no `\` continuations:
  1. the envs the mode uses (`model.mode_envs`) plus the envs in its own folder;
  2. their `bind` and `offline.bind` connectors, its `reads` content types and those envs, each with its home
     folder;
  3. any home under `components/modes/` other than the mode and its `composes` is an error.
- `composes` must name another mode under `components/modes/`, from a mode under `components/modes/`. Every name must
  be used at least once.
- Tests: `test_lint.py`'s case table replaces the two placement rows (:149-152) with five rows:
  - a binding across modes without `composes`;
  - the same with `composes` (clean, checked in the table's clean case);
  - an unused `composes`;
  - `composes` in a base mode;
  - a role placed in another user mode's env.

  Rows, not functions, so `tests` stays 463.

**6. Scaffold.**
- Files:
  - `bay/scaffold.py`:
    - `KINDS` gains `content-type`;
    - `MODES = "components/modes"`;
    - one `_mode_dir(kit, kind, target)` (needs `--mode`, refuses a protected mode, finds
      `components/modes/<target>/mode.yaml`, and otherwise says the mode is in base or missing). It replaces the
      feature branch's own checks and the env's;
    - the connector goes to `<mode>/connectors/<name>/`;
    - the new `content-type` branch writes three templates;
  - `bay/cli.py`: `choices` and the `--mode` check become `args.kind != "mode"`;
  - `bay/templates/content-type/` (`content-type.yaml`, `fields.schema.json`, `views.sql` with `v_{{name}}`);
  - `forge.scaffold.v1.yaml`: the enum, and `target` described for every kind but mode;
  - `components/base/forge/types/CreateReq.schema.json`: the enum, and `target` required for every kind but mode;
  - the forge create playbook (kinds and `target`) and `rules.yaml` (R-7's `when` also covers content-type, or a new
    rule; a row in the existing file).
- Tests:
  - extend `test_forge.py:19` (`test_bay_new_mode_is_lint_clean_and_resolves`) to scaffold a content type and a
    connector into the new mode and expect the files and a clean lint;
  - in `test_cli_commands.py:136` (`test_new_checks_the_options_its_kind_needs`), `new connector x` without
    `--mode` names `--mode`, and so does `new content-type x`;
  - the six test_forge fixtures name `components/modes/...`.

**7. Docs.** See the word budgets below. README:
- the component definition (:24-25);
- the lint commands (:94-95);
- the env path (:106);
- the folder map (:121);
- "Adding things" (:163);
- the `bay new` table row (:151).

**8. Close the window.**
- Files: `components/base/forge/envs/framework-dev.yaml`.
- Tests: whatever step 1 changed goes back.

## Risks

- **The write list widens itself** (step 1). The builder edits its own env, and the widening takes effect only after
  the owner's build. Mitigation, as in 0010: the owner reads that one diff before building, and step 8 narrows the
  list again before release. The review checks that step 8 happened (framework-dev's `fs.write` at release equals
  the protected list plus `plan-writer.yaml`, `requirements-dev.txt`, `docs`, `tests` and `README.md`).
- **Stale guard between commits.** After step 2 and before the build, guard.json names the old paths, so the builder
  cannot write `components/base/...`. `stale_policy` reports it. The coordinator must ask for the build right away.
- **One very large commit.** Step 2 renames 242 files and edits about 60. It cannot be split: every intermediate
  state fails lint (measured: 27 problems with the moves alone). Mitigation: it is mechanical. The plan names the
  regex, the path builders and the fixture list. `git show -M --stat` lets the reviewer see that it is renames plus
  the listed edits.
- **Rebases.** Every open branch conflicts on the moved files. git follows renames, so most resolve; the CHANGELOG
  says so.
- **deadcode and standards on a 242-file move.** Both compare with renames in mind (0010's rename-aware matching,
  0011's rename map). `test_moving_files_have_no_deadcode_findings` passed on the mechanical tree. A finding that
  shows up as new only because of the move is a bug in that matching, not in this change.
- **Silent passes at the new depth.** The four places in "wrong or incomplete" items 2 to 4 fail open, not closed.
  Each gets a test that fails on main (items 3, 4 and 5), so a regression shows.
- **B-11 drops `claude-transcripts`.** It is a base part now, and core docs may name base parts. If the owner wants
  base connectors kept, the price is 4 hits of `ledger` and `git` in today's core docs.
- **Case aliases move.** The protected-name defence now rests on `components/base/<Name>/` aliases (the inode guard
  and the casefolded `at_base`) and on the scaffold and loader name rules. The case test moves with it (item 2).
- **A user's flat connector is silent without step 3.** Steps 2 and 3 should ship in the same release, and they do.
- **DOD-11 read strictly.** The reviewer may judge the layout to be a contract change. Choice 2 states both sides,
  and 8b is ready if the owner picks v5.
- **The improve golden.** It holds only if the gmail-api link is fixed in step 2 (measured: doc-stale 0 -> 1 without
  it).
- **Scaffolding into base modes stops.** `bay new feature x --mode delivery` worked on main, because delivery is
  unprotected. After step 6 it says the mode lives in `components/base/` and changes through forge.extend. That is
  intended ("elevate through forge.extend"), and the CHANGELOG says so.

## Cost against the ceilings

Measured on the scratch tree, with dense code. "Plan" is what readable code needs. Every line is at most 120
characters, and no line is packed.

| Measure | Ceiling | Mechanical (step 2) | Full (measured) | Plan | Exception |
|---|---|---|---|---|---|
| `bay_lines` | 9549 | 9541 | 9605 | about 9610 | **9620** |
| `kit_python_lines` | 5276 | 5276 | 5276 | 5276 | none |
| `tests` | 463 | 463 | 463 | 463 | none |
| `long_lines` | 135 | 135 | 135 | 135 | none |
| `cli_commands` | 16 | 16 | 16 | 16 | none |
| `schemas` | 16 | 16 | 16 | 16 | none |
| `framework_folders` | 2 | 2 | 2 | 2 | none |
| `top_level_folders` | 7 | 7 | 7 | 7 | none |
| `comment_lines` | 0 | 0 | 0 | 0 | none |

What each ceiling costs:

- **`bay_lines` +56 measured**, per file:
  - `lint.py` +37, made up of:
    - the composition check and `_home`, about +33 (the env uses add 3);
    - the folder table, +6;
    - the stray line with `TIERS`, +4;
    - the placement rule, -9;
    - regexes and messages, 0;
  - `scaffold.py` +14 (the content-type branch 9, `_mode_dir` 11, minus the feature's and env's own checks 6);
  - `boundary.py` +2 (`instance_names`; +3 in the readable form above);
  - `contenttypes.py` +2;
  - `graph.py` +1;
  - `model.py`, `cli.py` and `guard.py` 0.

  The proposal had `model.py` +5 and `cli.py` +2 (both 0), `lint.py` +18 (it missed the env uses, `_home` and the
  table) and `scaffold.py` +24 (the shared `_mode_dir` saves 10). If the owner wants the exception at 9610, the
  first cut is the content-type scaffold (-9), then the unused-`composes` check (-3).
- **`kit_python_lines` 0.** `python_check.py` changes one line in place. `claude-transcripts` stays protected at its
  new path, and the other moved code was unprotected and stays so.
- **`tests` 0.** Every new case is a row in an existing table, or an assertion in an existing test (items 3 to 6).
  Protecting all of base would cost +11.
- **`long_lines` 0.** The `graph.py:149` line is wrapped. The content-type message is kept under 121 characters
  (one draft hit 121 and was cut). `scaffold.py`'s `produces:` line was already over 120 and stays one line.
- **The others 0.** No parser, schema file, framework folder or root folder is added. The templates are not Python.
- **The release** runs `--write` once, which writes the real `bay_lines` as the new ceiling.

## Docs: the word budgets (3000, `len(text.split())`)

Measured by applying draft text to copies of both files.

**DESIGN.md 2998 -> 2997.**
- The Component concept row: "one mode, with its connectors and content types, or one shared set" (+3).
- The Components intro: "`components/base/<name>/` ships with the framework, `components/modes/<name>/` is yours"
  (+6).
- The manifest table row: "connector | code that serves a capability, often a source" (-1).
- "A mode also holds what it needs (envs, interfaces, skills, types, data, tests, `connectors/`, `content-types/`)"
  (-1).
- The placement paragraph (:42-43) becomes the composition rule and elevation to base (-8).
- Line 19: "one component plus one binding line" becomes "one connector plus one binding line" (0).

**INTERFACES.md 2987 -> 2988.**
- The layout line in the diagram (0).
- The Components intro names both tiers (+4).
- The folder list gains `content-types/<kind>/ (the folder is the kind)` (+4).
- The placement-rule paragraph and its `bay check` line become composition and the two refusals (-6).
- `<mode>/envs/` (0).
- The new-source recipe gains `--mode` and `<mode>/connectors/bsky/` (0), and "needs `bay new content-type`" (-1).

No draft line names an instance outside a fence (B-11). The builder re-counts both files before the docs commit.

**README.md** has no budget. It gets the six edits in item 7. **conformance.yaml C-7** is reworded: "A component is a
folder under `components/base/` or `components/modes/` that holds one mode, with its connectors and content types,
or one shared set. A connector is code behind a capability interface and lives in the mode that binds it."

## Release 4.0.0

- `bay/__init__.py` goes to 4.0.0. Manifests stay `agentbay/v4` (choice 2).
- The CHANGELOG has the proposal's Upgrading recipe, plus:
  - the per-tier manifest rule;
  - copied modes carry their connectors;
  - code that derives the kit root from its own depth moves one level;
  - relative links between components gain `../`;
  - `bay new connector` and `bay new content-type` need `--mode`;
  - `bay new` no longer targets a base mode;
  - open branches should rebase.
- Run `./bay.sh check --limits --write --base origin/main --proposal docs/proposals/0021-component-layout.md` once.
- Print the tag, push and `gh release create` commands for the owner.

## Where the builder needs the owner

- **Builds** after steps 1, 2 and 8. The coordinator asks each time.
- **Reading step 1's diff** before its build (the self-widening write list).
- **Prompted `git mv`** in step 2 (19 commands).
- **Choice 2.** If the owner picks v5, step 8b is added and the CHANGELOG says so. Nothing else in the plan changes.
