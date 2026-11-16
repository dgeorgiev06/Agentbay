# Forge sources digest

Written 2026-11-16 for the reviewer who will design forge. It digests three public sources: Matt Pocock's skills, pstack, and Sandcastle. Words are used as agentbay's `CONTEXT.md` defines them where they refer to agentbay. Source terms are kept where they refer to the source.

## How this was read

The three GitHub repositories were read from shallow clones made on 2026-11-16, not page by page in a browser. One clone is one request per repository, so nothing was rate limited. The files are the same files the `blob/main` URLs show. The commits read:

| Repository | Commit | Commit date |
|---|---|---|
| `mattpocock/skills` | `5863806` | 2026-11-12 |
| `cursor/plugins` | `bf0c7cd` | 2026-11-14 |
| `backnotprop/pstack` (mirror) | `74bcc61` | 2026-11-15 |
| `mattpocock/sandcastle` | `1b380ca` | 2026-11-16 |

`aihero.dev` was mostly blocked from this session. Two pages opened through the fetch tool (`/sandcastle` and `/sandcastle/branch-strategies`). The author's index `https://www.aihero.dev/skills.md` did not open. The Sandcastle repository says its `docs/guide` folder is what the site publishes, so the sub-pages were read there.

Names have moved since the owner last looked. This matters when citing them:

- `diagnose` is now `diagnosing-bugs`. `review` is `code-review`. `to-prd` is `to-spec`. `to-issues` is `to-tickets`. `writing-great-skills` is `writing-for-agents`, in the productivity group.
- `zoom-out` was removed. The changelog says it went unused. It could not be read.
- The domain glossary file is now `GLOSSARY.md`. It used to be `CONTEXT.md`, which is the name agentbay took.
- `grill-me` and `grill-with-docs` are now one-line wrappers. The content is in `productivity/grilling`.
- Sandcastle has no "how-it-works" page. The nearest is `core-concepts`.

---

## 1. Licences

Not legal advice. This says what the files say.

| Source | Licence | Where read | What the text allows |
|---|---|---|---|
| `mattpocock/skills` | MIT. Copyright 2026 Matt Pocock. | `https://github.com/mattpocock/skills/blob/main/LICENSE` | Use, copy, modify, merge, publish, distribute, sublicense and sell. The condition: the copyright notice and the permission notice go into all copies or substantial portions. No warranty. |
| pstack in `cursor/plugins` | MIT. Copyright 2026 Lauren Tan. | `https://github.com/cursor/plugins/blob/main/pstack/LICENSE`. Also `"license": "MIT"` in `pstack/plugin.json` and `pstack/.cursor-plugin/plugin.json`, and a "license: MIT" line at the end of `pstack/README.md`. | Same MIT terms. |
| `cursor/plugins` itself | The repository root has no `LICENSE` file. The root `README.md` has a "License" heading with the one word "MIT". Each plugin folder has its own `LICENSE` file. | `https://github.com/cursor/plugins/blob/main/README.md` | The per-plugin file is what governs pstack. The root statement names MIT but carries no copyright line or licence text. |
| `backnotprop/pstack` (mirror) | MIT. Its `LICENSE` is the same text with the same copyright holder, Lauren Tan. | `https://github.com/backnotprop/pstack/blob/main/LICENSE` | Same MIT terms. The mirror adds its own edits (harness-neutral rewording of some skills, and two fixes). Those edits sit under the same file. |
| `mattpocock/sandcastle` | MIT. Copyright 2026 Matt Pocock. `"license": "MIT"` in `package.json`. | `https://github.com/mattpocock/sandcastle/blob/main/LICENSE` | Same MIT terms. |

What could not be verified:

- Whether the root "MIT" line in `cursor/plugins` is meant to cover files outside the plugin folders (`schemas/`, `scripts/`, `third_party/`). None of those were used here.
- Whether any skill text was itself taken from a third party under other terms. One case is declared: Pocock's `pr` skill credits a "show-me" skill by Dex Horthy at Humanlayer (`skills/engineering/pr/CREDITS.md`). The licence of that upstream skill was not checked.
- The content at `aihero.dev` (the prose on the site, as opposed to the repositories) has no licence statement that was seen.
- GitHub's own licence detection for these repositories was not checked. The files were read directly.

What this means for agentbay's current stance. `framework/practices.md` says ideas are adapted and no text is copied. Ideas need no notice. If forge ever ships a file that copies a substantial part of a skill (a template, a rule list, a script such as `check-plan.mjs`), MIT asks for the copyright and permission notice to travel with it.

---

## 2. The skills, one by one

Each entry gives: purpose, structure, rules (paraphrased), input and output, whether a human is assumed in the conversation, and whether a script could check the output.

### A. Matt Pocock's skills

The repository groups skills as `engineering`, `productivity`, `misc`, `in-progress` and an empty `deprecated`. A skill is a folder with `SKILL.md`, optional sibling reference files, and an `agents/openai.yaml` for Codex. Skills are either user-invoked (typed by a person, hidden from the model) or model-invoked. A router skill, `ask-matt`, describes the intended flow: grill, then spec, then tickets, then implement with tdd, then code review, then retro.

#### engineering/codebase-design (SKILL.md, DEEPENING.md, DESIGN-IT-TWICE.md)

- Purpose. A shared vocabulary and a few tests for designing deep modules.
- Structure. A glossary (module, interface, implementation, depth, seam, adapter, leverage, locality), each with words to avoid. Then deep versus shallow, principles, testability, relationships, rejected framings, and pointers to the two sibling files.
- Rules.
  - An interface is everything a caller must know, not only the types: ordering, invariants, error modes, configuration, performance.
  - Depth is measured as what a caller gets per unit of interface learned. The skill rejects measuring depth as a ratio of lines, because that rewards padding.
  - The deletion test. Imagine the module gone. If the complexity is gone too, the module was a pass-through. If it comes back in every caller, the module earns its place.
  - Callers and tests cross the same seam. Wanting to test past the interface suggests the module has the wrong shape.
  - A seam with one adapter is hypothetical. Two adapters make it real.
  - A deep module may have private seams that only its own tests use. They are not exposed.
  - For testability: take dependencies as arguments, return results instead of mutating, keep the surface small.
- DEEPENING.md. Classify a candidate's dependencies in four kinds, because the kind decides how it is tested: in-process (merge and test directly), local with a stand-in (test with the stand-in, seam stays private), remote but owned (a port, with a network adapter and an in-memory adapter), and true external (a port with a mock). Then "replace, don't layer" for tests: once tests exist at the deepened interface, the old tests of the shallow parts are waste and are deleted. A test that must change when only the inside changes is testing past the interface.
- DESIGN-IT-TWICE.md. Write the problem space for the person. Then start three or more sub-agents with fresh contexts, each under a different constraint (smallest interface, most flexible, best for the common caller, ports and adapters). Each returns the interface, a usage example, what is hidden, the dependency strategy and the trade-offs. Present them one by one, compare by depth, locality and seam placement, then give one firm recommendation, a hybrid if it fits.
- Input and output. Input: a module or cluster under discussion. Output: vocabulary applied to a design, or several candidate interfaces and a recommendation.
- Human assumed. Yes for design-it-twice (it shows the problem space to the user and presents designs). The vocabulary itself needs no human.
- Script-checkable. Partly. "Only the entry file is imported" and "a port has two adapters" can be checked from imports and a feature map. Depth, the deletion test and the comparison are judgement.

#### engineering/domain-modeling (SKILL.md, GLOSSARY-FORMAT.md, ADR-FORMAT.md)

- Purpose. Build and sharpen the project's glossary and decision records while a design is discussed.
- Structure. File layout (one `GLOSSARY.md`, or a `GLOSSARY-MAP.md` pointing at one per context, and `docs/adr/`). Then what to do during a session. Two format files.
- Rules.
  - Challenge a term the moment it conflicts with the glossary. Offer one precise word for a vague one.
  - Test relationships between concepts with invented edge cases.
  - Check what the person says against the code and raise contradictions.
  - Write a term into the glossary when it is settled, not later in a batch. The glossary holds no implementation detail.
  - Glossary entries: one or two sentences saying what the thing is, with the words to avoid. Only terms specific to the project.
  - Offer a decision record only when three things are all true: hard to reverse, surprising without context, and a real trade-off was made. A record can be one paragraph. Status, options and consequences are optional.
  - Files are created lazily, when there is something to write.
- Input and output. Input: a live design conversation and the existing glossary. Output: edits to `GLOSSARY.md` and new numbered records in `docs/adr/`.
- Human assumed. Yes. Every move is a question to the user.
- Script-checkable. The format is (entry shape, numbering, "avoid" words not used elsewhere in docs). Whether a term is right is judgement.

#### engineering/to-spec

- Purpose. Turn the conversation so far into a spec and publish it to the issue tracker, with no interview.
- Structure. Three steps and a template: problem statement, solution, a long numbered list of user stories, implementation decisions, testing decisions, out of scope, further notes.
- Rules.
  - Use glossary words and respect decision records.
  - Before writing, sketch the seams the feature will be tested at. Prefer existing seams. Prefer the highest seam. The ideal number is one. Confirm the seams with the user.
  - No file paths and no code snippets in the spec, because they go stale. The one exception is a snippet from a prototype that states a decision more exactly than prose (a state machine, a schema, a type shape).
  - Testing decisions say what a good test is, which modules are tested, and which existing tests are prior art.
  - Publish with the `ready-for-agent` label.
- Input and output. Input: conversation context and the codebase. Output: one issue on the tracker (or a local file) in the template.
- Human assumed. Lightly. One check of the seams.
- Script-checkable. Section presence and "no file paths" are. Whether the user stories cover the feature is judgement.

#### engineering/to-tickets

- Purpose. Cut a plan or spec into vertical slices with explicit blocking edges, and publish them.
- Structure. Five steps (gather, explore, draft, quiz the user, publish) and two templates.
- Rules.
  - Each slice goes through every layer and is demoable or verifiable alone. It is sized to fit one fresh context window.
  - Look for prefactoring that makes the change easy, and do it first.
  - Each ticket names the tickets that block it. The set is a graph. Work proceeds on the "frontier": tickets whose blockers are done.
  - Wide mechanical refactors are the stated exception. They are sequenced as expand, migrate in batches, contract. The old form stays beside the new until the last batch. If batches cannot stay green alone they share an integration branch and green is promised only at the end.
  - Show the breakdown to the user and iterate until approved.
  - Locally, one file per ticket under `.scratch/<feature>/issues/`, numbered in dependency order. On a tracker, one issue per ticket with native blocking links.
  - A ticket says what to build from the user's point of view, the acceptance criteria as checkboxes, and its blockers. No file paths.
- Input and output. Input: a spec, plan or conversation. Output: ticket files or issues.
- Human assumed. Yes. Step 4 loops until the user approves.
- Script-checkable. Yes for shape: every ticket has criteria, blockers resolve to real tickets, the graph has no cycle, numbering follows dependency order. Slice quality is judgement.

#### engineering/tdd (SKILL.md, tests.md, mocking.md)

- Purpose. A reference for running red then green so that the tests are worth keeping.
- Structure. What a good test is, seams, anti-patterns, rules of the loop. Two example files.
- Rules.
  - Tests check behaviour through public interfaces. A good test reads like a statement of a capability and survives refactors.
  - Test only at seams agreed in advance. Write the seams down and confirm them with the user before any test.
  - Three anti-patterns. Coupled to implementation (mocks internals, tests private methods, or checks through a side channel such as querying the database). Tautological (the expected value is computed the way the code computes it, so it cannot disagree). Horizontal slicing (all tests first, then all code).
  - Expected values come from an independent source: a known literal, a worked example, the spec.
  - Red before green. One seam, one test, one minimal implementation per cycle.
  - Refactoring is not part of the loop. It belongs to review.
  - Mock only at system boundaries (external APIs, time, sometimes the database or file system). Do not mock what you own. Prefer one specific function per external operation over a generic fetcher.
- Input and output. Input: a behaviour to build or a bug. Output: tests and code, one cycle at a time.
- Human assumed. Yes, once, to confirm the seams.
- Script-checkable. Partly. A script can see that a test file changed before the code in commit order, and that tests import only entry files. "Seen failing" needs a recorded run. Tautology needs judgement or mutation.

#### engineering/improve-codebase-architecture (SKILL.md, HTML-REPORT.md not read)

- Purpose. Find places where shallow modules could become deep ones, show them, and work through one with the user.
- Structure. Explore, present candidates as an HTML report, grilling loop.
- Rules.
  - Scope first. Deepening pays where code changes, so read the commit history for hot spots unless the user names an area.
  - A sub-agent with a fresh context walks the code and notes friction: concepts spread across many small modules, interfaces as complex as what they hide, pure functions extracted only for testability while the bugs sit in how they are called, leaks across seams, untested or hard-to-test parts.
  - Apply the deletion test to each suspect.
  - Write a self-contained HTML file to the system temp folder, never into the repository. One card per candidate: files, problem, solution, benefits in terms of locality and leverage, before and after diagrams, and a strength label (strong, worth exploring, speculative). End with a top recommendation.
  - Do not propose interfaces yet. Ask which candidate to explore.
  - Do not reopen a decision record unless the friction is real, and mark it clearly.
  - If the user rejects a candidate for a lasting reason, offer to record it so it is not suggested again.
- Input and output. Input: a codebase, optionally a direction. Output: an HTML report, then glossary and decision record edits from the grilling.
- Human assumed. Yes, throughout.
- Script-checkable. No. The candidate list could be seeded by scripts (import counts, churn), which is what agentbay's feature map already does.

#### engineering/grill-with-docs and productivity/grill-me, both over productivity/grilling

- Purpose. Interview the user until every decision in a plan is settled.
- Structure. `grill-me` calls `grilling`. `grill-with-docs` calls `grilling` and `domain-modeling`. `grilling` is one page.
- Rules.
  - Treat the plan as a tree of decisions. Work in rounds. A round asks every question whose prerequisites are settled.
  - Number each question and give a recommended answer. Word it so that "yes" accepts the recommendation.
  - A question that depends on an open question waits for a later round.
  - Facts are the agent's job. If a question needs a fact from the environment, send a sub-agent to find it and keep asking the rest. Decisions are the user's.
  - Done when no questions remain. Do not act until the user confirms a shared understanding.
- Input and output. Input: an idea or plan. Output: a settled set of decisions in the conversation (and glossary and decision records with the docs variant).
- Human assumed. Entirely.
- Script-checkable. No.

#### engineering/implement

- Purpose. Build one spec or ticket in the current session.
- Structure. Six lines.
- Rules. Fetch the ticket and say its title. Use tdd at agreed seams. Type-check often, run single test files often, run the full suite once at the end. Then run code-review. Commit to the current branch.
- Input and output. Input: a spec or ticket reference. Output: commits on the current branch.
- Human assumed. Only if the reference is ambiguous.
- Script-checkable. The checks it names are scripts. The skill itself asks for no evidence in its output.

#### engineering/implement-spec (not on the owner's list, read because it is the orchestration pattern)

- Purpose. Build a whole spec on one integration branch by running implementers in parallel over the ticket graph.
- Rules.
  - Every sub-agent starts with a fresh context. Talk to sub-agents sparsely, by pointers to the spec, tickets, notes and commits, not by repeating content.
  - An optional exploration sub-agent writes notes outside the repository for the others.
  - One fresh implementer per ticket, each in its own worktree on its own branch. It checks its worktree is based on the integration branch, builds with tdd, and merges the integration tip into its branch before reporting.
  - A separate merger sub-agent merges each finished ticket into the integration branch. New frontier tickets start at once.
  - When all tickets are done, one code review over the integration branch. All findings go to one fresh implementer.
  - Clean up the worktrees.
- Human assumed. No, after the start.
- Script-checkable. Worktree base, branch per ticket, and cleanup are all checkable by script. The skill leaves them to the agents.

#### engineering/diagnosing-bugs (was `diagnose`; includes scripts/hitl-loop.template.sh)

- Purpose. A fixed loop for hard bugs and performance regressions.
- Structure. A redaction rule, then six phases.
- Rules.
  - Redact secrets from everything shown.
  - Phase 1 is the skill: build a feedback loop that goes red on this bug. Ten ways are listed in order of preference, from a failing test down to a script that drives a human. Then tighten it: faster, sharper, deterministic. For flaky bugs raise the reproduction rate until it is debuggable.
  - Phase 1 is complete only when there is one command that has already been run and shown, that asserts the user's exact symptom, gives the same verdict each run, takes seconds, and runs unattended. No theory before that command exists.
  - If no loop can be built, stop, list what was tried, and ask the user for access or an artefact.
  - Phase 2: reproduce, confirm it is the user's failure and not a neighbour, then cut the repro down one element at a time until every remaining element is needed.
  - Phase 3: three to five ranked hypotheses, each with a prediction that could prove it false. Show them to the user but do not wait if the user is away.
  - Phase 4: one probe per prediction, one variable at a time. Tag every debug log with a unique prefix so cleanup is one search. For performance, measure a baseline and bisect.
  - Phase 5: write the regression test before the fix, but only at a seam that exercises the real pattern. If no such seam exists, that is the finding. If the red was forced by changing code or a fixture, compare against a clean copy to prove the change landed.
  - Phase 6: rerun the original loop, remove tagged instrumentation, delete throwaway code, state the confirmed hypothesis in the commit.
- Input and output. Input: a symptom. Output: a fix, a regression test or a note that no seam exists, and a commit message naming the cause.
- Human assumed. As a fallback only.
- Script-checkable. Largely. The red command, its rerun after the fix, the absence of the debug prefix, and failing-before then passing-after are all mechanical.

#### engineering/code-review (was `review`)

- Purpose. Review a diff on two separate axes, standards and spec, in two parallel sub-agents.
- Rules.
  - Pin a fixed point and build the diff command once. Fail early on a bad reference or an empty diff.
  - Find the spec from commit messages, an argument, or a file. If there is none, the spec axis reports that and is skipped.
  - Standards sources are whatever the repository documents, plus a fixed list of twelve code smells from Fowler. A documented standard overrides a smell. A smell is always a judgement call. Skip what tooling already enforces.
  - The standards sub-agent cites the standard for each breach. The spec sub-agent reports what is missing, what was not asked for, and what looks wrongly implemented, quoting the spec line. Each under 400 words.
  - Present the two reports under two headings. Do not merge or rank across axes, so one cannot hide the other.
- Input and output. Input: a fixed point and a spec. Output: two lists of findings and a one-line summary.
- Human assumed. Only to supply the fixed point or spec when missing.
- Script-checkable. The output shape is. The review does not run the code or the tests. It reads the diff.

#### engineering/pr

- Purpose. The shape of a pull request body.
- Rules. Three sections. Summary: the smallest visual that makes the change clear (pseudocode, a call tree, a file tree, a diagram, a diff sketch). Evidence: before and after, with screenshots ranked above run output. Merge danger: whether the change is a one-way or two-way door, and its blast radius in one word.
- Human assumed. No.
- Script-checkable. Section presence. The evidence is pasted, not rerun.

#### engineering/retro

- Purpose. After a session, propose changes to the agent's environment, not to the code.
- Rules.
  - Read the session's primary sources (the logs).
  - Look in seven categories: navigation, automated checks, coding standards, the size of the always-loaded steering file, tool economy, instructions that change nothing, and access to information.
  - A mechanical mistake gets a deterministic check, by default. A written standard is kept for real judgement calls.
  - A repository with no guardrail at all is itself a finding.
  - Standards are imposed by the review agent, not the implementing agent, because the implementer carries the most context and the reviewer the least. The standards file is read at review.
  - The always-loaded file should hold little more than pointers.
- Input and output. Input: a session log. Output: a ranked list of proposals for the user.
- Human assumed. Yes, to receive and choose.
- Script-checkable. No.

#### engineering/wayfinder

- Purpose. Plan work too large for one session as a shared map of decision tickets, resolved one per session.
- Rules.
  - It plans. A ticket resolves a decision, not a slice of the build.
  - The map is one issue that indexes decisions and never restates them. Each decision lives in its ticket.
  - Tickets have a type: research (agent alone), prototype and grilling (with a human), task (either). The agent never answers a human's side of a ticket.
  - A session claims a ticket before working, by assignment. At most one ticket is resolved per session, research excepted.
  - What cannot yet be asked sharply is listed as "not yet specified" and is not ticketed. What lies beyond the destination is listed as out of scope and closed.
  - Charting is one session and resolves nothing. When the map is clear it hands off to `to-spec`.
- Human assumed. Yes, and an issue tracker.
- Script-checkable. The map shape and the frontier query are. The content is not.

#### productivity/handoff

- Purpose. Compact the conversation into a document another agent can continue from.
- Rules. Save it in the system temp folder, not the workspace. Name the skills the next agent should use. Do not repeat what specs, plans, records, commits or diffs already hold. Point to them. Redact secrets and personal data. Tailor to what the next session is for.
- Human assumed. Invoked by one. The content needs none.
- Script-checkable. Pointers resolve. Little else.

#### productivity/writing-for-agents (SKILL.md, SKILL-MECHANICS.md)

- Purpose. A reference for any document an agent reads: a skill, a steering file, a doc reached by a pointer.
- Rules.
  - A "context pointer" names out-of-context material and the condition for reaching it. Its wording decides whether the agent reaches the material. Sharpen the wording before inlining the material.
  - Two budgets. Always-loaded text costs the agent's window on every turn. Documents the person must remember cost the person.
  - Order content by how soon the agent needs it: steps in the file, reference in the file, reference in another file behind a pointer. Keep one concept's definition, rules and caveats together.
  - Every step ends on a completion criterion. A vague one invites stopping early. The strongest are both checkable and exhaustive ("every modified model accounted for").
  - Split a document when later steps tempt the agent to rush the current one. Hiding later steps only works across a real context boundary such as a hand-off or a sub-agent.
  - Prefer a short word the model already knows over a coined one, and repeat it.
  - Steer by stating the wanted behaviour. A prohibition brings the unwanted behaviour into view. Keep prohibitions for hard guardrails and pair each with the positive.
  - One source of truth per meaning. Do not restate what the environment already says (scripts, config, help output). Delete sentences the model would obey anyway.
- Human assumed. No.
- Script-checkable. Length, duplicate sentences and dead pointers are. The rest is judgement.

#### engineering/prototype (SKILL.md read; LOGIC.md and UI.md not read)

- Purpose. Throwaway code that answers one design question.
- Rules. Decide whether the question is about logic or about looks. Mark the code as throwaway. One command to run. No persistence, no tests, no polish. Show the full state after every action. When done, fold the decision into real code and keep the prototype on a throwaway branch, with a pointer from the issue.
- Human assumed. Yes. A person reacts to the prototype.
- Script-checkable. No.

#### engineering/triage/AGENT-BRIEF.md (read as the nearest thing to agentbay's brief)

- Purpose. How to write the brief an unattended agent works from.
- Rules. Durable over precise: name interfaces, types and behaviours, never file paths or line numbers. Say what the system should do, not how. Acceptance criteria that can each be verified alone. Explicit out of scope. Template: category, summary, current behaviour, desired behaviour, key interfaces, acceptance criteria, out of scope.
- Script-checkable. Section presence. Each criterion being testable is judgement.

#### Also read in passing

- `engineering/research`: a background agent answers a question from primary sources and writes one cited Markdown file where the repository keeps such notes.
- `productivity/wait-what`: one line that asks for a re-pitch in Simplified Technical English with glossary words.
- `in-progress/setup-ts-deep-modules` (first 40 lines): installs dependency-cruiser with four rules. Outside code imports only a package's root files. A package's files import each other freely. Tests import only entry points. No cycles. The public surface is every root file, so a package may have several small entry points, and a barrel that re-exports a subtree is discouraged. The skill says it then proves the rules bite.
- `in-progress/software-factory` (first 60 lines): a vocabulary for a system of agents that turns tickets into merged code. A run never waits for a human. It ends, and the human's later change starts a new run. Three "brakes": automated checks, automated review by a separate run that reads the diff cold, and human review whose catches become new checks.

### B. pstack

pstack is a Cursor plugin by Lauren Tan. It has one router skill (`poteto-mode`) with a set of playbooks, a set of workflow skills, and about two dozen short "principle" skills that the router points at. Two sub-agent definitions ship with it: `poteto-agent` (a delegate that must read the router first) and `comment-sicko` (a reviewer that deletes comments). Many instructions name Cursor features: the `Task` tool with `subagent_type`, `run_in_background`, cloud environments, `/loop`, an `agent-transcripts` folder, a models rule file, and skills from another plugin (`deslop`, `control-ui`, `control-cli`). The mirror rewrites some of these in harness-neutral words.

#### poteto-mode (SKILL.md, playbooks/, scripts/)

- Purpose. One working style: restate the goal, design before code, delegate with separation, verify on the real thing, write plainly.
- Structure. Non-negotiables (a list of triggers and the skill each one calls), the principles index, autonomy, sub-agents, writing the reply, comments, and the list of playbooks.
- Rules.
  - The first message on a task restates the user's goal, the problem, and the smallest change expected to meet it, without waiting for confirmation. The same restatement opens every sub-agent brief, every pull request and every final report.
  - Before asking the human a "which approach" question, classify it. If running something could answer it, build a throwaway sketch and let the result decide. Ask only for a real product or preference call.
  - Before any code, name the data shape. Code that crosses a function boundary goes through `architect`. A contested design goes through `interrogate`.
  - Each reply names the principles that changed a decision. (agentbay already declined this.)
  - Autonomy. Reversible work proceeds. Irreversible writes always pause: force-push to a shared branch, deploys, data deletion, messages to customers. "No" is an acceptable answer to the user.
  - Sub-agents. The parent owns every sub-agent's work: it reviews the diff and writes its own summary. A second opinion is the same prompt on a different model. Each role has a configured model. Review and design panels use three model families.
  - Fresh sub-agents by default. A fix round, a retry or a follow-up goes to a fresh agent with the whole scope: the original brief, every later directive, and the previous report and branch. Reuse an agent only when the work needs state that is costly to move (its checkout, uncommitted changes, a running process). The skill says chained interrupts silently drop directives.
  - The reply. Short declarative sentences. No long dash. No colon as a mid-sentence connector. Short is no excuse to drop content. Say who the work is for and what changes for them. Never invent a link or citation. Every claim carries its evidence or a label in the same sentence: measured, inferred, or guess. Never hand the human a check the agent could run.
  - Comments. Keep one only for a non-obvious why that the code cannot show.
  - Playbooks. Open a todo list whose first items are the playbook's steps, copied exactly. A skipped step stays in the list with a one-line reason.
- Input and output. Input: a task. Output: the work, and a reply in the playbook's named shape.
- Human assumed. Present but asynchronous. The skill tries not to ask.
- Script-checkable. The todo-list rule and the reply sections are. A plan checker ships (`scripts/check-plan.mjs`, see below).

Playbooks read:

- **Feature.** Trace the subsystem. Run `architect`. Write a "throughput checkpoint" of four items: blocking first steps, independent workstreams, shared mutable state, smallest safe decomposition. An item that does not apply stays with a reason. Delegate the code to a sub-agent with a specific scope: file paths, the named data shape, success criteria. Delegation is mandatory because the gain is review separation. Verify on the matching surface. "Inconclusive" or the wrong surface is not a pass. Rebase into small ordered commits. Interrogate if contested. Open a pull request. Reply: what was built, what was chosen and why, the checkpoint, open decisions.
- **Refactoring.** The behaviour does not change. First pin the behaviour with a characterisation test, a snapshot or an equivalence harness. Type check and lint are not a pin. Name the missing structure and the target shape. Subtract first. Move in small steps that keep the pin green. For an API reshape, move every caller and delete the old API in the same wave, with no shim and no parallel paths. Check every rename against the files, because renames miss strings and prose. Prove on the real artefact that behaviour is unchanged. Keep the change only if it lowers reader load somewhere, otherwise revert it. A found bug or missing feature is split out. Reply: the structure changed, the pin, the equivalence proof, what shipped and what was reverted.
- **Bug fix.** Reproduce it yourself on the real surface, even where a protocol says to ask the user. Search for the cause by halving the remaining space with runtime evidence each pass. Confirm the mechanism with evidence before designing the fix. A change that "might help" is a hypothesis and does not ship. When evidence refutes a hypothesis, revert what it motivated. Verify on the same surface. Unit tests show a branch's behaviour, not that the bug is gone. Order commits so the failing repro lands before the fix. Reply: what was broken, root cause, fix, and the failing-then-passing output pasted verbatim.
- **Opening a PR.** Work from a worktree off main. Small ordered commits, each landable. Titles in Conventional Commits form. The body is a one-minute briefing under fixed headings: why, what changed, scope (always, including what is left out), trade-offs, blast radius, verification with real run paths and outcomes. Logs, hashes and tables are linked, not pasted. Prefer five narrow requests to one large one. Open ready, not draft. Opening a request does not start a watch loop.
- **Investigation.** Read-only. Output is a cited explanation or a recommendation with a trade-offs table. No pull request.
- **Prototype.** The one playbook where speed beats quality. Scope the decision first. No decision means no prototype. Build in a scratch folder. Put alternatives behind one switch. Observe the thing being decided. Hand the choice to Feature.
- **Pause safely.** On an explicit pause only: stop at a safe boundary, take no irreversible action, commit uncommitted edits as one `wip:` commit, write a resume note outside the context (intent, progress, what is verified, state, next steps, files, traps).
- **Session pickup.** Find the prior trail. Rebuild state from the branch and log. Do not redo completed work. Then verify the inherited claims against the goal on the real artefact, because a passing self-report is not proof.
- **Autonomous run.** State the exit condition as a checkable predicate before starting. Each iteration makes the smallest justified change, checks the predicate, commits if it moved, discards if not. Never relax the predicate to finish. Log each iteration.
- **Multi-phase plan** (first part read). The plan is the deliverable and nothing is implemented. Open questions are settled by prototype before writing. The plan follows a fixed skeleton of checkboxes, each naming the evidence that checks it. The line "Tests alone are not sufficient verification" opens every verification block. A script, `check-plan.mjs`, checks the plan file against the skeleton and prints `file:line: message` for each problem. Execution starts only on the operator's explicit go.

#### unslop

- Purpose. Remove the marks of machine-written prose.
- Structure. A numbered list of patterns in groups. The numbers are stable ids that other skills cite, and a removed rule leaves a gap.
- Rules, by group. Content: empty "-ing" phrases, vague attributions. Language: a list of overused words, fancy forms of "is", "not just X but Y", forced groups of three, cycling synonyms for one thing, false ranges. Style: no long dashes at all and no substitutes for them, colons only before a list or example, little bold, no bold label that restates its line, sentence-case headings, no decorative emoji, straight quotes. Artefacts: chatbot phrases, flattery. Filler: padding phrases, stacked hedges, generic conclusions. Jargon: a list of abstract metaphor nouns to replace with the concrete word. Plain speech: say what a thing does with a mechanism or a number, split dense sentences, active voice, cut adverbs, plain words, no mannered phrasing, and no over-compression (dropped articles, arrows, fragments).
- Input and output. Input: any text. Output: the rewritten text.
- Human assumed. No.
- Script-checkable. Many rules are word lists and punctuation. Those can be a script. Rules 27 to 33 need judgement.

#### technical-writing

- Purpose. A layered standard for docs, readmes, request descriptions and commit messages.
- Structure. Three top rules, a rhythm section, then four layers: Diátaxis for document mode, Google developer style for sentences, Simplified Technical English for instructions, Global English for syntax. Then voice and a worked example.
- Rules.
  - Cut words that do no work. Use the short everyday word. When a rule makes a sentence worse, fix it another way.
  - The codebase is the word list. Use the real symbol, file or command name. Do not invent jargon.
  - Vary sentence length on purpose. A document of only clipped sentences also reads as machine-written.
  - One document, one mode: tutorial, how-to, reference or explanation. Do not mix.
  - Address the reader as "you", present tense, active voice. Condition before instruction. Common case first.
  - One instruction per sentence. About 20 words for an instruction, 25 otherwise. Keep articles. One word per action, one meaning per word.
  - Keep "only" and "not" next to what they change. Break up long noun strings. Every "it" and "this" points at one thing. No semicolons, no long dash, no slashes, no idioms.
  - Counts and trees in docs must be true at the commit that lands them, with the command that regenerates them.
- Human assumed. No.
- Script-checkable. Sentence length, banned words, heading case and "command that regenerates the count" are. Mode purity is judgement.

#### typescript-best-practices (SKILL.md, references/patterns.md)

Covered in part 6. Structure: a sixteen-row table of rules, each with a one-line summary, and a patterns file with a "do" and a "don't" example per rule. It declares the file patterns it applies to in front matter (`paths`), and tells the reader to apply the `type-system-discipline` principle first. No human assumed. Most rows can be lint rules.

#### correct

- Purpose. Find the mistakes agents keep making in this repository and make each one impossible.
- Rules.
  - Assume every contributor is an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles.
  - Read commits, reverts, review comments and instruction files. Group mistakes into classes. A class counts once it has happened twice.
  - Fix each class at the highest level that works, in this order: architecture (one owner per state, one way per task, internals unreachable, one source of truth, old ways deleted), then types, then a lint or check whose error names what to use instead, then a behaviour test, and docs last and only for judgement calls.
  - If the bad pattern is already common, fail only when a change adds more.
  - Prove each new check fails on a real past mistake. The same command runs locally and in CI.
  - An exception sits on the offending line with a reason, an expiry date and a human's approval.
  - Keep a table that pairs each rule with what enforces it. Drop a rule once its mistake cannot happen.
- Human assumed. As the source of corrections.
- Script-checkable. The table and the "check fails on the old commit" proof are.

#### create-verification-skill

- Purpose. Generate a project-local skill that drives the real application the way a user does and captures evidence.
- Rules.
  - Answer from the repository, not the user: what surface a user touches, how the app starts, how an agent can drive it, what evidence can be captured, whether two instances can run side by side.
  - If the checkout does not build or start, fix or report that first.
  - The generated skill has fixed sections. Launch (the exact command, how to tell it is usable, teardown). Doctor (one read-only check that the instance is worth driving). Drive (real selectors and commands from this repository). Evidence (use the real user path, capture the action and the resulting state, verify side effects, do not trust a dry-run's name). Cleanup (kill only what you started, never delete the evidence). Helpers (executable, with their invocation shown).
  - Seed a feature map: one file per user-facing feature saying how to reach it, how to drive it, and what end state proves it. Never weaken a journey to make it pass.
  - Run the generated skill end to end once before handing it over. If it was proven on a stand-in, list what the stand-in did that the real target will not.
- Human assumed. No.
- Script-checkable. Yes. The output is itself a script-driven proof.

#### interrogate

- Purpose. Adversaries on several models try to break a change or design. Only findings proven by a run survive.
- Rules. State the intent first. Give each adversary its own worktree with the uncommitted changes copied in. Each must prove a finding by running the real code and report the exact command, its output, and the output the intent requires. Style, naming and hypothetical risks are left out. "No findings" is valid. The parent reruns each command and keeps a finding only when the output shows a failure that breaks the intent. Findings with one root cause are merged. Fixes are not applied.
- Output. Intent, verified findings with command and output, and a count of dropped findings per adversary.
- Human assumed. Only if the intent is unclear.
- Script-checkable. Yes. Every surviving finding is a command with expected and actual output.

#### architect (SKILL.md, references/design-red-flags.md read; runner-prompt and rationale-template not read)

- Purpose. Sketch types, signatures and module boundaries before code, from several candidates, then implement against the sketch.
- Rules.
  - Ground: build a real model of every system the new code touches.
  - Sketch: at least two structurally different candidates, from runners on different models, through `arena`. Write the caller's usage first and derive the types from it.
  - Screen each candidate against eight red flags: shallow module, information leakage, temporal decomposition (modules named for steps such as load, validate, save), pass-through method, split ownership of state, two ways to do one task, importable internals, hand-synced lists.
  - Prefer the design that hides more behind a smaller surface. A deep module is not a deep call chain.
  - A human checkpoint is off by default and is opt-in.
  - Implement against the sketch. A deviation is a signal to raise, not to absorb.
  - Scrap the sketch when a pattern of friction appears: the same workaround in unrelated code, types that need escape hatches, a sudden need for a lock, callers that must know internal rules.
- Human assumed. No, by default.
- Script-checkable. Three of the red flags are (importable internals, hand-synced lists, pass-through methods). The rest are judgement.

#### arena

- Purpose. Several candidates attempt the same artefact. One is picked as the base and the best parts of the others are grafted in.
- Rules. Frame: state the artefact, write a rubric of three to six gradeable criteria (candidates see only the task), choose runners, give each its own output location. Fan out in one message. Cross-judge: one read-only judge from a different vendor than the parent scores each criterion. Pick by the rubric, not by feel, and compare with the judge. Graft by hand, one or two things per loser. If candidates converge, ship the consensus. If they diverge wildly, the framing was too loose, so reframe. Verify the result like any other output.
- Output. One artefact and a synthesis note: the base and why, the judge's verdict, each graft and its source, what was rejected, dropouts, the verification result.
- Human assumed. No.
- Script-checkable. The note's fields are. The pick is judgement.

#### swarm

- Purpose. Fan out parallel workers and return one report.
- Rules. State the done predicate. Choose the shape: partition, race, or both, and declare the selection rule for a race before starting. Each worker gets its own writable output. A brief stands alone: goal, scope, slice, how to verify, what to report. Briefs that verify commits name the exact hashes. Workers answer `PASS`, `ISSUES` or `BLOCKED` with evidence and list every issue they can prove. A result that does not record the hashes and method it was given is dropped and the worker is respawned once. After a second miss it is a gap, and a gap is not a pass. Every required slice needs a result. No raw dumps in the report.
- Human assumed. No.
- Script-checkable. Yes: a three-value verdict, required fields, and coverage of slices.

#### reflect (SKILL.md read; four reference prompts not read)

- Purpose. Mine the finished conversation for lasting lessons and route each to an edit of a skill.
- Rules. Three reviewers read the transcript in parallel under different lenses (judgement, tooling, divergent). A synthesizer returns accepted, rejected and backlog lists. Any accepted item that a lint, script or runtime check would enforce better moves to the backlog. Accepted edits wait for the user's explicit approval, because a skill change affects every later agent. Backlog items are filed without waiting. One-offs are not lessons.
- Human assumed. Yes, to approve.
- Script-checkable. No.

#### show-me-your-work (SKILL.md, scripts/log.sh)

- Purpose. A decision trail for long or unattended work.
- Rules.
  - One tab-separated file. One row per decision: time, phase, decision, why, evidence, result. Evidence is a pointer (a commit, a `file:line`, an artefact path), never prose.
  - Log decision points, not every action: a fork chosen, a unit finished with its check result, a pivot or revert and what triggered it, a blocker.
  - Append only. A wrong row is superseded by a new row.
  - A new agent that adds to an existing log writes a `start` row first.
  - At the end, audit the log against the transcript: every row maps to something that happened, every pointer resolves, and unlogged forks are added.
  - Before handing back, a sub-agent on a different model family reads the trail and the transcript and flags weak evidence, skipped checks and risky choices. The reply ends with an "Attention" section that names the reviewing model. "No flags" is a valid entry.
  - Local by default. Committed when a reviewer needs it to trust the result.
- Human assumed. As the later reader.
- Script-checkable. Yes for shape and for pointers that resolve.

#### figure-it-out

- Purpose. Design a one-off playbook when none fits.
- Rules. Frame: a falsifiable definition of done, a quantified scope, and a rigour level set by how reversible and how wide the work is. One checkpoint with the human before a long run. Design: atomic units, riskiest unknown first, the verification harness built before the work with a baseline taken from the unchanged state. Parallelise only across seams, each worker in its own worktree. Run: each unit is an experiment that is kept or reverted. Verify by inspecting the artefact, never a self-report. When something passes too easily, suspect the way it was observed. Pair delegated work with a judge. If a worker games a gate, reset and harden the contract. A verdict is one of verified, not verified, inconclusive, and inconclusive is not a pass. Keep the trail. At the end check the whole against the predicate on the real product.
- Human assumed. Once, at the framing checkpoint.
- Script-checkable. The predicate and the three-value verdict are.

#### tdd (pstack's)

- Purpose. A failing regression test before a bug fix, when the test is cheap.
- Rules. Use only when asked or when a cheap local test target is obvious. Understand the bug, choose the narrowest check, write the failing test, run it and confirm it fails for the intended reason, fix, rerun. If a test would need broad set-up, brittle mocks or slow infrastructure, skip it and use the closest runnable check. No test is better than a bad test. Never change a test to match a wrong implementation. Never weaken an assertion unless the expected behaviour changed. Report the failing-before run and the passing-after run, or say why failing-before could not be shown.
- Human assumed. No.
- Script-checkable. Yes: two recorded runs.

#### no-comments (with the comment-sicko agent)

- Purpose. Delete comments from a diff and turn what they excused into code changes.
- Rules. A fresh sub-agent deletes every comment except: licence headers, behaviour forced by an external dependency or platform, `prettier-ignore`, doc comments that define a public API contract, and issue links for a constraint the code cannot express. In doubt, the comment goes. Lint and type suppressions are challenged: if the rule protects correctness, the suppression is flagged for removal. A surprise in the project's own code is not kept as a comment. The symbol is flagged for a rename, extraction or redesign. The parent then reviews the report, fixes accepted flags at the root cause, and for "do not change" comments offers to encode the constraint as a type, test or check before deleting the comment.
- Human assumed. For approving an encoding, unless pre-approved.
- Script-checkable. The deletion is. The mirror softens one rule: a comment about an outside rule it cannot verify is kept and marked.

#### Principle skills read

Each is a short page with a rule, a reason and sometimes a test. None assumes a human. Read in full unless noted.

| Skill | What it says | Script-checkable |
|---|---|---|
| prove-it-works | Verify the real artefact directly, not a proxy, a self-report or a compile. When a check fails, suspect how it was observed first. Prefer a script that reruns the comparison and keep its output. | The script is the check |
| test-behavior-not-implementation | Judge a test by two imagined edits. Break the behaviour: the test must fail. Change only the internals: the test must still pass. Expected values come from the requirement. Assert what the contract promises, no more. What a mocked external service receives is behaviour. A call to an internal helper is not. | The first edit can be automated as mutation |
| encode-lessons-in-structure | An instruction written twice becomes a lint, flag, check or script. If the fix is structural, use only the structural fix. | Yes |
| sequence-verifiable-units | Small units that each end in a checkable state. Do not advance until green. Order commits so the sequence proves itself: failing test then fix, subtraction then reshape, baseline then treatment. | Each commit green is checkable |
| subtract-before-you-add | Remove dead weight first, then build. Design for observed use. No speculative validators. Delete a reference that has no content. | Size before and after |
| model-the-domain | Put the domain in a structure (state machine, typed model, table, union, reducer) instead of scattered conditionals. Do not force an abstraction. Signs it was skipped: one more branch on an if chain, a second boolean that must stay in step with the first, modules named for phases. | Partly |
| type-system-discipline | Make illegal states unrepresentable. Brand primitives that mean different things. External data is untyped until parsed. Derive types from the schema that owns the shape. | Mostly lint |
| boundary-discipline | Validation and error handling at system boundaries only. Trust types inside. Business logic in pure functions. Do not re-export transport or storage types. | Partly |
| build-the-lever | For non-trivial work, build the tool that does or proves it. The tool is what a reviewer reruns. Do the first unit by hand, then build the tool and diff. If the principle is cited and no tool is in the diff, it was not applied. | Yes |
| make-operations-idempotent | Derive each step from the state that exists. Anything a run leaves behind must be recognisable as stale by the next run. Three questions: twice in a row, crashed at any point, same end state. | Crash tests |
| migrate-callers-then-delete-legacy-apis | Move callers and delete the old API in one wave. Applies when no outside user depends on compatibility. | Dead-code check |
| never-block-on-the-human | Proceed on reversible work and present the result. Irreversible actions still need confirmation. Product direction is the human's. | No |
| separate-before-serializing-shared-state | First remove the shared write target: one owned file, key or branch per actor, merged at the read side. Serialize by structure only when one writer is a real invariant. Instructions are not concurrency control. | File ownership is checkable |
| laziness-protocol | One source of truth per decision. The smallest diff that solves the problem. | Partly |
| guard-the-context-window | Route bulk to sub-agents and keep summaries. Cap files per phase. | No |
| fix-root-causes | Fix where the system first went wrong. A guard is a fix only when the state it handles is legitimate. Fix the pattern, not the instance. A workaround that needs a paragraph of comment means the code is wrong. | No |
| attack-the-premise | When two fixes built on one premise fail the same gate, write the premise down and test it before a third. | No |
| minimize-reader-load | Count the layers between a question and its answer, and the state a reader must hold. Collapse one-caller wrappers and adapters with no second implementation. Line counts and complexity scores are proxies. | Partly |
| exhaust-the-design-space | For a decision with no precedent, build two or three competing prototypes. (Very short page.) | No |

Read only as one-line entries in the router's index: experience-first, explain-the-number, foundational-thinking, outcome-oriented-execution, redesign-from-first-principles.

Also read: `blast-radius` (find the one fact a change is safe because of and prove it by running code, with a five-step ladder from "you said so" to "reproduced in the running app") and `in-your-own-words` (one line: restate the user's goal and problem).

### C. Sandcastle

Sandcastle is a TypeScript library, not a skill. The owner takes the pattern only (ADR 8). The pattern, precisely:

- **One call.** `run()` on the host creates a sandbox, starts an agent in it with a prompt, and returns the iterations, the commits made, and the branch.
- **Branch strategy.** Chosen per run. Three kinds. `head`: the agent writes in the working directory, no worktree. `merge-to-head`: a temporary branch in a worktree under `.sandcastle/worktrees/`, merged back into the branch that was checked out when the run started, then deleted. `branch`: commits land on a branch the caller names, in a worktree.
- **Failure handling.** If a `merge-to-head` run fails, the temporary branch is deleted unless the agent left commits on it. Then it is kept and the tool prints how to merge or discard it. If the merge itself fails, it is aborted so the target is unchanged, and the branch is kept.
- **Worktree reuse.** With a named branch, a second run reuses the existing worktree. A clean one is reused with a log line. A dirty one is reused with a warning. It is fast-forwarded from the remote only when clean and strictly behind. It is never reset, because a clean worktree can hold unpushed commits (their ADR 3).
- **Locking.** A file lock per worktree, created atomically and holding the process id, the branch and the time, stops two runs sharing one worktree. The process id allows stale locks to be detected (their ADR 7).
- **Worktree as a first-class thing.** `createWorktree()` gives a handle that outlives runs, so an interactive session and then an unattended agent can use the same one. Closing it removes the worktree only if it is clean.
- **Agent providers.** A function per agent program (Claude Code, Codex, Pi, Copilot, Cursor, OpenCode) that builds the command and parses the output. It takes a model string and options such as effort. Unattended runs default to the agent's skip-permissions flag unless a permission mode is set.
- **Sandbox providers.** Separate from agent providers: the operating system's own process sandbox, containers, cloud machines, or none.
- **Iterations.** One iteration is one start-to-exit pass of the agent, producing at most one commit against one task. `maxIterations` caps the loop (default one).
- **Completion signal.** A fixed marker string the agent prints to say nothing is left. The loop stops on it. The prompt must tell the agent to print it. The engine never injects it. It carries no data.
- **Hanging processes.** An idle timeout fails a run that produces no output. Once the completion signal is seen, a shorter completion timeout takes over. If the process still has not exited when it expires, the run succeeds with a warning and keeps its commits.
- **Structured output.** Separate from the completion signal. The agent prints JSON inside a tag the caller names. The library extracts it, validates it against a schema, and returns it typed. The run fails early if the prompt does not mention the tag. On a validation failure it can retry by resuming the same agent session with a short description of the error.
- **Prompts.** An inline string is passed as is. A prompt file may contain `{{KEY}}` placeholders and shell expressions that run inside the sandbox and are replaced by their output. A failing shell expression fails the run.
- **Review pipelines.** Shipped as templates, not as an engine feature. In `parallel-planner-with-review`: a planner agent reads the open issues and emits a plan (unblocked issues and a deterministic branch name each) as structured output. One sandbox per issue runs an implementer, then a reviewer on the same branch if it has commits. A merger agent then merges the finished branches, resolves conflicts itself, runs type check and tests, and closes the issues. The reviewer in these templates edits the code directly and commits.

---

## 3. agentbay's practices against the sources

"Same" means the source states the same rule. "Differs" means the same aim with a different rule. "Contradicts" means following the source would break the practice.

### General practices

| Id | Practice, short | Same | Differs or contradicts |
|---|---|---|---|
| P-01 | No comments | pstack `no-comments` and `fix-root-causes` (a workaround that needs a long comment means the code is wrong) | pstack keeps five kinds of comment, including a non-obvious why forced from outside and public API doc comments. Already declined in `practices.md`. Pocock is silent. |
| P-02 | Language practices in the toolchain's file, with good and bad examples | pstack `typescript-best-practices`: a rule table plus a patterns file, bound to file patterns in front matter | Pocock `retro` says standards are read by the reviewer, not the implementer, to spare the implementer's context. agentbay gives them to the builder in the brief. |
| P-03 | Problems as values | Nothing states this | pstack's TypeScript examples throw from parse functions. `boundary-discipline` says only "return errors" at boundaries. |
| P-04 | Readable before short | pstack `minimize-reader-load` (line counts are proxies), unslop rule 33 for prose, Sandcastle's review prompt | pstack `laziness-protocol` says fewer lines beat elegant boilerplate. That is a size preference agentbay does not hold. |
| P-05 | Model the domain in types | pstack `model-the-domain`, `type-system-discipline`. Pocock's smell "primitive obsession". | pstack goes further: state machines, tables and reducers, not only unions. |
| P-06 | Parse once at the edge | pstack `boundary-discipline`, `type-system-discipline` | None |
| P-07 | Same state however often a step runs | pstack `make-operations-idempotent` | pstack adds: leftovers must be recognisable as stale by the next run. agentbay has this only for bug injection (P-31). |
| P-08 | Feature is a deep module with one entry file | Pocock `codebase-design`. pstack red flags "shallow module" and "importable internals". | Pocock's in-progress TypeScript set-up allows several root files as entry points and discourages one large barrel. agentbay fixes one entry file. |
| P-09 | Mode code imports only the toolbox | pstack "importable internals" in spirit | No direct equivalent |
| P-10 | A port needs two adapters | Pocock `codebase-design` and DEEPENING, word for word in idea. pstack `minimize-reader-load`. | DEEPENING accepts a local stand-in (an in-memory database) for tests. agentbay rejected that for the store and uses the real store with a fault injector (ADR 10). pstack agrees with agentbay here: do not mock what you can run. |
| P-11 | Replace and delete, never layer | DEEPENING (for tests). pstack `migrate-callers-then-delete-legacy-apis` and red flag "two ways to do one task". | Pocock `to-tickets` contradicts for wide refactors: expand, migrate in batches, contract, with old and new side by side across tickets. pstack limits its rule to code with no outside users. |
| P-12 | One place | pstack `laziness-protocol`, red flags "split ownership", "hand-synced list", "information leakage". Pocock's "duplicated code" smell and `writing-for-agents` single source of truth. | agentbay alone says look-alike blocks that change for different reasons stay apart. |
| P-13 | Remove first; size reported, never a target | pstack `subtract-before-you-add` | Sources report no sizes. pstack measures "reader load" by judgement. |
| P-14 | A wide interface designed three ways | Pocock DESIGN-IT-TWICE (the origin). pstack `architect` and `arena`. | pstack triggers it for any code crossing a function boundary, uses different model families per candidate, and adds a judge from another vendor and a grafting step. agentbay keeps it for wide or new interfaces. |
| P-15 | The interface is the test surface | Pocock `codebase-design`, `tdd`. pstack `test-behavior-not-implementation`. | None |
| P-16 | Literal expected values; a test must fail on empty code | Pocock `tdd` (tautological tests). pstack's "break the behaviour" edit and `correct` step 3. | None |
| P-17 | Test first, seen failing | Pocock `tdd`. pstack `tdd` and Bug fix step 5. | Pocock forbids writing all tests first: one test, one implementation, repeat. agentbay briefs often say "the tests first" for a whole item. pstack makes test-first optional and says no test beats a bad one. |
| P-18 | Reviewer injects its own bugs | No source does this | Nearest: pstack's imagined edits, `correct` ("prove each check fails on a real past mistake"), `interrogate`. agentbay is ahead. |
| P-31 | Injection in a throwaway copy, with time limits, tree left clean | Pieces only: one worktree per candidate (pstack `arena`), "diff against a pristine copy" (Pocock `diagnosing-bugs`), stale leftovers (pstack idempotence), locks and timeouts (Sandcastle) | No source states the rule |
| P-19 | Proven on the real thing | pstack `prove-it-works`, `create-verification-skill`, every playbook's verify step. Pocock `pr` evidence. | pstack adds "inconclusive is not a pass" and a maintained feature map of journeys. |
| P-20 | Small vertical slices | Pocock `to-tickets`. pstack `sequence-verifiable-units`. | Pocock's slice cuts through every layer. agentbay's is one feature or one mode, which is closer to one module. Pocock sizes a slice to one fresh context window. agentbay has no stated size. |
| P-21 | Seven-section brief with a numbered definition of done | Pocock AGENT-BRIEF (acceptance criteria, out of scope). pstack plan skeleton with a checker script. | Pocock contradicts on content: no file paths, say what and not how. agentbay briefs list paths, commands in full and ordered steps. |
| P-22 | Evidence per item in the report | pstack reply rule (evidence or a label in the same sentence), `swarm` verdicts, `tdd` report, `show-me-your-work`. Pocock `pr`. | Sources have no "what was not verified" section as a fixed part. |
| P-23 | Reviewer never builds, reruns every check, reports only what it verified | pstack "you own every sub-agent's work", `interrogate` (leave out what you did not run), Session pickup step 5 | Pocock's `code-review` reads the diff and reruns nothing. Sandcastle's reviewer edits the code. pstack's Session pickup also says the prior trail is authoritative and not to redo it, which pulls the other way. |
| P-24 | Mechanical change by a rerunnable script | pstack `build-the-lever` | pstack applies it to any non-trivial work, not only mechanical change. |
| P-25 | Stop and start fresh with the whole scope | pstack "fresh subagents by default" with the same reasoning. Pocock `implement-spec` (fresh implementer per ticket and for fixes). | Sandcastle's structured-output retry resumes the same session. The 0022 plan's review rule ("back to the same builder once") and forge's "sends the task back to the builder" also pull against P-25. |
| P-26 | A rule written twice becomes a check | pstack `encode-lessons-in-structure`, `correct`. Pocock `retro`. | `correct` adds an order of preference (architecture, types, lint, test, docs) and expiry dates on exceptions. |
| P-27 | An evaluator that did not see the build, one on a different model | pstack `show-me-your-work` cross-model review, `arena` cross-judge, `interrogate` | Pocock uses fresh contexts but never a different model. |
| P-28 | Reversible work proceeds; the owner decides the rest | pstack `never-block-on-the-human` and Autonomy. Pocock `pr` one-way and two-way doors. | Pocock's grilling and `to-tickets` wait on the user for every decision. |
| P-29 | One meaning per word | Pocock `domain-modeling` and glossary format. pstack `technical-writing`. Sandcastle's glossary. | None |
| P-30 | Plain prose | pstack `unslop`, `technical-writing`, the reply rules. Pocock `wait-what`. | `technical-writing` warns that all-short sentences also read as machine-written and asks for varied length. agentbay asks only for short sentences. |

### TypeScript practices

Part 6 compares these with pstack's TypeScript skill in detail. Against the other sources:

| Id | Same | Differs |
|---|---|---|
| TS-02, TS-05 | Pocock `codebase-design` counts error modes as part of an interface | No source returns problems as values |
| TS-09 | pstack "object args" | pstack exempts hot paths |
| TS-12 | Pocock's set-up skill discourages barrels. pstack red flags re-exports of wire types. | Pocock allows several entry files |
| TS-16 | Sandcastle's review prompt bans nested ternaries | pstack measures reader load, not branch counts |
| TS-17 | Pocock "accept dependencies, don't create them" and `tdd/mocking.md` | Pocock mocks time and external APIs freely at boundaries. agentbay adds the two-adapter rule. |
| TS-01, TS-06, TS-07, TS-08, TS-10, TS-11, TS-13, TS-14, TS-15 | Nothing in the sources | These are agentbay's own or compiler settings |

### Practices the sources have and agentbay lacks

| # | Practice | Source | Adopt? | Why |
|---|---|---|---|---|
| 1 | A characterisation pin before a refactor: capture current behaviour first, by test, snapshot or equivalence harness | pstack Refactoring step 1 | Yes | Brief M5 did exactly this by hand (DOD-M5-1, byte-for-byte capture). It is not in `practices.md`. It is the proof on the real thing for a slice that must change nothing. |
| 2 | For a bug, a red command first: one command, already run, that asserts the symptom, before any theory | Pocock `diagnosing-bugs`, pstack Bug fix | Yes | It is checkable by the kernel: run the command, expect failure, run it after the fix, expect success. agentbay has no bug-fix practice at all. |
| 3 | Restate the goal before work, and carry it into every brief and report | pstack router, `in-your-own-words` | Yes | Cheap. It gives the reviewer something to check a slice against other than the definition of done. |
| 4 | Three-value verdicts: verified, not verified, inconclusive. Inconclusive is not a pass. A missing result is a gap, not a pass. | pstack `figure-it-out`, `swarm` | Yes | It fits a schema enum. agentbay reports have "not verified" sections but checks are pass or fail. |
| 5 | A label on every claim: measured, inferred or guess | pstack reply rule, `blast-radius` ladder | Yes | P-23 says a claim is verified or left out. A label lets the reviewer see which is which without rereading. |
| 6 | A decision trail: append-only rows with a pointer as evidence, audited at the end | pstack `show-me-your-work` | Yes | Briefs M4 to M6 already ask for a progress note in `/tmp` because builders were stopped. A trail in the run's events is the durable form. |
| 7 | A project verification skill with a feature map: launch, doctor, drive, evidence, cleanup | pstack `create-verification-skill` | Yes | This is forge's `first-session` check made general and language-neutral. It also answers "the brief names the real thing" once, per project, instead of in every brief. |
| 8 | Pause and pickup: a `wip` commit and a resume note on stop; on pickup, rebuild state and verify inherited claims | pstack Pause safely, Session pickup | Yes | Directly addresses builders stopped mid-run. P-31 has the "check the worktree is clean" half only. |
| 9 | Order of fixes for a repeated mistake: architecture, then types, then a check whose message names the fix, then a test, then docs | pstack `correct` | Yes | P-26 says "becomes a check". This says which kind of check to prefer. |
| 10 | Exceptions carry a reason, an expiry date and an approval | pstack `correct` | Yes | ADR 9 has an exemption with no date. ADR 11 says an exception needs an end date but no rule holds it. |
| 11 | When to write a decision record: hard to reverse, surprising, a real trade-off | Pocock `domain-modeling` | Yes | agentbay has fourteen records and no rule for when one is due. |
| 12 | Review on two axes that are never merged: standards and spec | Pocock `code-review` | Yes | The 0022 plan's review already has both (DOD ids and R-1 "does what the proposal says") but in one list. |
| 13 | One-way or two-way door, and blast radius, stated on every change | Pocock `pr`, pstack Opening a PR and `blast-radius` | Yes | P-28 depends on knowing which work is reversible. Nothing asks the builder or planner to say so. |
| 14 | The agent-as-contributor lens: it sees only the files it opened, copies the nearest example, takes the shortest path that compiles | pstack `correct`, `architect` | Yes | A good review question for every interface. It explains ADR 9 and ADR 11 in one sentence. |
| 15 | After two failed fixes on one premise, test the premise | pstack `attack-the-premise` | Yes | Forge's design sends a failed task back twice and then to the owner. This gives the second round something better to do than try again. |
| 16 | Tag temporary instrumentation with a unique prefix so one search proves it is gone | Pocock `diagnosing-bugs` | Yes | Small, and scriptable. Same family as P-31. |
| 17 | A slice is sized to one fresh context window | Pocock `to-tickets`, `ask-matt` | Yes, as guidance | Builders were stopped about 35 minutes in. A slice that fits the limit needs no pickup. Not exactly checkable. |
| 18 | A retro after the work, routing lessons to checks, with approval for rule changes | Pocock `retro`, pstack `reflect` | Yes, later | It belongs to the planned improve mode. Forge's evaluate stage can emit candidates. |
| 19 | Prototype to settle a question a run can answer, instead of asking | pstack router and Prototype, Pocock `prototype` | Yes | agentbay calls these spikes and used them in stage 0. Not written as a practice. |
| 20 | Completion criteria that are both checkable and exhaustive; state the wanted behaviour, keep prohibitions for hard guardrails | Pocock `writing-for-agents` | Partly | Good for writing forge's skills. It conflicts mildly with the skill contract's "Rules and constraints: what it must never do" section. Pair each prohibition with the positive. |
| 21 | A fixed list of code smells as labelled judgement calls | Pocock `code-review` | Maybe | Useful as a language-neutral practice file marked `review`. Low priority: several are already P-05, P-11, P-12. |
| 22 | Standards read at review, not at build | Pocock `retro` | No | agentbay's checks fail at build time anyway, so the builder must know the rules. Keep the practices file short instead. |
| 23 | Briefs without file paths | Pocock AGENT-BRIEF | No | That rule is for briefs that wait for weeks. agentbay's are written just before use, and paths are what make write scope checkable. |
| 24 | Citing principles in each reply | pstack router | No | Already declined. |
| 25 | Decision tickets on a tracker for very large work | Pocock `wayfinder` | No | Needs a tracker and live human sessions. The idea "do not plan what you cannot yet state sharply" is worth one line in the plan stage. |

---

## 4. What a forge workflow could take, stage by stage

The stage names follow the `build` workflow in the 0022 plan. "Script" means a check the kernel or a toolchain mode runs. "Model" means a skill step. "Owner" means an approval step.

### 4.1 The common path

| Stage | Informed by | Input | Output | Model's judgement | Script can check | Owner approval |
|---|---|---|---|---|---|---|
| 0 Restate | pstack `in-your-own-words`, router's first-message rule | The owner's request | Goal, problem, smallest change expected, kind of work (feature, refactoring, bug fix, design round) | All of it | The four fields are present and the kind is one of the closed set | No. It is shown, not gated. |
| 1 Brief (kernel) | pstack `figure-it-out` "baseline from the unchanged state". Sandcastle prompt expansion. | The request and the repository | State of the tree, baseline of every check, sizes, debt and detector counts, open findings | None | All of it. This stage is scripts. | No |
| 2 Proposal | Pocock `to-spec` (problem and solution in the owner's words, out of scope, testing decisions and seams). Pocock `pr` and pstack `blast-radius` (reversible or not, who is touched). | Stages 0 and 1 | What and why, what changes for the owner, seams to test at, one-way or two-way, out of scope, choices with a recommendation | The content | Sections present. Glossary "do not say" words absent. Each choice has a recommendation. | Yes. The first approval. Choices are presented as options. |
| 3 Plan | Pocock `to-tickets` (slices, blocking edges, prefactor first, frontier). pstack Feature's throughput checkpoint and `separate-before-serializing-shared-state` (who owns each file). pstack plan skeleton and `check-plan.mjs`. | The approved proposal and the code | Slices with owned files, blockers, a definition of done each, the real thing each is proven on, the order | Slicing, and each definition of done | Every slice has the seven sections. Ids are unique. Blockers resolve and have no cycle. No file has two owners. Every "must" names a command or an artefact. No "if" in a definition of done. Every command in Tools runs with `--help` or exists. | No, see next row |
| 3b Challenge | pstack `interrogate` (findings proven by a run, on another model). pstack `architect` red flags. | The plan | Findings: what collides, what cannot be verified, which items cannot both hold | All of it | Findings carry a command and output where one is possible. The challenger's model differs from the planner's. | Yes. The second approval, on plan plus findings. |
| 4 Tasks (kernel) | Sandcastle (a worktree and branch per run, a lock per worktree) | The plan | One task record and one worktree per slice | None | All of it | No |
| 5 Build | Pocock `tdd` (one test, one implementation, repeat; literal expected values). pstack `sequence-verifiable-units` (commit per green unit). pstack `show-me-your-work` (rows as units land). pstack Pause safely. | One brief | Commits on the slice's branch, a report with evidence per item, a trail | The code and the tests | Changed files within the owned set. Types, lint, format, dead code, copy-paste count, tests. A test commit precedes its code commit. Tree clean. No debug prefix left. Each trail pointer resolves. | No |
| 5b Checks (kernel) | pstack `prove-it-works`, `create-verification-skill`. pstack `test-behavior-not-implementation` first edit, made real as mutation. | The branch | Results as findings, each verified, not verified or inconclusive | None | All of it: toolchain actions, mutation in a throwaway copy with a time limit, the project's verification script | No |
| 5c Review | Pocock `code-review` (two axes, not merged, fresh context). pstack "own the sub-agent's work" and `interrogate` (leave out what was not run). | The diff, the brief, the checks' output. Not the builder's reasoning. | A verdict per definition-of-done id with evidence, standards findings citing practice ids, own bug injections | Reading the diff against the plan. Choosing where to inject. | The verdict covers every id. Every finding cites a rule id or is marked as judgement. Reviewer made no edits (diff of the worktree is empty). Reviewer's model differs from the builder's. | No, unless two rounds fail |
| 6 Integrate (kernel) | Sandcastle `merge-to-head`: abort on conflict, target unchanged, keep the branch | A reviewed branch | A merge, and every check rerun on the whole | None. A conflict fails the step. | All of it | No |
| 7 Evaluate | pstack `show-me-your-work` cross-model review. agentbay P-27. | The whole tree, no history | Ranked findings with file and line | All of it | Findings have file and line. The evaluator's model differs. | Yes. Fix now, later, or accept. |
| 8 Learn | Pocock `retro`. pstack `reflect`, `correct`. | The run's events and trail | Candidate checks and practice edits, each with the level it would be enforced at | Which lessons are lasting | A proposed check fails on the commit that had the mistake | Yes for any change to a practice file or a skill. No for filing a candidate. |

Notes on this path:

- A failed round. pstack and P-25 agree: a fix round goes to a fresh builder given the brief, the review and the branch. The 0022 forge text says the task goes "back to the builder". Forge should decide which it means. If the second round fails for the same reason, `attack-the-premise` says test the premise (often the brief) before a third attempt, and that is where the owner comes in.
- Merging. The sources use a model to merge and resolve conflicts (Pocock's merger sub-agent, Sandcastle's merge prompt). Forge's integrate stage is a script. A conflict should fail the stage and return to planning, because a conflict means two slices shared a file the plan said they did not.
- Completion. Sandcastle's completion signal is a string in the agent's output. agentbay already has a stronger form: a submission through a kernel tool with a task token, validated against a schema. Nothing to take here. The hanging-process timeout is worth taking for direct mode.

### 4.2 Feature

Sources: pstack Feature, Pocock `to-spec`, `to-tickets`, `tdd`, `implement`.

- Proposal adds: the data shape named before any logic (pstack `model-the-domain`), and the seams the tests will sit at (Pocock `to-spec` step 2).
- Plan adds: prefactoring slices first ("make the change easy, then make the easy change").
- Build: tests first, one at a time, at the entry file.
- Proof on the real thing: the new behaviour driven through the project's verification script, plus a new journey added to the feature map.
- Model judges: the shape, the slicing. Script checks: the usual set, and that the feature map gained an entry for a slice that adds an action or a command.
- Owner approves: proposal and plan.

### 4.3 Refactoring

Sources: pstack Refactoring, Pocock DEEPENING, agentbay's own R and M briefs.

- Stage 1 adds a pin: a capture of current behaviour before any edit. The kernel can own this. It runs the project's capture script on the base commit and stores the output.
- Proposal: the structure that is missing and the target shape, and nothing about behaviour. A bug or missing feature found on the way is split into its own request.
- Plan: a subtraction slice first, then the reshape. For a move of callers, the script that makes the change is named (P-24).
- Build: small steps that keep the pin green. Old tests of shallow parts are rewritten at the entry file and deleted.
- Checks: the capture after equals the capture before, byte for byte. Sizes before and after. Dead-code runs. Every title in the old test files maps to a test that still carries it or to a named covering test (as brief R4c did).
- Review asks pstack's last question: did reader load go down anywhere? If not, the change is reverted. agentbay's form of that question is the deletion test.
- Model judges: target shape, whether a test was truly covered elsewhere. Script checks: the pin, the mapping's completeness, the counts.
- Owner approves: the plan, only when an interface other features use changes. A refactor inside one feature is reversible work.
- Where the sources disagree: Pocock's expand, migrate, contract for wide refactors. agentbay forbids keeping old and new side by side (ADR 9). ADR 7 already accepts the cost: such a slice has a larger write scope.

### 4.4 Bug fix

Sources: Pocock `diagnosing-bugs`, pstack Bug fix and `tdd`, `fix-root-causes`, `attack-the-premise`.

- Stage 0 adds the symptom in the owner's words.
- A new stage replaces Proposal: **Reproduce**. Output: one command that has been run and fails on this bug, with its output. No approval. No theory before this exists.
- **Diagnose**. Output: ranked hypotheses, each with a prediction, and the one that survived with its evidence. Temporary logs carry one prefix.
- Plan is usually one slice. If the fix crosses an interface, it becomes a design round first.
- Build: the failing regression test is committed before the fix, at a seam that exercises the real pattern. If no such seam exists, the report says so and that becomes a refactoring request.
- Checks: the red command now passes. The regression test fails on the parent commit and passes on the fix commit. The debug prefix is nowhere in the tree.
- Model judges: the cause. Script checks: red before, green after, on both the command and the test.
- Owner approves: nothing, unless the fix changes what the owner types or sees (P-28).

### 4.5 Design round

Sources: Pocock DESIGN-IT-TWICE and `grilling`, pstack `architect`, `arena`, `interrogate`, agentbay ADR 10 and ADR 13.

- Trigger: a wide or new interface (P-14), or a proposal whose choices cannot be settled without seeing alternatives.
- **Ground**. Output: what any design must satisfy, the dependencies and their kind (in-process, local stand-in, owned remote, external), written for the owner.
- **Candidates**. Three builders, fresh, each under a different constraint, each on a different model where the project has them. Each writes the caller's usage first, then the interface, what is hidden, the seams, the trade-offs. Each in its own output folder.
- **Screen and compare**. A script screens what it can: importable internals, pass-through exports, lists kept in two places. A model compares on depth, locality and seam placement against a rubric written before the candidates were read. A judge on a different model scores the same rubric.
- **Recommend**. One design, possibly a hybrid, with each graft's source named.
- **Record**. A decision record, and the slices that carry it out.
- Model judges: nearly all of it. Script checks: each candidate has the five parts, the rubric predates the candidates, the judge's model differs.
- Owner approves: the recommendation. This is where Pocock's grilling idea is useful in a small dose: put the open decisions to the owner as numbered choices, each with a recommended answer, all in one round.
- pstack skips the human here by default. agentbay should not, because an interface changes what later slices are allowed to do and is costly to reverse.

---

## 5. What the sources assume that agentbay lacks or forbids

| Assumption | Where | agentbay |
|---|---|---|
| A human answering in the conversation | Pocock `grilling`, `domain-modeling`, `to-tickets` step 4, `tdd` seam confirmation, `improve-codebase-architecture`, `wayfinder` | The owner decides through approval steps bound to the content shown (CONTEXT, P-28). The owner prefers a few selectable choices to an interview (`practices.md`, not adopted list). |
| An issue tracker with labels, sub-issues and blocking links | Pocock `to-spec`, `to-tickets`, `implement-spec`, `triage`, `wayfinder`. Sandcastle's templates read issues with `gh`. | Briefs live in the repository. Not adopted. Pocock's local-file fallback (`.scratch/`) is the nearest fit. |
| Pull requests and a code host, with review bots | pstack Opening a PR, Babysit, Shipping. Pocock `pr`. | Slices are branches merged locally by the reviewer or the kernel. Briefs say never push. |
| Comments that explain why | pstack router and `no-comments` keep list | Forbidden by P-01. |
| Sub-agents spawned freely, nested, in the background, by the agent itself | pstack throughout (`Task` with `subagent_type`, `run_in_background`, cloud workers). Pocock DESIGN-IT-TWICE, `implement-spec`, `code-review`. | The kernel never drives a model (ADR 2). In relay mode only the session can start a sub-agent. In direct mode an adapter's `run` starts one agent per skill task. `foreach` over tasks runs in order for 5.0.0. Fan-out inside a skill step is outside what the kernel can see, budget or confine. |
| A harness that drives the model in a loop | Sandcastle `run()` with iterations, session resume and fork | The pattern is allowed only behind a harness adapter. The engine waits for a submission. |
| One harness's features | pstack: Cursor's `Task`, `/loop`, cloud environments, `agent-transcripts`, a models rule file, built-in `create-skill`, and skills from `cursor-team-kit`. Pocock: the Skill tool, `/clear`, `/compact`, `disable-model-invocation`. | No harness name outside `adapters/` (DOD-9). |
| Model names written into skills | pstack defaults name specific models per role | A skill names a tier. The project config maps tiers to models. |
| Skill text loaded by the model when a description matches | Both collections | A skill is a step in an action's `run` list, started by the kernel, with schemas for input and output. |
| Agents running with permission checks off | Sandcastle's unattended default | Grants and effects enforced by the broker and the adapter's hook (ADR 3). |
| A merge decided by a model | Pocock merger sub-agent, Sandcastle merge prompt | Integrate is a script. |
| A reviewer that edits the code | Sandcastle review prompt | The reviewer may run checks and may not edit (forge design, P-23). |
| Completion claimed by a printed marker | Sandcastle completion signal | A submission with a task token, checked against a schema. |
| Exceptions for failure | pstack TypeScript examples | `Outcome<T>` (P-03, TS-05). |
| A schema library as a dependency | pstack "schemas before guards" with Zod | No new dependency (DOD-8). The kit has JSON schemas and generated types. |
| Old and new side by side during a migration | Pocock `to-tickets` wide refactors | Forbidden (ADR 9). |
| Writing outside the project (system temp for hand-offs and reports, notes outside the repository) | Pocock `handoff`, `improve-codebase-architecture`, `implement-spec` | A mode writes only where its grants allow. Briefs do use `/tmp` for progress notes and throwaway copies, so this is practice without a rule. |
| Opening a browser or a UI to verify | pstack control skills, Pocock HTML report and prototypes | The real thing is a command or a harness session today. A project's verification script could add a UI later. |
| A long interview before a plan | Pocock grilling | Not adopted, except for a new mode's first brief. |
| The agent may decide a check is too costly and skip it | pstack `tdd`, router's `skip: <reason>` todo items | A "must" item is not the builder's to skip. The reviewer decides conditions before the brief is written (brief template). |

---

## 6. pstack's typescript-best-practices against TS-01 to TS-17

pstack's skill has sixteen rules. agentbay has seventeen. They overlap on about a third.

### Agreements

| pstack rule | agentbay | Note |
|---|---|---|
| Discriminated unions, no bags of optional fields | TS-02, P-05 | pstack asks for one discriminant name used everywhere (`kind`, `type` or `tag`). agentbay's examples use `status` and state no naming rule. |
| `unknown` over `any` | TS-03 | Same. |
| Boundary validation into a named domain type, then trust | TS-04, P-06 | Same. pstack adds: a loose record type stops at the parse. |
| Exhaustiveness | TS-02 | Same aim, different mechanism. See contradictions. |
| Object arguments instead of positional | TS-09 | agentbay: at most three parameters, then one object. pstack: objects by default. |
| Type guards must verify the claim, named `isX` or `hasX` | TS-03's example uses `isRecord` | agentbay has no stated rule on guards. |
| Real tests, do not mock what you can run | ADR 10, P-10 | Same position: the real store with a fault injector. |
| Schema-derived types | `schemas/generate-types.ts` | agentbay generates types from its JSON schemas. The rule is not written in the TS file. |

### pstack has it, agentbay does not

| pstack rule | Worth adding? |
|---|---|
| Branded types for primitives that mean different things, created only by a verifying guard | Yes, where it bites. Task tokens, run ids, mode names and action references are all strings today. A branded type would make "a submitter never receives another step's token" (ADR 10) partly a compile error. It needs no `as` if the brand comes from a type guard. |
| Constructive modelling: a non-empty list as a tuple type, a range as start plus duration | Yes, as an example under TS-02. It pairs with TS-06: a non-empty tuple removes the `undefined` check on the first element where emptiness is impossible. |
| Simplest total type: strengthen a type only where the loose one forces a `!`, a cast or a "cannot happen" throw | Yes, as the limit on the rule above. |
| Narrowing order: discriminant, then `in`, then `typeof`, then a guard | Maybe. One line under TS-03. |
| `satisfies` to check a value without widening | Yes. It is not an assertion, so TS-03's lint setting already allows it. TS-03 should say so, since it names `as const` as the only assertion allowed. |
| Reach for `Pick`, `Omit`, `ReturnType` before declaring a new type | Maybe. It serves P-12. It can also hide an interface's shape from a reader, which works against TS-08. |
| Structured logging, no `console.log` in shipped code | Not now. The kit has no logger. A lint rule against `console` in `bay/` outside the command line would be the cheap form. |

### agentbay has it, pstack does not

TS-01 (erasable syntax), TS-05 (problems as values, every problem returned), TS-06 (index access may be missing), TS-07 (exact optional properties), TS-08 (exported functions state their types), TS-10 (unions not overloads, no boolean that switches behaviour), TS-11 (a class only for state with a lifetime, `#private`, no inheritance), TS-12 (named exports, no re-export files), TS-13 (no floating promises), TS-14 (no parameter reassignment, `readonly` data), TS-15 (full-word names from the glossary), TS-16 (complexity limit with a warning against splitting only to pass it), TS-17 (the outside world as an argument).

pstack covers some of these as language-neutral principles instead: `minimize-reader-load` (TS-14 and TS-16 in spirit), `boundary-discipline` (TS-17 in spirit). It says nothing on TS-01, TS-07, TS-08, TS-11 or TS-13.

agentbay also states what holds each rule and where the rule comes from. pstack does neither.

### Contradictions

| Point | pstack | agentbay |
|---|---|---|
| Failure | Parse functions throw. Use the schema's safe form when failure is an expected branch. | Return `Outcome<T>`. Throw only when the process cannot go on. Return every problem, not the first. |
| `as` | Last resort, allowed after validation | Never, by lint. Only `as const`. |
| Exhaustiveness | An inline assignment of the value to a `never`-typed local in the default arm, with `void` in statement switches | The lint rule `switch-exhaustiveness-check`. pstack's unused local may also trip the unused-variable lint. |
| Parameters | Objects by default, skipped on hot paths | A hard limit of three with no exemption |
| Runtime schemas | Use the repository's schema library and infer types from it. Its examples use Zod. | No new dependency. Hand-written checks at the edge, or the kit's JSON schema checker. |
| Optional fields | "No optional-field bags" | Optional fields are fine when exact (TS-07). The two agree on state, and differ on options objects. |
| Comments in examples | The examples carry explanatory comments | P-01. agentbay's own practice file uses `// good` and `// bad` markers in examples only. |

None of these needs a change in agentbay. The first is the important one for forge: a toolchain mode's practice file must be able to say "problems are values" for a language, because it is not a universal norm and builders trained on common TypeScript will throw.

---

## 7. What both sources miss that agentbay's last two days show is needed

Each item names the evidence in the repository.

1. **A check that a brief does not contradict itself or the practices.** Neither source tests a ticket or a plan for items that cannot both hold. pstack's `check-plan.mjs` checks structure only. Evidence here: the brief template says a definition-of-done item has no "if" and that the reviewer decides conditions first, yet DOD-R4c-6 is an either-or left to the builder, and DOD-M5-9 and DOD-R4c-8 each end in a three-way "or". Brief M5 also leaves conditions to the builder in its Output list (items 3, 6 and 7), which the template does not forbid but which has the same effect. The 0022 plan's DOD-3 ("every exported function has a test") had to be reworded because it contradicted the interface-as-test-surface rule. The plan's DOD-5 reports a line count "against its budget" while P-13 and ADR 9 say size is never a target. The plan's review rule sends a failure "back to the same builder once" while P-25 says a builder is stopped and a fresh one started. The skill contract says three rounds and the forge design says two. Forge needs a script for the mechanical part (unique ids, a level on each item, no "if", a command named for each "must") and a challenge step that looks for pairs of items that cannot both be met.

2. **Builders stopped without warning.** pstack's Pause safely is for an announced stop. Sandcastle keeps a branch that has commits and times out an idle agent. Neither designs for a builder killed at an arbitrary moment. Evidence: briefs M1 to M6 and D2 each carry a paragraph saying the session can be stopped, and M4 says about 35 minutes in. The briefs' answer is by hand: commit after every passing step, keep a progress note in `/tmp`, run nothing in the background. Forge needs this as structure: a time budget per slice set below the observed limit, a commit per verified unit enforced by the checks, the trail kept in the run's events and not in `/tmp`, and a pickup step that starts a fresh builder from the brief, the commits and the trail.

3. **Bug injection that cannot leak.** Neither source injects bugs as routine, so neither has the failure. Evidence: P-31 exists, with its own number out of sequence, and every brief from D1 on names the throwaway-copy command, while R4c (written before it) has bug injection with no such command. The rule is held by review. Forge's design already makes mutation a kernel check through `toolchain@1` `mutants`. The missing parts are: the kernel, not the agent, applies each patch in a copy it created, runs the tests under a time limit, and deletes the copy; and a script asserts the working tree is clean at the end of every step, whoever ran it.

4. **Proof on the real thing that the kernel reruns.** Both sources ask for it. Both accept the agent's pasted output as the evidence (Pocock `pr`, pstack reply rules). pstack's parent "audits the receipts" by reading them. agentbay's lesson, in the forge design table, is that the checks are run again by the engine and not trusted from the agent. The sources also assume a user interface to drive. agentbay's real thing is a command in a fresh project outside the kit. What is missing in both: the proof named in the brief as a command, stored as a script, and rerun by someone other than the builder.

5. **A reviewer that verifies each claim, by id.** Pocock's review reads a diff. pstack's `interrogate` proves its own findings but does not walk the builder's claims. Neither produces a verdict per acceptance criterion. agentbay does this by hand (P-22, P-23, the plan's "a verdict per DOD id"). Forge needs the review output's schema to require one entry per id with the command rerun and its last lines, and a rule that an id with no rerun evidence is "not verified".

6. **Write scope enforced, not requested.** The sources separate work with worktrees and with instructions ("hold the file boundaries"). pstack itself says instructions are not concurrency control, then relies on them for scope. agentbay's lesson was a slice that changed 63 files (ADR 7). Forge's design already narrows a skill step's write paths and checks changed files against owned files. Keep it. Neither source has it.

7. **A kept, changed, dropped list for replaced behaviour.** Neither source has one. pstack's refactoring pin proves sameness but does not list what was deliberately dropped. agentbay's plan requires the list and sends an unnamed drop to the owner.

8. **Counts before and after.** Lines, debt entries, copy-paste blocks, test count. The sources report none. agentbay records all four in every brief's first step and compares at the end. Forge's stage 1 can produce the baseline and stage 5b the comparison, so no builder types them.

9. **Commands in full in the brief.** Pocock argues the opposite (no paths, no commands, they go stale). agentbay's template says "every command in full, never as in another brief", because a builder that guesses a command guesses wrong. Forge can generate the Tools section from the toolchain mode's `describe` and the project's settings, so it is both complete and not hand-copied.

10. **Budgets.** Neither source limits a run by tokens, dollars or minutes. pstack sets reasoning levels per role. Sandcastle reports usage. agentbay's runs have budgets, and forge has the most skill steps per run.

11. **Approval bound to content.** In both sources an approval is a chat message. agentbay's approval step is bound to what was shown. For forge this matters at the plan: a plan edited after approval must need a new approval.

12. **A hand-off that expires.** Pocock's `handoff` says to save the note outside the workspace and point at artefacts. Evidence that this matters: `HANDOFF.md` at the root of the kit describes "0008 slice 9 (version 1.0.0)" in the old Python tree. It is two major versions stale and sits where a new builder would read it first. Forge's pickup should read the run's events, and a stale hand-off file should fail a check or be deleted (ADR 9 covers docs).

13. **Practices that say what holds them.** pstack's `correct` asks for a rule table paired with enforcement. agentbay already has it in every row. What neither has, and forge's design adds, is a machine-readable form (`Enforced by:` per practice entry) that `bay check` validates and that the reviewer's findings must cite.

---

## 8. Sources

### Read (through shallow clones at the commits in the table at the top)

Pocock's skills, each at `https://github.com/mattpocock/skills/blob/main/<path>`:

- `LICENSE`
- `GLOSSARY.md`
- `CHANGELOG.md` (searched for renames only)
- `skills/engineering/README.md`
- `skills/deprecated/README.md`
- `skills/engineering/codebase-design/SKILL.md`, `DEEPENING.md`, `DESIGN-IT-TWICE.md`
- `skills/engineering/domain-modeling/SKILL.md`, `GLOSSARY-FORMAT.md`, `ADR-FORMAT.md`
- `skills/engineering/to-spec/SKILL.md`
- `skills/engineering/to-tickets/SKILL.md`
- `skills/engineering/tdd/SKILL.md`, `tests.md`, `mocking.md`
- `skills/engineering/implement/SKILL.md`
- `skills/engineering/implement-spec/SKILL.md`
- `skills/engineering/improve-codebase-architecture/SKILL.md`
- `skills/engineering/grill-with-docs/SKILL.md`
- `skills/engineering/diagnosing-bugs/SKILL.md`
- `skills/engineering/code-review/SKILL.md`
- `skills/engineering/pr/SKILL.md`
- `skills/engineering/retro/SKILL.md`
- `skills/engineering/research/SKILL.md`
- `skills/engineering/wayfinder/SKILL.md`
- `skills/engineering/prototype/SKILL.md`
- `skills/engineering/triage/AGENT-BRIEF.md` (to the first example)
- `skills/engineering/ask-matt/SKILL.md` (first 80 lines)
- `skills/productivity/grill-me/SKILL.md`
- `skills/productivity/grilling/SKILL.md`
- `skills/productivity/handoff/SKILL.md`
- `skills/productivity/wait-what/SKILL.md`
- `skills/productivity/writing-for-agents/SKILL.md`, `SKILL-MECHANICS.md`
- `skills/in-progress/software-factory/SKILL.md` (first 60 lines)
- `skills/in-progress/setup-ts-deep-modules/SKILL.md` (first 40 lines)

pstack, each at `https://github.com/cursor/plugins/blob/main/<path>`:

- `README.md` (the repository structure and licence sections)
- `pstack/LICENSE`, `pstack/plugin.json`, `pstack/README.md` (last section only)
- `pstack/agents/poteto-agent.md`, `pstack/agents/comment-sicko.md`
- `pstack/skills/poteto-mode/SKILL.md`
- `pstack/skills/poteto-mode/playbooks/feature.md`, `refactoring.md`, `bug-fix.md`, `opening-a-pr.md`, `investigation.md`, `prototype.md`, `pause-safely.md`, `session-pickup.md`, `autonomous-run.md`
- `pstack/skills/poteto-mode/playbooks/multi-phase-plan.md` (first 70 lines, long lines cut)
- `pstack/skills/poteto-mode/scripts/check-plan.mjs` (first 60 lines)
- `pstack/skills/unslop/SKILL.md`
- `pstack/skills/technical-writing/SKILL.md`
- `pstack/skills/typescript-best-practices/SKILL.md`, `references/patterns.md`
- `pstack/skills/correct/SKILL.md`
- `pstack/skills/create-verification-skill/SKILL.md`
- `pstack/skills/interrogate/SKILL.md`
- `pstack/skills/architect/SKILL.md`, `references/design-red-flags.md`
- `pstack/skills/arena/SKILL.md`
- `pstack/skills/swarm/SKILL.md`
- `pstack/skills/reflect/SKILL.md`
- `pstack/skills/show-me-your-work/SKILL.md`
- `pstack/skills/figure-it-out/SKILL.md`
- `pstack/skills/tdd/SKILL.md`
- `pstack/skills/no-comments/SKILL.md`
- `pstack/skills/in-your-own-words/SKILL.md`
- `pstack/skills/blast-radius/SKILL.md`
- `pstack/skills/principle-<name>/SKILL.md` for: prove-it-works, test-behavior-not-implementation, encode-lessons-in-structure, sequence-verifiable-units, subtract-before-you-add, model-the-domain, type-system-discipline, boundary-discipline, build-the-lever, make-operations-idempotent, migrate-callers-then-delete-legacy-apis, never-block-on-the-human, separate-before-serializing-shared-state, laziness-protocol, guard-the-context-window, fix-root-causes, exhaust-the-design-space, attack-the-premise, minimize-reader-load

The mirror, at `https://github.com/backnotprop/pstack/blob/main/<path>`:

- `LICENSE`, `MIRROR.md` (first 40 lines), `README.md` (the "What this mirror changes" section)
- `skills/interrogate/SKILL.md` (compared with upstream: wording only)

Sandcastle, each at `https://github.com/mattpocock/sandcastle/blob/main/<path>`:

- `LICENSE`, `package.json` (licence field), `README.md`, `GLOSSARY.md`
- `docs/guide/core-concepts.md`, `iterations.md`, `structured-output.md`, `toc.json`
- `docs/guide/branch-strategies.md` (first 150 lines and the closing sections)
- `docs/guide/agent-providers.md` (first 60 lines), `docs/guide/prompts.md` (first 70 lines)
- `docs/adr/0003-reuse-worktree-by-default.md`, `docs/adr/0007-worktree-locking.md` (first part of each)
- `src/templates/parallel-planner-with-review/main.mts`, `plan-prompt.md`, `merge-prompt.md`
- `src/templates/sequential-reviewer/review-prompt.md`

On the web, through the fetch tool (a summary by a small model, not the raw page):

- `https://www.aihero.dev/sandcastle`
- `https://www.aihero.dev/sandcastle/branch-strategies`

In agentbay: `CONTEXT.md`, `framework/practices.md`, `components/base/typescript/practices.md`, `docs/adr/0001` to `0014`, `docs/briefs/TEMPLATE.md`, `docs/briefs/M5-inspect-and-place.md`, `docs/briefs/R4c-runs-tests-at-the-entry-file.md`, the named sections of `docs/plans/0022-typescript-port.md` and `docs/proposals/0022-typescript-port.md`, `HANDOFF.md`, and a search of the other briefs for the lines about stopped sessions and throwaway copies.

### Could not be opened

- `https://www.aihero.dev/skills.md`. The fetch tool refused it as not on this session's allowlist, and a direct request was refused by the proxy with a 403. The index of skills was taken from `skills/engineering/README.md` in the repository instead.
- `https://www.aihero.dev/sandcastle/how-it-works`. Not tried, because the site's table of contents has no such page. `core-concepts` was read in its place.
- `https://www.aihero.dev/sandcastle/core-concepts`, `/glossary`, `/prompts`. Not fetched from the site. The same pages were read from `docs/guide` in the repository, which the repository says is what the site publishes.
- `skills/engineering/zoom-out`. Removed from the repository.

### Exists but was not read

- Pocock: `triage/SKILL.md` and `OUT-OF-SCOPE.md`, `setup-matt-pocock-skills`, `wizard`, `improve-codebase-architecture/HTML-REPORT.md`, `prototype/LOGIC.md` and `UI.md`, `ask-matt/PHASE-BOUNDARIES.md`, `productivity/teach` and `to-questionnaire`, the `misc` group, the rest of `in-progress` (including `chief-of-staff` and `loop-me`), and the `docs/` pages.
- pstack: `poteto-help`, `setup-pstack`, `statechart`, `recall`, `why`, `how`, `teach`, `sharpen`, `bro`, `ketchup`, `automate-me`, `benchmark-checklist`, both formal-verification skills, `maintain-verification-skill`, `make-bot-ui`, the other playbooks (babysit, shipping, orchestrate, both autopilots, eval, hillclimb, perf issue, the forensics pair, visual parity, worktree cleanup, authoring a skill), `reflect`'s four reference prompts, `architect`'s runner prompt and rationale template, the `docs/guide` pages, the `benny` automation pack, and five principle skills (experience-first, explain-the-number, foundational-thinking, outcome-oriented-execution, redesign-from-first-principles).
- Sandcastle: `docs/guide/run.md`, `sandbox-providers.md`, `agent-sessions.md`, `hooks.md`, `init.md`, `cli.md`, `run-logs.md`, `getting-started.md`, the other decision records, and the source code.
