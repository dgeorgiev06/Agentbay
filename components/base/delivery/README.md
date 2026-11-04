# delivery

General delegation: research a question, or build a change and have it independently reviewed.

| feature | does |
|---|---|
| `research` | research a question and return a sourced brief |
| `build` | implement a change in the repo, then review it independently |

**Contract:** needs `workspace.read/v1`, `workspace.write/v1`, `git.read/v1` and `web.research/v1`. It takes no
settings.
