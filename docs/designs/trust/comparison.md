# Trust in a mode's list: the three designs compared

Read `0-frame.md` first. This weighs `A-smallest.md`, `B-owner.md` and `C-defence.md` against its criteria and ends
with a recommendation: B as the base, without its chat channel, with two things from C.

## Where they agree

- Trust is a comparison of hashes made where grants are built (`bay/policy.ts`), with `hashOf` over the same list:
  the mode's name, each command's name, resolved words and effects, and the throwaway folders.
- `commandProblems` and `throwawayPlaceProblems` are deleted. A base mode needs no entry (T5). A changed list
  grants nothing until the owner decides again (T2).
- `agentbay.config.yaml` joins the paths no mode may name. A mode can be granted it today.
- A script, and a step's file tools and kernel tools, cannot give trust in any of the three (T3).
- None of the three stops the session agent's shell, or a trusted command that runs code. Each says so.
- A mode's tests run its commands in the temporary project the test toolbox makes, never in the owner's project.
- No schema file is added: `concepts` stays 5.

## Against the criteria

| # | Criterion | A, smallest | B, owner | C, defence |
|---|---|---|---|---|
| 1 | What the owner types, first time and after a change | Two lines in the config, with a 64-character hash; then a new hash. Or he tells the coordinator, which edits the file | `bay approve --trust <mode>` and `yes`; the same again. From chat, his own words, if he listed chat | `bay trust <mode>` and the mode's name, at a terminal only; the same again, also after a script changed |
| 2 | What he reads | One long `bay check` sentence with the whole list. After a change the whole new list; the difference is in git | A card 44 columns wide. After a change only the difference, and a count of changed scripts | A card with the list, the code and the folder. After a change the difference in list and files |
| 3a | To forge: (a) script | Write the config: refused after slice 1 | Write `.agentbay/`: refused | The same as B |
| 3b | (b) step | Closed name; broker | Closed name; broker | The same, and its shell never has a project mode's commands |
| 3c | (c) session agent | One `Edit`. Nothing stops it | A shell write, a pseudo-terminal, or with chat allowed a made-up quote | A shell write, or a pseudo-terminal with the marker unset. Chat never |
| 3d | (d) installed mode | Its list waits; a script update keeps trust | Its list waits; a script update is reported and keeps trust | Its list waits; a script update ends trust |
| 4 | `bay check` and a refused run | Error; the project does not load, so every call prints it | Warning; the project loads; the broker refuses the one command with a sentence | Error; the project loads; the broker refuses, and compares again at each use |
| 5 | Where it lives; a clone | Config, tracked. A clone and another person inherit it | `.agentbay/trust.json`, not tracked. A clone trusts nothing | The same file, also bound to the folder. A clone or a moved project trusts nothing |
| 6 | A run in flight | Every run of every mode stops at the next command until the owner edits the file | The mode's next command is refused; the rest goes on. An open session keeps old trust until `bay build` | The next command is refused, in an open session too |
| 7 | A worktree; tests | The worktree has the trust and cannot change it within scope; a changed list stops its load. Tests: the toolbox fills the config | The worktree trusts nothing and loads. Tests: the toolbox writes the temporary project's file | As B; the toolbox passes a test adapter and no file is written |
| 8 | New concepts | 2: trust, the list | 5: those, the card, the trust file, a second subject of `bay approve` | 8: those of B with a command of its own, and the code binding, the folder binding, the comparison at use, the shell marker |
| 9 | Files and features touched | 4 slices; safety, manifests, check, one sentence in broker, the adapter's text | 6 slices; those and vocabulary, command-line, the test toolbox | 6 slices; those and platform, the harness interface, the adapter's hook |
| 10 | The limits | 13 commands kept | 13 kept: `bay approve` gains a subject | 14, or `import-v4` gives up its place, or it folds into `bay approve` |
| | Size, estimated | +90 lines | +330 | +480, and 40 in the adapter |

## Where they truly differ

1. **Who can give trust with an ordinary tool.** In A the session agent can, with `Edit`. In B and C no file tool
   and no plain command can. This is the largest difference, and the reason A is not recommended.
2. **Whether the owner needs a terminal.** A: no. B: no, if he allows chat. C: always. The adapter's README says
   the owner has no terminal and works through the coordinator (`README.md:32`).
3. **Whether a mode without trust stops the project.** A: yes, every mode and forge with it. B and C: no.
4. **Whether trust travels.** A: with the repository, to anyone. B and C: it stays on one machine.
5. **What is bound.** A and B: the list. B reports changed scripts. C binds the code and the folder too.
6. **When the kernel compares.** A and B: at load. C: at load and at each use.
7. **What can be shown.** A keeps a hash and cannot show a difference. B and C keep the list and can.

## Questions where the owner would see a difference

**1. May your word in chat give trust, or only your hands at a terminal?**

- [ ] Chat too (A, B). You write "yes, trust go-toolchain"; the coordinator runs
  `bay approve --trust go-toolchain --hash c1df0989… --via chat --quote "yes, trust go-toolchain"`. An agent that
  invents the quote gives the trust.
- [x] A terminal only (C). In chat you would see: "bay trust gives trust only to the owner at a terminal. This is
  not one … Ask the owner to run: bay trust go-toolchain". You must reach the machine once per mode and per change.

**2. What do you type?**

- [ ] A: in `agentbay.config.yaml`, `trust:` and `go-toolchain: c1df09894b3d7705f88eafffec3df64f0eb7bffc371132cde647a9e2b89fee8d`.
- [x] B: `bay approve --trust go-toolchain`, then `yes`. Thirteen commands stay thirteen.
- [ ] C: `bay trust go-toolchain`, then `go-toolchain`. A fourteenth command, or `import-v4` gives up its place.

**3. Does a changed script end trust, or is it reported?**

- [ ] Nothing is said (A).
- [x] Reported (B): "warning: 2 script files of mode go-toolchain changed since the owner trusted its list on
  2026-11-17: scripts/run-tests.ts, scripts/check.ts. The list did not change, so the trust stands".
- [ ] It ends (C): "error: Mode go-toolchain is not what the owner trusted on 2026-11-17 14:02: 2 code files
  changed. None of its list is granted." You are asked after every edit of a script.

**4. What does a mode that waits do to the rest?**

- A: `bay call feed-briefing.sync '{}'` prints the error about go-toolchain and exits 1. Nothing runs.
- B, C: everything else runs. A step that needs the list is told: "… but the owner has not trusted the list of mode
  go-toolchain, so none of its commands is granted. The owner decides with: bay approve --trust go-toolchain".

**5. After the list changed, what do you read?**

- A: the whole new list in one sentence, and "No copy of the old list is kept; git shows what changed".
- B, C: `+ bench  go test -bench .` and `~ run-tests  go test -json -race   was: go test -json`, and what stayed.

## Recommendation

Build B, with one thing removed and two added from C.

1. **Remove the chat channel** (question 1). Trust is given at a terminal only, by the check `bay approve` has
   today (`approve.ts:54-69`), whatever `approvals.from` says. The reason: trust outlasts a run and turns confined
   steps into unconfined commands, and a setting in a file the coordinator may edit is no barrier. This is the
   one choice that costs the owner something real, so it is his to make. If he chooses chat, B stands as written.
2. **From C, the comparison at use, in its cheap form.** Before a command runs, the broker reads the record again
   and compares it with the list it loaded. If they differ, it refuses. The words that run are then always words
   the record holds at that moment, and a withdrawal reaches an open session. It costs one small file read per
   command and none of C's reading of the mode's code.
3. **From C, a step's shell gets base modes' commands only.** A project mode's commands run from its scripts. This
   removes the stale `.agentbay/steps.json` from the picture and keeps an agent from choosing the arguments.

Also, on its own and whatever is chosen: close the kit to the session agent's file tools when the project is not
the kit. Today it can write a mode into the kit's `components/base/`, where no trust is asked (frame, row c).

Not taken from C: the binding of code and folder. ADR 20 binds the list, and a question after every script edit
will stop being read. B's report is enough until modes are installed from elsewhere (ADR 14); binding the code of
an installed mode belongs to that design. Not taken: a command of its own, since the limit is full and
`bay approve --trust` under a terminal-only rule is as hard to misuse. Not taken from A: the tracked line. It is
the best evidence of the three against a forgery, and it comes with the file any agent may edit.

Why B as the base and not A: A is a third of the size, but it fails T3 in spirit for the session agent, stops the
whole project for one waiting mode, cannot show a difference, and lets trust travel to strangers. Why not C whole:
its extra bindings ask the owner more often without stopping any writer that B with these additions lets through.

## What I am unsure of, and what to try in code first

- **The terminal check.** In the harness shell this was written in, stdin is not a terminal, `CLAUDECODE` is set,
  and `script` and `python3` are installed, so a pseudo-terminal is within reach. I did not run `bay approve`
  under one. Try it, to know exactly what the tripwire is worth, before telling the owner what it stops.
- **A keychain item that asks for the login password on each read.** If macOS does this for the `security`
  command, a key behind it would be the first measure that stops the session agent. Not verified, and it would
  serve one platform. Try it on the owner's machine before the design is closed.
- **The shared starting words** (ADR 20, item 4) are not built. The hash is specified over resolved words; build
  item 4 first, or the first trusts are given to hashes that will change.
- **The card in the owner's chat client**, and a list of 20 commands on it. Try with git-worktrees' list.
- **Whether a warning is enough for a mode that waits.** If forge's proof treats `bay check` errors as failures,
  an error would block the merge that precedes the trust. I did not read forge's proof kinds; they are not built.
- **The cost of B's fingerprint** per `bay check`, and of the comparison at use per command. Not measured.
- **Line estimates** are within about a third. The slices' scopes were checked against `framework/features.yaml`
  by reading, not by the feature-map test.
- I did not run `npm run check`, as asked. One read-only probe was run: `grantsOf` grants a mode
  `agentbay.config.yaml` as a write path today.
