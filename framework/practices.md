# Practices

One list. Each practice appears once and says how it is held. Builders' briefs and the reviewer cite practices by id. A practice held by a check cannot be forgotten; a practice held by review is a candidate for a check (P-17). Words are used as `CONTEXT.md` defines them. Reasons are in `docs/adr/`.

Held by: **check** (fails `npm run check`), **review** (the reviewer verifies it on every slice), **planned check** (review today; the named check is to be built).

## Code

| Id | Practice | Held by |
|---|---|---|
| P-01 | No comments in code. Comments go stale. A name says what; a decision record says why; `bay/README.md` says how the parts fit. | check: lint rule `agentbay/no-comments` |
| P-02 | The language's own practices, with a good and a bad example each, are in the toolchain's file: for TypeScript, `components/base/typescript/practices.md` (TS-01 to TS-17). A brief's Input names that file. | check: compiler and lint for most; review for the rest |
| P-03 | Problems are returned as values (`Outcome<T>`), not thrown, except where the process cannot go on. | review |
| P-04 | Readable before short. No line is packed to save lines. | check: format; review |
| P-05 | Model the domain in types: a closed set is a union with one shape per case, so a state that cannot happen cannot be written. | review |
| P-06 | Data from outside is parsed once, at the edge. Inside, types are trusted. | review |
| P-07 | A step that may crash or be retried ends in the same state however often it runs. | review; crash tests in runs |

## Structure

| Id | Practice | Held by |
|---|---|---|
| P-08 | A kernel feature is a deep module: a folder with one entry file. Other features import only that file (ADR 6). | check: `tests/feature-map.test.ts` |
| P-09 | Mode code imports only the toolbox. An adapter imports only the harness interface. | check: feature map test, `bay check` |
| P-10 | A port exists only when two adapters exist. | review |
| P-11 | Replace and delete, never layer. Callers move and the old thing goes in the same slice. No shim, alias or re-export (ADR 9). | check: two dead-code runs; review of line counts |
| P-12 | The same code or rule lives in one place (ADR 11). | planned check: copy-paste detector with a threshold |
| P-13 | Before adding, remove what is in the way. Size is reported before and after every slice and a rise is explained, but size is never a target: quality and readability decide. | review: line counts in every report |
| P-14 | A wide or new interface is designed at least three ways, under different constraints, and compared before it is built (ADR 10 is the example). | review |

## Tests

| Id | Practice | Held by |
|---|---|---|
| P-15 | The interface is the test surface. A feature's tests import its entry file and assert what a caller observes. | planned check: test imports against the feature map |
| P-16 | A test asserts literal expected values. A test that still passes when the code under test returns nothing is rewritten or deleted. | planned check: a script that stubs imports; review by bug injection |
| P-17 | The builder writes the test first and sees it fail. | review: the report says how it failed |
| P-18 | The reviewer injects bugs of their own, in code the builder's injections did not reach. | review |
| P-31 | Bugs are injected in a throwaway copy of the tree, never in the working tree, and each test run has a time limit. A run that dies leaves nothing behind. Whoever picks up a worktree checks it is clean first. | review |
| P-32 | A step that needs no judgement is a script, not a skill. A skill holds only what a model must decide, in as few words as say it. When a skill step can be replaced by a script that gives the same output, replace it. | design, review |
| P-33 | A plan is broken into vertical slices that can run side by side. Each slice names what it delivers, its write scope, and the slices it must come after with the reason. Slices with disjoint scopes and no order between them form a wave. An interface two slices meet at is agreed and merged first. | plan |
| P-34 | A mode slice changes only its mode's folder and its interface. A capability the kernel lacks is its own slice, built first; a builder that lacks one stops and says so. | plan, build, review |
| P-35 | Interfaces first. Before a plan is cut, the design names each module touched, its one entry and what the entry offers as a caller would use it. An interface two slices meet at is merged first, with a test any implementation must pass. A plan that cannot give its slices narrow write scopes goes back to design. | design, plan |
| P-19 | Done means proven on the real thing: the command run, the demo walked, the harness session held. A passing type check is not proof. Each brief names the real thing. | review |

## Work

| Id | Practice | Held by |
|---|---|---|
| P-20 | Work is cut into small vertical slices: one feature or one mode (ADR 7). | review |
| P-21 | A brief has the seven sections of the skill contract and a numbered definition of done. | review; planned check: `bay check` on `docs/briefs/` |
| P-22 | A builder's report gives evidence per definition-of-done item, deletions with line counts, the same thing in more than one place, ways round the rule, what was not done and what was not verified. | review |
| P-23 | The reviewer never builds the slice it reviews, reruns every check, and reports only what it verified. A builder's claim is verified or left out. | review |
| P-24 | A mechanical change is made by a script the reviewer can rerun. | review |
| P-25 | A builder that must change course is stopped and a fresh one is started with the whole scope. A running builder is not redirected. | review |
| P-26 | A rule written down twice becomes a check. | review of this file: every "review" row is a candidate |
| P-27 | At each checkpoint an agent that did not see the build evaluates the whole, and at least one evaluator is a different model. | review |
| P-28 | Reversible work proceeds without asking. The owner decides approvals, anything that cannot be undone, and anything that changes what they type or see. | review |

## Words

| Id | Practice | Held by |
|---|---|---|
| P-29 | One meaning per word (`CONTEXT.md`). A new term is added there first. | review; planned check: "do not say" words in briefs and docs |
| P-30 | Prose for a person is plain: short declarative sentences, one thought each; the conclusion first; no filler, no hedging that carries no information, no invented metaphor, no long dash. This holds for docs, reports, and what a mode shows its owner. | planned check: a script for the mechanical tells; review |

## Considered and not adopted

| Idea | Source | Why not |
|---|---|---|
| Comments that explain why | pstack | Owner rule: none. The why goes in a decision record. |
| Citing a principle in every reply | pstack | Noise for the reader. Reports cite a practice only where it changed a choice. |
| A long interview before every plan | grill-me | The owner prefers a few selectable choices. Used only for a new mode's first brief. |
| Tickets in an issue tracker | to-tickets | Briefs live in the repo, where builders and the kernel can read them. |
| A sandbox library under forge | Sandcastle | Owner decision (ADR 8). The pattern is used; the dependency is not. |
| An agent framework under the kernel | Mastra, Deep Agents | The kernel never drives a model (ADR 2). They are harnesses behind adapters. |
| An in-memory copy of the store for tests | own earlier design | It tested the copy. Tests use the real store with a fault injector (ADR 10). |

## Sources

Deep modules, seams, replace-don't-layer, vertical slices, glossary and decision records: the codebase-design, domain-modeling, to-tickets and tdd skills in `mattpocock/skills`. Prove on the real thing, tests that survive empty code, owning a subagent's output, rules into checks, levers, second models, plain prose: the poteto-mode, technical-writing and unslop skills in `cursor/plugins` (pstack). Ideas are adapted; no text is copied.
