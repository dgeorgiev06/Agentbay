# ADR 27: forge runs with the hook or without it, and the tests are the kernel's to keep either way

Status: accepted, 18 November 2026. Decided by the owner. Narrows ADR 26 item 2.

## Context

ADR 26 says the kernel refuses a skill step's output when the hook never saw its agent. The same evening the owner said: "Option to disable hooks and have non hook checks. Hooks are disable at my job." An organisation can limit Claude Code to the hooks it deploys itself, and can make its own settings the only source of permission rules, so a project can count on neither there.

## Decision

1. **A project setting says how forge runs: with the hook, or without.** Only the owner changes it. With the hook is the default, and there ADR 26 item 2 stands: an output the hook did not see is refused. Without the hook the kernel accepts a step's output, requires every control below, and every card says the run was made without the hook and names what stood in for it.
2. **The slice's tests are never readable files while a builder runs, in either way of running.** The test writer hands its tests in as data. The kernel keeps them packed, and unpacks them only inside proof's throwaway copy, at a time when no builder runs. The test writer and the reviewer are given the tests' text in their task; neither reads a folder for it. This replaces design B's second mode with a folder of its own as what keeps a builder from the tests; the hook, where it runs, is one more layer.
3. **A builder has no tool that runs a command**, by its agent's list of tools.
4. **After a build, proof checks for a leak**: the builder's code shares no long run of text with the tests, and a mark planted in the tests is not in the code.
5. **Each round the test writer may add cases** the builder has had no chance to see.
6. **Where a project's own permission rules apply**, a rule that denies reading where the kernel keeps the tests is added as a further layer.

## What is lost without the hook, and said on the card

- A wrong read or write is found after it happened, not stopped as it happens.
- A write outside the repository is not seen by forge at all; only the harness's own permission prompts stand there.
- The kernel cannot tell that an output came from the step's agent and not from the main session.

## Consequences

- Design A's keeping of the tests by time and design B's by place both give way to the kernel keeping them. The blended plan changes accordingly.
- The filter on what a failing case tells the builder (ADR 26 item 1) is the same in both ways of running.
