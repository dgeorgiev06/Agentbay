---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only: nothing is changed before the gate. Owner request, chat 2026-11-12: "We need a structure for skills in modes", then: skills define input and output in config, a definition of done that reviewers use, and optional rules that reviewers load. Every count and line cited was read on main at 4.0.0 (a7a425d). Line costs are estimates until the plan step measures them. Builds on proposal 0022.
id: "0023"
status: draft
touches:
  - { path: schemas/skill.schema.json, reason: "NEW: the Skill contract (metadata name and description; spec when, in, out, uses, steps, examples, done, rules)" }
  - { path: schemas/data/review.verdict.v1.schema.json, reason: "the id pattern (:25) also accepts a skill's item, `<skill>.DOD-n` and `<skill>.R-n`; a widening, so review.verdict stays v1 (as C-n in 0020)" }
  - { path: bay/model.py, reason: "mode_skills and role skills find `skills/<name>/skill.yaml`; skill_front_matter (the SKILL.md parser, :866-887) is removed; a loaded skill carries its in, out, uses, done and rules; a feature knows the skills it lists" }
  - { path: bay/rules.py, reason: "a skill's `done` and `rules` load with the loader that reads a feature's, so both have one shape" }
  - { path: bay/lint.py, reason: "lint_skill_names (:713) validates each skill against the schema; new checks: a skill's `uses` are granted by every feature that lists it, `in` and `out` resolve to a type or a valid schema, done ids are unique and a rule's `refs` name them, a rule `check` is a known check; a SKILL.md left in the kit is reported with the fix" }
  - { path: bay/dispatch.py, reason: "the executor brief and the review brief (:700-725) carry the done items and rules of the feature's skills; _run_checks (:608) also runs a skill rule's `check`; _accept_review (:617) requires a verdict for each skill item and counts a failed must" }
  - { path: bay/conformance.py, reason: "names_no_tools also reads skill files (C-4 names skills but the check skips them today); dod_checkable and rules_testable read a skill's done items and rules" }
  - { path: bay/graph.py, reason: "the artifact graph classifies skill.yaml" }
  - { path: adapters/claude-code/claude_code.py, reason: "the build renders `.claude/skills/<owner>--<skill>/SKILL.md` from skill.yaml in place of copying a file and rewriting its `name:`" }
  - { path: adapters/claude-code/tests/, reason: "the skill tests in test_adapter.py build from skill.yaml" }
  - { path: framework/rules/conformance.yaml, reason: "new should rule: a skill's done items and rules are about how the method was applied; what must be true of a feature's result stays in the feature, and neither restates the other" }
  - { path: framework/roles/reviewer.yaml, reason: "the prompt says a verdict covers the skill items in the brief, and when `n/a` is right for one" }
  - { path: framework/roles/skills/, reason: "research-brief becomes skill.yaml" }
  - { path: framework/kernel.yaml, reason: "only if a protected path names a SKILL.md; the plan step checks" }
  - { path: components/, reason: "the 7 mode skills become skill.yaml (improve 2, store 2, feed-briefing 1, mail-briefing 2), each with in, out and done items; limits a skill and its feature both state are kept in one of them; the feature that lists a skill whose endpoints it does not grant is corrected" }
  - { path: components/base/forge/features/create/, reason: "the create instructions say how a skill is written" }
  - { path: bay/templates/, reason: "NEW skill template, so a scaffolded mode shows the shape" }
  - { path: tests/, reason: "the skill-name tests in test_lint.py and test_feature_uses.py use skill.yaml; the front-matter tests are replaced by tests of the new checks and of the review brief" }
  - { path: README.md, reason: "the folder map and Adding things name skill.yaml" }
  - { path: docs/DESIGN.md, reason: "Concepts, Features (what the reviewer is given) and B-8; paid for in the same file" }
  - { path: docs/INTERFACES.md, reason: "the skill contract in section 1 and the verdict ids in section 2; paid for in the same file" }
  - { path: framework/limits.yaml, reason: "release step: counts written down; `schemas` rises to 17 under the exception" }
  - { path: bay/__init__.py, reason: "release step: version" }
  - { path: CHANGELOG.md, reason: "release step: entry, with an Upgrading list" }
exceptions:
  - { measure: schemas, to: 17, reason: "A skill is a kind of its own and gets its own schema file. The alternative, a fourth kind inside rules.schema.json, keeps the count at 16 and hides the contract (owner decision 1)." }
---

# 0023: A skill is defined as data

## Summary

A skill is the one part of a mode with no enforced structure. `SKILL.md` is checked for a `name`, a `description` and nothing else; the body is free prose. This is the problem the framework set out to solve, inside the framework.

This proposal makes a skill a YAML definition with the same parts a feature has: an input, an output, steps, a definition of done and optional rules. `bay check` verifies the definition against the features that use it. The reviewer is handed a skill's done items and rules and gives a verdict for each, as for a feature's. The agent runtime still gets a `SKILL.md`: the adapter renders it at build time, as it already renders agents.

## Problem

Measured on main: 8 skills (7 in modes, 1 on a role), 1,824 words.

1. **No structure to follow.** Every shipped skill is, by convention, a numbered procedure with commands and a closing "return X". Nothing requires it, so the next skill need not look like the last, and an agent writing one has no shape to fill.
2. **No stated input or output.** What a skill needs and what it hands back is in its prose, if anywhere. The digest skill says "Return only the Digest JSON"; nothing ties that word to the `Digest` type.
3. **A reviewer never sees a skill.** The review brief carries the feature's done items and rules (`bay/dispatch.py:700`). Whether the method was followed, such as "cite only ids you read with `get`", is judged only if the feature's author copied it into the feature.
4. **A skill can tell an agent to call what its feature does not grant.** `components/base/store/skills/corpus-sql/SKILL.md:25` offers `items.store/v2.search` and `items.store/v2.facets` as shortcuts. `feed-briefing.digest` lists that skill and grants neither endpoint (`components/modes/feed-briefing/mode.yaml:30`). The use shim refuses the call at run time. Nothing catches it before.
5. **Limits are written twice.** In `feed-briefing.digest`, the two-citation minimum is in DOD-1, in rule R-2 and in the digest skill (step 4). The 60-word summary limit is in R-5 and in the skill (step 3). Only the feature's copy is enforced.
6. **The skill check skips skills.** Conformance rule C-4 says skills name no concrete tool or connector, but `names_no_tools` (`bay/conformance.py:174`) reads only playbooks and rules files.

## Change

### 1. The skill file

`skills/<skill>/skill.yaml` in a mode, or `framework/roles/skills/<skill>/skill.yaml` for a role:

```yaml
apiVersion: agentbay/v5
kind: Skill
metadata:
  name: corpus-sql
  description: Find stored items with read-only SQL and cite them by id.
spec:
  when: A step needs items beyond what its plan gave it.
  in:
    type: object
    required: [question]
    properties:
      question: { type: string, description: "What to find, in words." }
      since: { type: string, description: "Start of the period, ISO-8601 or relative (7d)." }
  out:
    type: object
    required: [items]
    properties:
      items: { type: array, items: { type: string }, description: "Ids of the items read in full, as stored." }
  uses: [items.store/v2.describe, items.store/v2.sql, items.store/v2.get, items.store/v2.thread]
  steps:
    - Call describe once to learn the views, columns, allowed functions and limits.
    - Narrow with one SELECT per sql call. Always select id and url; keep text columns short.
    - Read in full the few rows you will rely on, with get, or thread for a conversation.
    - If a call returns an error, it says what to change. Fix the query and retry.
  examples:
    - { name: recent by author, text: "SELECT id, url, createdAt FROM v_items WHERE author = 'lido' ORDER BY createdAt DESC LIMIT 20" }
  done:
    - { id: DOD-1, level: must, statement: "Every id in `items` was returned by a get or thread call in this step." }
    - { id: DOD-2, level: must, statement: "Each id is copied exactly as stored, `<source>:<extId>`." }
  rules:
    - { id: R-1, level: must_not, statement: "Open a store file or run a command other than the role's data shim.", appliesTo: both }
    - { id: R-2, level: must, statement: "Cite only stored items.", appliesTo: both, check: citations_resolve, refs: [DOD-2] }
```

| Field | Is | Required |
|---|---|---|
| `metadata.name`, `description` | what the skill is; the name equals the folder | yes |
| `when` | when a role should load it | yes |
| `in` | what the skill needs: a type name of the mode, or a JSON schema | yes |
| `out` | what the skill hands back: a type name, or a JSON schema | yes |
| `uses` | the read endpoints its steps call | when it calls any |
| `steps` | the procedure, in order, one action each | yes |
| `examples` | named commands or queries | no |
| `done` | acceptance criteria: `id`, `level`, `statement`, as in a feature | yes, at least one |
| `rules` | constraints: the shape of a feature's rules, with `appliesTo` and an optional `check` | no |

There is no free-text body.

`in` and `out` take a type name where the mode already has the type (the digest skill's `out` is `Digest`, the type its feature returns), and an inline schema where the shape belongs to the skill alone. A role's skill uses inline schemas, since a role has no types folder.

### 2. What a reviewer is given

A feature lists its skills in `skills:` (absent means every skill of the mode, as today). For each one, the review brief carries the skill's done items and the rules whose `appliesTo` includes the reviewer, beside the feature's own:

```json
"skills": [
  { "name": "corpus-sql",
    "definitionOfDone": [ { "id": "corpus-sql.DOD-1", "level": "must", "text": "..." } ],
    "rules": [ { "id": "corpus-sql.R-2", "level": "must", "statement": "...", "check": "citations_resolve" } ] }
]
```

- **Ids.** In a brief and a verdict, a skill's item is `<skill>.<id>`, so it cannot collide with the feature's `DOD-1`. Inside `skill.yaml` the ids are plain.
- **Verdict.** The reviewer gives `pass`, `fail` or `n/a` for each. `n/a` is right when the step did not use the skill, and needs that reason.
- **Outcome.** A failed `must` or `must_not` skill item makes the call `partial` and halts it before release, exactly as a feature's does.
- **Checks.** A skill rule with a `check` runs on the feature's output with the feature's own checks, and its result is in the brief.
- **Executor.** A role step's brief carries the same done items and the rules for executors, and the rendered `SKILL.md` shows them, so the agent knows what it will be judged on.

### 3. What `bay check` verifies

- The file matches the schema, and `metadata.name` equals the folder name.
- **Grants.** Every endpoint in a skill's `uses` is in the `uses:` of every feature that lists the skill. Finding 4 becomes a lint error with the fix.
- **Types.** `in` and `out` each resolve: a name is a type the mode has, an inline value is a valid JSON schema.
- **Done and rules.** Done ids are unique, a rule's `refs` name done ids of the same skill, and a `check` is one `bay/checks.py` knows.
- **Tools.** `names_no_tools` reads skills, so C-4 is checked where it says it is.
- A `SKILL.md` left in the kit is reported with the fix, as an unread file.

### 4. Skill or feature: which holds a limit

Both now have done items and rules, so each limit needs one home.

| It is about | It lives in | Example |
|---|---|---|
| how the method was applied, wherever the skill is used | the skill | "Every cited id was read in full." |
| what must be true of this feature's result | the feature | "Every theme cites at least 2 stored items." |

A skill never names a feature, so it stays reusable. A feature may add to what its skills require and never lowers it: the strictest wins, as rules already stack. Code cannot tell that two sentences say the same thing, so "neither restates the other" is a `should` conformance rule the reviewer judges.

### 5. What is and is not enforced by code

- `in` and `out` are handed to the role and the reviewer and checked for validity at build time. The dispatcher validates a step's output, not a skill's. Where a skill's `out` is the type its step returns, that existing validation covers it; otherwise conformance to `out` is the reviewer's judgement.
- A done item or rule without a `check` is judged by the reviewer. One with a `check` is run by the dispatcher.

### 6. The build renders the runtime file

The adapter writes `.claude/skills/<owner>--<skill>/SKILL.md` from the definition: front matter (`name`, and `description` joined with `when`), then Input, Steps, Examples, Output, Done and Rules as sections. `skill_front_matter` and the `name:` rewrite go.

## What stays

- Where skills live, how a child mode's skill replaces its parent's of the same name, and the `<owner>--<skill>` runtime name (B-8).
- `skills:` on a feature, and its meaning when absent.
- A role's own skills.
- The feature's done items, rules and review settings.

## Cost against the ceilings

- **`schemas` (16): 17, under the exception above.**
- **`bay_lines` (9703): expected to rise.** Removed: `skill_front_matter` (22 lines) and the copy-and-rewrite in the adapter. Added: the lint checks, the skill items in both briefs, the prefixed ids in `_accept_review`, the skill checks in `_run_checks`. The plan measures the rise and names the `exceptions:` entry; the proposal is amended with it before the gate.
- **`tests` (463):** does not grow; the plan names what each new test replaces.
- **`cli_commands`, `framework_folders`, `top_level_folders`, `comment_lines`:** unchanged.

## Compatibility and safety impact

- **Contracts.** A `SKILL.md` in a mode is no longer read, which breaks a user mode that has one. This proposal is written to land in the same major version as 0022 (`agentbay/v5`, 5.0.0). If 0022 is already released, the release is 6.0.0 (owner decision 2). `review.verdict/v1` only accepts more ids.
- **Upgrading a user skill.** Move the front matter to `metadata`, the "Use for" sentence to `when`, each numbered step to `steps`, each recipe to `examples`, the endpoints it calls to `uses`; write `in`, `out` and at least one done item; delete `SKILL.md`. `bay check` names each one still to do.
- **Review gets stricter.** A feature that lists a skill is now reviewed against the skill's items too, so a call that passes today can end `partial`. This is the intent. The plan step runs the fake-source demo with the migrated skills and reports any new failure before the gate.
- **Review gets longer.** Each listed skill adds its items to the verdict. A feature with no `skills:` key lists every skill of its mode, so the plan step sets `skills:` on each shipped feature that leaves it out.
- **Safety.** Finding 4 moves from a run-time refusal to a build-time error; no grant widens. The fix shipped here is to move the two shortcuts out of the skill the digest feature lists, not to widen that feature's grants.
- **Extensibility (DOD-4).** A new source is still one connector and one env binding line.

## Owner decisions

Not yet decided. Each is written above as the first option.

1. **Where the contract lives.** Its own `schemas/skill.schema.json`, with `schemas` raised to 17 (as written); or a kind inside `rules.schema.json`, with no raise.
2. **The release.** With 0022 as 5.0.0 (as written); or on its own as 6.0.0.
3. **`in` and `out`.** A type name or an inline schema (as written); or type names only, which gives one form and needs a types folder for role skills.
4. **`done` is required.** At least one item per skill (as written); or optional, which lets a skill ship with nothing for a reviewer to judge.
5. **When a skill's items are reviewed.** For every skill the feature lists, with `n/a` allowed (as written); or only for skills a step names, which needs a `skills:` key on steps.
6. **Free text.** None (as written); or an optional `notes` field, which reopens the slot this proposal closes.
