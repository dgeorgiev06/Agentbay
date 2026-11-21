# A run that continues into another: slice KC1, proposed

A proposal; nothing here is built. The owner decides whether to build it (question 15 of `docs/designs/pm-mode/design.md`).

## The problem

An interview of the PM mode is one run of `ask` for each turn. After a turn, the next one should start without the coordinator typing a command, yet a run's output may not be what starts it. A review of a first try showed why: a mode's output named a `next` workflow and its input, and the coordinator's block told it to run that "at once".

- Nothing in the kernel checks such a field. Any mode's finished run can carry it: a script's output, a skill's handed-in output, an action called alone. A made-up mode with no commands named forge's plan workflow, and the run was done with it intact.
- The command put the mode's JSON inside single quotes in a shell command. A `'` in it breaks out, in the main session's shell, which nothing checks.

So the step was taken out. Today a turn's run says, in a sentence of its output, the command for the next turn; the coordinator runs it only when the owner asks.

## The safe form

1. **A workflow lists what it may continue into.** `continues:` names workflows of its own mode only. A load and `bay check` refuse any other name, a mode's or an interface's.
2. **Only after the owner answered.** A run may continue only when it had at least one approval the owner answered. A run of steps that asked him nothing ends as today.
3. **The input is checked.** The run's output names the input for the next run, and the kernel checks it against the target workflow's trigger schema before anything starts.
4. **A chain has an end.** A chain of runs that continue each other is at most N runs, a project setting; after N the kernel waits for the owner, a wait of reason `owner`.
5. **No mode's text reaches a shell.** `bay runs` prints a command that takes no JSON, such as `bay resume <runId> --continue`. The kernel reads the next run's workflow and input from its own record of the finished run.
6. **The coordinator's line** becomes: "When a done run prints a command to continue it, run the command it prints."

## What it costs

A field in the workflow schema and its load check; a check of the target's trigger; a counter on the chain; one form of `bay resume`; one line of the coordinator's block, for which the block's limit of 59 lines would be raised openly, with the reason, rather than lines joined to fit.
