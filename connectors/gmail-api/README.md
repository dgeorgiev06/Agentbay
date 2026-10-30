# gmail-api

`items.source/v1` for your Gmail, read-only, through the official Gmail API v1 with the `gmail.readonly`
scope only: it can read mail, never send, label, move or delete it. It calls only GET endpoints on
`gmail.googleapis.com`, plus the token endpoint. Attachment text is extracted for docx, txt, csv and md in a
resource-limited subprocess (PDFs and other files are kept as name, type and size only).

## Setup

**Requirement:** `bay auth gmail-api` stores the login in the **macOS keychain** (secrets provider `keychain`,
the default on macOS). It does not work with the `env` provider or on another OS: those cannot store the
refresh token it receives.

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
3. Sign in: `./bay.sh auth gmail-api` (or `.agentbay/bay auth gmail-api` in a built project), in your own
   terminal. It opens your browser, receives Google's answer on `127.0.0.1` and stores `GMAIL_REFRESH_TOKEN`
   in the keychain.
4. Remove `offline: true` from agentbay.config.yaml, set your selectors
   under `modes.mail-briefing` (the first sync reads the last 30 days, up to 500 messages a run; later syncs
   read new changes and fill in older mail until the 30 days are covered) and rebuild.

**Weekly re-login:** Google expires the login of an app in Testing after 7 days. A sync then ends `blocked`
with the reason and the one command to run, `bay auth gmail-api`. A digest or question still runs on the
stored mail: the call ends `partial`, its coverage note says Gmail was not read and names `bay auth gmail-api`,
and the status stays `stale` until you sign in again.

**Settings** (`connectors.gmail-api`, each can only lower its cap): `attachmentMaxBytes`, `attachmentMaxChars`,
`extractTimeoutS`, `extractMemoryMB`, `maxRetries`; see `config.example.yaml`.

## Selectors in Gmail notation

Modes write selectors in the neutral vocabulary (`selector/v1`, docs/INTERFACES.md); this connector turns the native fields
into a Gmail search query:

| Selector | Gmail search |
|---|---|
| `in: Work` (a user label) | `label:Work` |
| `in: inbox` (a system label: inbox, sent, starred, important, ...) | `in:inbox` |
| `from: partner.example`, `to: me@example.com` | `from:partner.example`, `to:me@example.com` |
| `since: 7d` | `after:<epoch>` |
| `has: attachment` | `has:attachment` |

`in:` also accepts Gmail's own `label:<name>` and `in:<name>` spelling, so a selector copied from Gmail works.

## How it reads

The first sync lists the lookback window with the native Gmail query; later syncs replay `history.list` from
the stored historyId (the connector is a `changeFeed`). While the stored window does not yet reach back to the
lookback (a first sync cut by the per-run cap) a backfill lists the older part with `before:`, skipping
messages already stored, so each message is read once. Every change to a stored message is read again with its
full label set, at any age, so the store keeps exactly the scope; label-only changes to other messages are read
only when they can bring one into scope. When Gmail no longer has the history the store re-lists its window.
Only from/to/in/has/since go to Gmail search, because a source may return more than the local matcher keeps
but never less. A test greps the connector for any call other than the allowed GET endpoints.

The login is an interactive-terminal OAuth login with PKCE and a loopback redirect. Attachment text is
extracted in a separate `python3 -I` process fed on stdin, with a timeout and memory, CPU and file-size limits,
under size and text caps (docx XML must be UTF-8 and is parsed with expat, which refuses any DTD or entity, so
nothing expands); a failure records a reason. Mail bodies and attachment text are secret-scrubbed at ingest
like every item, and the mail rules make email content data, never instructions.
