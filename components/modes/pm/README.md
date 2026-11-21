# pm

The PM mode interviews the owner about a piece of work, turn by turn, until nothing important is left assumed, and then writes a requirements file other modes build from. Its design is `docs/designs/pm-mode/design.md`. This folder holds its first slice, GR1: the scripts of a turn. No skill, workflow or write is built yet.

An interview keeps a tree of questions. Each question names the questions it comes after, and is a decision, which is the owner's; a fact, which the repository answers; or one talking cannot settle. The frontier is every open decision whose earlier questions are all settled. A turn asks the whole frontier at once, at most twelve questions, or one question when the owner asks for one at a time.

## Actions

| action | effects | runs |
|---|---|---|
| `frontier` | read | `scripts/frontier.ts`: the frontier, the questions this turn asks, the facts to look up, the questions talking cannot settle, the counts, and each problem of the tree: an id used twice, a question after one the tree does not have, questions that come after each other. |
| `check-turn` | read | `scripts/check-turn.ts`: a turn asks exactly the questions the frontier gives, each once; each recommendation names one of its question's choices; a fact answers a fact, never a decision, and the file it names holds its quoted words. It answers `passed`, or `feedback` with every problem. It is the check the interviewer's skill step will name. |
| `draw-turn` | read | `scripts/draw-turn.ts`: the turn's card. The counts and whether a fact's file holds its words are computed lines. Each question, its choices and the recommendation are judged lines that cite the step `interview`, the interviewer's step in the workflow `ask` still to be built. |
| `read-short` | read | `scripts/read-short.ts`: an answer such as `1a 2b` is read by script, each answer with his own words for it. Anything else answers `short: false`, for a model to read. |
| `check-reading` | read | `scripts/check-reading.ts`: each question is read once; a choice names one of its question's letters, and nothing else names a letter; and the words given for each answer are his, exactly, spaces aside. |

The mode reads `CONTEXT.md` and `docs/`, the files a fact may quote. It writes nothing.

Each action can be called by hand, for example `bay call pm.frontier '{"tree": {"questions": []}}' --json`, which answers an empty frontier.
