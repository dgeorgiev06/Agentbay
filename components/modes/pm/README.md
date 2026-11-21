# pm

The PM mode interviews the owner about a piece of work before anyone designs it, a turn of questions at a time, and keeps what he answers. Its design is `docs/designs/pm-mode/design.md`. The interview is optional: forge reads a requirements file written by hand as well. No file of the project is written yet; the sign-off that writes the requirements file is a later slice.

An interview keeps a tree of questions. Each question names the questions it comes after, and is a decision, which is the owner's; a fact, which the project's files answer and the owner confirms; or one talking cannot settle. The frontier is every open decision whose earlier questions are all settled. A turn asks the frontier, at most `questionsPerTurn` questions, each on its own card with lettered answers and the interviewer's recommendation.

## Workflows

| workflow               | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflows/start.yaml` | `open` draws the start card with the owner's words; on `start`, `begin` keeps the interview and names its first turn. Only this card starts an interview, and only it opens one again after a stop or a turn left unanswered.                                                                                                                                                                                                                                                                                                                     |
| `workflows/ask.yaml`   | One turn. `frontier` refuses a job not started, stopped, or with a turn left unanswered, and marks the turn open. The `interview` skill (role interviewer) writes the turn; `scripts/check-turn.ts` holds it to the frontier taken from the mode's own records. `draw` makes one card for each fact and question, facts first. Each card is an approval with the choices a, b, c (withheld for a card with two answers), later and stop. `record` checks the turn and the answers again against the records, keeps them, and names the next turn. |

The run's output says what was kept and, under `next`, the turn that comes next.

## Settings

| setting            | what it does                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `questionsPerTurn` | How many questions a turn asks at most, from 1 to 12; 12 when not given.                                                                |
| `freeTextAnswers`  | Whether the owner may answer in his own words; off when not given. On is not built yet, and an interview does not start while it is on. |

The mode reads `CONTEXT.md`, `README.md`, `docs/`, `src/`, `lib/`, `app/`, `packages/` and `tests/`, the files a fact may quote. It writes only its own records.

Each action can be called by hand, for example `bay call pm.frontier '{"job": "todo"}' --json`, which refuses a job whose interview the owner did not start.
