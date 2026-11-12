---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Owner goal, chat 2026-11-12: "frameworks can enforce structure for prose in code like definition. Json or yaml. Define inputs outputs instructions definition of done policies and constraints." Every count below was measured on main at 4.0.0 (a7a425d). Line costs are estimates until the plan step measures them.
id: "0022"
status: draft
touches:
  - { path: bay/playbook.py, reason: "REMOVED (111 lines). The Markdown section parser has nothing left to parse once a feature's instructions are data" }
  - { path: bay/rules.py, reason: "loads the feature file: `steps`, `done`, `rules` and `failure`, each checked against the schema; `DodItem` moves here from playbook.py" }
  - { path: bay/model.py, reason: "Feature drops playbook_path and playbook_text and gains the instruction of each step and the failure list; a step drops `task`; the feature file is found by its folder, child first then parent" }
  - { path: bay/lint.py, reason: "the playbook checks at :89-106 become: a feature with a role step has a feature file, every role step has an instruction, every instruction key is a step id; the skill-name scan at :752-764 reads the instructions" }
  - { path: bay/conformance.py, reason: "playbook_matches_workflow (C-1, about 35 lines) is removed: the exact key check in lint replaces its substring match; dod_checkable and names_no_tools read the feature file" }
  - { path: bay/dispatch.py, reason: "_executor_brief (:715) hands a role step its own instruction, the step list, the failure list and the input and output schemas in place of the whole playbook text" }
  - { path: bay/registry.py, reason: "the registry entry names the feature file in place of the playbook path (:29)" }
  - { path: bay/graph.py, reason: "the artifact graph classifies features/*/feature.yaml; `playbook` stays the kind of a coordinator playbook.md (:28)" }
  - { path: bay/scaffold.py, reason: "`bay new feature` and `bay new mode` write one feature.yaml where they wrote playbook.md and rules.yaml" }
  - { path: bay/templates/feature/, reason: "playbook.md and rules.yaml are replaced by one feature.yaml template; the mode.yaml snippet loses `playbook:`, `rules:` and `task:`" }
  - { path: bay/templates/, reason: "every template manifest says agentbay/v5" }
  - { path: bay/cli.py, reason: "`bay describe <mode>` prints each feature's instructions and failure list beside the done items and rules it prints today (:224); no new command" }
  - { path: bay/config.py, reason: "the generated agentbay.config.yaml says agentbay/v5 (:16)" }
  - { path: schemas/, reason: "every schema's $id and apiVersion const say agentbay/v5. rules.schema.json gains the kind Feature (steps, done, rules, failure); mode.schema.json drops the feature keys `playbook` and `rules` and the step key `task`. No schema file is added" }
  - { path: framework/rules/conformance.yaml, reason: "C-1 is reworded (every role step has an instruction, checked by lint) and loses its `check`; C-2, C-4 and C-9 say feature file where they say playbook" }
  - { path: framework/roles/, reason: "apiVersion; the analyst prompt (analyst.yaml:13) says instruction where it says the feature's playbook" }
  - { path: framework/kernel.yaml, reason: "apiVersion only; it names no playbook or rules file, so no protected path changes" }
  - { path: adapters/claude-code/, reason: "the generated agent text at claude_code.py:271 says what the step plan now carries; adapter.yaml apiVersion; the adapter test" }
  - { path: components/, reason: "every manifest says agentbay/v5 (82 files). The 14 feature folders each trade playbook.md and rules.yaml for one feature.yaml; the 8 mode.yaml files drop `playbook:`, `rules:` and `task:`; type schemas gain the field descriptions that the Inputs and Outputs sections held. This touch must stay: it is the reason the boundary check passes the migration" }
  - { path: components/base/forge/features/create/, reason: "the create instructions and DOD items say feature.yaml where they say playbook and rules" }
  - { path: tests/, reason: "the 10 test files that build or read a playbook use a feature file; the playbook-section tests are replaced by schema tests of the same count or fewer" }
  - { path: README.md, reason: "the opening paragraph, the folder map and Adding things say a feature is a YAML definition" }
  - { path: docs/DESIGN.md, reason: "Features: the playbook sentences become the feature file; paid for in the same file (it is at its 3000 word ceiling)" }
  - { path: docs/INTERFACES.md, reason: "section 1 drops `playbook`, `rules` and `task`; section 2 becomes the feature file contract; paid for in the same file" }
  - { path: framework/limits.yaml, reason: "release step: the lower counts are written down" }
  - { path: bay/__init__.py, reason: "release step: version 5.0.0" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading list" }
  - { path: HANDOFF.md, reason: "it still describes the 1.0.0 release; cut to this work" }
---

# 0022: A feature is defined as data

## Summary

The framework exists so that a job is a definition with structure, not a page of prose. Today a feature is half that. Its interface, steps, effects and review are data in `mode.yaml`, and its rules are data in `rules.yaml`. Its instructions, definition of done and failure handling are a Markdown `playbook.md` whose headings a hand-written parser checks. More than half of that Markdown restates the manifest, and nothing checks that the two agree beyond a substring match.

This proposal makes the feature file the one place a feature's instructions live, in YAML, checked by a schema:

- `playbook.md` and `rules.yaml` of a feature become one `feature.yaml` with four lists: `steps` (the instruction of each role step, keyed by step id), `done`, `rules` and `failure`.
- Inputs and outputs are described once, in the type schemas the dispatcher already validates.
- A role step is handed its own instruction, not the whole playbook.
- The Markdown parser and the fuzzy playbook check are deleted.

It does not change skills or the coordinator playbooks. Those are the next two proposals (see Not in this proposal).

## Problem

Measured on main, over the 14 feature playbooks (5,337 words):

| Section | Words | Also defined in |
|---|---|---|
| Purpose | 300 | `description` of the feature in `mode.yaml` |
| Inputs | 340 | the `in` type schema |
| Steps | 2,268 | `steps` in `mode.yaml` (ids, kinds, endpoints, `when:`), plus each role step's `task:` |
| Outputs | 182 | the `out` type schema |
| Definition of Done | 1,610 | nowhere else |
| Failure handling | 626 | nowhere else |

1. **Two sources.** 3,090 words (58%) describe things the manifest or a schema already defines. `components/modes/feed-briefing/features/digest/playbook.md` says the store is refreshed when "older than 2h"; `mode.yaml:33` says `when: "stale > 2h"`. Change one and the other is wrong, silently.
2. **The check is weak.** Conformance rule C-1 (`bay/conformance.py:104`) passes when the Steps section contains the step id, the role name or the word "review" anywhere. It runs in review and in `improve.audit`, not in `bay check`. Nothing checks Inputs or Outputs.
3. **A role step has its instruction in two places.** `mode.yaml` gives the `themes` step a `task:` ("Write the digest from the gathered items.") and the playbook gives it a paragraph. The agent gets both.
4. **The agent gets everything.** `_executor_brief` (`bay/dispatch.py:715`) sends `playbookText`, the whole file, to every role step, and the definition of done a second time as `definitionOfDone`.
5. **Structure is enforced by a custom parser.** `bay/playbook.py` (111 lines) recognises six headings, numbered lists and the `- [DOD-n] (level) text` line by regular expression. A schema does this for every other file in the kit.

## Change

### 1. The feature file

`features/<feature>/feature.yaml`, kind `Feature`, validated by `schemas/rules.schema.json` (which already holds two kinds):

```yaml
apiVersion: agentbay/v5
kind: Feature
steps:
  themes: >-
    Group the gathered items into 3-7 themes (or by selector when there are several). Narrow with the
    corpus-sql skill and read the items you rely on in full when the gathered ones are not enough.
    Give each theme a short summary and the items it rests on.
done:
  - { id: DOD-1, level: must, statement: "Every theme cites at least 2 stored items, or exactly 1 when the theme is explicitly about a single item." }
  - { id: DOD-2, level: must, statement: "Every citation is the url or id of a stored item in the period." }
rules:
  - { id: R-1, level: must, statement: "Cite only urls or ids of stored items, exactly as stored.", appliesTo: both, check: citations_resolve, refs: [DOD-2] }
failure:
  - { when: "No items in the period", then: "Return zero themes and say so in `notes`; do not invent themes." }
  - { when: "Coverage is incomplete", then: "Produce the digest for what is covered and state the gap." }
```

- `steps` holds one instruction for each role step, keyed by the step's `id` in `mode.yaml`. Code steps, gates and the review step take none: the interface endpoint, the gate text and the review block already describe them.
- `done` items have the shape rules have: `id`, `level`, `statement`.
- `rules` is today's `rules.yaml` list, unchanged.
- `failure` is a list of `when` and `then`.

### 2. What moves where

| Today | After |
|---|---|
| `## Purpose` | the feature's `description` in `mode.yaml` (it is there already) |
| `## Inputs` | `description` on each property of the `in` type schema |
| `## Steps`, a code step | nothing: `steps` in `mode.yaml` is the definition |
| `## Steps`, a role step, and its `task:` | `steps.<id>` in `feature.yaml`; `task:` is removed from `mode.yaml` |
| `## Definition of Done` | `done` in `feature.yaml` |
| `## Outputs` | `description` on the `out` type schema |
| `## Failure handling` | `failure` in `feature.yaml` |
| `rules.yaml` | `rules` in `feature.yaml` |
| the keys `playbook:` and `rules:` of a feature | removed: the file is found at `features/<feature>/feature.yaml`, in the child mode first, then its parent, as types and skills are |

Text in a Steps section that describes how the framework behaves, such as the paragraph on gate skipping that opens the Steps of `forge.extend`, is not an instruction to a role. It is already stated in `docs/DESIGN.md` (A gate binds content) and is dropped from the feature.

### 3. What `bay check` enforces

- A feature with a role step has a feature file. A feature with only code steps needs none, as today.
- Every role step has an entry in `steps`, and every key of `steps` is the id of a role step of that feature. This is an exact match, in lint, and replaces C-1's substring check.
- `done` ids are unique and every `refs:` of a rule names one (today's check, `bay/lint.py:266`).
- A `playbook.md` or `rules.yaml` left in a feature folder is reported with the fix, as an unread file.

### 4. What a role step is handed

`_executor_brief` sends:

- `instruction`: this step's text.
- `steps`: the feature's ordered steps (id and kind), generated from the manifest, so the role sees where it sits.
- `failure`, `rules`, `definitionOfDone`, `input`, `previous`, `tools`: as today.
- `inSchema` and `outSchema`: the schemas, with their field descriptions.

`playbook` and `playbookText` go. The review brief is unchanged: it already carries the done items and rules as data.

### 5. Reading a feature

`bay describe <mode>` already prints each feature's steps, done items and rules as resolved (`bay/cli.py:224`). It also prints the instructions and the failure list. No command is added.

## What stays

- The coordinator `playbook.md` at the root of a mode, and the word playbook for it.
- Skills.
- The definition of done ids, the rule ids and every deterministic check.
- Review settings, which live only in `mode.yaml`.
- Inheritance: a child feature with no feature file of its own uses its parent's.

## Cost against the ceilings

Estimates; the plan step measures each on a scratch copy.

- **`bay_lines` (9703): expected to fall.** Removed: `bay/playbook.py` (111) and `playbook_matches_workflow` (about 35). Added: the loader for `steps`, `done` and `failure` in `bay/rules.py`, the two key checks in lint and the brief fields. No exception is asked for. If the plan measures a rise, the proposal is amended before the gate.
- **`schemas` (16):** unchanged. The Feature kind goes into `rules.schema.json`.
- **`cli_commands` (16), `framework_folders` (2), `top_level_folders` (7):** unchanged.
- **`tests` (463):** does not grow. The tests of playbook sections and numbering are replaced by schema tests; the plan names each.
- **`kit_python_lines`, `long_lines`, `comment_lines`:** no change expected.
- **Docs.** DESIGN is at 3,000 words and INTERFACES at 2,989. Both edits replace sentences about playbook sections with shorter ones about the feature file.

## Compatibility and safety impact

- **Contracts.** Removing `playbook`, `rules` and `task` from the mode contract and changing the rules file is breaking, so the apiVersion becomes `agentbay/v5` (DOD-11) and the release is 5.0.0. A v4 file is refused with the fix, as a v3 file is today. There is no compatibility layer (B-12): every shipped feature is migrated in this change.
- **Upgrading a user mode.** For each feature with a playbook: move the role-step text to `steps.<id>`, the DOD lines to `done`, the failure bullets to `failure`, the rules list to `rules`; delete `playbook.md` and `rules.yaml`; remove `playbook:`, `rules:` and `task:` from `mode.yaml`; set `agentbay/v5` in every manifest. `bay check` names each file still to do.
- **Review strength.** The reviewer's brief does not change, so no review gets weaker. The mandatory review of `forge.extend` and the C-6 rule are untouched.
- **Agent behaviour.** A role step sees less text: its own instruction, not its neighbours'. The risk is a step that relied on a sentence written under another step. The migration reads each playbook for that, and the offline golden tests and the fake-source demo are the evidence.
- **Safety.** No guard rule, env, secret path or protected path changes meaning. `framework/kernel.yaml` names no playbook or rules file, so nothing is added to or dropped from protection.
- **Extensibility (DOD-4).** A new source is still one connector and one env binding line. A new feature is one `feature.yaml` and one block in `mode.yaml`, where it was two files and one block.

## Not in this proposal

Each is its own proposal, in this order:

1. **Skills.** A `SKILL.md` is checked only for its name and front matter (8 files, 1,824 words). The digest skill repeats the two-citation minimum of DOD-1 and R-2 and the 60-word limit of R-5. The next proposal gives a skill enforced structure and has it cite done and rule ids in place of restating them.
2. **Coordinator playbooks.** The 7 mode-level `playbook.md` files (3,192 words) have no required structure. The Chief of Staff's is 1,226 words.
3. **Role prompts and long rule statements.** A role's `prompt` is a paragraph block in YAML, and some rule statements hold several conditions in one sentence.

## Owner decisions

Not yet decided. Each is written above as the first option.

1. **Where a role step's instruction lives.** In `feature.yaml` under `steps.<id>`, with `task:` removed from `mode.yaml` (as written); or in `mode.yaml` as `task:`, with no `steps` in the feature file. The first keeps `mode.yaml` a short map and long text out of it. The second keeps one fewer key to cross-check.
2. **How the feature file is found.** By its folder, `features/<feature>/feature.yaml` (as written); or by a key in `mode.yaml`. The folder rule removes two keys from every feature and matches how types and skills are found.
3. **The file's name and kind.** `feature.yaml`, kind `Feature` (as written); or keep the name `rules.yaml` and kind `Rules` with the three lists added, which leaves the name describing a quarter of the file.
4. **The version.** `agentbay/v5` and 5.0.0 (as written). DOD-11 requires the bump, and it touches the 82 component manifests and the 6 framework ones. The alternative, keeping v4 by accepting both shapes, is a compatibility layer and B-12 forbids it.
5. **Framework text in Steps sections.** Dropped where DESIGN already says it (as written); or kept as a `notes` field on the feature, which reopens a free-prose slot.
