# What the kit offers a mode

How a mode is put together in this kit, for whoever designs, declares, tests or builds one. Paths are from the
top of the kit, except where a path is said to be inside the mode's folder. Where nothing in the kit enforces a
rule, the sheet says "by convention".

## The folder

- A mode is a folder, `components/modes/<name>/` (the kit's own base modes are in `components/base/<name>/`),
  with `mode.yaml` at its top. The manifest's form is `schemas/mode.schema.json`.
- `mode.yaml` must give `name` (the folder's name), `version` (major.minor.patch), `description` and `actions`.
- The top of the folder holds only `mode.yaml`, `README.md`, the files named in `extraFiles`, and the folders
  `skills/`, `scripts/`, `workflows/`, `schemas/`, `migrations/` and `tests/`. `bay check` reports anything else.

## Actions and their schema files

- Each action is `actions.<name>`, with `description`, `effects`, `run`, and its request and response as JSON
  Schema files named in `input` and `output`. The kernel checks the input before the run starts and the output
  at its end.
- Every file mode.yaml names is relative to the mode's folder. The manifest's form says of such a path: "A path
  relative to the mode's folder that neither starts with / nor contains a .. segment." The kernel refuses any
  other path, so mode.yaml cannot name a design's files in `docs/designs/`.
- A mode built from a design gets its schema files from the design: the builder copies each request and
  response schema file the design gives, `docs/designs/<job>/schemas/<interface>/<action>-request.json` and
  `<action>-response.json`, byte for byte and under the same name, into the mode's `schemas/` folder, and
  `input` and `output` name the copies, such as `schemas/add-request.json`. The declaration lists every copy.
- A mode's schema file may refer, with `$ref`, only to a part of itself (`#/...`) or to
  `<interface>@<major>/<file>#<part>` of a kit interface the mode implements or requires. `bay check` refuses a
  reference to another file by its name, such as `add-request.json`, so a design schema that refers to another
  file cannot be copied as it is: the builder stops and says so.
- `run` lists the action's steps in order, each `script: scripts/<file>.ts`, `skill: skills/<folder>` or
  `call: <interface>.<action>`. A step's output is the next step's input, and the last step's output is the
  action's.

## Scripts

- A script is a `.ts` file in `scripts/` that exports `run = defineScript(async (input, context) => ...)`, with
  `defineScript` from the SDK, `bay/sdk.ts`. What it returns is its step's output. `fail(reason)`, also from
  the SDK, ends the run as failed, with the reason in it.
- Mode code imports only the SDK (`agentbay/sdk`, or, in a mode of the kit, a relative import of `bay/sdk.ts`),
  `node:` built-ins and files of its own mode; no package. `bay check` reports any other import.
- `context` gives, as `ScriptContext` in `bay/sdk.ts` says:
  - `context.db`: `query(sql, parameters)` for one select, with or values statement; `execute(sql, parameters)`
    for one statement of any other kind; `partition(name)`, a second database of the mode's own.
  - `context.files`: `read`, `write`, `list`, `makeFolder`, `link` and `remove`, for the paths in
    `resources.files`.
  - `context.settings`: the mode's settings.
  - `context.now()`: the current time, which a test can set.
  - `context.random(bytes)`: random bytes.
  - `context.call(reference, input)`: runs another action and answers with its output: an action of the same
    mode by its name alone, or `<interface>.<action>` of an interface in `requires.interfaces`, served by the mode
    the project binds to it.
  - `context.http`, `context.secrets`, `context.commands`, `context.events`, `context.spend` and
    `context.schemas`; `context.caller`, the mode that called the action, if any; `context.skillInput`, in a
    script that checks a skill's output, the skill's input.
- Each of them except `settings`, `now`, `caller` and `skillInput` answers `{ ok: true, value }`, or
  `{ ok: false, message }` with the reason it was refused or failed.

## How a mode keeps data

- A mode keeps its data in its own SQLite database. mode.yaml declares it as
  `resources: { db: { migrations: migrations } }`: `resources.db.migrations` names the mode's folder of SQL
  files, which is `migrations` when it is left out.
- Each SQL file there is named `NNNN-name.sql`, such as `migrations/0001-todos.sql`, and they run in the order of
  their names. Before the first statement a step runs on the mode's database, the kernel runs the files not run
  before. A partition runs them when the script calls its `migrate()`.
- The kernel keeps the database in the project at `.agentbay/data/<mode>.db`, and a partition at
  `.agentbay/data/<mode>--<partition>.db`.
- Each call runs one statement. Attach, detach, vacuum, pragma and transaction statements are refused, so a mode
  reads and writes the tables of its own database only.
- A module of a design that owns tables keeps them in its mode's database. Keeping data there and not in files of
  the mode's own is by convention: the kernel does not stop a mode that declares `resources.files.write`.

## Effects

- `effects` lists every effect the action may have, among `read`, `write`, `network`, `spend` and `delete`,
  including those of the actions it calls.
- The kernel refuses: a statement that changes data without `write`; one that holds delete, drop or truncate
  without `delete`; writing a file without `write`, and removing one without `delete`; a network request without
  `network`; reporting a spend of more than nothing without `spend`; a call to an action with an effect the caller
  does not declare. Nothing is refused for want of `read`: it is declared by convention.
- A request reaches only the hosts in `resources.network`, `context.secrets` only the names in
  `resources.secrets`, and `context.commands` only the commands in `resources.commands`.

## Settings

- `settings` in mode.yaml names a JSON Schema file of the mode, such as `schemas/settings.json`. The project's
  config gives the values under its own `settings`, keyed by the mode's name; the kernel checks them against the
  schema when it loads, and a script reads them in `context.settings`.

## Skill steps and approvals

- A skill step is `skill: skills/<folder>` in an action's `run`, with a `role` or a `tier`, and `checks`,
  scripts that send the output back, three rounds at most. The folder holds `SKILL.md`; forge's own skills, in
  `components/base/forge/skills/`, show its sections.
- An approval is a step of a workflow file that mode.yaml lists in `workflows`: `approval: <question>`, with
  `show` and, when the owner picks one of several, `choices`. The form is `schemas/workflow.schema.json`;
  `components/modes/pm/workflows/ask.yaml` is an example.

## Tests

- A mode's tests are `.test.ts` files in its `tests/` folder, run with `node --test`. They may import the kit's
  `tests/test-toolbox.ts`, besides what mode code may import.
- A mode's test opens a throwaway project with `openModeProject(config, { project: import.meta.dirname })`
  from the test toolbox: `config` is a project config, such as
  `{ modes: ["todo"], bindings: {}, adapter: "claude-code" }`. The call is the same for a mode of the kit and
  for a mode of a project beside it: the toolbox opens the project that the test's folder is in, and when that
  is the kit itself, it opens the kit's modes once, as it does when `options` is left out. It answers with
  these, among others:
  - `output(reference, input)`: runs the action, such as `todo.add`, asserts that the run is done, and gives its
    output.
  - `failure(reference, input)`: runs the action, asserts that the run failed, and gives its reason, which holds
    the sentence the script gave `fail`.
  - `refusal(reference, input)`: asserts that the kernel refused to start the run, such as for an input its
    schema does not admit, and gives the messages.
  - `close()`: removes the project.
- When the project's modes do not load, such as when mode.yaml names a path with `..`, `openModeProject` fails
  with a JSON list of the kernel's problems, each with a `message`, such as
  "actions.add.input is not in the expected form".

## What a mode may not do

- The kernel refuses, or `bay check` reports:
  - a path in mode.yaml that starts with `/` or contains `..`;
  - an import from outside the mode's folder, other than the SDK, `node:` built-ins and, in tests, the test
    toolbox;
  - reading a file outside the mode's folder and `resources.files`, or writing one outside
    `resources.files.write`; and `resources.files` may not name the kernel's folders, `.agentbay/`, `.git/`, the
    project's config or another mode's folder, and `write` may not name the mode's own `mode.yaml`, `scripts/` or
    `skills/`;
  - reaching another mode's database: each mode has its own file, and attach is refused. A mode reaches another
    mode's data only by calling its actions through an interface;
  - a host not in `resources.network`, and any request without the `network` effect.
- By convention, and not enforced: a mode keeps its data in its database, not in files.

## Two meanings of "interface"

- In a design, an interface is a module's entry: its actions, each with request, response and examples. When a
  design says "module todo implements the interface todo", it means the module offers those actions. That
  interface is not a kit interface, and the mode's mode.yaml has no `implements` for it.
- In the kit, an interface is `name@major`, a contract several modes implement: `<name>.yaml` and the folder
  `<name>/` of its schema files, under `components/base/interfaces/`. A mode names one in `implements` or
  `requires.interfaces`, and a mode that implements one leaves out `input` and `output` of its actions, which the
  interface gives.
- A mode built from a design needs no kit interface, unless the design says another mode must implement the same
  contract.
