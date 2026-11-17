# Broker as one sealed feature: the three designs compared

Read `0-frame.md` first. This weighs `A-smallest.md`, `B-mode-author.md` and `C-seams.md` against its criteria and
ends with a recommendation: A as the base, with the ruling from C and two things from B.

## Where they agree

All three reach the same answers to half the frame's questions, so these are settled whichever is chosen.

- One feature, `bay/broker/`, with two entry files: `broker.ts` for the kernel and `bay/sdk.ts` for modes.
- `sdk.ts` is written by hand and declares every shape an author can reach. Its only type imports are `Json` and
  `Answer`. `ports.ts` keeps the port's own `HttpRequest`, as it already keeps `ProcessRequest`.
- A definition has two halves: shapes that the child also reads, and a kernel half. Both are records typed over
  one union of names, so a missing entry does not compile. Guards are written by hand, once each.
- One function answers every request. The runner, the protocol and the effect rule name no operation.
- `call` and `spend` are in the table. `skill.submit` is a function on the same rule.
- 16 of the 18 debt entries go and all 8 test entries. The `scripts` feature is deleted; safety is `policy.ts`.
- Effects per listed command make a command's effects a claim the owner reviews. None of the three can enforce
  the claim in a child process, and each says so.

## Against the criteria

| # | Criterion | A, smallest | B, mode author | C, seams |
|---|---|---|---|---|
| 1 | Files to add an operation (today: 6, and up to 3 for shapes) | 3 source, 1 pin, 2 tests | 3 source, the listing regenerated, 2 tests | 3 source, 2 pins, 2 tests |
| 2 | Files to add a field | `sdk.ts`, the guard, the handler; the pin; one example | The same | The same, and the wire example |
| 3 | What an author sees | Nothing changes. Commands are a list of `{ run, effects }` | One page of types, a generated listing with a sentence per operation, commands by name, `valueOf` | As A |
| 4 | What a reviewer of a new operation reads | One shape and one handler. The grant check is somewhere in the handler | As A, and a sentence and the manifest lines to check against the code | The rule on its own, then the record. The doing cannot reach grants |
| 5 | Cannot be got wrong | A missing or misnamed entry; a guard that returns the wrong type; a path round the rule | As A, and the types cannot drift from `sdk.ts`: they are read from it | As A, and: doing before ruling, a rule that changes the world, a handler that reads grants, a forgotten record |
| 5b | Held only by test or review | That a handler checks its grant and records; a dropped optional field (test) | As A, and the prose of the listing | The in-process adapter matching the child (test) |
| 6 | A test of one operation | `step.ask("files.read", { path })`, then the sentence and the events | The same object a script holds, with no child | Three small tests, and four proofs over all 16 from two examples |
| 7 | Migration | Chain of 7, then 2 modes side by side. No expected value changes until effects per command | Chain of 7, then 4 modes. The command slice edits two modes' code | Chain of 7 or 8, one slice beside two others if the owner allows |
| 8 | Deleted | The `Broker` class, `effect-rule.ts`, 3 switches, 7 parsers, the doubled guards | As A, and prefix matching, 30 lines of git options in a mode, 4 copies of an unwrap | As A, and `SecretStore.get`, `script-runner.ts` as one file |
| 9 | Names exported by `broker.ts` | 10 | 11, and 3 new in `sdk.ts` | 12 |
| 10 | New concepts | The table; `Step` | The table; types read from the toolbox; the listing; named commands | The table; ruling; `Asking`, `Look`, `World`; the transport; the proofs |
| 11 | A second transport later | The runner is rewritten, about 250 lines | The far end is ready; the kernel end is as A | One file. No operation changes |
| 12 | Size after (today 3,209) | 3,300 | 3,310, and 170 of tool and listing | 3,665, and 330 of test support |

## Where they truly differ

1. **Who owns an operation's types.** A and C restate each request as a named record in `Requests`. B reads the
   parameters straight from the toolbox's methods. B has one spot fewer per operation and pays with a wire that
   carries arguments by position and with harder compiler errors.
2. **How a command is listed.** A and C: a list, matched by leading words, longest first. B: a name. A name makes
   the rule an exact lookup and writes the fixed words once. It also changes what an author types.
3. **How much of a definition is one function.** A and B: needs, words, and one handler that checks the grant and
   does the work. C: rule, doing, record and answer apart. C is the only design in which the type system holds
   the grant check in place.
4. **The transport.** Only C makes it a port. Its second adapter is for tests; the container is not built.
5. **The pin.** A and C: the toolbox written out again as one type that must equal the real one. B: a generated
   listing in sentences. C adds one line of wire text per operation.

## What each costs

- **A** is the least to build: nine slices, no new tool, no expected value changed in the seven `broker-*` test
  files. To live with: the grant check and the record are habits inside a handler, as today. The next throwaway
  folders touches three source files where it touched 13, but a reviewer still reads a whole handler to find
  what is checked.
- **B** costs a generator, a kernel slice that reaches into two modes, and 22 names in git-worktrees. To live
  with: authors and builder agents get a page that says what each operation is for. The page's prose is held by
  review. The compiler errors for a wrong entry are the worst of the three.
- **C** costs one slice and about 450 lines more than A, and the most to learn. To live with: a new operation is
  four functions, and for a third of the operations three of them are one line. In return, review of a new
  operation is the rule and the record, and a container later is one file.

## Questions where the owner would see a difference

How a listed command looks in `mode.yaml` (each design's section 6 has the full text):
- [ ] A list. `- run: git … worktree remove --end-of-options` with `effects: [write, delete]` (A, C).
- [x] A name. `remove-worktree: { run: git … worktree remove --end-of-options, effects: [write, delete] }`, and
  the script says `command: "remove-worktree"` (B).

What a refusal says when an action lacks an effect a command has:
- With a list: "… asked to run the command ["git", …, "worktree", "remove", …] in ., but the action status declares
  the effects: read. The listed command "git … worktree remove --end-of-options" has the write effect; to allow it,
  add write to actions.status.effects in …/mode.yaml."
- With names: "… asked to run the listed command remove-worktree with [".forge/worktrees/k3"] in ., but the action
  status declares the effects: read, and remove-worktree is listed with: write, delete. To allow it, add write …"
- Every other refusal is the same in all three designs as today, character for character.

How a change to the toolbox shows on an approval card:
- [x] One changed line of the pinned type: `+ readonly exists: (path: string) => Promise<Answer<boolean>>;` (A, C).
- [ ] Four lines of the listing: the signature, when to use it, what it needs, which manifest lines allow it (B).

Whether an agent in a skill step may run some of a mode's commands. Today it may run them only if its action
declares all five effects. In every design it may run those whose effects the action declares. The agent file
the harness writes will list fewer or more commands than now.

## Recommendation

Build A, with three additions. None of the additions needs the others.

1. **From C, the ruling.** A definition gets a `rule` that returns what was allowed, and its handler takes that
   value and not the request. This is the one thing in the three designs that makes a security property hold by
   type: a path cannot be read before it is checked, because the handler never receives the unchecked path. It
   costs about 120 lines over A. I would not take C's further split into record and answer, nor `Look` and
   `World`: they add most of C's 450 lines and help only the simplest test. I would take C's table of proofs
   without its fourth line: three properties over all 16 operations, through the entry, from two examples each.
   And the grant check of `secrets.get` moves from `secrets.ts` into the rule, so that every grant is checked in
   one feature.
2. **From B, `valueOf`.** Four modes wrote it. It is ten lines in the toolbox and one small slice per mode.
3. **From B, commands by name,** if the owner accepts a change to the toolbox in this round. The reason is the
   rule and not the look: an exact lookup has no "which listed line wins", and a script cannot build the words
   the kernel compares. If the owner prefers no toolbox change now, take A's list. Do not do the list now and
   names later: that is two rewrites of every manifest that lists commands.

Not now: the transport port, the generated listing, and B's types read from the toolbox. The port waits until
slice I3 or a container needs a second adapter (P-10). C shows it is one slice and that no operation changes,
provided the runner meets the operations at one function, which A's slice 3 already gives. The listing is worth
having for authors but is not needed to pin the surface.

The reason for A as the base: the problem measured in the frame is places, and all three remove the same places.
A does it with one concept and changes no expected value, so the capture of today's output stays a proof through
six of its slices.

## What I am unsure of, and what to try in code first

- The typed table was tried as sketches of three and four operations with the compiler alone. The linter was not
  run on them, and the kit's limits on branches and parameters may shape the guards. Try: slice 2 with all 16
  shapes before the later slices are briefed.
- `http.request` checks each redirect against the hosts while it runs, and the database child finds some
  refusals only when a statement runs. I believe both fit "rule, then handler" with the URL rule passed in and a
  late refusal. Try: write those two definitions first. If they do not fit, the ruling becomes optional per
  operation and loses most of its worth.
- The type that must "equal" the toolbox was not tried. Equality of types with `readonly` and optional fields
  has corner cases. Try it in slice 2; the fallback is a listing printed by the compiler, as in B.
- The child must be allowed to read `operations.ts`. I did not run a script with the changed list of files.
- The effects I wrote on git commands are guesses to show the form. The mode's slice decides them.
- I read the Claude Code adapter's use of listed commands only at its call sites.
- Line counts after are estimates, within about a fifth.
- The audit says the toolbox changed twice without `sdk.ts` being edited; I found one such commit (`616e674`). It
  counts 14 files for throwaway folders; commit `5f1b960` has 13 under `bay/`.
- Slices 4 and 5 of every design leave the table half moved for one slice. I found no order that avoids it.
