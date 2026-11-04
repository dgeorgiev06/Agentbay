# claude-transcripts (framework connector)

Implements `session.events/v1`: this project's Claude Code session transcripts as session episodes. The
parser is defensive (the format is not a stable API) and keeps structure and metadata only, never
conversation text. It never follows symlinks, skips files older than the window and is read-only.

A line that fails to parse or fold (bad JSON, too deep, over 4 MB, an unexpected shape) is counted as a bad line and
skipped, never echoed, so one record never fails a scan. Text is read in memory only to classify it and then dropped.
The connector runs only on the dispatcher side: agents never read transcript files, because `improve-local` gives
roles no path to them and the guard denies reads outside the project.

**Needs:** read access to `~/.claude/projects`. **Settings** (`connectors.claude-transcripts`): `root`, the
transcripts folder; see `config.example.yaml`.
