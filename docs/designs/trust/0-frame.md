# Design frame: the owner's trust in a mode that lists commands

ADR 20, item 1, decided that a mode outside the kit's `components/base/` may list commands and name throwaway
folders when the project's owner trusts it by name. It did not decide how the trust is given, where it is kept or
how the kernel defends it. Three designs follow (`A-smallest.md`, `B-owner.md`, `C-defence.md`) and `comparison.md`
weighs them. This frame is what all three are held to. Read on `tr/trust-designs` at `7157252`.

## The problem, with evidence

- Today the place decides. `isBaseMode` (`bay/policy.ts:241-243`) is the whole rule. Any other mode that lists a
  command or names a throwaway folder gets a problem (`policy.ts:245-257`, `:285-297`), and one problem fails the
  load of the whole project (`bay/manifests/grants.ts:25-31`). A project cannot have a toolchain of its own
  (`docs/designs/forge/toolchain-open-questions.md`, item 1).
- `bay check` shows commands only for base modes, as warnings (`bay/check.ts:32-51`).
- The kernel has one way for the owner to say yes: an approval of a run's step, bound to the hash of what was
  shown (`bay/runs/scrubbed-store.ts:13`, `bay/json.ts:42-44`, `bay/runs/engine.ts:184-190`). `bay approve` asks
  for an interactive terminal (`bay/commands/approve.ts:54-69`) or takes the owner's quoted words from chat when
  `approvals.from` lists chat (`approve.ts:40-42`, `:84-85`).
- Two limits are at their ceiling. `cli_commands` is 13 and `bay/commands.ts:15-29` has 13; two of them, `auth`
  and `import-v4`, are not built (`bay/commands/not-built.ts:9-25`). `concepts` is 5 and counts schema files
  (`bay/check-limits.ts:49-51`); there are five.
- ADR 20 item 4, the words every command of a mode starts with, is decided and not built: `ListedCommand` is
  `{ run, effects }` (`bay/generated/mode.ts:20`).

## Who can write what today

| Writer | Can write | Stopped by | Not stopped |
|---|---|---|---|
| (a) A mode's script, through the broker | Its write paths only (`broker/file-operations.ts:81-85`, `file-access.ts:76-93`); the child has write access to nothing else (`script-runner.ts:71-81`) | No mode may name `.agentbay/`, `.git/`, the kernel folders, another mode's folder or its own `mode.yaml`, `scripts/`, `skills/` (`policy.ts:57-67`, `:86-132`) | `agentbay.config.yaml` is not in that list. A mode that names it under `resources.files.write` is granted it (tried: `grantsOf` returns it in `writePaths`). A listed command is unconfined and writes anything the owner can |
| (b) An agent in a skill step | Kernel tool `files_write`: as (a) (`bay/tools.ts:78-90`). Harness file tools: its roots only. Shell: the listed commands its action's effects cover, plus plain arguments (`guard-commands.ts:3`, `:14-33`) | `.agentbay`, `.claude`, `.git`, `.mcp.json`, `CLAUDE.md`, `agentbay.config.yaml`, `.env*` are closed to every step (`adapters/claude-code/guard-input.ts:1-10`); so is the kit when the project is not the kit (`guard-paths.ts:125-130`) | A listed command that runs code runs what the agent wrote (adapter `README.md:33`). If the hook cannot run, calls pass (`README.md:35`). The commands a step may run are fixed when `bay build` writes `.agentbay/steps.json` (`bay/adapter.ts:51`) |
| (c) An agent in the owner's session, outside any run | Anything the owner can, through the shell. `Bash` is not checked for the main thread (`guard-decide.ts:98-101`) | `Write` and `Edit` into `.agentbay/`, `.claude/`, `.mcp.json` and the kit's `bay/`, `schemas/`, `adapters/`, `framework/` (`guard-decide.ts:45`, `:92-96`) | `Edit` of `agentbay.config.yaml`, by owner decision (`README.md:32`). `Edit` of any `mode.yaml`. `Write` into the kit's `components/base/`, which makes a mode trusted by place. `echo > .agentbay/x` (`README.md:31`) |
| (d) A mode installed from elsewhere (after 5.0.0) | At run time, as (a) and (b). At install, whatever the installer copies | Nothing yet: install is not built (ADR 14) | Its own `mode.yaml` and scripts are its author's |
| (e) The owner at a terminal | Everything | Nothing, by design | |

Three things follow for every design. One: (c) cannot be prevented from forging trust. An agent with the owner's
shell can write any file the kernel reads, can run `bay` inside a pseudo-terminal, and can edit the kernel. It can
also run any command directly, so forged trust gives it nothing in that session. What forged trust gives is that
confined steps stop being confined later. A design can make that need a deliberate act no ordinary tool performs,
and can make it show afterwards. It cannot make it impossible. Two: a command that runs code, once trusted, can
write anywhere, so trust in one mode is trust in what that mode's commands execute. Three: the tool server loads
the kernel once for a whole session (`bay/mcp.ts:26-33`), so a decision taken at load is as old as the session.

## What must stay true

From `docs/designs/operations/0-frame.md`: S1, every operation passes through one rule. S3, nothing is allowed that
the manifest does not declare. S4, a refusal is a sentence with what was asked, what is declared and what to
change. S5, a guarded operation that matters is recorded as an event. S7, data from outside is parsed once, at the
edge. From ADR 13: `bay check` and a load come from one inspection and cannot disagree. From ADR 20:

- T1. The trust names the mode and is bound to the exact commands and throwaway folders it lists.
- T2. A change to that list is not trusted until the owner approves again. Until then none of the list is granted.
- T3. Nothing an agent's step can do gives, widens or renews trust: not a file write, not a command, not a tool.
- T4. `bay check` shows every trusted mode with each command and its effects, and reports a mode that lists
  commands without trust or whose list changed since it was trusted.
- T5. A mode under the kit's `components/base/` is trusted as before, with no entry.

No design may weaken these. A design that trades something away says so in a section of its own.

## Fixed for all three designs

- Two words are proposed for `CONTEXT.md`. **Trust**: the owner's statement that one named mode outside the kit's
  base folder may have its list, bound to that exact list. Do not say: allow-list, permission. **List** (a mode's):
  its listed commands and its throwaway folders, taken together. An approval stays a step of a run.
- Every mode outside `components/base/` needs trust, a kit mode under `components/modes/` included.
- The list is hashed with `hashOf` (`bay/json.ts:42`) over the mode's name, each command's name, the words it
  runs and its sorted effects, and the normalized throwaway folders, commands sorted by name. The words are the
  resolved ones: the shared starting words of ADR 20 item 4 followed by the command's own, split as
  `policy.ts:280` splits them. Layout of the YAML and the order of commands do not change the hash.
- The example is a project mode `go-toolchain` in `components/modes/go-toolchain/`. It lists `vet` (`go vet ./...`,
  read), `build` (`go build ./...`, read and write) and `run-tests` (`go test -json`, read, write, network), and
  the throwaway folder `.forge/go-cache/`. Later `run-tests` gains `-race` and a command `bench` is added. The
  hashes shown, `c1df0989…` and `25f7aeaa…`, are example values.
- `agentbay.config.yaml` joins the paths no mode may name. This closes the gap in row (a) whatever is chosen.

## Questions every design must answer

1. What does the owner type and read to trust a mode, to trust it again after its list changed, and to withdraw?
2. What data is kept, in what shape, where, and who may write it?
3. How does `grantsOfMode` decide, and what does a mode without trust get: no load, or a load without its list?
4. What do `bay check` and a refused run say, literally?
5. What does the binding cover beyond the list? Are the mode's scripts covered, and why?
6. What does forge do with a mode it is building that is not yet trusted? Where can its tests run its commands?
7. What does a clone on another machine, or another person's checkout, see?
8. In what order is it built, in slices with write scopes (P-33, P-34, P-35), and what is deleted?

## How the designs are compared

| # | Criterion |
|---|---|
| 1 | What the owner types to trust a mode the first time, and after its commands change |
| 2 | What the owner reads when asked |
| 3 | What an agent in each of (a) to (d) would have to do to forge or widen trust, and what stops it |
| 4 | What `bay check` says and what a refused run says |
| 5 | Where the trust lives, and what a clone on another machine or another person's checkout sees |
| 6 | What happens to a run in flight when trust is withdrawn or the list changes |
| 7 | How a builder's work in a worktree or a throwaway copy is treated: can a mode's tests run its commands before the owner has trusted it, and where |
| 8 | The number of new concepts |
| 9 | Files and features touched |
| 10 | Whether it fits the limit of 13 command-line commands, and of 5 schema files |
