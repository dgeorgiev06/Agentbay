# Closed files in forge's work folders

Slice GW1. Read with `0-frame.md` here and `docs/designs/operations/0-frame.md`. Neither frame's properties may
weaken: S1 to S7, T1 to T5, and ADR 13 (`bay check` and the build come from one rule).

## The fault

Forge grants its steps `.forge/worktrees/` (`components/base/forge/mode.yaml`). The build-time rule
(`adapters/claude-code/root-scan.ts`, run by `bay build` and, through `granted-folders.ts`, by `bay check`) refuses a
granted folder that holds a closed entry. Every worktree forge cuts there holds a `.git` file, one line,
`gitdir: <project>/.git/worktrees/<name>`. So while a forge build runs, or after a stopped run leaves a work folder,
`bay check` reports one error per forge skill (10) and `bay build` refuses.

## What a forge worktree holds

`git worktree add` checks out tracked files only. Nothing in git-worktrees links or copies anything into a
worktree (it links ignored folders into its copies under `.forge/copies/`, which no step is granted).

| Entry | In this kit's worktree | In another project's worktree |
|---|---|---|
| `.git`, a pointer file | always, at its top | always, at its top |
| `agentbay.config.yaml` | the project's (tracked) and two fixtures under `tests/fixtures/` | when the project tracks its config, as it should |
| `CLAUDE.md` | no: ignored (`/CLAUDE.md`) | when the project tracks one, which is common |
| `.claude/`, `.mcp.json` | no: ignored | when the project tracks them |
| `.env`, `.env.*` | no: never tracked | when the project tracks one, such as `.env.example` |
| `.agentbay/` | no: ignored everywhere | no, unless a project tracks it |

A real `.env` reaches a worktree only if something writes it there after the cut: the owner, or a step's command.

## 1. What the rule protects, and by what

It is meant to stop a step from reading secrets, or rewriting agentbay's own control files or git's state, through
a folder it was granted.

- **The hook, when it is active.** It denies a step's `Read`, `Write` and `Edit` of any path with a closed segment
  at any depth below the project or the kit, whatever its roots (`closedNameIn`, `guard-paths.ts`), and a search
  over a folder whose tree holds a closed name. This holds at every call, for entries made after the build too.
  It is defence in depth, not isolation: a step whose mode lists a command that runs code is not confined by it.
- **The build-time rule.** It refuses to write agent files while a granted folder holds a closed entry. It sees the
  tree only when `bay check` or `bay build` runs. The broker does not refuse closed names at run time (pm-mode
  design 3.6), so for a script or a kernel file tool, a closed entry added after the build is not stopped.
- **Nothing, where the hook is not active.** The agent file lists tools, not paths. A builder there is not
  confined: its `Write` reaches the owner's real config and `.git/`. This kit runs `without-the-hook`.

## 2. Each entry, and whether a step touching it is a harm

- **The `.git` pointer.** Reading it gives a path, which the step's own task already holds. Writing it is a real
  harm. Forge's scripts run git in the worktree through worktrees@1, and git follows the pointer. Pointed at the
  owner's `.git`, the next `commit` acts on the owner's index and checked-out branch: `commit.ts` compares the head
  with the head of the branch git reports, which is then the owner's. Pointed at a folder the step wrote, git
  runs on a repository the step made, with a `config` of its own; git-worktrees overrides hooks, fsmonitor and
  signing in its command words, and nothing proves that is every setting that runs a program. Proof never sees
  it: the pointer is not a tracked path, so no changed path shows it. So the pointer's content must stay closed to a step's writes, and it is: the
  hook denies any path whose segment is `.git`.
- **A checked-out `agentbay.config.yaml` or `CLAUDE.md`.** A copy; nothing reads it as agentbay's own. Writing it
  changes the slice's diff: proof's `in-scope` kind reports a changed path outside the write scope, and the merge
  card shows it. If a slice's scope names it, the owner merges it knowingly. The hook denies a step either way.
- **A `.env` file.** Never put there by a cut. One written later may hold a real secret, and nothing tells it from
  a copy of a tracked `.env.example`.

## 3. Options

- **(a) Tell a worktree's pointer file from a `.git` folder.** The rule treats as not closed a regular file, not a
  link, named `.git`, whose whole text is `gitdir: <path>` with one optional newline, where `<path>` is
  `<project>/.git/worktrees/<one name>` by the project's real path, as git writes it. Anything else named `.git` stays
  closed, in the same sentence as today. The hook keeps denying every `.git` segment. Cost: one rule, an
  inspector for the entry's kind. Keeps every property. Leaves the checked-out config copy, and in other projects
  any tracked closed file, refusing as before.
- **(b) A manifest field naming throwaway work folders, exempt from the scan.** Lets through every closed entry
  in them, `.env` included, at build time; a new manifest field, so T1's list and the trust card grow. Widens.
- **(c) Forge's worktrees outside the project.** The grant still names a folder, and the scan would find the same
  copies there. Changes forge and git-worktrees, and helps only if that folder is not scanned: a widening too.
- **(d) Scan only at build time; run-time state under a mode's declared scratch is out of scope.** Same reach as
  (b) without a field, and `bay check` would then disagree with what the folder holds. Widens.

**Recommended: (a).** It is the smallest, and it relaxes nothing a step could do before: with the hook, a step
still cannot read or write the pointer; without the hook, a builder could already write it, and the owner's own
`.git/`. The broker's reach is unchanged: worktrees appear after the build, so the rule never saw them while a run
used them. The pointer to elsewhere stays closed, so a granted folder cannot carry a pointer the build accepts
to a git folder outside the project's own worktrees. A project that is itself a linked worktree keeps its forge
worktrees closed, since their pointers lead to the main repository's `.git/worktrees/`: closed, not widened.

## 4. The owner's decision

(a) needed no decision and was built first. It did not make `bay check` pass while a worktree is open: the
checked-out `agentbay.config.yaml` copies stayed closed, and three or four open worktrees of the kit (about 1,600
entries each) passed the scan's bound of 5,000 entries. On 22 November 2026 the owner was asked: "A forge work
folder is a full checkout, so it holds a copy of agentbay.config.yaml, which the closed-file rule forbids in any
folder granted to an agent. That makes bay check fail during every forge build. How should it be resolved?" He
chose "Allow tracked copies (Recommended)", put to him as: "Inside a work folder this project owns, a file git
already tracks is a copy and is allowed. Untracked files such as a real .env stay refused. The scope check and
your merge approval still catch any change to a copy."

## 5. The rule as built

One rule, `adapters/claude-code/root-scan.ts` with `worktree-copies.ts`, run by `bay build` and `bay check`.

- **A worktree of this project** is a folder, under a granted folder, whose `.git` is the pointer of (a): a
  regular file, one line `gitdir: <project's real path>/.git/worktrees/<one name>`. Any other folder is
  ordinary: a closed name in it refuses, as before.
- **Inside a worktree**, an entry whose path below the worktree has no closed segment passes. One with a closed
  segment passes only when it is a copy:
  - a regular file that git tracks at stage 0 with mode `100644` or `100755`, at that very path; or
  - a folder that holds such a file somewhere below it.
- **Never a copy**, tracked or not: any segment named `.git` other than the worktree's own pointer, so a nested
  repository or a worktree inside a worktree refuses; and `.env` or `.env.*`, except a name that ends in
  `.example`, `.sample` or `.template`, in any case. A project that commits its `.env` still has a secret in it.
- **Refused**, in the sentence of today ("the step … is granted …, which holds …"): an untracked file or an
  empty folder with a closed name (a real `.env`, an `agentbay.config.yaml` or `CLAUDE.md` written later,
  `.agentbay/`, `.claude/`, `.mcp.json`), a tracked link (mode `120000`), a tracked copy swapped on disk for a
  link, a conflicted entry, a submodule's folder, a pointer that leads elsewhere.
- **How "tracked" is known.** The rule asks git, through the kernel's process port, by an argument array with no
  shell: `git --git-dir=<the pointer's folder> --work-tree=<worktree> -c core.fsmonitor=false
  --no-optional-locks ls-files --stage -z`, with only `PATH` and no global or system git config, 30 seconds at
  most. Nothing from a mode reaches the words: the paths are the accepted pointer's and the worktree's. Git reads
  its own index (versions 2 to 4, split and sparse indexes, SHA-256); a parser here would be a second, weaker
  reader of a binary format. Git is asked once per worktree, and only when the worktree holds a closed name.
  When git does not answer whole and plainly (does not start, fails, times out, is stopped, an output cut short,
  a record not of the form `mode object stage<TAB>path`), every closed name in that worktree refuses.
- **The scan bound.** Each worktree of this project is walked with its own bound of 5,000 entries and 12 levels,
  counted from its top; an ordinary folder keeps the bound. Every entry is still looked at: `git ls-files` does
  not list names under `.git`, so it cannot stand in for the walk. The work grows with the number of worktrees,
  each a real checkout of this project.

## 6. What is allowed now, and what a step can still do

- `bay check` and `bay build` pass while forge's worktrees are open, with their tracked config, `CLAUDE.md`,
  `.claude/` and `.env.example` copies. They still refuse when one holds an untracked closed file.
- With the hook, nothing changes for a step: it is denied reading and writing every closed segment at any depth,
  the copies and the pointer included (`adapters/claude-code/tests/guard-decide.test.ts`). It is defence in depth,
  not isolation: a step whose mode lists a command that runs code is not confined by it.
- Where the hook is not active, as in this kit (`without-the-hook`), a builder step is not confined. Its file tools
  can read and write the copies, the pointer, the owner's real `agentbay.config.yaml`, `.git/` and any `.env` on
  the machine. A change to a tracked copy shows in the slice's diff, where proof's `in-scope` kind and the owner's
  merge card catch it; a change to the pointer, to an untracked file or to anything outside the worktree does not
  show there. The build-time rule sees only what is on disk when it runs.
- The broker still does not refuse closed names at run time (pm-mode design 3.6). A script of a mode granted a
  folder that holds a worktree can read a tracked copy through it, as it could read any file the folder held.
