# Design frame: forge, the mode that builds things

Read-only design task. Do NOT change any file in /home/claude/agentbay and run no git command that writes. Run nothing in the background. Write one file only, the path you are given.

## What forge is for
agentbay 5 is a TypeScript kit: a kernel that loads modes, enforces their grants and effects, and runs their actions and workflows durably. For two days the kit itself has been built by hand through one process: a reviewer writes a brief in seven sections with a numbered definition of done; a builder agent implements it in a git worktree; the reviewer reruns every check, injects bugs of its own, and merges or sends it back. Forge is that process as a mode, so that the owner can ask for a mode or a kernel change and get a verified, merged slice, with the kernel holding the state instead of a person.

The owner's requirements, in his words over two days:
- "a best in class mode to build things ... with stages that write proposals tech plans tasks implementation reviews different agents and models"
- "Should be able to use it with other language like golang. So needs to be modular and need to be able to add best practices"
- "Smaller slices and vertical more localized to a feature when possible. Also check boundaries."
- "need deep modules"; "aggressively delete unused code. Not layer on top of it"; "flag if same code exists in multiple places and refactor into common shared code"
- "As long as there are instructions to write quality code the line cap is not that important"; "avoid comments in the code"
- "How do we know tests are legit and really test something"
- The framework "is an abstraction with rails that could be run interactive or not on any harness" (Claude Code, Codex, Mastra and others). The kernel never drives a model.
- Forge's first real jobs: a mail source mode with a mail briefing (tested against made-up mail), then a "home" mode (docs/proposals/0023-home-mode.md), then the rest of the kernel's features, deepened one at a time.

## Read
In /home/claude/agentbay:
- CONTEXT.md; framework/practices.md; components/base/typescript/practices.md; framework/features.yaml
- docs/adr/ — all of them, especially 0002 (the kernel never drives a model), 0003, 0005, 0007, 0008 (ideas from Sandcastle, not the dependency), 0009, 0011, 0012, 0014
- docs/research/2026-11-16-forge-sources-digest.md — what two public skill collections and Sandcastle say, and what forge could take. Read parts 3, 4, 5 and 7 closely.
- docs/briefs/TEMPLATE.md and three real briefs with very different shapes: docs/briefs/M2-loading-applies-the-policy.md (a behaviour change), docs/briefs/M1-move-manifests-into-its-folder.md (a mechanical move), docs/briefs/R5a-approval-content-is-scrubbed-everywhere.md (a bug fix)
- docs/plans/0022-typescript-port.md — the sections "The forge mode: how agentbay builds things", "Forge is language-neutral", "Direct mode". This is an earlier design by the reviewer, written before the practices existed. You may keep, change or drop any of it.
- docs/proposals/0022-typescript-port.md — the mode contract, the skill contract (seven sections), workflows (action, approval, wait, foreach steps), Safety
- The kit as it is: bay/manifests/manifests.ts and bay/runs/runs.ts (the two entry files), bay/adapter.ts, adapters/claude-code/ (how a skill step reaches an agent today), components/modes/feed-briefing/ (a real mode with a skill whose output a script checks), components/base/typescript/

## Facts from two days of doing it by hand
- 24 slices were built. Each took a builder 15 to 70 minutes. The reviewer's check added about 15.
- Five briefs had definition-of-done items that contradicted each other. Builders noticed and chose sensibly; nothing checked the brief before it was sent.
- Three builders were killed mid-run when the session stopped. Work survived because each step was committed and a progress note was kept; a fresh builder finished from the commits.
- One killed builder left an injected bug in the working tree. Since then bugs are injected only in a throwaway copy.
- Reviewer bug injection found untested behaviour in about one slice in three, after the builder's own injection had passed.
- A fake in tests hid a real fault twice. Running the real command in a fresh project ("proven on the real thing") found faults that tests had not.
- Capturing all output before and after ("byte for byte the same") made two large refactors safe.
- Designing a wide interface three ways under different constraints, then choosing, was done twice and changed the outcome both times.
- Builders are spawned by a coordinating session with a tool of the harness. The kernel has no way to start an agent today. A "direct mode" (`Adapter.run(task)`) is planned and not built.
- The kernel has: durable runs that wait and resume, approvals bound to the content shown, budgets, undo, skill steps whose output is checked by scripts with feedback rounds, per-step tool lists enforced by a hook, a store, and `bay actions`. It does not have: a check that is itself a skill, a write scope per task, a model per skill, several modes bound to one interface, images as skill input, or any way to run a command such as `git` or `npm` from a mode except through `resources.commands`, which only a base mode may list and which gives the agent a shell.

## Decided already (constraints on every design)
- The kernel never drives a model (ADR 2). Forge is a mode: manifests, actions, workflows, skills, scripts. Kernel additions it needs are named and justified one by one, each as small as possible.
- The seven-section skill contract holds for every forge skill, with a definition of done that scripts check wherever a script can.
- A reviewer never builds what it reviews, reruns every check, and reports only what it verified (P-23). A reviewer does not edit the code it reviews.
- A slice that is sent back goes to a fresh builder with the whole scope and the findings (P-25). At most two fix rounds, then the owner decides.
- Bugs are injected in a throwaway copy (P-31). Size is reported, never targeted (P-13). No comments in code (P-01).
- The owner approves: what will be built (before building), anything that cannot be undone, anything that changes what he types or sees, and the merge to the main line. Choices are put to him as a few selectable options, not as prose.
- Language-neutral: everything a language needs (type check, lint, format, dead code, tests, bug injection, its practices file) comes from a toolchain mode behind an interface. Forge names no language.
- No dependency on Sandcastle or on an agent framework. Runtime dependencies stay `yaml` and `ajv`.

## Questions every design must answer
1. **Kinds of work.** Which kinds does forge know (new mode, new feature, behaviour change, refactor or move, bug fix, design round), and what differs between them: the first step, the evidence, the approvals? One workflow with branches, or a workflow per kind?
2. **Stages.** From the owner's request to a merged slice: each stage's input, output, who does it (a skill at which tier, a script, the owner), what a script checks, and what happens on failure. Where do a brief's contradictions get caught before a builder starts?
3. **Slicing.** Who cuts a request into slices, how is one slice's write scope stated and enforced, and how do slices that depend on each other run?
4. **Isolation.** Where does a builder work (a worktree and branch per slice, as by hand?), who creates and removes it, and how is "the builder touched nothing outside its scope" checked?
5. **Starting agents.** How does a build step reach an agent on a harness that the kernel does not drive? Interactive (a coordinator session hands each task to a subagent) and unattended (direct mode) both. What survives a stopped session, and how does a fresh builder pick up?
6. **Review as code and as judgement.** Which review steps are scripts (rerun checks, diff against scope, output capture, bug injection, copy-paste detection, boundary debt) and which need a model (does the test assert the right thing, is the design sound, is the report truthful)? How is a builder's claim tied to evidence the kernel can check?
7. **Models.** How are tiers mapped to models per stage, and how does a second model review a design or a diff?
8. **Language neutrality.** The toolchain interface: its actions, what each returns, and what a Go toolchain mode would supply. Where do practices live and how are they added by the owner?
9. **Kernel additions.** The exact list, each with: what it is, why forge cannot do without it, how small it can be, and which feature of the kit it lands in. Say which can wait until after forge's first real job.
10. **The owner's experience.** What he types to start, what he is shown at each approval, what a status question returns, and how long he must stay attached. Give one worked example end to end: "build a mail source mode that reads made-up mail from a folder".
11. **Bootstrapping.** Forge must be built by hand, by the same process it replaces. What is the smallest forge that is worth using on the mail mode, and what is added after?
12. **What can go wrong.** A builder that lies or loops; a check that passes vacuously; a merge conflict between slices; a stopped session; a budget overrun. Say what catches each.

## Your output (one Markdown file, at most 320 lines, plain English, short sentences)
1. The shape in one paragraph, then a diagram in text of the stages.
2. The modes forge is made of, each with its actions (name, one-sentence description, effects) and its skills (name, tier, what its output is and how it is checked). Small composable modes behind interfaces are preferred to one large mode.
3. The workflows, as YAML sketches in the kit's workflow format.
4. The toolchain interface, as an interface file sketch, and what the TypeScript and Go modes supply.
5. Kernel additions, as a table (question 9).
6. The worked example (question 10), step by step, with what the owner sees.
7. Answers to the remaining questions, briefly.
8. Trade-offs: what this design makes harder, and the strongest argument against it.
9. Build order: slices small enough for one builder each, in order, with the point at which forge first builds something itself.

Use the glossary's words. Mark every number you give as measured (from the facts above) or estimated.
