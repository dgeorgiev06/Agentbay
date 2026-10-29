# agentbay

Jobs for Claude Code, defined as data. You describe a **mode** (a job with endpoints): which of the
framework's **roles** do its steps, the **environment** each role works in, the capabilities it needs, and its
playbooks, skills and rules. **Connectors** do the deterministic work, and one **agent profile** says how an
LLM product runs the roles. agentbay checks that it all wires up, compiles it into Claude Code, and runs it
through one dispatcher that enforces schemas, effects, budgets and secrets, and logs every step.

```
Chief of Staff (your main Claude Code session)
  └─ bay call feed-briefing.digest ──> Mode feed-briefing (extends briefing), feature digest
        refresh   run: items.store/v1.sync   ─ code ─> Env local-feeds ─> corpus-store ─> x-api (api.x.com)
        gather    run: items.store/v1.query  ─ code
        themes    role: analyst    ─ subagent analyst--feed-briefing (balanced: sonnet) in Env local-feeds
        review    role: reviewer   ─ subagent reviewer--feed-briefing (deep: opus), from the feature's review block
```

The framework owns the five roles (`lead`, `analyst`, `researcher`, `builder`, `reviewer`) and the agent
profile (`framework/agents/claude-code.yaml`, the only file that names models). You own modes, envs and
connectors. Modes name capabilities (`items.source/v1`), never tools; agents never see secrets or connectors.

Design: [docs/DESIGN.md](docs/DESIGN.md). Contracts: [docs/INTERFACES.md](docs/INTERFACES.md).

## Install

Python 3 and Claude Code. From a clone:

```bash
pip install -r requirements.txt        # pyyaml, jsonschema
./bay.sh validate                      # lint + resolve everything
python3 tests/run.py                   # the test suite (stdlib runner; pytest works too)
```

## Quickstart (offline, 5 minutes)

```bash
cp agentbay.config.example.yaml ~/code/my-repo/agentbay.config.yaml   # selects the offline env (fake source)
./bay.sh build --project ~/code/my-repo
cd ~/code/my-repo && claude            # restart Claude Code after every build; accept the workspace trust prompt
```

Ask *"brief me on the last 3 days"*. The Chief of Staff runs
`.agentbay/bay call feed-briefing.digest '{"since": "3d"}'`: the dispatcher syncs the corpus store (code, no
agent) and returns `needs-agent` for step `themes`. The coordinator runs the `analyst--feed-briefing`
subagent with the step plan, submits its digest (`.agentbay/bay submit <callId> themes '<json>'`),
deterministic checks run, the `reviewer` returns one verdict per Definition of Done item, and the call ends
`done` (or `partial`). `.agentbay/bay status` shows calls, steps and cost. Questions (*"what did people say
about custody?"*) run `feed-briefing.ask`, where the analyst answers through read-only SQL over the store.

**Real X timeline:** store `X_CLIENT_ID`, `X_CLIENT_SECRET` and `X_REFRESH_TOKEN` with `./bay.sh secret set
<NAME>` (macOS keychain; on Linux use `secrets: {provider: env}`), delete the
`envs: { local-feeds: local-feeds-offline }` line in agentbay.config.yaml, set `connectors.x-api.userId` and
rebuild. Caps `maxItemsPerRun`, `monthlyItems` and `spendUsd` stop a sync before it exceeds one.

**Your email** works the same way: `mail-briefing` keeps the messages your selectors match (offline it uses a
sample mailbox), and *"what needs my reply?"* runs `mail-briefing.digest`. See [Gmail setup](#gmail-setup).

**What to keep** is a list of selectors in `modes.feed-briefing.selectors` (default `[{id: home}]`):

```yaml
modes:
  feed-briefing:
    selectors:
      - { id: home }                                     # the home timeline
      - { id: staking, in: list:1585430245762441216 }    # an X List (scope list.read)
      - { id: vitalik, from: vitalik, not: { text: giveaway } }
```

## Gmail setup

`mail-briefing` reads your Gmail through your own Google Cloud OAuth client with the `gmail.readonly` scope:
it can read mail, never send, label, move or delete it. Attachment text is extracted for docx, txt, csv and md
(PDFs and other files are kept as name, type and size only).

**Requirement:** `bay auth gmail` stores the login in the **macOS keychain** (secrets provider `keychain`, the
default on macOS). It does not work with the `env` provider or on another OS: those cannot store the refresh
token it receives.

1. In the [Google Cloud console](https://console.cloud.google.com/) create or pick a project and enable the
   **Gmail API** (APIs & Services -> Library).
2. Open **Google Auth Platform** (the console's OAuth section; older consoles call it "OAuth consent screen").
   Menu names shift from time to time; the settings below are what matters:
   - **Branding:** an app name and your address as the support and developer contact.
   - **Audience:** user type *External*, publishing status **Testing**, and your Gmail address under
     **Test users**.
   - **Data access:** add the scope `https://www.googleapis.com/auth/gmail.readonly`, and only that one.
   - **Clients:** create a client of application type **Desktop app**. Store its id and secret:
     `./bay.sh secret set GMAIL_CLIENT_ID` and `./bay.sh secret set GMAIL_CLIENT_SECRET`.
3. Sign in: `./bay.sh auth gmail` (or `.agentbay/bay auth gmail` in a built project), in your own terminal. It
   opens your browser, receives Google's answer on `127.0.0.1` and stores `GMAIL_REFRESH_TOKEN` in the keychain.
4. Remove `local-mail: local-mail-offline` from the `envs:` line of agentbay.config.yaml, set your selectors
   under `modes.mail-briefing` (see agentbay.config.example.yaml: the first sync reads the last 30 days, up to
   500 messages a run; later syncs read new changes and fill in older mail until the 30 days are covered) and
   rebuild.

**Weekly re-login:** Google expires the login of an app in Testing after 7 days. `mail-briefing.sync` then ends
`blocked` with the reason and the one command to run, `bay auth gmail`. A digest or question still runs on the
stored mail: the call ends `partial`, its coverage note says Gmail was not read and names `bay auth gmail`, and
the status stays `stale` until you sign in again.

## Folder map

```
modes/           your modes: briefing (abstract base: sync, digest, ask, prune), feed-briefing (X posts),
                 mail-briefing (Gmail, read-only), delivery (research, build + review)
envs/            your envs: local-feeds, local-feeds-offline, local-mail, local-mail-offline
connectors/      your connectors: x-api (official X API v2), gmail-api (Gmail API, read-only), fake and
                 fake-mail (offline)
interfaces/      items.source/v1, items.store/v1
framework/       shipped with the kit, never edited by users:
  roles/ agents/   the five roles and the claude-code agent profile
  modes/           cos (Chief of Staff, project workflows), forge (create, extend), improve (findings backlog)
  envs/ interfaces/ connectors/ rules/   framework wiring; conformance rules
schemas/         the contracts (apiVersion agentbay/v2) and data schemas
bay/             resolver, lint, dispatcher, connector runtime, guard hook, adapter, ledger, CLI, improve/
coordinator/     Chief of Staff slash commands
tests/           python3 tests/run.py (connector tests live next to each connector)
```

`bay build` writes subagents, skills, commands, merged settings and hooks, one `CLAUDE.md` import line and
`.agentbay/` into the target project, tracked in `.agentbay/manifest.json`; `bay clean` removes exactly that.

## Commands

| command | does |
|---|---|
| `bay validate` / `bay lint` | check everything / just structure (`file:line` errors) |
| `bay build` / `bay clean` | compile into a project / remove what was generated |
| `bay ls`, `bay describe <mode\|role>`, `bay catalog [<name>]` | what exists, fully resolved; the registry |
| `bay call <mode>.<endpoint> '<json>'` | run a feature (cron features with `schedule:`; nothing runs schedules for you) |
| `bay submit <callId> <step> '<json>'`, `bay show <callId>` | hand back an agentic step's output; current state |
| `bay approve <callId\|runId> [--reject]` | pass an approval gate (your terminal only) |
| `bay status`, `bay log`, `bay note <ref> "text" [--instruction]` | calls, runs and cost; the raw ledger; record a note |
| `bay mode\|feature\|connector\|env new <name>` | scaffold (same templates as `forge.create`) |
| `bay improve weekly`, `bay improve decide <id> approve\|defer\|wontfix` | weekly improve pass; your decision on a backlog item |
| `bay secret set <NAME>` | store a secret (read from your terminal, never echoed) |
| `bay auth gmail` | sign in to Gmail in your browser (read-only scope); again whenever a sync says the login expired |

Run them as `./bay.sh <command>` in the kit, or `.agentbay/bay <command>` in a built project.

## Adding things

A source is one connector plus one binding line in an env; a new kind of briefing is a mode with
`extends: briefing`; a feature is `bay feature new`; a framework change is `bay call forge.extend`. Recipes:
[docs/INTERFACES.md#extension-recipes](docs/INTERFACES.md#extension-recipes).

## Safety, in one paragraph

The guard hook is defense in depth, not isolation: it narrows what subagents can ask to do, but cannot contain
code once something runs it. Nothing that runs code is auto-approved: subagents get no auto-approval except
their own role's read-only data shim, and the main thread is pre-approved only for the read and notes commands
`bay show|status|log|note|task|catalog`. `bay call`, `bay submit` and `bay approve` always prompt. Approval
gates, secrets, the Gmail login and backlog approvals need your terminal.
Details: [docs/DESIGN.md#safety-model](docs/DESIGN.md#safety-model).
