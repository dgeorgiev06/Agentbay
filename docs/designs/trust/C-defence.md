# Trust in a mode's list: design C, from the boundary inward

Constraint: start from each writer in the frame's table and make forging trust as hard as the platform allows.
Only then see what the owner has to do. Say of every measure what it stops and what gets round it, and build none
that only looks like defence.

The idea in one paragraph. Trust is given by one command, `bay trust`, which works only for a person at a terminal
and never through chat. The record is kept in the kernel's folder `.agentbay/`, which three guards already close.
It binds more than the list: the mode's code and the project's folder too, so a changed script or a copied
project ends it. The kernel compares at load and again at the moment a command runs, so an open session cannot
keep trust that was withdrawn. A skill step's shell is never given a project mode's commands. C prevents every
forgery that (a), (b) and (d) could attempt through anything the kernel or the hook rules on. It does not prevent
(c), and section 1 says exactly how far it gets.

## 1. Each writer, and what the platform allows

| Writer | The way in | Measure | What still gets round it |
|---|---|---|---|
| (a) script | Write the record or the config | The record is in `.agentbay/`, which no mode may name (`policy.ts:57-60`); the config joins that list; the child has no write access to either | Nothing through the broker |
| (a) a trusted mode's command | It is unconfined: write any file | None is possible. The command runs with the owner's file permissions | Everything. Trust in a command that runs code is trust in that code |
| (b) step, file tools and kernel tools | Write the record | Closed name for every step (`guard-input.ts:2`); `files_write` is the broker | Nothing, while the hook runs |
| (b) step, shell | Run a listed command with words of its own, or after trust was withdrawn | A step's shell is given base modes' commands only. A project mode's commands run from its scripts, which pass fixed arguments | A base mode's command that runs code, as today (adapter `README.md:33`) |
| (c) session agent, file tools | `Write` the record; or `Write` a mode into the kit's `components/base/` | `.agentbay/` is closed to them (`guard-decide.ts:45`). C also closes the whole kit to them when the project is not the kit, as it is closed to steps (`guard-paths.ts:125-130`) | When the project is the kit, `components/base/` stays open: builders work there |
| (c) session agent, `bay` | Run the command that gives trust | `bay trust` refuses unless stdin and stderr are terminals, reads the answer from the controlling terminal, and refuses in a shell the harness marks as an agent's. Chat never gives trust | A pseudo-terminal with the marker unset |
| (c) session agent, shell | `echo > .agentbay/trust.json`; edit the kernel | None is possible (adapter `README.md:31`) | Everything |
| (d) installed mode | Arrive trusted, or change after trust | Nothing an installer copies is read as trust. The binding covers the code, so an update of a script ends trust | Nothing, short of (a)'s command |
| any, later | Use trust that was withdrawn, in a session opened before | The broker compares again at each use (section 4) | A command already running finishes |

**What this amounts to for (c).** To forge trust the session agent must write a file from its shell, or wrap `bay
trust` in a pseudo-terminal and clear the marker, or edit the kernel. Each is a deliberate act of several steps.
No file tool does it, no plain command does it, and no sentence in a file the agent reads can make it happen as a
side effect of ordinary work. That is the whole of the defence, and it is a tripwire, not a wall. The agent has a
shell in that session anyway; what C protects is that confined steps stay confined afterwards.

**Considered and left out, because they would be theatre here.**

- A signature made with a key behind the owner's passphrase. The public key would sit on the same disk; whoever
  can write the record can replace the key and sign again. It adds a passphrase to lose and stops no writer above.
- A keyed checksum with the key in the macOS keychain or an environment secret. Any process of the owner reads the
  keychain with the command the kernel itself uses (`bay/secrets.ts:122-140`), and other platforms have no keychain
  (`bay/commands/secret.ts:16-23`). It would guard against a bug in a guard, not against a writer.
- A record owned by another user of the machine. The agent can still edit the kernel that reads it, unless the kit
  is locked away too. That is the container of ADR 5, not a file permission.
- A record in the owner's home folder. The hook does not look there, and a shell reaches it as easily.

One thing might be real and is not verified: a keychain item that asks for the login password on every read. It
exists on macOS only. It is listed in the comparison as something to try, and C does not rest on it.

## 2. What the owner types and reads

**The first time.** At a terminal on the machine that holds the project:

```
$ bay trust go-toolchain
Mode go-toolchain, in components/modes/go-toolchain, asks for your trust.

Commands, each run unconfined:
  build      go build ./...       read, write
  run-tests  go test -json        read, write, network
  vet        go vet ./...         read
Throwaway folders, where the kernel makes and removes folders:
  .forge/go-cache
Code that chooses the arguments: 4 files in scripts/, 1 in skills/.

The trust holds for this list, this code and this folder (/home/owner/realty). Any change to one of them
ends it. A skill step is not given these commands; the mode's scripts run them.

Type the mode's name to trust it: go-toolchain
Trusted: list c1df09894b3d, code 20f94de4f196, on 2026-11-17 14:02 at /dev/ttys003.
```

**After a change**, of the list or of the code:

```
$ bay trust go-toolchain
Mode go-toolchain is not what you trusted on 2026-11-17 14:02. Nothing of its list is granted.

Changed in the list:
  + bench      go test -bench .       read, write
  ~ run-tests  go test -json -race    was: go test -json
Changed in the code: scripts/run-tests.ts, scripts/check.ts
As before: build, vet, .forge/go-cache

Type the mode's name to trust it as it is now: go-toolchain
Trusted: list 25f7aeaa1dd5, code da8bd139c182, on 2026-11-19 09:40 at /dev/ttys001.
```

**Anywhere but a terminal**, the coordinator's shell included:

```
bay trust gives trust only to the owner at a terminal. This is not one: stdin is not a terminal, and CLAUDECODE marks the shell as an agent's. Nothing changed. Ask the owner to run: bay trust go-toolchain
```

**Withdrawing** needs no terminal and no confirmation, because it only narrows:

```
$ bay trust go-toolchain --withdraw
Trust withdrawn from go-toolchain. Its commands and throwaway folders are refused from now on, in sessions that are already open too.
```

## 3. The data kept

`.agentbay/trust.json`, created for the owner only (`bay/owner-only.ts:14-22`), read by a guard written by hand.

```ts
export type ModeList = {
  readonly mode: string;
  readonly commands: readonly GrantedCommand[];
  readonly throwaway: readonly string[];
};

export type ModeNow = {
  readonly list: ModeList;
  readonly code: Readonly<Record<string, string>>;
  readonly project: string;
};

export type TrustRecord = ModeNow & {
  readonly at: string;
  readonly terminal: string;
};

export type TrustFile = {
  readonly version: 1;
  readonly modes: Readonly<Record<string, TrustRecord>>;
};
```

`code` maps each file of the mode to the SHA-256 of its bytes. `project` is the real path of the project's
folder. Only the handler of `bay trust` writes the file. The kernel reaches it through a small port,
`TrustSource`, with two adapters: the file, which `bay` and the tool server use, and a test adapter that the test
toolbox passes. No kernel function gives trust except the handler.

## 4. How the kernel decides

Manifests gathers a `ModeNow` for each mode outside the base folder that lists something. Safety compares.

```ts
export type ListTrust =
  | { readonly state: "not needed" }
  | { readonly state: "trusted"; readonly record: TrustRecord }
  | { readonly state: "never trusted"; readonly now: ModeNow }
  | { readonly state: "changed"; readonly now: ModeNow; readonly record: TrustRecord };

export function listTrustOf(now: ModeNow, record: TrustRecord | undefined): ListTrust {
  if (record === undefined) {
    return { state: "never trusted", now };
  }
  const same =
    hashOf(record.list) === hashOf(now.list) &&
    hashOf(record.code) === hashOf(now.code) &&
    record.project === now.project;
  return same ? { state: "trusted", record } : { state: "changed", now, record };
}

function grantsOfMode(request: GrantRequest): ModeGrants {
  const declared = declaredResources(request.manifest);
  const listTrust = request.now === undefined ? notNeeded : listTrustOf(request.now, request.record);
  const inForce = listTrust.state === "not needed" || listTrust.state === "trusted";
  return {
    ...grantsBesideTheList(request, declared),
    throwawayPaths: inForce ? projectPaths(request.layout, declared.throwaway) : [],
    commands: inForce ? grantedCommands(declared) : [],
    listTrust,
  };
}
```

`request.now` is undefined for a base mode and for a mode that lists nothing. `grantsBesideTheList` is today's body
(`policy.ts:341-357`) without the two fields. The project loads without a list that is not in force.

The second comparison is in the broker. The rule of `commands.run` and of the three throwaway operations asks the
kernel for the mode's trust at that moment, which gathers `ModeNow` again and reads the record again:

```ts
const trust = await asking.trustNow();
if (trust.state === "never trusted" || trust.state === "changed") {
  return refusedWith(listNotInForce(request, asking, trust));
}
```

When it is trusted, the words that run are those of the list just compared, not of an older load. For a base mode
`trustNow` answers "not needed" without reading a file.

## 5. What `bay check` and a refused run say

A mode that waits is an error in C: a project with a list nobody has read is not sound, though it loads.

```
components/modes/go-toolchain/mode.yaml:9: error: Mode go-toolchain lists 3 commands and 1 throwaway folder, and the owner has not trusted it, so none of them is granted.
  fix: The owner runs, at a terminal: bay trust go-toolchain
components/modes/go-toolchain/mode.yaml:9: error: Mode go-toolchain is not what the owner trusted on 2026-11-17 14:02: 1 command added, 1 changed, 2 code files changed. None of its list is granted.
  fix: The owner runs, at a terminal: bay trust go-toolchain
components/modes/go-toolchain/mode.yaml:11: warning: Mode go-toolchain, trusted by the owner on 2026-11-17 14:02 at /dev/ttys003, lists the command build, which runs go build ./... and which the mode says has the effects: read, write; a listed command can run code the agent wrote.
  fix: Withdraw with bay trust go-toolchain --withdraw unless the mode cannot work without the command. The kernel believes the effects a mode lists and cannot check them.
```

A refused run, from the broker, in the usual three parts:

```
The step 0 of action check asked to run the listed command vet with ["./..."] in ., but mode go-toolchain is not what the owner trusted on 2026-11-17 14:02 (scripts/check.ts changed), so none of its commands is granted. The owner decides at a terminal with: bay trust go-toolchain
```

A step agent that tries a project mode's command in its shell is denied by the hook as any unlisted command is
(`guard-decide.ts:285-300`); the command is not in its policy.

## 6. What the binding covers

- The list, as the frame fixes it: names, resolved words with the shared starting words, effects, throwaway folders.
- The code: every file in the mode's folder outside `tests/`, `mode.yaml` included only through the list. Scripts
  are covered because a script chooses the arguments of a trusted command, and for `go test` the arguments choose
  which code runs. Skills are covered because they tell an agent what to ask the mode's actions for.
- The project's folder, so that a copy of the project, `.agentbay/` and all, is not trusted where it lands.

This goes beyond ADR 20, whose sentence binds the list. C asks the owner to widen it and says what it costs:
every edit of a script ends trust, so a mode under daily work asks often. The card names the changed files to keep
the question short. If the owner does not want this, C works with the list alone and loses its answer to (d).

## 7. What forge does, worktrees and tests

- A worktree has no `.agentbay/` (`.gitignore:2`), and a copied one names another folder. Nothing outside the base
  folder is trusted there. The worktree's project loads; `bay check` there reports the error of section 5.
- A mode's tests run its commands in the temporary project the test toolbox makes, inside the throwaway copy the
  toolchain is given (ADR 20, item 2). The toolbox passes the test adapter of `TrustSource`, naming the modes under
  test. The file adapter is never written by a test, and the owner's project is never touched.
- Forge merges the slice. The project loads, `bay check` has one error, and forge's merge card says: "go-toolchain
  waits for your trust. At a terminal: bay trust go-toolchain". Forge goes on with work that does not need the
  mode. It cannot give the trust and cannot carry the owner's word.

## 8. A clone, a moved project, a run in flight

- A clone on another machine, or another person's checkout: nothing is trusted. Each person trusts for himself.
- A project folder that was moved or restored from a copy: every mode shows as changed, "the folder was
  /home/owner/realty and is /home/owner/work/realty", and the owner trusts again.
- A run in flight: the next command after a withdrawal or a change is refused, in an open harness session too,
  because the broker compares at use. A command that is running finishes. Other modes go on.

## 9. Migration, as slices, and what is deleted

| # | Slice | Kind and write scope | After |
|---|---|---|---|
| 1 | The interface. The four types and `ListTrust`; `listTrustOf`; `ModeGrants.listTrust`; `TrustSource` with its file and test adapters; manifests gathers `ModeNow` and offers `trustNow`; the config joins the paths no mode may name. A test any implementation passes: trusted, never trusted, and one change each of list, code and folder | Capability, safety: `bay/contracts.ts`, `bay/policy.ts`, a private `bay/trust.ts`, `bay/ports.ts`, `bay/node-ports.ts`, `bay/manifests/grants.ts`, `loaded.ts`, a private `manifests/mode-code.ts`, `framework/features.yaml`, tests, `CONTEXT.md` | - |
| 2 | The broker compares at use; the refusals; a step's shell gets base commands only | Capability, broker: `bay/broker/`, one line of `bay/kernel.ts`, tests | 1 |
| 3 | `bay trust`: the card, the terminal rule, `--withdraw`; the harness interface gains the shell markers | Capability, command-line: a new `bay/commands/trust.ts`, `bay/commands.ts`, `bay/terminal.ts`, `bay/adapter.ts`, `framework/limits.yaml`, tests | 1 |
| 4 | `bay check`: the error, the trusted modes | Capability, check: `bay/check.ts`, tests | 1 |
| 5 | The test toolbox passes the test adapter | `tests/test-toolbox.ts` and its test | 1 |
| 6 | The adapter names its marker, closes the kit to the session agent's file tools when the project is not the kit, and tells the coordinator never to run `bay trust` | `adapters/claude-code/` | 3 |

Slices 2 to 5 have disjoint scopes and form one wave after slice 1; slice 6 follows slice 3. Deleted:
`commandProblems` and `throwawayPlaceProblems` (`policy.ts:245-297`), the clause "only a mode under the kit's
components/base/ may list commands" in four sentences, the tier filter of `checkBaseCommands`. Estimated size:
about 480 kernel lines added and 40 in the adapter, 25 removed.

## 10. What C costs

C trades away no security property. It trades the owner's ease, and one limit.

1. **A terminal, always.** The adapter's README says the owner has no terminal and works through the coordinator
   (`README.md:32`). Under C he must reach one to trust a mode. There is no setting that changes this.
2. **A 14th command.** `cli_commands` is 13. The owner raises it to 14, or gives `bay trust` the place of
   `import-v4`, which is not built (`not-built.ts:18-25`), or folds it into `bay approve --trust` under C's rules.
   The last keeps the limit and puts trust one flag away from the command the coordinator runs every day.
3. **More questions.** Trust ends with every change to the mode's code, and with a moved folder.
4. **Reads at every command.** The second comparison reads the manifest, the mode's files and the record each
   time a command runs. For a mode that runs twenty commands in one action that is twenty readings. Not measured.

## 11. Risks, and what C does not do

- It does not stop the session agent's shell, a trusted command that runs code, or an edit of the kernel.
- The terminal rule and the marker are tripwires. A pseudo-terminal with the marker unset passes both. The marker
  was seen set in a harness shell on the day of writing; the adapter's documentation was not checked for it.
- Reading the answer from the controlling terminal was not tried under the kit's terminal port
  (`bay/terminal.ts:28-34`), and Windows has no `/dev/tty`.
- When the project is the kit, `components/base/` is open to builders and a mode there is trusted by place (T5).
  C narrows the gap of the frame's row (c) only for projects beside the kit.
- A step of a project mode cannot run the mode's commands from its own shell. A mode that needs that must give the
  agent an action to call instead. No base mode loses anything.
- It does not cover an action's effects, which only choose among commands the owner has read.
- Giving trust is no event of a run (S5); the record holds the time and the terminal.
