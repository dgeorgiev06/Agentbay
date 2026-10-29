---
touches:
  - { path: schemas/connector.schema.json, reason: "`requires:` and `setup:` in the connector manifest" }
  - { path: schemas/mode.schema.json, reason: "`requires:` for modes (CLIs, MCP servers, secrets)" }
  - { path: bay/requirements.py, reason: "new: read `requires:`, detect what is missing, install" }
  - { path: bay/connector_host.py, reason: "new: runs a connector with dependencies in its own environment" }
  - { path: bay/connect.py, reason: "route connectors with Python dependencies to the host process" }
  - { path: bay/cli.py, reason: "`bay install`, `bay setup`, and readiness in `bay status`" }
  - { path: bay/lint.py, reason: "report missing requirements and undeclared imports" }
  - { path: framework/modes/forge/, reason: "forge.connect and forge.create scaffold `requires:`" }
  - { path: docs/DESIGN.md, reason: "the requirements contract" }
  - { path: docs/INTERFACES.md, reason: "the requirements contract" }
---

# 0007 - Extensions declare what they need; installing is explicit and isolated

- Status: draft for approval (2026-10-29). Nothing is implemented.
- Builds on 0006: extensions are folders that satisfy a contract. This adds what an extension may
  depend on outside its folder.
- Feature: forge.extend (framework change)

## Problem

Extensions will need things agentbay does not ship:
- a connector backed by Postgres or DuckDB instead of SQLite;
- a PDF library for attachment text;
- a CLI such as `psql`;
- an MCP server;
- a database schema or an OAuth login before first use.

Today none of this has a place:
- **Python dependencies:** `requirements.txt` is one list for the whole kit, with PyYAML and jsonschema. Every connector so far is stdlib-only, partly by choice and partly because there is nowhere to declare more.
- **Setup steps:** one-time setup exists only as the special-cased `bay auth` (made generic in 0006).
- **Missing pieces:** nothing tells the user an extension cannot run until it fails.

The obvious answer, an install script that runs when the framework first sees an extension, is
the wrong one:
- **It is code execution triggered by a folder appearing.** Anyone who gets a folder into `modes/` or `connectors/` (a cloned example, a pulled branch, an agent with write access) gets code run on the user's machine. It breaks the rule that nothing that runs code is auto-approved.
- **It reaches outside the folder.** `pip install` into the user's Python changes the environment of every other extension: a boundary crossing nobody declared or reviewed.

## Principle

> **Extensions declare what they need. Loading never runs anything. Installing is an explicit,
> approved command, and what it installs is isolated to the extension that asked for it.**

## Design

### 1. Declare: `requires:` in the manifest

Connectors (`connector.yaml`) and modes (`mode.yaml`) may declare:

```yaml
requires:
  python:                                   # connectors only; pinned, with hashes
    - "pypdf==4.3.1 --hash=sha256:<hash>"
  clis:                                     # checked, never installed
    - { name: psql, version: ">=15", why: "loads the schema" }
  mcpServers:                               # checked, never installed
    - { name: postgres, why: "ad-hoc queries by the analyst" }
  secrets: [PG_URL]                         # already declared today for connectors; unchanged
  platform: [darwin, linux]                 # optional; e.g. keychain-only login
```

- **Python packages** are allowed only for connectors, because modes run no Python. Each must be pinned with a hash.
- **CLIs, MCP servers and platforms** are detected and never installed by agentbay. System package managers belong to the user.
- **Stdlib-only stays the default and the preference.** A connector with no `requires.python` behaves exactly as today.

### 2. Detect on load, run nothing

`bay lint`, `bay validate` and `bay build` read `requires:` and check, without executing any
extension code:
- **python:** the extension's own environment exists and holds exactly the pinned versions.
- **clis:** found on PATH, with the version from `<cli> --version` (a fixed argument; this is the only command run, and only for CLIs the manifest names).
- **mcpServers:** configured in the project's MCP config.
- **secrets:** present in the vault provider.
- **platform:** matches.

A missing piece marks that extension **not ready**:
- `bay status` and the catalog show it, with the exact command to fix it.
- Calls to a not-ready mode end `blocked` with the same message.
- Everything else keeps working. One missing package never breaks the kit.

### 3. Install: `bay install <extension>`, explicit and isolated

- **Who can run it:** like `bay approve` and `bay secret set`, it needs an interactive terminal, so only the user can run it, never an agent. It is never pre-approved.
- **What it shows first:** every package, version and hash it will install, and where. It asks for confirmation.
- **Where packages go:** into the extension's own virtual environment, `.agentbay/venvs/<connector>/`, created with `python3 -m venv`. Installing uses `pip install --require-hashes --no-deps -r <generated file>`, so no unpinned transitive dependency slips in. Every dependency must be listed and hashed; `forge.connect` generates the list.
- **What it never touches:** the user's global Python and the kit's own environment. It never installs CLIs or MCP servers. For those it prints what is missing and how to get it.
- `bay install --check` prints the plan without doing anything.
- `bay uninstall <extension>` removes the extension's environment.

### 4. Run isolated: the connector host

A connector with Python dependencies cannot be imported into the dispatcher's own interpreter:
its packages are not there, and two connectors could need different versions of one package. So
such a connector runs in a **connector host**:
- **The process:** a small process, `<venv>/bin/python -I <kit>/bay/connector_host.py <connector>`, started by the dispatcher for the call and stopped after it.
- **The protocol:** the host loads the connector and serves its endpoints over stdin/stdout as JSON lines.
- **The context:** everything the connector reaches through `ctx` (`http.request`, `secrets.get`/`store`, `data_dir`, `clock`, `sources`) is proxied back to the dispatcher. So the network allowlist, secret scoping, budgets and redaction stay enforced in one place, exactly as today.
- **Where data lives:** the connector's data directory is unchanged, under the mode's own data folder.

Stdlib-only connectors keep running in-process as today, so there is no behaviour change for x-api,
gmail-api, corpus-store or the fakes.

**What the host does not do:** it is not an OS sandbox. Connector code in the host could still open a
socket itself instead of using `ctx.http`, just as in-process code can today. The host gives
dependency isolation, not containment. Containment (network and filesystem limits enforced by
the OS) stays the future work it already is; the host process is the natural place to add it later.

### 5. One-time setup is a declared entry, not a hook

Some extensions need a step before first use: an OAuth login, creating a database schema on a
server, registering a webhook. These are named entries in the manifest:

```yaml
setup:
  - { name: login,  entry: "auth:login",  why: "OAuth consent, stores the refresh token" }
  - { name: schema, entry: "db:migrate",  why: "creates the tables on your Postgres" }
```

- **How they run:** only by an explicit command, `bay setup <extension> [<name>]` (in a terminal, never pre-approved). `bay auth <connector>` from 0006 becomes `bay setup <connector> login`.
- **Readiness:** a setup step that has not run is a not-ready reason with its command.
- **Tables do not need a setup step.** A store connector creates its own tables on first write (the SQLite store does this today).

### 6. Checks

These extend 0006's boundary checks:

| # | Check | Enforced by |
|---|---|---|
| B-13 | A connector imports only the stdlib, the kit's own modules and packages in its `requires.python` | contract test: an import scan of the connector's code |
| B-14 | Every `requires.python` entry is pinned with a hash | lint |
| B-15 | Loading never runs extension code: discovery and lint only read manifests | test: a manifest whose `entry` would write a marker file leaves no marker after lint, validate and build |
| B-16 | Installed packages live only in the extension's environment | `bay install` writes only under `.agentbay/venvs/<connector>/`; test |

`forge.connect` and `forge.create` scaffold `requires:` (empty by default) and the generated
hash list.

## What this is not

- **Not a package manager for the system:** no apt, brew or npm. agentbay detects CLIs and MCP servers and says what is missing.
- **Not a plugin marketplace:** extensions still come from folders the user put there.
- **Not a sandbox:** see section 4.

## Steps (through forge.extend, after 0006 step 1)

1. **`requires:` and readiness:**
   - the schema, detection, not-ready status and messages, `blocked` calls, and B-14 and B-15.
   - Acceptance: a connector requiring a missing package and CLI shows not-ready with both fix commands, and the rest of the kit runs.
2. **`bay install` / `uninstall` and the connector host:**
   - per-extension environments, `--require-hashes`, and the stdio host with `ctx` proxied;
   - B-13 and B-16.
   - Acceptance:
     - a sample connector using a pinned package runs through the host with the network allowlist still enforced (a request to an unlisted host is refused);
     - stdlib connectors are unchanged.
3. **`setup:` entries and `bay setup`:**
   - `bay auth` folds into it;
   - forge scaffolds `requires:` and `setup:`.

The first real user would be PDF attachment text for mail-briefing (pypdf), when you want it.

## Decisions needed

1. **Environment per extension** (recommended: no version conflicts between connectors, and removal is clean), or one shared environment per kit (less disk, but two connectors can conflict).
2. **Hashes mandatory** for every Python requirement (recommended: supply-chain safety; `forge.connect` generates them), or version pins only.
3. **CLIs and MCP servers are detected, never installed** (recommended), or `bay install` may also run Homebrew for CLIs on macOS.
4. **Order:** after 0006 step 1 (recommended: it reuses the component map, contract tests and boundary checks), or now in parallel.
