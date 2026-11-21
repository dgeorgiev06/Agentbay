# agentbay design: where to read

This file used to describe agentbay 4: a dispatcher, roles, envs, connectors, use shims and a Python kit. None of
that is in agentbay 5, and git history keeps the old text. What is built is described where it is decided and
where it is built. This page says where. The words are defined in [CONTEXT.md](../CONTEXT.md).

## The system in short

- The kernel, in `bay/`, loads the modes a project uses, applies their grants and their actions' effects, and runs
  actions and workflows as runs it records in `.agentbay/kernel.db`. It never drives a model (ADR 2).
- A mode is a folder with a `mode.yaml`. Its actions run steps: a script, a skill or a call. Its workflows run
  actions, approvals, waits and foreaches. It implements and requires interfaces, and the project's config binds
  each interface to a mode.
- A script runs in a child process and reaches the kernel only through the toolbox, `bay/sdk.ts` (ADR 4). Every
  operation it asks for passes one rule in the broker, which checks the mode's grants and the action's effects
  (ADR 3, ADR 19). The confinement is a seat belt, not a wall (ADR 5).
- A skill step becomes a task for an agent of the harness. The Claude Code adapter writes one agent per skill
  step and a hook that, where it runs, narrows what each agent may do. The hook is defence in depth, not
  isolation. The kernel checks what the agent hands in.
- A mode outside the kit's `components/base/` gets its list, the commands it lists and its throwaway folders,
  only while a trust record names that exact list (ADR 20, ADR 21). Trust does not stop an agent that has the
  owner's shell, runs `bay approve` in a pseudo-terminal, or quotes words the owner did not write: see What the
  hook does not stop in `adapters/claude-code/README.md`, and the Trust row of CONTEXT.md.
- The requirements mode checks a requirements file, and forge reads one only through `requirements.check`
  (ADR 25). From it forge makes a design and a plan, then builds waves of slices by a test writer, a builder who
  never has the tests, proof by script and a reviewer, each ending in a card the owner answers (ADR 24 to 28).

## What it guards against, and what it does not

agentbay is built to limit what an agent's mistakes and overreach can do, what instructions hidden in data an
agent reads can make it do, and what a mode can reach beyond what it declares. It does not guard against the
owner, nor against an agent that has the owner's shell or speaks for him in chat: such an agent can write any
file the kernel reads, run `bay` in a pseudo-terminal, and run any command itself (`docs/designs/trust/0-frame.md`,
"Who can write what today"). Nor does it guard against code once it runs: a listed command that runs code runs
whatever an agent wrote, and the checks and tests proof runs in a throwaway copy run unconfined: the copy limits
where they write by convention only. A script's confinement in its child process is a seat belt, not a wall (ADR 5), and
the hook is defence in depth, not isolation.

An answer from chat is weaker than one from a terminal. With `approvals.from` listing chat, the kernel takes the
words the coordinator quotes, bound by the hash to what was shown, and cannot tell them from words the owner did
not write. A terminal answer needs an interactive terminal and a typed yes, which a pseudo-terminal also passes.

## Where each part is decided and described

| Part | Decided in | Designs | Described where it is built |
|---|---|---|---|
| The kit's ground rules: TypeScript, no model in the kernel, grants and effects, the toolbox, slices, one place for each thing | ADR 1 to 9, 11 | | `framework/practices.md`, `framework/features.yaml` |
| Runs: the engine, waits, resume, undo, budgets, cards, replay of time and random values | ADR 10 | `docs/designs/runs/` | the README sections on kept packed outputs, side by side items, time and random values, and testing a part of a workflow |
| Manifests: loading modes, bindings, discovery | ADR 12, 13 | `docs/designs/manifests/` | `schemas/`, `bay actions`, `bay config` |
| The broker: operations, rulings, listed commands | ADR 17, 19 | `docs/designs/operations/` | the README's Safety paragraph |
| Trust in a project's mode | ADR 20, 21 | `docs/designs/trust/` | the README's Safety paragraph; the trust card (`bay approve --trust <mode>`) |
| The Claude Code adapter and its hook | ADR 27 | | `adapters/claude-code/README.md` |
| Proof | ADR 15, 22 | `docs/designs/proof/` | `components/base/proof/README.md` |
| A toolchain in any project | ADR 23 | | `components/base/typescript/README.md` |
| Forge | ADR 14, 16, 18, 24 to 28 | `docs/designs/forge/`, `docs/designs/forge-whole/` | `components/base/forge/README.md`, `docs/plans/README.md` |
| Requirements | ADR 25 | `docs/designs/pm-mode/` (the PM mode is designed, not built) | `components/base/requirements/README.md` |
| The store and the briefing | | | `components/base/store/README.md`, `components/modes/feed-briefing/README.md` |

ADRs, dated plans, briefs and research notes are history: each says what was true on its date. The newest notes of
what was built are at the end of `docs/plans/0024-forge-whole.md`.
