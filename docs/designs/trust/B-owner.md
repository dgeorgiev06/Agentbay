# Trust in a mode's list: design B, from the owner's seat

Constraint: start at the moment the owner is asked. Decide what he must see and say in one screen, on a phone or
at a terminal, the first time and when a list changes. The inside follows from that screen.

The idea in one paragraph. The owner is shown a card that the kernel writes: the mode, each command with its words
and effects, the throwaway folders, and, when a list changed, only what changed. He answers the card the way he
answers an approval: `yes` at a terminal, or his own words in chat when he has allowed chat. To show a difference
the kernel must remember the list he trusted, so it keeps the list itself, with when and how he trusted it, in its
own folder `.agentbay/`. A mode without trust does not stop the project. It loads without its list, and a step
that asks for one of its commands is refused with a sentence that says how to decide.

## 1. The moment he is asked

Three places lead to the same card.

- `bay check`, which the coordinator runs at the start of a session (`coordinator.ts:37`), reports a mode that
  waits for trust (section 5).
- A refused run names the mode and the command to decide with (section 5).
- Forge's merge card says that a slice adds or changes a list. It does not show the list: a card about trust is
  written by the kernel and by nothing else (section 8).

## 2. What the owner reads and types

The card is at most 44 columns wide, so it fits a phone. `bay approve --trust go-toolchain` prints it.

**The first time, at a terminal.**

```
$ bay approve --trust go-toolchain
Trust the mode go-toolchain?
  components/modes/go-toolchain

It lists 3 commands. Each runs unconfined.
  build      go build ./...
             read, write
  run-tests  go test -json
             read, write, network
  vet        go vet ./...
             read
It names 1 throwaway folder. The kernel
makes and removes folders there.
  .forge/go-cache

The effects are the mode's own claim.
Its scripts choose the arguments.
You trust exactly this list. Any change
to it asks you again.

hash c1df09894b3d
Type yes to trust it: yes
go-toolchain is trusted: 3 commands, 1 throwaway folder. Run bay build so its skill steps get the commands.
```

The owner types one command and `yes`. He types no hash: the kernel records the hash of what it has just printed.

**The first time, on a phone.** The coordinator runs the same command. Its shell is not a terminal, so the kernel
prints the card, changes nothing, and adds:

```
Nothing changed. Trust is the owner's to give: at a terminal, or, if agentbay.config.yaml lists chat under approvals.from, with --hash c1df09894b3d7705f88eafffec3df64f0eb7bffc371132cde647a9e2b89fee8d --via chat --quote "<the owner's exact words>".
```

The coordinator shows the owner the card. The owner writes, for example, `yes, trust go-toolchain`. The
coordinator runs:

```
bay approve --trust go-toolchain --hash c1df0989…fee8d --via chat --quote "yes, trust go-toolchain"
```

The kernel accepts it only when `approvals.from` lists chat, the hash is the hash of the list the mode has at that
moment, and the quote contains the mode's name. It records the quote.

**After the list changed.** The card shows the difference and one line for what stayed.

```
$ bay approve --trust go-toolchain
The mode go-toolchain changed its list.
You trusted it on 2026-11-17, at the
terminal. None of it runs until you decide.

  + bench      go test -bench .
               read, write
  ~ run-tests  go test -json -race
        was    go test -json
               read, write, network
  = as before: build, vet,
    folder .forge/go-cache

2 of its script files changed as well.

hash 25f7aeaa1dd5
Type yes to trust the new list: yes
go-toolchain is trusted: 4 commands, 1 throwaway folder. Run bay build so its skill steps get the commands.
```

**Withdrawing.**

```
$ bay approve --trust go-toolchain --reject
Withdraw trust from the mode go-toolchain?
Its 4 commands and 1 throwaway folder stop
being granted. A run that needs them is
refused until you trust the mode again.
Type yes to withdraw: yes
Trust withdrawn from go-toolchain. Run bay build so its skill steps lose the commands.
```

`--reject` on a card he has not accepted records nothing and prints "go-toolchain stays without trust."

## 3. The data kept

One file, `.agentbay/trust.json`, created for the owner only, as `kernel.db` is (`bay/owner-only.ts:14-22`).

```ts
export type ModeList = {
  readonly mode: string;
  readonly commands: readonly GrantedCommand[];
  readonly throwaway: readonly string[];
};

export type TrustGiven = {
  readonly list: ModeList;
  readonly scripts: string;
  readonly at: string;
  readonly by: string;
};

export type TrustFile = {
  readonly version: 1;
  readonly modes: Readonly<Record<string, TrustGiven>>;
};
```

`by` is `owner at the terminal` or `owner via chat, quoted: "…"`, the words `bay approve` already records
(`approve.ts:84-85`). `scripts` is a fingerprint of the mode's code on the day of trust (section 6). The file is
read once, at the edge, by a guard written by hand (P-06); a file that does not parse trusts nothing and is an
error in `bay check`. No schema file is added, so `concepts` stays 5. That is honest only because nobody writes
this file by hand: if the owner were meant to edit it, it would need a schema.

Who may write it: the handler of `bay approve --trust`, through the file port, and nothing else in the kernel. No
mode may name `.agentbay/` (`policy.ts:57-60`). The name is closed to every step (`guard-input.ts:2`) and to the
session agent's `Write` and `Edit` (`guard-decide.ts:45`).

## 4. How the kernel decides

Manifests reads the file while loading and hands each mode's entry to the grant rule. `ModeGrants` gains one
field, so that the broker and `bay check` can say why a list is not in force.

```ts
export type ListTrust =
  | { readonly state: "not needed" }
  | { readonly state: "trusted"; readonly given: TrustGiven }
  | { readonly state: "never trusted"; readonly list: ModeList }
  | { readonly state: "changed"; readonly list: ModeList; readonly given: TrustGiven };

function listTrustOf(request: GrantRequest): ListTrust {
  const list = listOf(request.manifest);
  const listsNothing = list.commands.length === 0 && list.throwaway.length === 0;
  if (isBaseMode(request) || listsNothing) {
    return { state: "not needed" };
  }
  const given = request.given;
  if (given === undefined) {
    return { state: "never trusted", list };
  }
  return hashOf(given.list) === hashOf(list) ? { state: "trusted", given } : { state: "changed", list, given };
}

function grantsOfMode(request: GrantRequest): ModeGrants {
  const { manifest, folder, layout } = request;
  const declared = declaredResources(manifest);
  const writePaths = projectPaths(layout, declared.write);
  const listTrust = listTrustOf(request);
  const inForce = listTrust.state === "not needed" || listTrust.state === "trusted";
  return {
    mode: manifest.name,
    modeFolder: folder,
    databaseFile: pathIn(layout, "project", join(".agentbay", "data", `${manifest.name}.db`)),
    migrationsFolder: join(folder, normalized(declared.migrations)),
    readPaths: [folder, ...projectPaths(layout, declared.read), ...writePaths],
    writePaths,
    throwawayPaths: inForce ? projectPaths(layout, declared.throwaway) : [],
    secrets: [...declared.secrets],
    hosts: [...declared.hosts],
    commands: inForce ? grantedCommands(declared) : [],
    listTrust,
  };
}
```

`listOf` is the function of design A. `commandProblems` and `throwawayPlaceProblems` are deleted and nothing
replaces them among the problems: a list without trust is not a fault in the project, it is a question for the
owner. The project loads. Everything that reads `grants.commands` already does the right thing with an empty
list: the broker's lookup (`command-operations.ts:50-53`), the commands a step is given (`broker.ts:39-47`) and the
folders the kernel will make or remove.

## 5. What `bay check` and a refused run say

A mode that waits, the first time and after a change. Both are warnings: the project is sound.

```
components/modes/go-toolchain/mode.yaml:9: warning: Mode go-toolchain lists 3 commands and 1 throwaway folder, and the owner has not trusted it, so none of them is granted.
  fix: The owner reads the list and decides: bay approve --trust go-toolchain
components/modes/go-toolchain/mode.yaml:9: warning: Mode go-toolchain changed its list since the owner trusted it on 2026-11-17 (1 command added, 1 changed), so none of it is granted.
  fix: The owner reads what changed and decides: bay approve --trust go-toolchain
```

A trusted mode: one line per command, as base modes have today (`check.ts:32-51`), and one for a mode whose
scripts changed.

```
components/modes/go-toolchain/mode.yaml:11: warning: Mode go-toolchain, trusted on 2026-11-17 by the owner at the terminal, lists the command build, which runs go build ./... and which the mode says has the effects: read, write; a listed command can run code the agent wrote.
  fix: Withdraw with bay approve --trust go-toolchain --reject unless the mode cannot work without the command. The kernel believes the effects a mode lists and cannot check them.
components/modes/go-toolchain/mode.yaml:1: warning: 2 script files of mode go-toolchain changed since the owner trusted its list on 2026-11-17: scripts/run-tests.ts, scripts/check.ts. The list did not change, so the trust stands; the scripts choose the arguments of its commands.
  fix: Read the changes. To record that you have, decide again: bay approve --trust go-toolchain
```

A refused run. The step's script gets the broker's refusal, in the usual three parts (`answers.ts:36-43`):

```
The step 0 of action check asked to run the listed command vet with ["./..."] in ., but the owner has not trusted the list of mode go-toolchain, so none of its commands is granted. The owner decides with: bay approve --trust go-toolchain
```

After a change the middle part reads "but mode go-toolchain changed its list since the owner trusted it on
2026-11-17, so none of its commands is granted". A request to make or remove a folder in a throwaway folder is
refused in the same words with "throwaway folders" for "commands".

## 6. What the binding covers

Trust is bound to the list, as the frame fixes it: the mode's name, each command's name, resolved words and
effects, and the throwaway folders. Because the trusted list is kept whole, the kernel compares the two lists'
hashes and shows the two lists' difference from the same data.

The scripts are recorded and reported, and they do not bind. The fingerprint is the hash of the sorted pairs of
path and content hash for every file in the mode's folder outside `tests/`, without `mode.yaml`. It is computed
when trust is given and when `bay check` runs, never at a load.

- Why they do not bind. ADR 20 binds the list. From the owner's seat, a question that comes with every edit of a
  script is a question he learns to answer without reading. A question that comes only when the list changes
  stays rare enough to be read.
- Why they are reported. A changed script can pass different arguments to a trusted command. The owner should be
  told, in the place he already looks, and be able to say "seen" with the same command.

## 7. Who can forge or widen it

| Writer | What it would have to do | What stops it |
|---|---|---|
| (a) script | Write `.agentbay/trust.json` | No mode may name `.agentbay/` (`policy.ts:57-60`); the child has no write access there. A trusted command that runs code can write the file: not stopped |
| (b) step | Write the file, or run `bay approve` | The name is closed to every step; `files_write` is the broker; `bay` is not a listed command. A listed command that runs code is not stopped |
| (c) session agent | Write the file from the shell; or run `bay approve --trust` in a pseudo-terminal and answer `yes`; or, with chat allowed, quote words the owner did not write | `Write` and `Edit` are denied (`guard-decide.ts:45`). The plain command is refused: its shell is not a terminal. The rest is a deliberate act against the coordinator's instructions (`coordinator.ts:52`), and nothing prevents it |
| (d) installed mode | Arrive with a list, or change it in an update | The list is not in force until the owner accepts the card. An update shows as a difference. An installer copies nothing into `.agentbay/` |

What still means something in (c): no file tool and no plain command gives trust, so it cannot happen by mistake
or by an instruction slipped into a file the agent reads and follows carelessly. Every trust shows in each
`bay check` with its date and its channel, the quoted words included. That record is in a file the same agent can
rewrite, and it is not in git, so it is weaker evidence than design A's tracked line.

## 8. What forge does, worktrees and tests

- `.agentbay/` is not tracked (`.gitignore:2`), so a worktree has no trust file. Every list outside the base
  folder is without trust there. The worktree's project still loads, and every action that needs no command works.
- A mode's tests run its commands in the temporary project the test toolbox makes. `ProjectOptions` gains
  `trusted?: readonly string[]`; the toolbox writes that project's trust file through the same function the
  handler uses, with `by: "a test"`. The owner's project is never touched.
- Forge merges a slice whose mode is not yet trusted. The project keeps loading and forge keeps working. The merge
  card names the mode and says: "After the merge, go-toolchain waits for your trust: bay approve --trust
  go-toolchain". The merge approval does not give trust. A merge card is written by forge, which is a mode; if its
  approval gave trust, a mode's script would decide what the owner was shown.
- Until the owner decides, forge cannot use that toolchain in the project. It says so and goes on with other work.

## 9. A clone, and another person's checkout

Nothing is trusted. `.agentbay/` does not travel. `bay check` lists each mode that waits, and the owner of that
checkout sees the first-time card for each. Under B trust belongs to one person's checkout on one machine.

## 10. A run in flight

- After a withdrawal or a change, the next load grants the mode nothing from its list. A step that asks for a
  command gets the refusal of section 5; its action fails with that sentence and the run is recorded as failed.
  The owner decides and calls again. Other modes, and this mode's actions that run no command, go on.
- A script step that is running holds its grants and finishes with them.
- A harness session that started earlier keeps the system its tool server loaded (`bay/mcp.ts:26-33`), and its
  steps keep the commands in `.agentbay/steps.json`, until the session ends or `bay build` runs. The handler says
  "Run bay build" for that reason. B does not shorten this further.

## 11. Migration, as slices

| # | Slice | Kind and write scope | After |
|---|---|---|---|
| 1 | The interface. `ModeList`, `TrustGiven`, `ListTrust`, `ModeGrants.listTrust`; `listOf`, `listTrustOf`; the file's guard and the two pure functions that add and remove an entry; manifests reads the file and passes `given`; the config joins the paths no mode may name. A test at `loadSystem`: with trust the list is granted, without it the project loads and the list is empty | Capability, safety: `bay/contracts.ts`, `bay/policy.ts`, a private `bay/trust.ts`, `bay/manifests/grants.ts`, `loaded.ts`, `framework/features.yaml`, tests, `CONTEXT.md` | - |
| 2 | The broker's two refusals for a list not in force | Capability, broker: `bay/broker/command-operations.ts`, `file-operations.ts`, tests | 1 |
| 3 | `bay approve --trust`: the card, both channels, writing the file | Capability, command-line: `bay/commands/approve.ts`, a private `bay/trust-card.ts`, tests | 1 |
| 4 | `bay check`: waiting modes, trusted modes, changed scripts | Capability, check: `bay/check.ts`, tests | 1 |
| 5 | The test toolbox's `trusted` option | `tests/test-toolbox.ts` and its test | 1 |
| 6 | The coordinator's block and the adapter's README | `adapters/claude-code/` | 3, for the command's words |

Slices 2 to 5 have disjoint scopes and form one wave after slice 1; slice 6 follows slice 3. The card of slice 3
is proven on the real thing (P-19): a terminal session and a chat session, each held once by the owner.

## 12. What is deleted

`commandProblems` and `throwawayPlaceProblems` (`policy.ts:245-257`, `:285-297`), the clause "only a mode under the
kit's components/base/ may list commands" in four sentences, and the tier filter of `checkBaseCommands`. Estimated
size: about 330 kernel lines added (the card and its difference are half), 25 removed.

## 13. What B trades away

B weakens no property that holds today. It makes three choices for the owner's ease that cost defence.

1. **Chat may give trust.** Only when the owner lists chat under `approvals.from`; without that, only a terminal.
   With it, the session agent can give trust by quoting words. This is the trust the owner already places in the
   coordinator for approvals, extended to something that lasts longer than one run. The coordinator may also edit
   `approvals.from` itself (adapter `README.md:32`). An owner who works from a phone has no other channel.
2. **The record is not in git.** It is quieter to live with and it leaves no trace outside the machine.
3. **A mode that waits is a warning, not an error.** The project keeps working, and a warning is easier to miss.

## 14. Risks, and what B does not do

- `bay approve` gains a second subject. The glossary says an approval is a step of a run. B keeps that meaning
  and adds one sentence: the command `bay approve` is how the owner answers an approval or gives trust. If that
  reads as two meanings for one word, the command needs a name of its own, and the limit of 13 has no room.
- A list of 20 commands, as git-worktrees has, does not fit one screen the first time. The shared starting words
  of ADR 20 item 4 are shown once, above the commands, which brings such a list to about 45 lines. A changed list
  shows only the difference and does fit.
- The fingerprint reads every file of a trusted mode on each `bay check`. Not measured.
- It does not make scripts bind, does not cover an action's effects, and does not close the kit's
  `components/base/` to the session agent (frame, row c).
- It does not record trust as an event of a run (S5): giving trust belongs to no run. The file is the record.
- Not verified: that a 44-column card survives the chat client the owner uses, and that the `yes` prompt reads
  well when the card is longer than the terminal.
