# Trust in a mode's list: design A, the smallest

Constraint: the least machinery. Use what exists: the project config, the grant rule, `bay check`. No new command,
no new file, no new schema file, no new store.

The idea in one paragraph. Trust is one line in `agentbay.config.yaml`: the mode's name and the hash of its list.
`bay check` prints the line to add. The grant rule computes the hash of the list the mode has now and compares it
with the line. Equal: the list is granted. Missing or different: the mode has a problem, as it has today, and the
problem says what to do. The owner gives trust by adding the line, renews it by changing the line and withdraws it
by deleting the line. The config is a tracked file, so every one of these is a change the owner can see in git.

## 1. What the owner types and reads

**The first time.** The owner, or forge's merge card, runs `bay check`. It prints:

```
components/modes/go-toolchain/mode.yaml:9: error: Mode go-toolchain lists 3 commands and 1 throwaway folder, and the owner has not trusted it. A listed command runs unconfined, and the kernel removes whole folders in a throwaway folder. The list: build runs "go build ./..." (read, write); run-tests runs "go test -json" (read, write, network); vet runs "go vet ./..." (read); throwaway folder .forge/go-cache.
  fix: Read the list. To trust exactly this list, the owner adds to agentbay.config.yaml:
    trust:
      go-toolchain: c1df09894b3d7705f88eafffec3df64f0eb7bffc371132cde647a9e2b89fee8d
```

The owner types those two lines into the config, in an editor. An owner without a terminal tells the coordinator
"trust go-toolchain", and the coordinator makes the edit, as it changes settings today (adapter `README.md:32`).

**After the list changed.** `bay check` prints:

```
components/modes/go-toolchain/mode.yaml:9: error: Mode go-toolchain changed its list since the owner trusted it, so none of it is in force. The list now: bench runs "go test -bench ." (read, write); build runs "go build ./..." (read, write); run-tests runs "go test -json -race" (read, write, network); vet runs "go vet ./..." (read); throwaway folder .forge/go-cache.
  fix: Read the list. No copy of the old list is kept; git shows what changed: git diff -- components/modes/go-toolchain/mode.yaml. To trust the new list, the owner changes the line under trust: in agentbay.config.yaml to:
      go-toolchain: 25f7aeaa1dd52491fd7539fc95e57f6e6d6f0dac351cc9612bca98eeb45f722b
```

The owner replaces the hash.

**Withdrawing.** The owner deletes the line. Nothing is printed for it; the next `bay check` prints the first
message again. A line left behind for a mode that is gone, or that no longer lists anything, is a warning:

```
agentbay.config.yaml:14: warning: trust: names go-toolchain, and no mode of that name lists commands or throwaway folders.
  fix: Remove the line.
```

## 2. The data kept

One optional key in the config. The schema text, added to `schemas/config.schema.json`:

```json
"trust": {
  "description": "Modes outside the kit's base folder that the owner trusts to list commands and name throwaway folders, as mode name: the hash bay check prints for the mode's list. Only the owner adds or changes a line.",
  "type": "object",
  "propertyNames": { "$ref": "#/$defs/name" },
  "additionalProperties": {
    "description": "The SHA-256 of the mode's list, as 64 lower-case hex characters.",
    "type": "string",
    "pattern": "^[0-9a-f]{64}$"
  }
}
```

The generated type gains `readonly trust?: Readonly<Record<string, string>>`. No schema file is added, so
`concepts` stays 5.

Where it lives: `agentbay.config.yaml`, in the project, tracked by git.

Who may write it:

- The owner, in an editor.
- The coordinator, on the owner's word. The main thread may `Edit` the config today (`guard-decide.ts:45` does not
  close it), by owner decision.
- No mode. Slice 1 adds the config to the paths no mode may name (`policy.ts:57-60`).
- No skill step. The name is closed to every step (`guard-input.ts:7`).

## 3. How the kernel decides

`GrantRequest` gains one field, which manifests fills from `config.trust`. The rule lives in `bay/policy.ts`, where
grants are built.

```ts
export type GrantRequest = {
  readonly manifest: Mode;
  readonly home: Home;
  readonly folder: string;
  readonly layout: Layout;
  readonly otherModes: readonly OtherMode[];
  readonly trustedHash: string | undefined;
};

export type ModeList = {
  readonly mode: string;
  readonly commands: readonly GrantedCommand[];
  readonly throwaway: readonly string[];
};

type ListTrust =
  | { readonly state: "not needed" }
  | { readonly state: "trusted" }
  | { readonly state: "never trusted"; readonly list: ModeList; readonly hash: string }
  | { readonly state: "changed"; readonly list: ModeList; readonly hash: string };

function listOf(manifest: Mode): ModeList {
  const declared = declaredResources(manifest);
  const commands = grantedCommands(declared)
    .map((command) => ({ ...command, effects: [...command.effects].sort() }))
    .sort((first, second) => first.name.localeCompare(second.name));
  return { mode: manifest.name, commands, throwaway: declared.throwaway.map(normalized).sort() };
}

function listTrustOf(request: GrantRequest): ListTrust {
  const list = listOf(request.manifest);
  const listsNothing = list.commands.length === 0 && list.throwaway.length === 0;
  if (isBaseMode(request) || listsNothing) {
    return { state: "not needed" };
  }
  const hash = hashOf(list);
  if (request.trustedHash === hash) {
    return { state: "trusted" };
  }
  return { state: request.trustedHash === undefined ? "never trusted" : "changed", list, hash };
}

function trustProblems(request: GrantRequest): readonly GrantProblem[] {
  const trust = listTrustOf(request);
  if (trust.state === "not needed" || trust.state === "trusted") {
    return [];
  }
  return [{ at: ["resources"], message: untrustedMessage(request, trust), fix: lineToAdd(request, trust) }];
}
```

`grantsOf` calls `trustProblems` where it calls `commandProblems` and `throwawayPlaceProblems` today
(`policy.ts:364`, `:366`). `grantsOfMode` (`policy.ts:341-357`) does not change by one line. It is reached only when
there is no problem, so it is reached only for a list that is trusted or needs no trust. That is the whole
decision: one comparison of two hashes, in the place that already decides.

A mode without trust is a problem, and a problem fails the load, as today. There is no half-loaded state and no
new field on `ModeGrants`. The cost is in section 9.

## 4. What `bay check` and a refused run say

The two errors and the warning of section 1 are the findings for a mode without trust. They come from the
inspection, so a load fails with the same sentences (ADR 13).

For a trusted mode, `bay check` shows each command as it shows a base mode's today (`check.ts:32-51`). The filter
changes from "tier is base" to "its list is in force", and the sentence names the trust:

```
components/modes/go-toolchain/mode.yaml:11: warning: Mode go-toolchain, which the owner trusts in agentbay.config.yaml, lists the command build, which runs go build ./... and which the mode says has the effects: read, write; a listed command can run code the agent wrote.
  fix: Remove go-toolchain from trust: in agentbay.config.yaml unless the mode cannot work without the command. The kernel believes the effects a mode lists and cannot check them.
components/modes/go-toolchain/mode.yaml:6: warning: Mode go-toolchain, which the owner trusts in agentbay.config.yaml, names the throwaway folder .forge/go-cache; the kernel makes folders and links there and removes whole folders for it.
  fix: Remove go-toolchain from trust: in agentbay.config.yaml unless the mode cannot work without the folder.
```

A refused run. `bay call go-toolchain.check '{"folder":"."}'` prints the error of section 1 and exits 1, because the
project does not load. So does every other `bay` command that needs the kernel, for every mode. The one refusal the
broker words for commands (`command-operations.ts:61-63`) loses its last clause, "only a mode under the kit's
components/base/ may list commands", and ends: "a mode outside the kit's base folder also needs the owner's trust;
bay check prints the line."

## 5. What the binding covers

The hash covers what the frame fixes: the mode's name, each command's name, resolved words and effects, and the
throwaway folders. The shared starting words of ADR 20 item 4 are inside the resolved words, so removing a
protection from them changes every command's words and the hash.

The mode's scripts are not covered. This is a choice, and it has a price.

- Why not. ADR 20 binds trust to the list. A script is edited far more often than a list. If every edit of a
  script withdrew trust, the owner would be asked many times a day while a mode is built, and would stop reading.
  A script is also confined: it reaches a command only by name and passes only the arguments that vary (ADR 19).
- The price. A trusted mode whose script changes can pass different arguments to the same commands. For
  `go test -json`, the arguments choose which code runs. The words in the list are the only fixed part. An author
  who wants a command to be safe under any argument ends its words with `--` or `--end-of-options`, as
  git-worktrees does, and the owner reads for that.

An action's effects are not covered either. They decide which listed commands an action may run, and they can
only choose among commands the owner has read.

## 6. Who can forge or widen it

| Writer | What it would have to do | What stops it |
|---|---|---|
| (a) script | Write the config | After slice 1, no mode may name the config, so the broker refuses and the child has no write access to it. A trusted command that runs code can still edit any file: not stopped |
| (b) step | Write the config with a file tool, or with `files_write` | The name is closed to every step (`guard-input.ts:7`); `files_write` is the broker, as (a). A listed command that runs code is not stopped |
| (c) session agent | One `Edit` of the config | Nothing. The coordinator's block gains the sentence it has for approvals (`coordinator.ts:58`): change `trust` only when the owner asks for exactly that. The change is a tracked diff |
| (d) installed mode | Arrive with a list | The list is not in force until the owner adds the line. An update that changes the list drops trust. An update that changes only scripts keeps it |

A defends against (a) and (b) as far as the broker and the hook do, and against (d) for the list. It does not
defend against (c) at all, and says so. What still means something in (c): the trust is a line in a tracked file,
so a forged line shows in `git diff`, in a pull request and on forge's merge card; and the hash binds the line to
one list, so an agent that later changes the list must forge again.

## 7. What forge does, worktrees and tests

- A worktree has the config, because it is tracked. A mode slice may not change it: its write scope is the mode's
  folder (ADR 17, item 1), and the proof "changes are in scope" fails a slice that edits the config. So a builder
  that adds or changes a list leaves the worktree's project unable to load. `bay check --project <worktree>` still
  works and prints the line.
- A mode's tests run its commands in the temporary project the test toolbox makes (`tests/test-toolbox.ts:204-218`).
  The toolbox writes that project's config already. `ProjectOptions` gains `trusted?: readonly string[]`, and the
  toolbox fills in `trust:` for the named modes. This gives nothing away: a test is code a toolchain's command
  runs unconfined, in a throwaway copy (ADR 20, item 2).
- Forge's merge card shows the error of section 1 for the slice's mode. After the merge the project does not load
  until the owner adds the line. For a new mode the owner may add the line before the merge; until then it is the
  warning of section 1. For a changed list there is no order that keeps the project loading: old hash with new
  list, or new hash with old list. Forge cannot continue until the owner has edited the config.

## 8. A clone, and another person's checkout

The trust is in a tracked file, so it travels. A clone on another machine loads the same modes with the same trust
and asks nobody. Another person who checks the project out runs what the first owner trusted. Under A trust
belongs to the project, not to a person or a machine. A pull request that changes a list and its line together is
trust given by whoever merges it.

## 9. A run in flight

- The list changes, or the line is deleted, while a run waits. The next `bay` command fails to load, so the run
  cannot be resumed, approved or submitted to until the owner restores the trust or the list. Runs of every other
  mode stop too. Nothing is lost: the run is in `kernel.db` and resumes afterwards.
- A script step that is running holds its grants and finishes with them.
- A harness session that started earlier keeps the system its tool server loaded (`bay/mcp.ts:26-33`), and its
  steps keep the commands `bay build` wrote into `.agentbay/steps.json`. Both last until the session ends or the
  build runs again. A does not shorten this.

## 10. Migration, as slices

| # | Slice | Kind and write scope | After |
|---|---|---|---|
| 1 | The rule. `trust` in the config schema; `trustedHash` on `GrantRequest`; `listOf`, `listTrustOf`, `trustProblems`; the config joins the paths no mode may name; the two descriptions in `mode.schema.json` (`:156`, `:176`) and the broker's sentence change. A test at `loadSystem`: trusted loads, missing and changed fail with the literal sentences | Capability, safety: `bay/policy.ts`, `bay/manifests/grants.ts`, `schemas/config.schema.json`, `schemas/mode.schema.json`, `bay/generated/`, `bay/broker/command-operations.ts` (one sentence), their tests, `CONTEXT.md` | - |
| 2 | `bay check` shows trusted modes and warns of a stray line | Capability, check: `bay/check.ts`, `bay/manifests/inspection.ts` (one field: is the list in force), tests | 1, for the field |
| 3 | The test toolbox's `trusted` option | `tests/test-toolbox.ts` and its test | 1, for `listOf` |
| 4 | The coordinator's sentence and the adapter's README | `adapters/claude-code/coordinator.ts`, `README.md`, tests | 1 |

Slices 2, 3 and 4 have disjoint scopes and form one wave after slice 1. Slice 1 touches two kernel features
(safety and manifests) and one sentence in a third; that is the interface the others meet at, so it merges first.
The typescript mode's work on a project that is not the kit (ADR 20's order) comes after slice 3.

## 11. What is deleted

`commandProblems` and `throwawayPlaceProblems` (`policy.ts:245-257`, `:285-297`), about 25 lines, and the clause
"Only a mode under the kit's components/base/ may list" in four sentences. `checkBaseCommands` becomes a check of
every list in force; the tier filter goes. Estimated size: about 90 kernel lines added, 25 removed.

## 12. What A trades away

A weakens nothing that holds today. It leaves three things undefended that B or C defend, and the owner should
choose A knowing them.

1. **The coordinator can give trust with one edit.** The file that holds trust is the file the owner already lets
   the coordinator edit. T3 holds for a step. For the session agent it holds only by instruction.
2. **Trust travels with the repository.** Whoever clones the project inherits it.
3. **One mode without trust stops the whole project**, and forge with it, until the owner has edited a file.

## 13. Risks, and what A does not do

- It cannot show what changed in a list. It shows the new list and points at git.
- It does not record who gave trust or when, beyond what git records.
- It does not cover scripts, skills or an action's effects (section 5).
- It does not notice a session that began before trust was withdrawn (section 9).
- It does not close the kit's `components/base/` to the session agent, so a mode written there is trusted by
  place (frame, row c). That gap is open today and A leaves it.
- A 64-character hash is pasted, not typed. On a phone the coordinator carries it. A shorter hash would be easier
  to type and easier to collide with, and A keeps the full one.
- Not verified: that the config schema's `propertyNames` and `pattern` give sentences an owner can act on when a
  line is malformed. Try it in slice 1.
