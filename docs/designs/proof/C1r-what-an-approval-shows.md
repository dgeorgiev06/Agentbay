# What an approval shows: choices and a card, as slice C1r built them

For C1p, which prints a card and lets `bay approve` take a choice, and for F1, the first workflow that names choices.
Words are used as `CONTEXT.md` defines them. The tests that hold each sentence are `tests/runs-choices.test.ts`,
`tests/runs-cards.test.ts` and `tests/approval-card-kit.test.ts`.

## What a workflow names

```yaml
- id: card
  approval: Merge this slice?
  show: $steps.draw.output.card
  choices:
    merge: { does: Merge into the integration branch, when: $steps.offer.output.merge }
    send-back: { does: "Round 2, a fresh builder", when: $steps.offer.output.sendBack }
    keep: { does: Stop; the branches stay }
    discard: { does: Stop; the worktree goes }
  quotes: [review]
```

- Every choice has `does`: one sentence of what taking it does, which the owner reads beside its name on the card.
  A choice without it, or with a blank one, is refused when the workflow loads.

- A rule (`when`) is `$steps.<id>.output` with an optional path, naming an earlier step. Anything else is refused
  when the workflow loads. At run time a rule that is not `true` or `false`, or resolves to nothing, fails the step.
- The rules are evaluated once, when the run first reaches the approval, and stored with it. A resume, a new
  process or a changed workflow file does not evaluate them again.
- `quotes` names earlier action steps whose skills a judged line may cite.

## What a script hands the kernel

The content `show` resolves to. Any content may carry the reasons; a card is content with `lines`.

```json
{
  "title": "Merge TR2?",
  "lines": [
    { "mark": "ran", "words": "# pass 1374", "source": { "step": "check", "command": "test" } },
    { "mark": "ran", "words": "# pass 3", "source": { "step": "review", "command": "test", "run": "<run id>" } },
    { "mark": "computed", "words": "in scope: 11 of 11 paths", "source": { "step": "offer" } },
    { "mark": "judged", "words": "the tests assert what each item says", "source": { "step": "review" } }
  ],
  "withheld": { "merge": "1 must item is inconclusive." }
}
```

- `withheld` holds one sentence for each choice whose rule is false, and nothing else. A missing reason, a reason
  for an offered choice, or a reason for no choice fails the step.
- A card has only `title`, `lines` and `withheld`. A line has only `mark`, `words` and `source`. A field the
  kernel adds, such as a model's name, is refused if a script gives it.
- `source.step` is a step id of the workflow, as `$steps.<id>` names it. It must be an action step that finished
  before the approval.
- `ran`: the kernel recorded the command `command` in that step. With `run`, the command is in that run, and the
  run is one a skill of that step called with `call_action`. The engine records the called run in the skill's
  detail; a script cannot write it.
- `computed`: no skill ran inside that step.
- `judged`: the step is listed in `quotes` and a skill ran inside it.
- The kernel does not compare a line's words with what a command printed.

## What the runs entry returns

While the run waits, `runs.show(id).state.waiting` is:

```json
{
  "reason": "approval",
  "stepKey": "card",
  "question": "Merge this slice?",
  "hash": "<hashOf(content)>",
  "content": "<the scrubbed content, as handed over>",
  "choices": [
    {
      "name": "merge",
      "status": "withheld",
      "does": "Merge into the integration branch",
      "reason": "1 must item is inconclusive."
    },
    { "name": "send-back", "status": "offered", "does": "Round 2, a fresh builder" },
    { "name": "keep", "status": "offered", "does": "Stop; the branches stay" },
    { "name": "discard", "status": "offered", "does": "Stop; the worktree goes" }
  ],
  "card": {
    "title": "Merge TR2?",
    "lines": [
      { "mark": "ran", "words": "# pass 1374", "source": { "step": "check", "command": "test" } },
      {
        "mark": "judged",
        "words": "the tests assert what each item says",
        "source": { "step": "review" },
        "skills": [{ "mode": "forge", "skill": "skills/review", "tier": "deep" }]
      }
    ],
    "counted": { "ran": 2, "computed": 1, "judged": 1 }
  }
}
```

- `choices` is there only when the step names choices, and `card` only when the content is a card. Without
  either, the waiting approval is exactly as before.
- Each choice carries its `does` from the workflow, as the run first reached the approval. Like the rules, it is
  stored with the approval and not read again from a changed workflow file. It is not part of the hash.
- The hash is `hashOf` the scrubbed content: title, lines with marks and sources, and the reasons. `skills` and
  `counted` are the kernel's and are not hashed.
- `skills` is what the kernel recorded for the skill steps inside the cited step: mode, skill and tier. The kernel
  does not know which model a harness ran for a tier; C1p prints the tier and must not name a model.
- C1p prints `card`, never `content`, as the card's lines: only `card` was checked. How it prints them is below.

## What the owner reads

`bay runs <id>` and `bay approve` print `card` in this form (ADR 26 item 7, amending ADR 22). The JSON form does
not change: every line there keeps its mark and source. The tests that hold it are `tests/runs-card.test.ts` and
`tests/run-report.test.ts`.

| Row | Printed as | Continued as |
|---|---|---|
| title | at column 0 | 2 spaces |
| computed line | 2 spaces, then the words; no mark | 4 spaces |
| ran or judged line | the mark padded to 9 columns, then the words | the mark padded to 11 columns |
| source of a ran line | `ran`, padded to 10, `by the command <name>`, and ` in run <id>` when it has one | the mark padded to 12 columns |
| source of a judged line | `judged`, padded to 10, `by <mode> <skill>, tier <tier>`, `; ` between skills | the mark padded to 12 columns |
| foot | `All lines worked out by script.` when every line is computed; `Unmarked lines were worked out by script.` when some are; nothing when none is | none |
| choices offered | `You can:`, then each name and its `does` | under the `does` |
| choices withheld | `Not available:`, then each name and its `does`, then `why: <reason>` | under the `does` |
| counts | `checked: <n> ran, <n> computed, <n> judged`, as the kernel gave them | none |
| hash | `hash` and the first 12 characters | none |

- The source row follows the last of a run of lines with one mark and one source, so it is printed once for them.
  A judged line whose skills are none has no source row.
- Every row is at most 44 columns. A word longer than its row is split with no space inside it.
- Only the kernel writes at column 0 below the title's first row: a mark, the foot, a heading, the counts, the
  hash. Every word a script wrote below that row starts at column 2 or later, so a computed line whose words begin
  "judged by you" prints as `  judged by you` and never reads as a mark.
- Control and format characters in any text are shown as `\uXXXX`, as before.
- The trust card does not change.

A card with one computed line, one judged line and a withheld choice (the hash is an example):

```
Merge TR2?
  in scope: 11 of 11 paths
judged   the tests assert what each item
judged     says
judged    by carder skills/review, tier deep
Unmarked lines were worked out by script.
You can:
  keep  Stop; the slice stays as it is
Not available:
  merge  Merge the slice
         why: No test ran.
checked: 0 ran, 1 computed, 1 judged
hash 3b0e5a91c7d2
```

## Deciding

`runs.approve(id, { stepKey, hash, by, choice })` for a step with choices; `{ stepKey, hash, by, verdict }` for
one without, as before. A verdict on a step with choices, or a choice on one without, is refused. A withheld choice
is refused with its reason, an unknown one with the names offered; nothing changes. The event `approval.recorded`
holds `{ stepKey, hash, decision: "choice", choice, by }`, and the step's output is `{ choice, content }`, so a
later step reads `$steps.card.output.choice`.
