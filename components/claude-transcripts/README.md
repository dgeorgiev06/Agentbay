# claude-transcripts (framework connector)

Implements `session.events/v1`: this project's Claude Code session transcripts as session episodes. The
parser is defensive (the format is not a stable API) and keeps structure and metadata only, never
conversation text. It never follows symlinks, skips files older than the window and is read-only.

**Needs:** read access to `~/.claude/projects`. **Settings** (`connectors.claude-transcripts`): `root`, the
transcripts folder; see `config.example.yaml`.
