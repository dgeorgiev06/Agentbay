# agentbay: the words we use

One meaning per word. Briefs, plans, code names and reviews use these words and no others for these things. When a new term is needed, it is added here first. Decisions and their reasons are in `docs/adr/`.

## What the owner sees

| Term | Meaning | Do not say |
|---|---|---|
| **Kit** | The agentbay checkout: the kernel, the adapters and the modes that ship with it. | framework folder, repo root |
| **Project** | The owner's folder. It holds `agentbay.config.yaml`, the project's own modes and the `.agentbay/` data folder. | workspace, app |
| **Mode** | A folder with a `mode.yaml`. The unit that is installed, composed and permitted. | plugin, component, connector |
| **Action** | A named thing a mode can do, with typed input and output and declared effects. A mode's actions are its interface. | feature, command, endpoint |
| **Step** | One entry in an action's `run` list: a script, a skill or a call. | task (see below) |
| **Script** | Code a step runs, in a confined child process. It reaches the kernel only through the toolbox. | connector code |
| **Skill** | A `SKILL.md` with the seven sections. An agent does the work; the kernel checks the output. | prompt, playbook, role |
| **Workflow** | A named list of workflow steps (action, approval, wait, foreach) that the kernel runs durably. | pipeline, flow |
| **Run** | One execution of an action or workflow, recorded in the kernel database. It can wait, resume and be undone. | job, session |
| **Interface** | A set of action signatures with no code, named `name@major`. A mode implements it; another mode requires it. | API, contract (see below) |
| **Binding** | The project's choice of which mode serves an interface for a requiring mode. | wiring, injection |
| **Brought mode** | A base mode active in a project because forge is: proof, bound to `proof@1`, and git-worktrees, bound to `worktrees@1`, each only while the config binds no mode to that interface. The kernel brings them; forge brings no toolchain, and `bay check` names each mode it brought. | default mode, implicit dependency, auto-install |
| **Effect** | What an action may do to the world: `read`, `write`, `network`, `spend`, `delete`. Declared per action. | permission (see Grant) |
| **Grant** | What a mode may reach: its database, paths, secrets, hosts, commands. Declared in `resources:`. | permission, capability |
| **Throwaway folder** | A folder named under a mode's `resources.files.throwaway`. The kernel makes folders and links in it and removes files and folders from it for that mode; the mode's scripts never read or write its files, and its commands fill it. | scratch, temp folder |
| **List** (a mode's) | The commands a mode lists, each by name with its words and effects, the words its commands start with, and its throwaway folders, taken together. A base mode's list is granted to it; any other mode's list is granted only while the owner trusts it. | allow-list, command list, permissions |
| **Trust** | The owner's statement that one named mode outside the kit's `components/base/` may have its list, bound to that exact list by its hash. A changed list is not trusted until the owner trusts it again. Trust stops a mode's script and an agent inside a run's step from granting commands to themselves; it does not stop an agent that has the owner's shell. | allow-list, permission, approval (an approval is a step of a run) |
| **Trust record** | The file `.agentbay/trust.json`: for each mode the owner trusts, the list as trusted, its hash, when and how the trust was given. The kernel reads it at each load, and no mode may name it. | trust file, trust store, allow-list |
| **Throwaway copy** | The folder a caller makes for a toolchain's check or test, holding a copy of the code, and removes afterwards (the worktrees interface's `copy`). The check or test may write inside it and nowhere else. Its folder is the top of a git repository of its own that holds the commit's files as one commit, with the caller's links present and ignored, so tools list the copy's files as they list a project's; nothing done inside it changes the project's repository. It is not a throwaway folder, which a mode names in its manifest, and not a worktree a builder works in. | scratch copy, temporary copy, sandbox, clone |
| **Card** | Any text the kernel prints for the owner to read before answering with `bay approve`, at most 44 columns wide. The trust card is one card. An approval's card is what an approval shows when a script hands it a title and lines; each line has a mark, words and a source, and the kernel checks every line's source before it shows the card. The command `bay approve` is how the owner answers an approval or a card. | prompt, dialog, approval, summary |
| **Trust card** | The card the owner reads to answer `bay approve --trust <mode>`: the mode and its folder, every command of its list with its resolved words and effects, its throwaway folders, what trust means, and the start of the list's hash; after a change, only what changed, and what stayed in one line. Drawn from the manifest alone, at most 44 columns wide. | trust prompt, trust dialog |
| **Start card** | The card forge's workflows `one-slice` and `one-round` show before a slice is built: the planned slice's title, kind, base, write scope, the slices it comes after and its items, every line computed from the slice. Approving it cuts the slice's worktree; rejecting it fails the run, and nothing is cut. | build prompt, kickoff card |
| **Merge card** | The card forge's workflows `one-slice` and `one-round` show after proof has judged a slice: what changed and where the work is, each verdict with a failed one's reason, each judgement item as not judged, the size, and a line for each changed kernel, adapter, kit schema or base mode manifest file. Its choices are merge, send-back, keep and discard; merge is offered only when the builder built the slice and every must item, scope and declared passed. | review card, pull request, summary |
| **Approval** | A workflow step that waits for the owner and is bound to the content shown. | gate |
| **Budget** | A limit on a run: items, dollars, tokens, minutes. | quota |
| **Toolbox** | `bay/sdk.ts`. The only kernel file mode code may import. | SDK internals, helpers |
| **Test toolbox** | `tests/test-toolbox.ts`. The only kit file a mode's tests may import besides the toolbox. It opens a project, calls actions, answers skill steps and reads runs, and never hands out the kernel. | mode harness, test helpers |
| **Shared test** | `<name>/tests/shared.ts` beside an interface: what every mode that implements it must do, through the interface's actions only. Each implementing mode runs it from its own tests. | contract test, conformance suite |
| **Operation** | One thing a script or an agent's tool asks the broker to do, such as `files.read` or `commands.run`. Each has one entry in the broker's table: its request, its result and their guards. | call, request kind, broker method |
| **Ruling** | What an operation's rule returns: the value it allowed, which is all its handler is given, or the refusal. | permission, verdict |
| **Toolchain** | A mode that implements `toolchain@1` for one language: it names the language's files and practices, runs its checks in a checkout, and runs its tests there. | language mode, linter |
| **Verdict** | What a toolchain says of one check or one test run, or what proof says of one item of a definition of done: `passed`, `failed` or `inconclusive`. Inconclusive means nothing is known, and it is never a pass; any part of an item that is inconclusive makes the item inconclusive. | result, status, outcome |
| **Failing case** | One case of a failed test run, as a toolchain names it: its name, the test file it is in, and the first line of the test runner's message for it, at most 200 characters with the cut counted. A test file that did not load is not a case: the toolchain names it apart, under `notLoaded`. | failed test, error |
| **Choice** | One named answer an approval offers. It may have a rule: an earlier step's output that is true or false. The owner's decision names one choice, and later steps read it as the approval's output. | button, option (in prose "option" is fine), verdict |
| **Withheld choice** | A choice whose rule was false when the approval was first shown. It stays on the approval with the reason a script wrote, and the kernel refuses it. The rules are not evaluated again. | disabled, hidden or blocked choice |
| **Mark** (of a card's line) | Where a line of an approval's card came from: `ran`, a command the kernel recorded in this run or in a run one of its skills called; `computed`, a step that ran no skill; `judged`, a skill step the approval quotes, to which the kernel adds the skill and its tier. The kernel checks the kind of step a line cites, not whether its words are true. | label, tag, calc, source (the source is what a line cites) |
| **Not set up** | What a checkout or a project is for a check, or for the test run, when it lacks what the toolchain needs to run it, such as an agreed script in `package.json`. The verdict is inconclusive, with a sentence saying what to add, and `describe` lists it under `missing`. | missing tool, unconfigured |
| **Agreed script** | A `package.json` script the typescript mode runs by name: `typecheck`, `lint`, `format:check`, `deadcode` and `test`, which every project needs, and `generate:check`, which only some have. | npm task, target |

## What a builder of the kit sees

| Term | Meaning | Do not say |
|---|---|---|
| **Kernel** | The code in `bay/`. It loads modes, enforces grants and effects, and runs runs. It never drives a model. | engine (see below), core |
| **Engine** | The part of the kernel that advances a run step by step. | kernel, runner |
| **Broker** | The part of the kernel every resource request passes through. It applies grants and effects. | gateway, proxy |
| **Harness** | The agent program that does skill work: Claude Code, Codex and others. Named only in `adapters/`. | runtime, agent |
| **Adapter (harness)** | The code in `adapters/<harness>/` that fits one harness to the kernel. | plugin, integration |
| **Tier** | `fast`, `balanced` or `deep`. A skill names a tier; the project config maps tiers to models. | model |
| **Effort** | How hard a tier's model works on a step: `low`, `medium`, `high`, `xhigh` or `max`. The config's `tiers` sets it with the model; a tier without one runs at the harness's own effort. | reasoning level, thinking budget |
| **Feature** | A deep module of the kernel: a folder with one entry file. Only the entry file is imported from outside. Listed in `framework/features.yaml`. | module (ambiguous), layer |
| **Entry file** | The one file of a feature that others may import. Its exports are the feature's interface. | index, barrel |
| **Seam** | A place where behaviour can be swapped without editing the code around it. | hook, extension point |
| **Port** | An interface at a seam to the outside world (files, clock, processes, network). Exists only when two adapters exist. | abstraction, wrapper |
| **Adapter (port)** | A thing that satisfies a port: the real one or the test one. Always say which kind of adapter is meant. | mock, stub, fake (as a type name is fine) |
| **Slice** | One piece of work for one builder: one interface, one capability of the kernel or one mode. It has a name, a kind, a write scope, the slices it comes after with the reason, the interface it builds against if any, and its definition of done; its form is the slice in `proof@1`'s request. | ticket, task, phase |
| **Sighting** | What the agentbay hook records when it lets a step agent's `submit` through: the hash of the call's token, and the agent's mode and skill. With `skillSteps.run: with-the-hook`, the default, the kernel takes a skill step's output only against an unused sighting of its token by its step's mode and skill, and uses it up. | hook mark, seen flag |
| **Task** | What the kernel hands a harness for one skill step. Not a piece of build work. | job |
| **Brief** | The seven-section instruction a builder receives for a slice. | prompt |
| **Builder** | An agent that writes a slice. | worker, dev |
| **Test writer** | The agent that writes a slice's tests from its conditions and interface, before any builder works, and hands them in as data, never as files. It never reads the builder's code. | tester, QA agent |
| **Round** | One pass of a slice through the test writer and the builder, ending in one commit that holds the builder's work and the tests, which proof judges. Forge's workflow `one-round` runs one. | iteration, cycle, attempt |
| **Kept tests** | A slice's tests while a round runs, held by forge in its database partition `kept-tests`, each gzipped and in base64, until the builder's step is closed and they are committed. | stored tests, hidden tests, vault |
| **Reviewer** | The agent that checks a slice against its definition of done and attacks it. Never the builder. | approver |
| **Bug injection** | Flipping one line on purpose to see whether a test at the feature's interface fails. | mutation testing (fine as a synonym in prose) |
| **Proof** | The base mode that turns each item of a slice's definition of done into a verdict by script, with no model, behind the interface `proof@1`. It reaches code only by copy, call, remove: a throwaway copy, a toolchain's call in it, and the copy removed. | review, QA, verification mode |
| **Kind of proof** | One of eight ways proof judges an item, each a script: `checks`, `fails-first`, `in-scope`, `as-declared`, `bugs-caught`, `same-output`, `count`, `real-thing`. The set is closed. | check type, rule, assertion |
| **Write scope** | The paths a slice may change, as patterns. Proof fails the slice's item `scope` for any changed path outside it. | allowed files, ownership |
| **Declaration** | What a builder states it will change before its first edit: files, and the action names that modes and interfaces gain, lose or change. Proof compares it with what changed and shows it only as counts. | plan of change, intent, manifest |
| **Judgement item** | An item of a definition of done that names no kind of proof. Proof returns it as it was given; a person or a named model judges it, and every card labels it as judgement. | manual item, soft item, review item |
| **Plan** | A YAML file of the forge mode, under `docs/plans/`: a title and the slices of one piece of work, each with its title. `forge.waves` works out its table, its waves and its longest chain; nobody edits those by hand. A merged slice stays in its plan. | roadmap, backlog, schedule |
| **Wave** | The slices of a plan that can be built side by side: no order between them, and scopes that share no path. A wave can use one builder per slice. | batch, stage, phase |
| **Longest chain** | The longest run of slices in a plan in which each comes after the one before. A plan takes at least as many waves as its longest chain has slices. | critical path |

## Words with two meanings elsewhere

- **Contract.** Use **interface** for a mode's action signatures, **skill contract** for the seven sections, and **shared types** for `bay/contracts.ts`. Never bare "contract".
- **Module.** In prose about design, a module is anything with an interface and an implementation. In this repo the unit is a **feature** (kernel) or a **mode** (everything else).
- **Adapter.** Harness adapter or port adapter. Say which.
