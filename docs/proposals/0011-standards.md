---
# Approval is recorded in the ledger by `bay approve`; this file grants nothing. Design only. Split from 0010 by owner decision; it needs 0010's loader, the `tools` component and the `component.yaml` manifest, so it lands after 0010.
id: "0011"
status: draft
depends: "0010"
touches:
  - { path: components/, reason: "NEW `python`, `unslop` and `comments` components; `standards.check/v1` in `components/tools/interfaces/`; the `deadcode` connector in forge and the split of improve-detect; the `standards` step in forge.extend and delivery.build; the provider lists in the `local-authoring` and `workspace` envs" }
  - { path: framework/limits.yaml, reason: "new measure comment_lines" }
  - { path: framework/roles/, reason: "builder states the comments rule and loads standards skills; reviewer checks it" }
  - { path: schemas/, reason: "component.schema.json gains the `comments:` block" }
  - { path: bay/limits.py, reason: "comment_lines, per file and in total" }
  - { path: bay/dispatch.py, reason: "a code step runs every provider bound to a list interface; `standards:*` skill group" }
  - { path: tests/, reason: "tests for the check mechanism and the three checkers" }
  - { path: docs/INTERFACES.md, reason: "standards.check/v1" }
  - { path: requirements-dev.txt, reason: "NEW. ruff, mypy and stub packages, pinned; dev only" }
exceptions:
  - { measure: kit_python_lines, to: 6800, reason: "the python, unslop and comments checkers are new kit Python (about 400 lines); 0010's move adds none, and 0011 slice 2 and 0012 slice 3 remove about 190 between them" }
---

# 0011: Standards as components

## Decisions

### 1. Standards as the first new components

No standards mode. A new interface `standards.check/v1` (owned by `tools`) has one operation, `change { base }`, with the same result shape as `improve.detect/v1.change`: `new`, `existing`, `stopped`. It compares findings in the working tree with the tree at the merge-base of `base`, keyed by file, rule and message, so the 2279 ruff findings, 638 mypy errors and 63 unformatted files in the current tree (lint baseline) are `existing` and block nothing. No repository-wide reformat is proposed (rejected: a diff of 63 files that breaks every open branch and 0009's review budget; a tolerated-findings file was rejected because it rots).

A binding is a list, like `items.source`. A code step runs every bound provider and merges the results; one new finding blocks. Each provider filters by the file globs in its own config. Features choose skills by `skills: [standards:*]` (every skill of the components bound to `standards.check/v1` in the step's env), `[python:python]` (one), or none. Another language later is one folder (`components/go/`) plus its name in the binding lists. No checker is split across an interface, a connector and a mode: the interface is `tools`', and each checker with its config and skill is one folder.

`components/python/` (`component.yaml`): `connectors/check/` (runs ruff and mypy as subprocesses, list arguments, no shell, with a timeout), `ruff.toml` and `mypy.ini` (line length 120, the brief's rule selection, `mypy --strict`; passed with `--config`, so the repo root gets no tool config), `skills/python/SKILL.md` (the brief's checkable rules, with the ones only a review can see). Tool versions are pinned in the new dev-only `requirements-dev.txt` (ruff 0.16.9, mypy 2.3.1, `types-PyYAML`, `types-jsonschema`); runtime dependencies are unchanged. If a tool is missing the step ends blocked and names the pip command. The brief marks many rules `[U]` (not re-read against their primary source); slice 3 confirms each rule code with `ruff rule`, and the two pinned versions, before anything is enabled.

`components/unslop/` (`component.yaml`): `skills/unslop/SKILL.md` kept as published, `LICENSE` with the MIT notice and `Copyright (c) 2026 Lauren Tan`, and a README naming the source as the `pstack/skills/unslop` folder of the `cursor/plugins` repository on GitHub (no URL is written, so no company domain enters the repo). `connectors/check/` scans for the mechanical patterns of the skill: em dashes, curly quotes, decorative emojis, the listed AI vocabulary, "serves as"-type phrases. The skill's judgement rules stay with the reviewer. The skill file is third-party text: never executed, never edited.

`components/comments/` (`component.yaml`), the owner's comments rule. It is language-neutral: it owns the rule and the measurement, and each language component declares only its comment syntax in a `comments:` block of its `component.yaml` (python: line `#`, docstrings; a future go: `//` and `/* */`). There is no per-language copy of the check.

- **Rule.** No comments by default. A one-line comment only for a reason the code cannot express: a security or crash-safety invariant, or an outside API's quirk. No history, no finding ids, no cross-references. A docstring is one line per public function and a few lines per module; design text goes in the component README.
- **Measurement.** `connectors/check/` counts comment and docstring lines per file. It reports a finding when a file's count rises above its count at the merge-base, and the total is held by the `comment_lines` ceiling (Limits below).
- **Who states it.** The rule's full text is `skills/comments/SKILL.md`, loaded through `standards:*`. The builder role states it in one sentence, the python skill states the Python form (docstring length), and the reviewer role checks it as a DoD item (DOD-17), because whether a comment is a reason the code cannot express is a judgement the counter cannot make.
- **Cleanup.** 0012 slice 6 removes the existing comments that break the rule.

### 2. Limits

- NEW `comment_lines`: comment and docstring lines, per file and in total, as counted by the `comments` component (decision 1). Its ceiling is set when the component lands, lowered to the real count by 0012 slice 6, and can only tighten.
- `kit_python_lines` is counted as 0010 decision 6 says; the exception is in the front matter. The `tests` ceiling is the one 0010 sets; the tests this proposal adds (the mechanism and the three checkers) fall inside it, and 0012 lowers it.

### 3. Slices

Each ends with the tests green and `bay check` clean.

1. **Standards mechanism.** `standards.check/v1`, list-bound code step, `standards:*` skills, with a fixture provider in its test.
2. **Split improve-detect.** `limits` to `forge.scaffold/v1`; `change` into forge's `deadcode` connector as a `standards.check/v1` provider (0010 decision 7). The old `deadcode` step stays until slice 6.
3. **`python`.** Checker, config, skill, requirements-dev, the new-versus-base test, the version and rule-code confirmation.
4. **`unslop`.** Skill, notice, prose checker, tests.
5. **`comments`.** Component, skill, checker, the python syntax declaration, the `comment_lines` measure, tests.
6. **Wire.** Bind the providers: `[python, unslop, comments, deadcode]` in `local-authoring` (forge) and `[python, unslop, comments]` in `workspace` (delivery). forge.extend gets one `standards` step after `limits` that replaces its `deadcode` step, with DoD items "the standards check reports no new finding" (DOD-16) and "comments follow the rule" (DOD-17); delivery.build gets the same step. The roles load the skills and the builder role states the comments rule.

Slices 1 to 6 add behaviour.

## Prevention

Same rule as 0010's Prevention: a check, never prose.

| Root cause | Check that blocks it | Slice |
|---|---|---|
| Python style, comments that restate code | `python` and `comments` providers in the `standards` step | 3, 5, 6 |

## Safety impact

The new checkers run local tools on project files with list arguments and a timeout, and read nothing outside the project. The unslop skill is data, never run.
