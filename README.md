# agentbay

agentbay is a framework for extending AI agents with **modes**. You write a mode as configuration files, YAML
plus Markdown playbooks, not code: what it does, which role does each step, and what each step may touch. agentbay
checks that the pieces fit, turns them into agents for your runtime, and runs every step through one dispatcher.
The dispatcher lets an agent touch only what its environment allows, keeps secrets out of the agent's reach, stops
at the approvals you require, and logs every step. Claude Code is the supported runtime today; another LLM product
needs one new adapter, not new modes.

- **Chief of Staff**: your main agent session (in Claude Code today). You talk to it; it routes each request to a
  mode and runs the steps.
- **Mode**: an extension that adds a capability to agentbay, such as a daily digest of your inbox. It exposes
  **features**, the endpoints you call (`mail-briefing.digest`). Each feature is a list of steps with a
  definition of done and rules.
- **Role**: who does a step: `lead`, `analyst`, `researcher`, `builder` or `reviewer`. The framework owns the
  roles; a step names one.
- **Adapter and agent profile**: an adapter compiles agentbay for one LLM product, and its agent profile maps each
  tier to that product's models. `adapters/claude-code/` is the one adapter today and the only place models are named.
- **Environment (env)**: what a step may touch: which files, commands, network hosts and secrets.
- **Connector**: deterministic code that does the work agents must not do directly, such as reading Gmail or
  storing items. Agents never see a connector or a secret; they call it through an interface.
- **Capability interface**: a versioned contract, such as `items.source/v1`, between a mode and the
  connectors that serve it. A mode names interfaces, never connectors, so a source can be swapped.
- **Component**: one folder with one manifest, under `components/base/` (shipped with the framework) or
  `components/modes/` (yours). It holds one mode with its envs, interfaces, tests, source connectors
  (`connectors/`) and content types (`content-types/`), or one shared set. A mode that uses another mode's
  connectors or content types lists it in `composes:` in its `mode.yaml`.
- **Kernel**: the framework itself (`bay/`, `schemas/`, `framework/`, `adapters/`). Only the framework's
  change process may edit it.

```
Chief of Staff (your main Claude Code session)
  └─ bay call feed-briefing.digest ──> Mode feed-briefing (extends store), feature digest
        refresh   run: items.store/v2.sync   ─ code ─> Env local-feeds ─> corpus-store ─> x-api (api.x.com)
        gather    run: items.store/v2.query  ─ code
        themes    role: analyst    ─ subagent analyst--feed-briefing (balanced: sonnet) in Env local-feeds
        review    role: reviewer   ─ subagent reviewer--feed-briefing (deep: opus), from the feature's review block
```

Design: [docs/DESIGN.md](docs/DESIGN.md). Contracts: [docs/INTERFACES.md](docs/INTERFACES.md).

## Install

`python3` and a Claude Code version that sends `agent_type`. To run the standards checks (ruff and mypy at the pinned
versions), also install `requirements-dev.txt`; a step that needs a missing tool stops and names that command. From a
clone:

```bash
pip install -r requirements.txt        # pyyaml, jsonschema
pip install -r requirements-dev.txt    # ruff, mypy and two type stub packages, for the standards step
./bay.sh check                         # lint + resolve everything
python3 tests/run.py                   # the test suite
```

## Quickstart (offline, 5 minutes)

```bash
./bay.sh build --project ~/code/my-repo   # writes a minimal agentbay.config.yaml when the project has none
# add `offline: true` to ~/code/my-repo/agentbay.config.yaml (fake sources, no network, no secrets), then:
./bay.sh build --project ~/code/my-repo
cd ~/code/my-repo && claude            # restart Claude Code after every build; accept the workspace trust prompt
```

Ask for a digest, for example *"brief me on the last 3 days"*. The Chief of Staff calls the digest feature of the
mode:

```bash
.agentbay/bay call feed-briefing.digest '{"since": "3d"}'
```

Code steps run in the dispatcher, and agentic steps run as subagents. The `reviewer` gives a verdict for each
Definition of Done item. A change to the framework also passes checks for new unused code and for growth past the
size ceilings in `framework/limits.yaml`, and a large proposal gets a written plan before you approve it. The
[safety model](docs/DESIGN.md#safety-model) describes each of these. `./bay.sh check --limits` runs the size check
by hand.

**Standards.** A feature whose builder can write code also runs a `standards` step, and the call is blocked on any
finding that is new against the commit the call started from; findings already in the tree block nothing. A change to
the framework passes these checks:

- `ruff` (rules E, F, W and B, line length 120) and `mypy --strict`, with the kit's `ruff.toml` and `mypy.ini`.
  In another project the step reads the project's own `ruff.toml` (else `pyproject.toml` with a `[tool.ruff]` table)
  and `mypy.ini` from the starting commit, so a change cannot supply its own config. mypy does not read
  `.mypy.ini`, `setup.cfg` or `[tool.mypy]`. A tool without a project file uses the kit's.
- No `#` comment and no docstring longer than one line, in every language that declares its comment syntax in a
  `language` block of a component. A reason goes in a name, an error message or the README. A project can turn this
  rule off with `connectors: { comments-check: { rule: off } }` in its `agentbay.config.yaml`, read from the starting
  commit. In the kit, `bay check --limits` also holds the count at zero as `comment_lines`.
- The size ceilings and the unused-code check.

Lint requires the step in every feature whose builder can write a checked file, so a mode you write with such a role
needs a `standards` step, `needs: standards.check/v1` and an env that binds the checkers. Agents may run the two commands
before the step does, each with the kit's config and a fixed list of flags:

```bash
python3 -I -m ruff check --config components/base/python/ruff.toml <path>
python3 -I -m mypy --config-file components/base/python/mypy.ini <path>
```

**Going live:** sign in as the source connector's `README.md` says, remove `offline: true` from
agentbay.config.yaml and rebuild. Budget caps stop a sync before it exceeds one.

## Settings

`bay config` prints every setting, with its type, default and description, from the schemas. `bay build`
writes a minimal `agentbay.config.yaml` when the project has none. Settings can only lower a cap: a value above
the env's `limits:` is refused by lint and at run time. Capabilities stay bound only in an env manifest
(`components/modes/<name>/envs/<env>.yaml`, or under `components/base/` for a shipped mode). An env's `offline:`
block names the stand-in sources that `offline: true`
binds in their place.
A mode endpoint with a `schedule:` (daily, weekly) runs from cron: `bay check` prints the command to schedule.
For example, a weekly report on Mondays at 07:00:

```
0 7 * * 1  cd ~/code/my-repo && .agentbay/bay call improve.backlog '{}'
```

## Folder map

Each component is a folder with its own `README.md` and, if it takes settings, its own `config.example.yaml`.
An env is one file inside the folder of the component it belongs to.

```
components/      base/ is the framework's shipped modes and shared sets; modes/ is yours, one folder per mode
                 with its connectors/ and content-types/ inside
adapters/        agent runtimes that bay build compiles for, each with its agent profile and slash commands
framework/       shipped with the kit, never edited by users:
  roles/           the five roles
  rules/           conformance rules
  kernel.yaml      the paths the kernel owns, and a `protected:` block naming what only forge.extend may change
  limits.yaml      the size ceilings
schemas/         the contracts (apiVersion agentbay/v4; a file with another version is refused with the fix) and data schemas
bay/             resolver, lint, dispatcher, guard hook, run log, CLI and the templates `bay new` writes from
docs/            DESIGN.md, INTERFACES.md and the proposals
tests/           python3 tests/run.py (the tests of a component live in its own tests/ folder)
```

`bay build` writes subagents, skills, commands, settings, hooks and `.agentbay/` into the project, tracked in
`.agentbay/manifest.json`. `bay clean` removes exactly that.

## Commands

| command | does |
|---|---|
| `bay check [--base <ref> --proposal <file>] [--limits [--write]]` | lint and resolve everything; with `--base`, also check a change against core ownership; `--limits` checks the ceilings, `--write` records lower counts (release only) |
| `bay build` / `bay clean` | compile into a project / remove what was generated |
| `bay catalog [<name>] [--roles]`, `bay describe <name>` | what is installed, resolved; `--roles` lists the role units |
| `bay show <mode> --resolved` | a mode's features after `extends`, with the file each comes from |
| `bay call <mode>.<endpoint> '<json>'` | run a feature |
| `bay submit '<json>' --token <token>`, `bay show <callId>`, `bay show reclaim <runId>`, `bay show close <callId> --reason <text>` | hand back a step's output; current state; mark a stuck run reclaimed; end an open call as abandoned |
| `bay approve <callId\|runId> [--reject]` | pass an approval gate in your terminal, or from chat when `approve.from` lists chat |
| `bay approve <F-id> [--defer\|--wontfix]` | decide a backlog item from the analysis mode (follows `approve.from`, like a gate) |
| `bay status [--agents\|--log]`, `bay note <ref> "text"` | calls, steps, cost, agent runs (grouped by role, mode, model, tier); the raw run log; a note |
| `bay note task`, `bay note dispatch <taskId> --agent <name> --input <x> [--unguarded <reason>]`, `bay note done <taskId>`, `bay note review <taskId> '<json>'`, `bay plan <taskId> [--done <n>]` | agent run records: a fresh taskId; the Chief of Staff logs each dispatch, its finish and outside review; a subagent first records its outcome and to-do (`bay plan` is its only `bay` command) |
| `bay new mode <name>`, `bay new feature <name> --mode <mode>`, `bay new connector <name> --implements <interface> --mode <mode>`, `bay new content-type <name> --mode <mode>`, `bay new env <name> --mode <mode>` | create a mode, or a feature, a source connector, a content type or an env inside a mode in `components/modes/`, from a template |
| `bay secret set <NAME>` | store a secret (read from your terminal, never echoed) |
| `bay auth <connector>` | a connector's browser login (Claude Code asks first; needs the browser on this machine) |
| `bay config` | print every agentbay.config.yaml setting, from the schemas |

Run as `./bay.sh <command>` in the kit, or `.agentbay/bay <command>` in a built project. A component's `README.md`
lists any commands it adds.

## Adding things

A source is one connector plus one binding line in the mode's env. A feature is `bay new feature`. A framework
change starts from a proposal that lists every core path it touches. For example, a new source starts with
`bay new connector <name> --implements items.source/v1 --mode <mode>`, which creates the folder
`components/modes/<mode>/connectors/<name>/`. Recipes:
[docs/INTERFACES.md#extension-recipes](docs/INTERFACES.md#extension-recipes).

**Chain modes.** A project workflow in `agentbay.config.yaml` runs one mode's endpoint, then an approval gate, then
another mode's endpoint:

```yaml
workflows:
  morning:
    description: Digest my mail, then draft replies I approve
    steps:
      - { id: digest, call: mail-briefing.digest, with: { since: "1d" } }
      - { id: ok, gate: "Draft replies for the threads that need one?" }
      - { id: drafts, call: delivery.build, with: { goal: "Draft replies to the threads in the digest that need one", deliverable: "drafts/<date>.md with one draft per thread; nothing is sent" } }
```

You start it by asking the Chief of Staff, and the drafting step never sends mail; it only drafts. A `with` value is
substituted only when the whole value is one reference such as `$steps.digest.notes`, and `delivery.build` takes
text for its `goal` and `deliverable`, so the example states them in words.

## Safety, in one paragraph

Where it runs, the guard hook narrows what subagents can ask to do; it is defense in depth, not isolation, and
cannot contain code once something runs it. A project whose config sets `skillSteps.run: without-the-hook` runs
skill steps with no hook: the kernel takes their outputs, and each run records that no hook saw them. Nothing that runs code is auto-approved except a role's own read-only data shim;
the main thread is pre-approved only for `bay show|status|note|catalog`. `bay secret set`
needs your terminal. Approval gates and backlog approvals follow `approve.from` in agentbay.config.yaml (default
`[terminal]`; chat is recorded as `user@chat-via-cos`). `approve.plans` makes a listed step show its plan for your
approval before it runs. `bay auth` asks first in Claude Code.
Details: [docs/DESIGN.md#safety-model](docs/DESIGN.md#safety-model).

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
`Step each failed for 1 of 4 items: the 3rd of 4 items at each[2]: <reason>`. `bay resume <run> --rerun` runs only the failed items again, under a new key such as `each[2]~2`;
items that finished are not run again and keep their outputs. `bay resume <run> --stop` fails the foreach with that
sentence, and the run ends as any failed run: `failed` when none of its finished actions wrote, deleted or has an
undo, so there is nothing to undo; otherwise `undone`, once the kernel has run the undo of each finished action that
has one, latest first, and listed what it undid, what failed to undo, and what it cannot undo.

Running again, stopping and raising a budget (`--rerun`, `--stop`, `--extend`) are the owner's answers, so each takes
where the answer comes from as `bay approve` does: a terminal, the default, which must be interactive and where the
owner types yes, or `--via chat --quote "<the owner's exact words>"`; each is refused unless `approvals.from` in
agentbay.config.yaml lists it, and by default it lists terminal alone. The kernel records it with the answer, as
`owner at the terminal` or `owner via chat, quoted: "<words>"`, in the answer's `run.resumed` event (`bay runs <run> --events`). A stop gives the
run the reason `<that source> stopped the run.`, except at a foreach whose items failed, whose sentence is the reason.
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
owner with a question that says a test stopped it there. Resuming it stops there again. `bay` itself has no way
to start one: a test that drives `bay` in a process of its own runs `node tests/start-part.ts <mode>:<path>
'<trigger json>' '<part json>'` in its project, which works only in a folder under the temporary folder.

Forge's tests give outputs captured from whole runs, in `components/base/forge/tests/given-*.json`. When a
workflow or an output schema changes, they no longer start, and the refusal names the step. `node
components/base/forge/tests/recapture.ts [given-<name>.json ...]` makes them again: in a copy of the kit, it runs
the whole end-to-end case each file comes from, writes the outputs of the steps before the one the test runs from,
with the commits the test makes again by branch, and formats the files. `recapture.ts` lists, for each file, its
case and the step its test runs from. A case that only remakes a file, since the test that reads the file holds every
one of its assertions, runs only when `FORGE_RECAPTURE` is set, as `recapture.ts` sets it; the everyday suite skips
it. With no file named it makes all four, in about four minutes. The whole cases do not check the cards
their files lead to, so the test that reads a file may then need its expected card changed to the one it now prints.
