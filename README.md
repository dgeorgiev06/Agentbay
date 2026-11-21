# agentbay

agentbay runs work for its owner through **modes**. A mode is a folder with a `mode.yaml`: its actions, the
steps each action runs, what the mode may reach, and its workflows. A step is a script, a skill or a call of
another action. The kernel loads the modes a project uses, checks them, and runs each action or workflow as a
**run**, which it records in `.agentbay/kernel.db` so that it can wait, resume and be undone. The kernel never
drives a model. A skill step becomes a task for an agent of the harness, Claude Code today; the agent hands
its output back, and the kernel checks it against the step's output schema and the step's checks.

The kit is TypeScript that Node runs directly, with no build step. The words are defined in
[CONTEXT.md](CONTEXT.md), and each decision and its reason is in [docs/adr/](docs/adr/).
[docs/DESIGN.md](docs/DESIGN.md) says where to read about each part.

## The parts

- **Kernel** (`bay/`). It loads modes, applies their grants and their actions' effects, and runs runs. A mode's
  script runs in a child process and reaches the kernel only through the toolbox, `bay/sdk.ts`.
- **Modes** (`components/`). `components/base/` holds the modes that ship with the kit: `store`, `forge`,
  `proof`, `git-worktrees`, `requirements` and `typescript`. `components/modes/` holds the kit's example modes,
  `feed-briefing` and `fake-source`. A project keeps its own modes in its own `components/modes/`.
- **Interfaces** (`components/base/interfaces/`). Action signatures with no code, named `name@major`, such as
  `items-source@1`. A mode implements an interface or requires one, and the project's `bindings:` say which mode
  serves each.
- **Adapter** (`adapters/claude-code/`). `bay build` writes one Claude Code agent for each skill step, the hook
  and its policy, the kernel's tool server in `.mcp.json`, and the coordinator's block in `CLAUDE.md`. Its
  [README](adapters/claude-code/README.md) says what the hook does and does not stop.
- **Schemas** (`schemas/`). The forms of `mode.yaml`, a workflow, a skill, an interface and
  `agentbay.config.yaml`. `npm run generate` writes their TypeScript types into `bay/generated/`.
- **Framework files** (`framework/`). The kernel's feature map (`features.yaml`), the size budgets (`limits.yaml`, which `bay check`
  reports as warnings), and the practices builders and reviewers hold (`practices.md`).

```
owner ── Claude Code session (the coordinator)
           └─ bay call feed-briefing.digest
                kernel ── step 1  script scripts/select.ts      in a child process, through the toolbox
                       ── step 2  skill skills/digest           a task for the agent agentbay-feed-briefing-digest,
                                                                which hands its draft in with the tool submit;
                                                                scripts/check-citations.ts holds the draft to the
                                                                posts the step was given
                       ── step 3  script scripts/format.ts
```

## Install

Node 22.18 or later. From a clone of the kit:

```bash
npm ci            # ajv and yaml, and the tools the checks use
./bay.sh --help   # the commands
npm run check     # what a merge needs: generated types, type check, lint, format, dead code, every test
```

## Quick start: a briefing from made-up posts, in a folder of your own

The kit's `fake-source` mode serves thirty made-up posts and touches no network, so this needs no account and
no secret. Make a folder with this `agentbay.config.yaml`:

```yaml
modes: [feed-briefing]
bindings: { items-source: fake-source, items-store: store }
adapter: claude-code
settings:
  fake-source: { baseDate: "2026-11-15T12:00:00Z" }
```

Then, in that folder, with `<kit>` the path of the kit:

```console
$ <kit>/bay.sh check
Skill steps run with the hook: the kernel takes a skill step's output only when the agentbay hook saw the step's agent hand it in.
bay check: 0 errors, 0 warnings.

$ <kit>/bay.sh actions
fake-source    Serves thirty made-up posts as an items-source, for tests and the demo; it touches no network.
feed-briefing  Syncs posts from a source into the store, writes a digest of themes that cites them, and answers questions.
store          Keeps the items of each composing mode in a database of its own, with search and bounded SQL.
bay actions <mode> lists the actions of one mode.

$ <kit>/bay.sh call feed-briefing.sync '{"since":"2026-11-08T12:00:00Z"}'
run <run> (action feed-briefing.sync): done
output:
{
  "source": "fake",
  "pages": 2,
  "fetched": 18,
  "added": 18,
  ...
}

$ <kit>/bay.sh call feed-briefing.digest '{"until":"2026-11-15T12:00:00Z"}'
run <run> (action feed-briefing.digest): waiting for skill at 1#1
task for the agent agentbay-feed-briefing-digest. A task token was issued with this task; it is shown only now.
{
  "agent": "agentbay-feed-briefing-digest",
  ...
  "token": "<token>"
}
```

The sync stored the posts in `.agentbay/data/store--feed-briefing.db`. The digest ran its first script, then
stopped at its skill step and printed the task. `<kit>/bay.sh runs` lists both runs.

A digest needs an agent to write it. `<kit>/bay.sh build` writes the agent files listed under The parts. Start
Claude Code in the folder and ask for a digest: the block in `CLAUDE.md` tells the coordinator to run the action,
give the task to the agent `agentbay-feed-briefing-digest`, and read the run again when the agent returns. By
default (`skillSteps.run: with-the-hook`) the kernel takes an output only when it finds the hook's record, a
sighting, of an agent of that step's mode and skill handing it in with the task's token, and it uses the sighting
up. A sighting is a row in `.agentbay/hook-sightings.db`, and the hook is not the only thing that can write one:
the adapter's [README](adapters/claude-code/README.md) says who else can, such as the coordinator's shell and a
step whose mode lists a command that runs code. A `bay submit` from a plain terminal, with no such record, is
refused, and the run still waits:

```console
$ <kit>/bay.sh submit @draft.json --token <token>
The kernel did not take this output. This project runs skill steps with the hook, and the agentbay hook did not see the agent of skill digest of mode feed-briefing hand it in with this task's token. Run <run> still waits for step 1#1. Two ways on: hand the task to that agent in a Claude Code session where the agentbay hook is active, or the owner sets skillSteps.run to without-the-hook in agentbay.config.yaml.
```

The hook has not yet run inside a live Claude Code session; the adapter's README says what that leaves unverified.
`<kit>/bay.sh build --clean` removes what the build wrote. The workflow `daily` runs sync, digest and an approval
of the digest: `<kit>/bay.sh call --workflow feed-briefing:workflows/daily.yaml`. No real source is built yet.

## Settings

`bay config` prints every setting the project config may hold, with its type, its description and its current
value. The config has `modes` (the kit's modes the project uses; its own modes, and the modes they bind, are used
anyway; of a kit mode the project does not use only the manifest is read, so its workflows, even broken ones, stop
nothing), `bindings`, `adapter`, `settings` (per mode, checked against the mode's settings schema), `budget` (the
default limits of a run), `tiers` (the model and effort of each tier), `skillSteps` and `approvals`. No mode may
name the config. Where the hook runs, it closes the config to step agents' file tools only. For a command, the
hook checks that it is a listed command's words followed by plain arguments, not which paths those arguments name,
so any listed command can still be pointed at the config, and one that runs code can do anything. The coordinator
can edit the config: the block in `CLAUDE.md` tells it to change
`approvals` or `skillSteps` only when the owner asks for exactly that, and nothing enforces it.

A workflow's `trigger` may name a schedule or an event, but no part of the kernel starts a workflow by either yet:
`bay call --workflow` starts it, and `bay resume --due` wakes the runs whose wait is over.

## Folder map

```
bay/          the kernel, its command line (bay/cli.ts, run by bay.sh), the tool server (bay/mcp.ts) and the
              templates bay new writes from
components/   base/: the modes and interfaces that ship with the kit; modes/: the kit's example modes
adapters/     claude-code/: what bay build writes for Claude Code, and the hook
schemas/      the forms of the manifests and the config, and the script that generates their types
framework/    the feature map, the size budgets and the practices
tests/        the kernel's tests and the test toolbox (tests/test-toolbox.ts); a mode's tests live in its tests/
docs/         adr/ (decisions), designs/ (designs before a build), plans/, briefs/, research/, requirements/,
              proposals/ (agentbay 4's proposals, which CHANGELOG.md points to)
```

A mode's folder holds `mode.yaml`, `README.md`, and `skills/`, `scripts/`, `workflows/`, `schemas/`,
`migrations/` and `tests/` as it needs them; `bay check` refuses anything else unless the manifest lists it under
`extraFiles`. `bay build` records what it wrote in `.agentbay/build.json`, and `bay build --clean` removes exactly
that.

## Commands

| command | does |
|---|---|
| `bay check` | Check manifests, skills, workflows, imports and limits, and report every problem at once. |
| `bay new <mode\|action\|skill\|workflow\|interface> <name> [--mode <mode>] [--tier base\|modes]` | Write a new mode, action, skill, workflow or interface from its template. |
| `bay actions [<mode>] [--find <words>]` | List the active modes, or the actions of one mode with their descriptions, effects and input schemas; --find keeps those that hold every given word. |
| `bay call <mode.action> ['<json>'] \| call --workflow <mode>:<path> ['<json>'] \| call --tool <name> '<json>'` | Start an action or a workflow and print the run; or call a kernel tool, which needs a task token unless it is actions. |
| `bay submit <json \| @file \| -> --token <token> [--tokens <n>] [--usd <x>]` | Hand in the output of a waiting skill step, with the token of its task. |
| `bay runs [<run> [--full] [--events] [--new-token [--step <step key>]]]` | List the runs, newest first; or show one run with its steps and task; --events adds events, --new-token replaces the token of every task, or with --step only of that step's task. |
| `bay approve <run> <stepKey> --hash <hash> [--reject \| --choice <name>] [--via terminal \| --via chat --quote "<the owner's words>"]; approve --trust <mode> [--reject] [--via chat --hash <hash> --quote "<the owner's words>"]` | Approve or reject what a waiting approval shows, or take one of its choices, naming its hash; or, with --trust, give or withdraw trust in a mode's list. From a terminal, or from chat if allowed. |
| `bay resume <run> [--rerun \| --extend <measure>=<amount>[,...] \| --stop] [--via terminal \| --via chat --quote "<the owner's words>"] \| resume --due` | Continue a run: --rerun runs an unfinished step, or a side-by-side foreach's failed items, again, --extend raises a spent budget, --stop ends it, each from a terminal or from chat if allowed; --due wakes waits. |
| `bay build [--clean] [--adapter <name>]` | Write the adapter's agent files for every skill step; --clean removes what a build wrote. |
| `bay secret set <NAME> \| secret check <NAME>` | Store a secret in the macOS keychain from an interactive terminal, or check that one can be found. |
| `bay auth <mode>` | Log in to a source that needs a browser login (not built yet). |
| `bay config` | Print every setting the project config may hold, with its current value, and which mode serves whom. |
| `bay import-v4 <folder>` | Copy your own to-dos and other local items from an agentbay 4 store once (not built yet). |

Run as `./bay.sh <command>` in the kit, and as `<kit>/bay.sh <command> --project <folder>` for a project
elsewhere.

## Adding a mode

In a project, `bay new` writes from the kit's templates:

- `bay new mode <name>`: `components/modes/<name>/mode.yaml` and its `README.md`.
- `bay new action <name> --mode <mode>`: the action in the mode's `mode.yaml`, its input and output schemas, a
  script, and an example in `tests/`.
- `bay new skill <name> --mode <mode>`: `skills/<name>/SKILL.md` only. No step names it yet; an action's `run`
  list must add one.
- `bay new workflow <name> --mode <mode>`: `workflows/<name>.yaml`, listed under `workflows:` in `mode.yaml`.
- `bay new interface <name>`: `components/interfaces/<name>.yaml` at version 1, with no actions. The name is
  plain kebab-case: `bay new interface thing@1` is refused.

`bay check` then checks the whole project, and `bay actions <mode>` lists a new action, which
`bay call <mode>.<name>` runs. A mode outside the kit's `components/base/` gets its list, the commands it lists
and its throwaway folders, only while a trust record (`.agentbay/trust.json`) names that exact list; `bay approve
--trust <mode>` shows the owner the trust card and records his answer. Trust does not stop an agent that has the
owner's shell, runs `bay approve` in a pseudo-terminal, or quotes words the owner did not write: the adapter's
README, under What the hook does not stop, and the Trust row of [CONTEXT.md](CONTEXT.md) say so. Forge builds a mode in slices, with tests, proof and the owner's cards:
[components/base/forge/README.md](components/base/forge/README.md).

## Safety, in one paragraph

Where it runs, the guard hook narrows what step agents can do: a step's tools, the folders it reads and writes and
the words of the commands it may run all come from its mode's manifest, and the coordinator's file tools may write
anything but `.agentbay/`, `.claude/`, `.mcp.json`, the kit's `bay/`, `schemas/`, `adapters/` and `framework/`, and, outside the kit, its `components/base/`; the coordinator's shell is not checked. It is defence
in depth, not isolation, and cannot contain code once a listed command runs it. A project whose config sets
`skillSteps.run: without-the-hook` runs skill steps with no hook: the kernel takes their outputs, and each run
records that no hook saw them. A mode's script runs in a child process under Node's permission model and reaches
the kernel only through its toolbox, where each operation is checked against the mode's grants and its action's
effects. A mode outside the kit's `components/base/` is granted the commands it lists only after the owner trusts
that list. Secrets come from the environment (`AGENTBAY_SECRET_<NAME>`) or, on macOS, the keychain: `bay secret
set` prints the command you run yourself, which never echoes the value. An approval and the owner's answers to
`bay resume` are taken only from a channel that `approvals.from` in agentbay.config.yaml lists, `terminal` or
`chat` (default `[terminal]`); trust is given at a terminal always, and from chat only when it lists chat. An
answer is recorded as `owner at the terminal` or `owner via chat, quoted: "<the owner's words>"`. Details:
[adapters/claude-code/README.md](adapters/claude-code/README.md) for the hook,
[docs/designs/operations/0-frame.md](docs/designs/operations/0-frame.md) for the toolbox and
[docs/designs/trust/0-frame.md](docs/designs/trust/0-frame.md) for trust.

## A skill's output kept packed

An action may say `skillOutput: kept-packed` in its mode's manifest. The kernel then keeps its skill's output
gzipped and in base64 in `.agentbay/kernel.db`. That holds for the skill step's row, its checks' rows, the row of the
call that ran the action, and the run's own row when the action runs alone. Each value is packed before it is
written, so no line of the output is in that file, its journal or its write-ahead file as text, before or after a
restart. Base64 matters too: a block that gzip leaves uncompressed is still never the text's own bytes.

The kernel unpacks the output for the script that called the action, also when it replays that script's finished
calls, and for the skill's own checks. A round that a check sends back gets the check's feedback, as before, and
not the earlier output; a check's feedback is shown as written, so a check should not quote the output. `bay runs`
marks each such step kept packed and never prints its input, its output or its reason, also with `--full`,
`--json` and `--events`; it prints a check's verdict and feedback. Events hold only sizes. Such an action's run is
one skill step, and only a script may call it: `bay check` refuses a call step or a workflow step that names it,
since either would pass the output on as text. Left out, or set to `as-text`, the output is kept as text, as before.

## The answers of called actions kept packed

An action may say `calledOutputs: kept-packed`. The kernel then keeps packed every call made under it: each call
its script makes, each call those actions' scripts make, at any depth, and each undo of such a call. For each, the
call's input, output and reason, and every step under it with its input, detail, output and reason, are gzipped
and in base64 in `.agentbay/kernel.db`, and a refused call's input too. The kernel unpacks them for the script
that made the call, also when it replays that script's finished calls after a restart, and for skill checks under
it. `bay runs` marks those steps kept packed as above.

A failure under such an action reaches the calling script without the words of the one that failed. When a script
or a skill under it fails, its own step keeps the reason, packed, and the step above is told only which script or
skill failed and that the kernel keeps its reason packed. When a called action's input or answer does not match
its schema, the reason counts the problems and quotes none of them. A refusal, such as a call whose effects the
caller does not declare, keeps the kernel's sentence, which quotes nothing of the call.

The marked action's own step, input and output are kept as text, so a workflow and a card can read them; whatever
its script puts there from an answer is the mode's to keep out. Its run may have no call step: `bay check` refuses
one, since a call step would pass the answer on as text. Events are not packed: the kernel's own carry sizes,
command words, hashes and refusal sentences, and no input or output of a call; an event a script emits is kept as
the script wrote it. A skill's `call_action` starts a run of its own, kept as the action it names says, not packed
by this field.

Packing is not secrecy. It keeps the text from a search and from anyone who reads the files. It does not stop
code that can open the database and unpack it, such as a script run as the same user. With the hook, a step's
agent cannot read `.agentbay` at all; without it, packing is what keeps the text out of reach of a plain read.

## A foreach's items side by side

A workflow's `foreach` may say `sideBySide: <2 to 8>`. Up to that many of its items then run at the same time, in
the one kernel process: their scripts and called actions run as two `bay call`s would. The output is still a list
in the order of the items. Without the field the items run one after another, as before.

`sideBySide` may also be a reference, such as `$settings.<key>` or `$steps.<id>.output.<path>`. The kernel
resolves it each time the foreach starts or resumes, before any item runs; a value that is not a whole number from
2 to 8 fails the step with a sentence that names the step, the reference and the value.

An item's step may wait for a skill, an approval or a time. A waiting item keeps its place, so no more items than
`sideBySide` wait at once, and the next item starts when one ends; an item that had started before a resume always
goes on, even when the value is now lower. The run waits on every such step at once: `bay runs <run>` shows the
first as `waiting` and `task`, and the others under `alsoWaiting`, each with its own task and token. `bay submit`
answers the step its token names, and `bay approve` the step it names. `bay runs <run> --new-token --step <step
key>` replaces the token of that one task and leaves the others working. A submit that arrives while another call
advances the run is recorded and answered as accepted; the run takes it once, when that call ends or at the next
`bay resume <run>`. A submit the kernel cannot record is refused with its reason, and its token still works.

When items fail, the others still run to their end or to their wait, and are recorded. The run then waits for the
owner with one sentence that names every failed item, by the name its foreach declares (below) or else by its
place, such as `the 3rd of 4 items`, then its key and its reason, each reason cut to 200 characters:
`Step each failed for 1 of 4 items: the 3rd of 4 items at each[2]: <reason>`. `bay resume <run> --rerun [--via terminal | --via chat --quote "<the owner's exact words>"]` runs only the failed items again, under a new key such as `each[2]~2`;
items that finished are not run again and keep their outputs. `bay resume <run> --stop [--via terminal | --via chat --quote "<the owner's exact words>"]` fails the foreach with that
sentence, and the run ends as any failed run: `failed` only when every finished action only read, so there is
nothing to undo; otherwise `undone`. The kernel then runs, latest first, the undo of each finished action that has
one and does not delete, and lists what it undid and what failed to undo; an action that deletes is listed as a
delete it did not undo, and one with any other effect than read (write, network or spend) and no undo as one it
cannot undo.

Running again, stopping and raising a budget (`--rerun`, `--stop`, `--extend`) are the owner's answers, so each takes
where the answer comes from as `bay approve` does: a terminal, the default, which must be interactive and where the
owner types yes, or `--via chat --quote "<the owner's exact words>"`; each is refused unless `approvals.from` in
agentbay.config.yaml lists it, and by default it lists terminal alone. The kernel records it with the answer, as
`owner at the terminal` or `owner via chat, quoted: "<words>"`, in the answer's `run.resumed` event (`bay runs <run>
--events`). A stop gives the run the reason `<that source> stopped the run.`, except at a foreach whose items failed,
whose sentence is the reason.
A plain `bay resume <run>` decides nothing for the owner and takes no source: a run that no engine advances goes on,
and a run that asks the owner asks again.

Every item draws from the run's one budget. While the budget limits items, dollars or tokens, a script whose
action may spend runs only when no other item's such script runs, so a step never starts on a budget another
item has spent. Minutes are counted per step and added up, so items side by side use the minutes faster.

`bay check` refuses a `sideBySide` below 2 or above 8, and a reference that is not one or that names a step not
before the foreach; what a reference resolves to is known only when the run gets there. It does not warn when items
write the same place: an action's effects say it may write, and its mode's grants say where, but which file or row
an item writes depends on its input, so the manifests cannot tell two items apart. A mode's database waits on its
lock, so two items that write it both land.

An approval after a foreach may quote a step the foreach runs in each item: `quotes` lists the step's id, and a
card's line cites it with its item, counted from 0, as `source: { step: <id>, item: <n> }`. The kernel takes that
item's last attempt, after `--rerun` the one that finished, and holds the step to the rules of a plain one. To a
judged line it adds the skill and its tier and the foreach, and the card says `by <mode> <skill>, tier <tier>, for
<the item>`. A line that cites a step in the items without its item, an item the foreach did not run, or a step of
a foreach inside an item is not shown, and the approval fails with that line's sentence.

The foreach says how its items are named with `itemName: { id: <ref>, title: <ref> }`, the title optional, each
`$item` or `$item.<path>`; forge's wave names a slice `{ id: $item.planned.slice.name, title: $item.planned.title
}`, and its card says `for TD1 (The td1 mode counts what was added)`. The kernel reads both from the item as the
foreach recorded it, already scrubbed of secrets, so neither a card's script nor a skill can give or change the
name: a line that brings `itemName` or `itemCount` is refused as one that brings `foreach` is. Each part is made
one line, control and format characters (such as a bidi override or a zero-width space) and line breaks turned to
spaces and parentheses to brackets, and cut with `…`, the id to 40 characters and the title to 80. The name stands
only in the row that says by whom a line was judged or run and in the owner's question about failed items, never as
a line's words. Without `itemName`, or when its id reads no text or is blank once cleaned, the card names the item
by its place: `for the 1st of 3 items of step slices`; a title that reads no text leaves the id alone. A stored
card is read back with the same name, and one whose name or count the kernel could not have written is refused.
`bay check` refuses an `itemName` part that is not a reference or that reads anything but the item.

## Checking a value against a schema

A script has two calls in the toolbox for it. `context.schemas.check(file, value)` takes a schema file of the
mode, or one of an interface the mode implements or requires, written `<interface>@<major>/<file>`.
`context.schemas.checkAgainst(schema, value)` takes the schema itself as a value, such as one a skill handed in.
Both use the kernel's own validator: JSON Schema draft 2020-12, with a keyword it does not know ignored, and
each schema compiled once by its content, at most 256 kept. Both answer `{ passed: true, value }`, or
`{ passed: false, problems }` with every problem's path and sentence.

`checkAgainst` reads no file and reaches no network. A schema it cannot use is a failed answer with one sentence,
and the value is not checked: one longer than 65536 characters as JSON (the largest action schema in the kit,
`proof@1`'s `prove-request.json`, is 15237), nested more than 64 levels deep, one whose `$ref`, `$dynamicRef` or
`$recursiveRef` points anywhere but its own parts (`#` or `#/...`), one that sets `$id` below its top, one that
grows past 65536 parts when each reference is followed in place (the kit's largest is 1688), and one the
validator cannot compile or that sends it round without end. The validator has no `loadSchema`, so a reference it
cannot find stops the compile; it never fetches. A `pattern` is a regular expression as written, as in a schema
file: one that backtracks without end stops the script at its own time limit, and nothing else.

## The time and random values a script uses

`context.now()` is the time the script's step first started, and `context.random(bytes)` answers a value of 1 to
64 random bytes as hex. The kernel records each value in the step before the script sees it, so a step that runs
again after a crash, a stop for a called action or the owner's rerun reads the same time and the same values in the
same order; asked for more, it gets fresh ones. A skill's next round, a foreach item's new attempt and every other
step have their own values. A step records at most 64, and on a rerun a value asked in another size than the one
recorded is a failed answer. The values are stored packed, and a run shows only how many a step drew
(`drawnValues`). The kit's lint refuses `Date.now()`, `new Date()` with no arguments, `Math.random()`
and the random calls of `node:crypto`, also through `globalThis`, computed or taken apart, in every file of a mode
that is not a test. It cannot see an alias made another way, `Intl` formatting with no date, or
`performance.now()` and `process.hrtime()`, which it leaves alone by design
(`docs/designs/runs/replay-safe-clock.md`).

## Testing a part of a workflow

A mode's test can run one part of a workflow alone. `project.runWorkflowPart(mode, path, { input, given, until })`,
from the test toolbox, starts the workflow with `given`, the outputs of its first steps by id, and runs from the
first step not given. Each given output is checked against the output schema of its step's action, and one that
breaks it refuses the start with the schema's sentence, so a test cannot give an output the action could not
have answered. A `foreach` is given one output for each of its items, each checked against the schema of the
action that ends its steps. An approval is given as `{ "choice": "<name>" }` with a choice it offers for the
steps given before it, or as `{ "verdict": "approve" }` when it has no choices. `until` names a step after the
given ones: the run stops once it is done, records its output, and starts nothing after it.

Given steps are the steps from the first up to where the walk begins, each at the top of the workflow. A wait
cannot be given, and neither can what a step does to the world: a worktree it cuts, a branch it commits, rows it
writes. A later step that needs such a thing finds it missing, so the test makes it itself, as forge's tests make
a slice's branches before they give its rounds, or gives fewer steps and lets that one run. A card's line marked
judged may cite a given step, or a step in an item of a given foreach; it names no skill, since none ran. A line marked ran cannot cite one, since no
command ran there.

A run started this way says so. `bay runs <run> --json` shows its target with `part`, the given steps and
`until`; `--events` shows a `step.given` event for each given step; and a run stopped by `until` waits for its
owner with a question that says a test stopped it there. Resuming it stops there again, so `bay runs <run>` offers
only `bay resume <run> --stop`, with the owner's source, to end it. `bay` itself has no way
to start one: a test that drives `bay` in a process of its own runs `node tests/start-part.ts <mode>:<path>
'<trigger json>' '<part json>'` in its project, which works only in a folder under the temporary folder.

Forge's end-to-end tests run their `bay` commands inside the test's own process. `commandLineIn(copy)`, from the
test toolbox, loads `bay/bay-command.ts` from the case's copy of the kit and runs a command line there as
`./bay.sh` would, without the second or so a new `bay` process costs to start. It answers the exit code and the
text `bay` prints on stdout, without the trailing newline. It does not give what `bay` writes on stderr, and on an
error that escapes the command line it rejects with that error where `bay` would print `internal error` and exit 70.
Script steps still run in their own hosts, from the copy's kernel. One whole case of each workflow still starts a
`bay` process per command, through `processProject` (or `byProcess`): rounds (`one-round.test.ts` case 6, a fresh
kernel for each answer), design (a design that serves no action for a condition), plan (a condition no slice
meets), one-slice (case 3, a rejected start card), wave (a wave stopped after a slice failed as a run), and one
`forge.waves` call (`waves.test.ts`, a plan of one slice).

Forge's tests give outputs captured from whole runs, in `components/base/forge/tests/given-*.json`. When a
workflow or an output schema changes, they no longer start, and the refusal names the step. `node
components/base/forge/tests/recapture.ts [given-<name>.json ...]` makes them again: in a copy of the kit, it runs
the whole end-to-end case each file comes from, writes the outputs of the steps before the one the test runs from,
with the commits the test makes again by branch, and formats the files. `recapture.ts` lists, for each file, its
case and the step its test runs from. A case that only remakes a file, since the test that reads the file holds every
one of its assertions, runs only when `FORGE_RECAPTURE` is set, as `recapture.ts` sets it; the everyday suite skips
it. With no file named it makes all four, in about four minutes. The whole cases do not check the cards
their files lead to, so the test that reads a file may then need its expected card changed to the one it now prints.

## Checking a change

`npm run check` is the whole check, and what a merge needs: the generated types, the type check, lint, the format
check, the dead-code check, then every test file. On a 2-core machine its tests keep both cores busy for the whole
run, so it is about as short as the CPU work in it.

While building, `npm run test:affected -- <base>` runs the same five checks on the whole kit, then only the test
files the change needs. The change is every path changed since `<base>` (`git diff <base>...HEAD`), with uncommitted
and untracked paths. It picks one of three tiers and prints it with its reason:

- **mode**: every changed path is inside one or more mode folders (a folder with a `mode.yaml`), and none is a
  manifest, schema, workflow or skill. Only the test files inside those mode folders run.
- **manifest**: a changed path is a mode's `mode.yaml`, or under its `schemas/`, `workflows/` or `skills/`. The
  modes' own tests run, and the tests that open the kit, listed by hand in `tests/affected.ts` (a test checks that
  every test file with one of its markers is on the list).
- **all**: any other path changed: the kernel (`bay/`), `tests/`, `framework/`, `schemas/`, `adapters/`, an
  interface, `package.json`, any file at the top. The whole suite runs, as in `npm run check`.

A change under `docs/`, or to the root `README.md` or `CONTEXT.md`, runs no test. Markdown inside a mode folder
counts as part of that mode.

What it can miss, in the two lower tiers:

- **Other modes that run the changed mode.** A mode's code also runs in other modes' tests. Proof's tests run the
  real `git-worktrees` and `typescript` modes, and forge's end-to-end tests run the real `git-worktrees` and
  `requirements`. A change to `components/base/git-worktrees/scripts/` runs only git-worktrees' own tests, not those.
- **Kernel tests that read every mode.** In the mode tier, the tests under `tests/` that check the whole kit do not
  run: `bay check` on the kit (the imports a script may make, the size warnings), the feature map, the made-up
  modes beside the kit's own. In the manifest tier, a test that opens the kit but carries none of the markers
  is missed until it is put on the list.
- **The merged result.** It checks the branch, not the branch merged with what landed since `<base>`.

So it decides what to run while building, not whether a change is safe: run `npm run check` before asking for a
merge, and the whole suite runs again on the merged branch.
