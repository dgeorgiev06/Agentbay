# The PM mode: from the owner's words to a checked requirements file

The design of the PM mode that ADR 25 gives the requirements to. It proposes; the owner decides. Words are used as `CONTEXT.md` defines them. It builds on forge's design as chosen in ADR 26 (design A's skeleton) and on ADR 27 (with the hook or without).

## The design in eight lines

1. The PM mode, `pm`, turns what the owner asks for into one requirements file per job. It plans no slice, writes no test and no code.
2. The file's form belongs to a small base mode, `requirements`, behind the interface `requirements@1`. Both `pm` and forge require it, so neither needs the other.
3. A condition is given, when, then, with a literal value in `then`. A refused condition also says what a person sees after. A script refuses vague words.
4. The owner is asked one question a run, as an approval with two or three answers and a recommendation. Each answer is recorded with who gave it and when.
5. Two skills: `draft` at tier balanced, and `critique` at tier deep, another model. Everything else is a script.
6. The owner signs the file off on one card, answer first. Only then is the file written, as the next version.
7. A change after building has started is a new version. The file lists what changed by condition id, and forge compares that with the version its plan was cut from.
8. At the owner's job it runs without the hook. It reads exported documents and tickets from a folder, writes nothing back, and has no network effect.

## 1. What the PM mode is for, and who uses it

**Conclusion.** It is for writing down what a person should see working, in a form a script can check. It never plans, tests or builds (ADR 25). The owner uses it alone; a team can add its words, and the owner signs off.

### What it does

- It takes the owner's words: a sentence in chat, or an exported document or ticket.
- It drafts outcomes a person could see working, each with conditions.
- It asks the owner what the words leave open, one question at a time.
- It checks the result by script, has another model critique it, and shows the owner a card.
- On the owner's approval it writes `docs/requirements/<job>.yaml`.

### What it never does

- It cuts no slice, names no kind of proof, and fixes no interface. Those are forge's (ADR 25, items 2 and 6).
- It writes no test and no code. It has no write path outside `docs/requirements/`.
- It decides no answer for the owner. Every answer is an approval's choice.
- It reads nothing of forge: no plan, no design, no run. Forge reads the file and nothing else of it.

### Who uses it

- **The owner alone.** He says what he wants. The mode asks, he answers, he signs off.
- **With a team.** Others' words come in through `pm.start` with `by` set to their role, such as `design lead`. Each becomes an entry under `asked`. The file is reviewed like any file in the repository. Answers and the sign-off stay the owner's, since an approval is his (ADR 15, `CLAUDE.md`).
- **A team that builds another way.** The file is plain YAML. Nothing in it names forge.

## 2. The requirements file

**Conclusion.** One YAML file per job, `docs/requirements/<job>.yaml`. Outcomes a person could see; conditions as given, when, then with literal values; what is left out on purpose; open questions; who asked, who answered, and when. Its schema is `requirements@1`'s, so `pm` and forge read one form.

### Where the form lives

Design A put the schema in forge's folder, since forge was its one reader. The PM mode must write the same form and check it, and ADR 25 says either mode works without the other. So the form moves to an interface, `requirements@1`, as `proof@1` holds the slice that forge and proof share.

- `components/base/interfaces/requirements.yaml`: one action, `check`.
- `components/base/interfaces/requirements/file.json`: the file's schema.
- `components/base/requirements/`: the base mode that implements it. Scripts only; no skill, no command.

Forge requires `requirements@1` and reads the file through `requirements.check`. That replaces the action `forge.requirements` in slice RQ1 of plan 0024 (question 1).

### The form, field by field

| Field | Required | What it holds |
|---|---|---|
| `job` | yes | The job's name, `^[a-z][a-z0-9-]*$`, equal to the file's name |
| `version` | yes | 1, then one more at each sign-off |
| `title` | yes | One line |
| `for` | yes | Who it is for, one sentence |
| `asked` | yes | Each request: `by`, `on` (a date), `words` (as given) |
| `constraints` | no | Sentences: what the work must keep to |
| `outcomes` | yes | At least one |
| `judged` | no | Up to 3 sentences only a person can judge |
| `leftOut` | yes | Sentences; may be empty |
| `open` | yes | Questions not yet answered; may be empty |
| `decided` | yes | Each answer: `question`, `answer`, `by`, `on`, `run` |
| `signed` | yes | `by`, `on`, `run` of the sign-off |
| `changes` | yes | One entry per version: `version`, `on`, `added`, `changed`, `removed` |

An outcome has `id` (`O` and a number), `says` (one sentence), `from` (optional: `asked 1`, or a section of a document, or a ticket's key), and `conditions` (at least one). It may have `noRefusal`, one sentence, when no input of it can be refused.

A condition has:

- `id`: the outcome's id, `-C` and a number. Never reused once removed.
- `path`: `works` or `refused`.
- `given`, `when`, `then`: one sentence each, at most 300 characters.
- `after`: required when `path` is `refused`: what a person sees once the refusal is over.

### Schema sketch

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Requirements",
  "type": "object",
  "additionalProperties": false,
  "required": ["job", "version", "title", "for", "asked", "outcomes", "leftOut", "open", "decided", "signed", "changes"],
  "properties": {
    "job": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
    "version": { "type": "integer", "minimum": 1 },
    "title": { "$ref": "#/$defs/sentence" },
    "for": { "$ref": "#/$defs/sentence" },
    "asked": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/asked" } },
    "constraints": { "type": "array", "items": { "$ref": "#/$defs/sentence" } },
    "outcomes": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/outcome" } },
    "judged": { "type": "array", "maxItems": 3, "items": { "$ref": "#/$defs/sentence" } },
    "leftOut": { "type": "array", "items": { "$ref": "#/$defs/sentence" } },
    "open": { "type": "array", "items": { "$ref": "#/$defs/question" } },
    "decided": { "type": "array", "items": { "$ref": "#/$defs/decision" } },
    "signed": { "$ref": "#/$defs/by" },
    "changes": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/change" } }
  },
  "$defs": {
    "sentence": { "type": "string", "minLength": 1, "maxLength": 300 },
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "outcomeId": { "type": "string", "pattern": "^O[1-9][0-9]*$" },
    "conditionId": { "type": "string", "pattern": "^O[1-9][0-9]*-C[1-9][0-9]*$" },
    "asked": {
      "type": "object", "additionalProperties": false, "required": ["by", "on", "words"],
      "properties": { "by": { "type": "string" }, "on": { "$ref": "#/$defs/date" }, "words": { "type": "string", "maxLength": 4000 } }
    },
    "outcome": {
      "type": "object", "additionalProperties": false, "required": ["id", "says", "conditions"],
      "properties": {
        "id": { "$ref": "#/$defs/outcomeId" },
        "says": { "$ref": "#/$defs/sentence" },
        "from": { "type": "array", "items": { "type": "string" } },
        "noRefusal": { "$ref": "#/$defs/sentence" },
        "conditions": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/condition" } }
      }
    },
    "condition": {
      "type": "object", "additionalProperties": false, "required": ["id", "path", "given", "when", "then"],
      "properties": {
        "id": { "$ref": "#/$defs/conditionId" },
        "path": { "enum": ["works", "refused"] },
        "given": { "$ref": "#/$defs/sentence" },
        "when": { "$ref": "#/$defs/sentence" },
        "then": { "$ref": "#/$defs/sentence" },
        "after": { "$ref": "#/$defs/sentence" }
      },
      "if": { "properties": { "path": { "const": "refused" } } },
      "then": { "required": ["after"] }
    },
    "question": {
      "type": "object", "additionalProperties": false, "required": ["id", "asks", "answers", "recommended", "why"],
      "properties": {
        "id": { "type": "string", "pattern": "^Q[1-9][0-9]*$" },
        "asks": { "$ref": "#/$defs/sentence" },
        "answers": { "type": "array", "minItems": 2, "maxItems": 3, "items": { "type": "string", "maxLength": 60 } },
        "recommended": { "type": "integer", "minimum": 0, "maximum": 2 },
        "why": { "$ref": "#/$defs/sentence" }
      }
    },
    "by": {
      "type": "object", "additionalProperties": false, "required": ["by", "on", "run"],
      "properties": { "by": { "type": "string" }, "on": { "$ref": "#/$defs/date" }, "run": { "type": "string" } }
    },
    "decision": {
      "type": "object", "additionalProperties": false, "required": ["question", "answer", "by", "on", "run"],
      "properties": {
        "question": { "$ref": "#/$defs/sentence" }, "answer": { "type": "string" },
        "by": { "type": "string" }, "on": { "$ref": "#/$defs/date" }, "run": { "type": "string" }
      }
    },
    "change": {
      "type": "object", "additionalProperties": false, "required": ["version", "on", "added", "changed", "removed"],
      "properties": {
        "version": { "type": "integer", "minimum": 1 },
        "on": { "$ref": "#/$defs/date" },
        "added": { "type": "array", "items": { "$ref": "#/$defs/conditionId" } },
        "changed": { "type": "array", "items": { "$ref": "#/$defs/conditionId" } },
        "removed": { "type": "array", "items": { "$ref": "#/$defs/conditionId" } }
      }
    }
  }
}
```

The schema holds what a schema can. The rules it cannot hold are the check's (section 4).

### No kind of proof in the file

A and B agreed, and ADR 26 took A: the requirements name no kind of proof. Proof's eight kinds are forge's words. A team that builds another way should not need them. `judged` is the one place the file says a person must decide; forge turns each into a judgement item.

### The todo mode's file, whole

Three outcomes: add and list, done and remove, and due dates. One question is left open on purpose, to show the field.

```yaml
job: todo
version: 1
title: A todo list kept by agentbay
for: The owner, who keeps short tasks beside his work.
asked:
  - by: owner
    on: 2026-11-18
    words: A todo mode. Add and list, done and remove. Then due dates.
constraints:
  - It is a mode of the kit, under components/modes/todo.
  - It uses no network.
outcomes:
  - id: O1
    says: A person adds a todo and sees it among the open ones.
    from: [asked 1]
    conditions:
      - id: O1-C1
        path: works
        given: no todos
        when: the person adds "buy milk", then lists the open todos
        then: 1 todo is listed, with id 1, text "buy milk" and status "open"
      - id: O1-C2
        path: works
        given: the todos "buy milk" and "call the bank" were added in that order
        when: the person lists the open todos
        then: the list is "buy milk" first and "call the bank" second
      - id: O1-C3
        path: works
        given: no todos
        when: the person lists the open todos
        then: 0 todos are listed
      - id: O1-C4
        path: works
        given: no todos
        when: the person adds a text of exactly 500 characters
        then: the open list shows that text whole, all 500 characters
      - id: O1-C5
        path: refused
        given: the todo "buy milk" was added
        when: the person adds a todo with the text ""
        then: it is refused with a sentence that contains "text is empty"
        after: the open list shows only "buy milk"
      - id: O1-C6
        path: refused
        given: the todo "buy milk" was added
        when: the person adds a todo with the text "   ", three spaces
        then: it is refused with a sentence that contains "text is empty"
        after: the open list shows only "buy milk"
      - id: O1-C7
        path: refused
        given: the todo "buy milk" was added
        when: the person adds a text of 501 characters
        then: it is refused with a sentence that contains "at most 500"
        after: the open list shows only "buy milk"
  - id: O2
    says: A person marks a todo done, or removes it.
    from: [asked 1]
    conditions:
      - id: O2-C1
        path: works
        given: the open todos 1 "buy milk" and 2 "call the bank"
        when: the person marks 1 done, then lists the open todos
        then: only "call the bank" is listed
      - id: O2-C2
        path: works
        given: todo 1 "buy milk" was marked done
        when: the person lists all todos
        then: the todo "buy milk" is listed with status "done"
      - id: O2-C3
        path: works
        given: the todos 1 "buy milk" and 2 "call the bank"
        when: the person removes 2, then lists all todos
        then: only "buy milk" is listed
      - id: O2-C4
        path: works
        given: the todos 1 and 2, and 2 was removed
        when: the person adds "post the letter"
        then: it gets id 3, not 2
      - id: O2-C5
        path: refused
        given: the todo 1 "buy milk" and no other
        when: the person marks 99 done, or removes 99
        then: it is refused with a sentence that contains "No todo has the id 99"
        after: all todos still list only "buy milk", open
      - id: O2-C6
        path: refused
        given: todo 1 "buy milk" was marked done
        when: the person marks 1 done again
        then: it is refused with a sentence that contains "already done"
        after: all todos still list "buy milk" once, with status "done"
  - id: O3
    says: A person gives a todo a due date and sees what is overdue.
    from: [asked 1]
    conditions:
      - id: O3-C1
        path: works
        given: no todos
        when: the person adds "pay rent" with the due date "2026-12-01"
        then: the open list shows "pay rent" with due "2026-12-01"
      - id: O3-C2
        path: works
        given: the todos "a" due "2026-12-05", "b" with no due date, and "c" due "2026-12-01", added in that order
        when: the person lists the open todos
        then: the list is "c", "a", "b"
      - id: O3-C3
        path: works
        given: the date is 2026-11-21 and "buy milk" is open and due "2026-11-20"
        when: the person lists the open todos
        then: the todo "buy milk" is listed with overdue true
      - id: O3-C4
        path: works
        given: the date is 2026-11-21 and "buy milk", due "2026-11-20", was marked done
        when: the person lists all todos
        then: the todo "buy milk" is listed with overdue false
      - id: O3-C5
        path: refused
        given: no todos
        when: the person adds "pay rent" with the due date "next tuesday"
        then: it is refused with a sentence that contains "YYYY-MM-DD"
        after: 0 todos are listed
      - id: O3-C6
        path: refused
        given: no todos
        when: the person adds "pay rent" with the due date "2026-02-30"
        then: it is refused with a sentence that contains "not a date"
        after: 0 todos are listed
judged:
  - Every sentence a person reads from the mode says what to do next.
leftOut:
  - Editing a todo's text.
  - A time of day on a due date.
  - Reminders.
  - Sharing a list with another person or project.
open:
  - id: Q1
    asks: May a todo be added with a due date that has already passed?
    answers:
      - Yes, and it is listed as overdue
      - No, it is refused
    recommended: 0
    why: A person often writes down a task after its date has gone.
decided:
  - question: What happens when a todo already done is marked done again?
    answer: It is refused, and the sentence says it is already done
    by: owner
    on: 2026-11-18
    run: run_4f1c
  - question: Is the id of a removed todo given to a new one?
    answer: No, ids are never reused
    by: owner
    on: 2026-11-18
    run: run_51a9
  - question: How long may a todo's text be?
    answer: 500 characters
    by: owner
    on: 2026-11-18
    run: run_5e02
  - question: In what order are open todos with due dates listed?
    answer: By due date, then those with none, in the order added
    by: owner
    on: 2026-11-18
    run: run_6b77
signed:
  by: owner
  on: 2026-11-18
  run: run_7c2e
changes:
  - version: 1
    on: 2026-11-18
    added: [O1-C1, O1-C2, O1-C3, O1-C4, O1-C5, O1-C6, O1-C7, O2-C1, O2-C2, O2-C3, O2-C4, O2-C5, O2-C6, O3-C1, O3-C2, O3-C3, O3-C4, O3-C5, O3-C6]
    changed: []
    removed: []
```

19 conditions, 7 of them refused. Run ids are examples.

Three choices in the file are worth a word:

- **"contains" in a refusal.** A condition pins the part of a sentence a person acts on, not the whole sentence. The test pins that part; the wording around it stays the builder's.
- **The date is given.** `O3-C3` says "the date is 2026-11-21". The test toolbox's clock makes it so. A condition never says "today".
- **One condition, two calls.** `O2-C5` covers done and remove with one id. A test writer writes two cases. The critique may ask for two conditions; the owner decides.

## 3. The mode's actions and workflows

**Conclusion.** Seven actions and two workflows. The owner's words go in with `pm.start`. The workflow `ask` asks one question a run. The workflow `sign-off` checks, critiques, shows the card and writes the file. Two steps are a model's; every other step is a script (P-32).

### The flow

1. `pm.start {job, words, by}`: records the words and drafts. Its output says how many questions are open.
2. While questions are open, the coordinator starts `ask`. Each run asks one question and records the answer.
3. Then the coordinator starts `sign-off`. The owner reads the card and approves, keeps the draft to change it, or discards it.
4. On approval the file is written as the next version.

### `components/modes/pm/mode.yaml`

```yaml
name: pm
version: 1.0.0
description: Turns what the owner asks for into a checked requirements file, asking him one question at a time.

requires:
  interfaces: [requirements@1]

settings: schemas/settings.json

resources:
  files:
    read: [docs/requirements/]
    write: [docs/requirements/]

actions:
  start:
    description: When the owner, or someone he names, asks for a piece of work or a change to one, and the words should become requirements.
    input: schemas/start-request.json
    output: schemas/drafted.json
    effects: [read, write]
    run:
      - script: scripts/start.ts
      - skill: skills/draft
        tier: balanced
        checks: [scripts/check-draft.ts]
      - script: scripts/keep-draft.ts
  draft:
    description: When the draft must be written again from the words and every answer so far, before the next question.
    input: schemas/draft-request.json
    output: schemas/drafted.json
    effects: [read, write]
    run:
      - script: scripts/gather.ts
      - skill: skills/draft
        tier: balanced
        checks: [scripts/check-draft.ts]
      - script: scripts/keep-draft.ts
  question:
    description: When the next open question of a draft is to be put to the owner on a card.
    input: schemas/drafted.json
    output: schemas/question-card.json
    effects: [read]
    run:
      - script: scripts/question.ts
  record:
    description: When the owner has answered a question and the answer is to be kept with who gave it and when.
    input: schemas/record-request.json
    output: schemas/recorded.json
    effects: [read, write]
    run:
      - script: scripts/record.ts
  critique:
    description: When a checked draft needs another model to find conditions that test two things, miss a refusal, or could not be seen by a person.
    input: schemas/critique-request.json
    output: schemas/critique.json
    effects: [read]
    run:
      - skill: skills/critique
        tier: deep
  draw:
    description: When the owner needs the card for a draft, answer first, from the check, the critique and the changes since the last version.
    input: schemas/draw-request.json
    output: schemas/sign-off-card.json
    effects: [read]
    run:
      - script: scripts/draw.ts
  write:
    description: When the owner has chosen on the sign-off card and the choice is to be done.
    input: schemas/write-request.json
    output: schemas/written.json
    effects: [read, write, delete]
    run:
      - script: scripts/write.ts

workflows:
  - workflows/ask.yaml
  - workflows/sign-off.yaml
```

Seven actions. The owner starts one, `start`, and two workflows, `ask` and `sign-off`. The other six actions are their steps.

The draft and the answers live in the mode's own database partition, as the todo mode keeps todos. Nothing is on disk under `docs/requirements/` until the owner approves.

### `workflows/ask.yaml`

```yaml
name: ask
trigger: { manual: true }
budget: { minutes: 15 }
steps:
  - id: draft
    action: draft
  - id: question
    action: question
    input:
      job: $steps.draft.output.job
      draft: $steps.draft.output.draft
      open: $steps.draft.output.open
  - id: ask
    approval: Which answer?
    show: $steps.question.output.card
    quotes: [draft]
    choices:
      a: { does: Take answer a on the card, when: $steps.question.output.offer.a }
      b: { does: Take answer b on the card, when: $steps.question.output.offer.b }
      c: { does: Take answer c on the card, when: $steps.question.output.offer.c }
      later: { does: Leave it open in the file and go on, when: $steps.question.output.offer.later }
      stop: { does: Stop asking; the draft and answers stay }
  - id: record
    action: record
    input:
      job: $steps.draft.output.job
      question: $steps.question.output.question
      answer: $steps.ask.output
```

### `workflows/sign-off.yaml`

```yaml
name: sign-off
trigger: { manual: true }
budget: { minutes: 15 }
steps:
  - id: draft
    action: draft
  - id: check
    action: requirements.check
    input:
      requirements: $steps.draft.output.draft
      before: $steps.draft.output.before
  - id: critique
    action: critique
    input:
      requirements: $steps.draft.output.draft
  - id: draw
    action: draw
    input:
      draft: $steps.draft.output
      check: $steps.check.output
      critique: $steps.critique.output
  - id: card
    approval: Sign off these requirements?
    show: $steps.draw.output.card
    quotes: [draft, critique]
    choices:
      approve: { does: Write the file as the next version, when: $steps.draw.output.approve }
      keep: { does: Stop; nothing is written; the draft stays to change }
      discard: { does: Stop; nothing is written; the draft goes }
  - id: write
    action: write
    input:
      choice: $steps.card.output.choice
      job: $steps.draft.output.job
      draft: $steps.draft.output.draft
      before: $steps.draft.output.before
      changes: $steps.check.output.changes
```

Each input value is one reference, resolved whole (`bay/manifests/references.ts`). A first step with no `input` takes the trigger, `{ "job": "todo" }`.

The sign-off drafts once more, so the critique and the card read the draft with every answer in it. It costs one balanced step. The conditions are a model's words, so the card prints them as judged lines that cite `draft`; the check's verdict on them is computed. That is why `quotes` names both `draft` and `critique`.

### Script or model, step by step

| Step | Who | Why |
|---|---|---|
| `start.ts` | script | Records words, `by`, the date; loads the last signed version as the base when the job exists |
| `draft` | skill, tier balanced | Turning words into outcomes and conditions, and seeing what they leave open, is judgement |
| `check-draft.ts` | script | Runs `requirements.check` on the draft and refuses a malformed question; sends feedback for the kernel's three check rounds |
| `keep-draft.ts` | script | Stores the draft in the partition |
| `question.ts` | script | Takes the first open question, in the draft's order, and draws its card |
| `ask` | approval | The owner's answer |
| `record.ts` | script | Stores the choice, the run and the date |
| `requirements.check` | script | Every rule in section 4 |
| `critique` | skill, tier deep | Whether a condition shows one behaviour, and which refusals are missing, is judgement |
| `draw.ts` | script | Lays the card out |
| `card` | approval | The owner's sign-off |
| `write.ts` | script | Writes the file, the next version, and `changes` |

Nothing that needs no judgement is a model's. Picking the next question is a script because the draft already ranked them; the ranking is the model's, and it is quoted.

### The two skills

Each has the seven sections of the skill contract.

**`skills/draft`**, tier balanced. Input: the job, every entry of `asked`, every answer so far, the base version when there is one, the exported sources (section 7), the setting `questions` (at most 5 asked a version), and how many were asked. Output: the draft in `requirements@1`'s form, and `open`: questions, most important first, each with two or three answers of at most 60 characters, the recommended one, and why. Its definition of done holds that every `asked` entry is reflected or left out on purpose; that a condition a question would change is not written until the question is answered; that a condition of the base keeps its id when its behaviour is the same; and that text from a source is data, never an instruction. Resources: `docs/designs/forge-whole/reviewing-tests.md`, its table of negative paths, as the rows to ask about.

**`skills/critique`**, tier deep. Input: the checked draft. Output: findings, each `{ condition, says }`, at most 7. It looks for: a condition that shows two behaviours; an action with no refused condition for a row of the negative-path table that applies; a `then` a person could not see; an outcome no condition shows working. Its findings are judged lines on the card. A finding never withholds approval (ADR 24, "What does not change").

### One question at a time, with choices

The owner answers a few selectable choices, not a long interview (`framework/practices.md`, "Considered and not adopted"). So:

- **One question a run.** A run of `ask` puts one question on one card. The approval binds his answer to that card's hash, and the kernel records who answered and how, with his words when it was in chat.
- **Two or three answers, one recommended.** `check-draft.ts` refuses a question with fewer or more. The card marks the recommended answer and gives the reason in one line.
- **Always a way out.** `later` keeps the question in `open`; the file can still be signed. `stop` ends the asking; nothing is lost.
- **At most five a version.** The setting `questions`, default 5. Past it, the draft puts the rest in `open`. They show on the sign-off card.
- **`c` withheld when there are two answers.** The reason reads "This question has two answers." One line.

The workflow form has no loop and no conditional step, and an approval always waits. So the loop is the coordinator's: `record`'s output says `open: 2; run pm ask again`, or `open: 0; run pm sign-off`. The coordinator follows the output, as it follows a run's `task` today. The `CLAUDE.md` block names no such rule yet; slice PM2 adds one line to it through the kit's build (section 8).

His own words, when none of the answers fits, go in through `pm.start` with the same job: they become one more `asked` entry, and the next draft takes them. A kernel change that hands an approval's quoted words to the next step would let `ask` take them directly. It is not needed for the first version (question 3).

## 4. What makes a condition good

**Conclusion.** A good condition is one behaviour a person could see, with literal values, and the refusals are written as conditions too. `requirements.check` refuses by script what a script can see: no literal value, vague words, a refusal with no `after`, an outcome with no refusal. The critique judges the rest.

### The rules the check holds

Each problem names the file, the line and the condition's id, and says what to write instead.

1. **A literal in `then`.** It holds a double-quoted value or a number. "0 todos are listed" passes; "the list is empty" does not.
2. **A literal in `after`.** The same rule, for every refused condition.
3. **No vague words.** `given`, `when`, `then` and `after` hold none of: "should", "properly", "correctly", "as expected", "appropriate", "works", "handles", "etc", "and so on", "user-friendly", "fast", "quickly", "easily", "some", "various". The list is one data file in the `requirements` mode. Whole words, any case.
4. **A refusal per outcome.** Each outcome has a `refused` condition, or a `noRefusal` sentence that says why none applies.
5. **No date that moves.** "today", "now", "yesterday" and "tomorrow" are refused; a condition gives the date.
6. **Ids.** Unique in the file; each condition's id starts with its outcome's; a removed id is never used again, by the `changes` of every earlier version.
7. **Versions.** `version` is the last signed version plus one; `changes` has one entry for it, and its lists match the difference from the version before, as the check computes it.
8. **Open questions.** Two or three answers each; `recommended` names one of them.

What the check does not hold, and the critique judges: one behaviour per condition; whether the refusals cover the rows of the negative-path table that apply; whether a person could see the `then`.

### Five weak conditions and their good forms

**1. A wish, not a check.**

Weak: `then: adding a todo should work properly`. Refused by rules 1 and 3.

Good: `O1-C1`. given no todos; when the person adds "buy milk", then lists the open todos; then 1 todo is listed, with id 1, text "buy milk" and status "open".

**2. An order with no values.**

Weak: `then: the todos are sorted correctly`. Refused by rules 1 and 3.

Good: `O3-C2`. given "a" due "2026-12-05", "b" with no date, "c" due "2026-12-01"; then the list is "c", "a", "b".

**3. A refusal with nothing after.**

Weak: `when: the person enters bad input; then: it handles the error`. Refused by rules 1, 2 and 3.

Good: `O1-C5`. when the person adds a todo with the text ""; then it is refused with a sentence that contains "text is empty"; after: the open list shows only "buy milk".

**4. Two behaviours in one.**

Weak: `then: the person can mark todos done and remove them, and they disappear`. Refused by rules 1 and 3; the critique would also split it.

Good: `O2-C1` and `O2-C3`, one for done and one for remove, each with the list a person sees.

**5. A date that moves.**

Weak: `given: a todo due yesterday; then: it shows as overdue`. Refused by rules 1 and 5.

Good: `O3-C3`. given the date is 2026-11-21 and "buy milk" is open and due "2026-11-20"; then "buy milk" is listed with overdue true.

A condition the check passes can still be weak: "1 todo is listed" passes rule 1 and checks almost nothing. That is the critique's to find, and the owner's to decide.

## 5. The owner's card

**Conclusion.** The answer first: ready to sign, or why not. Then every condition, short, since the owner signs what he reads. Then the critique, marked as judgement. At most 44 columns, in the clearer card of ADR 26 item 7, printed as slice KC1 prints it: one heading above each run of lines with one mark and one source.

### Sign-off card, the todo mode, version 1

```
Sign off the todo requirements?
-- computed: pm draw --
Ready to sign: the check found no
problem.
docs/requirements/todo.yaml, version 1
3 outcomes, 19 conditions, 7 refused
Asked by owner on 2026-11-18.
Answered: 4 questions. Open: 1.
-- judged: pm draft --
O1 Add a todo and see it listed.
 C1 add "buy milk": listed, id 1, open
 C2 two added: listed in that order
 C3 none added: 0 listed
 C4 500 characters: kept whole
 C5 text "": refused, "text is empty"
 C6 text "   ": refused, the same
 C7 501 characters: refused,
    "at most 500"
O2 Mark a todo done, or remove it.
 C1 done: not in the open list
 C2 done: in all, status "done"
 C3 removed: in no list
 C4 after a remove, the next id is 3
 C5 id 99: refused, "No todo has the
    id 99"
 C6 done twice: refused, "already done"
O3 Give a todo a due date.
 C1 due "2026-12-01": listed with it
 C2 listed by due date, none last
 C3 past due, open: overdue true
 C4 past due, done: overdue false
 C5 "next tuesday": refused,
    "YYYY-MM-DD"
 C6 "2026-02-30": refused, "not a date"
Judged by a person: every sentence says
what to do next.
Left out: editing a text, a time of
day, reminders, sharing.
Open: may a due date already be past?
  Recommended: yes, listed as overdue.
  No condition is written for it yet.
  (pm draft: tier balanced)
-- judged: pm critique --
O2-C5 covers done and remove: two
  conditions would say it plainer.
No condition for a text that is not
  text, such as a number.
  (pm critique: tier deep)
-- computed: kernel --
The hook saw every skill step of this
run.
Choose one:
  approve  Write the file as the next
           version
  keep     Stop; nothing is written;
           the draft stays to change
  discard  Stop; nothing is written;
           the draft goes
checked: 0 ran, 5 computed, 29 judged
hash 7c2e91a04f3b
```

- The conditions are under a judged heading, since a model wrote them. The check's verdict on them is computed. Both are true, and the card says which is which.
- A condition is one line where it fits. A literal is never cut; a long one wraps.
- With problems, the answer reads "Not ready: the check found 2 problems", each problem follows in one or two lines with its condition's id, and `approve` shows "not offered: fix the 2 problems first."
- Without the hook, the last heading reads "This run was made without the hook. A step's reads were not confined." (ADR 27).

### Question card, one run of `ask`

```
Which answer?
-- judged: pm draft --
May a todo be added with a due date
that has already passed?
  a  Yes, and it is listed as overdue
     recommended: a person often
     writes down a task after its date
  b  No, it is refused
  (pm draft: tier balanced)
-- computed: pm question --
Question 5 of at most 5. After it:
the sign-off card.
Choose one:
  a      Take answer a on the card
  b      Take answer b on the card
  c      Take answer c on the card
         not offered: this question has
         two answers.
  later  Leave it open in the file and
         go on
  stop   Stop asking; the draft and
         answers stay
checked: 0 ran, 1 computed, 4 judged
hash 2a90c4e1d7f3
```

## 6. A change after building has started

**Conclusion.** A change is a new version of the same file, made the same way: `pm.start` with the job, then `ask` and `sign-off`. The file's `changes` names, by id, what was added, changed and removed. Forge's plan names the version it was cut from, and `forge.waves` reports every condition that changed since, with the slices that meet it.

### In the PM mode

- `pm.start {job: "todo", words: "Overdue todos come first."}` loads version 1 as the base and adds an `asked` entry.
- The draft keeps every id whose behaviour stays the same. A condition whose words change keeps its id and is listed as changed. A behaviour that is gone is removed, and its id is never used again (rule 6). A new behaviour gets a new id.
- The check computes the difference itself, from the base on disk and the draft. The draft cannot claim a smaller change than it made.
- The card leads with the change:

```
Sign off version 2 of todo?
-- computed: pm draw --
Ready to sign: the check found no
problem.
Changed since version 1:
  changed O3-C2
  added O3-C7
  removed none
-- judged: pm draft --
O3-C2 was: listed by due date, none
  last
O3-C2 now: overdue first, then by due
  date, none last
O3-C7 date 2026-11-21, "a" overdue
  and "b" due 2026-11-25: "a" first
  (pm draft: tier balanced)
...
```

Only what changed is printed in full, then one line for what stayed: "17 conditions as in version 1."

### What forge is told

Forge reads the file and nothing else (ADR 25, item 3). What it needs is in the file:

- The plan's `requirements` field, which design A adds, holds the file and the version it was cut from: `requirements: { file: docs/requirements/todo.yaml, version: 1 }`.
- `forge.waves` reads the file's `changes` after that version. It reports, for each changed or removed condition, the slices whose `meets` names it, and whether each is merged. It reports each added condition as met by no slice. These are problems, so a plan cut from an old version is not taken as current.
- A merged slice stays merged and in its plan. A condition it met that changed needs a new slice, which meets it at the new version.
- A slice not yet started whose conditions changed is cut again. A slice being built finishes its round; its merge card says "the requirements changed since this plan: O3-C2", and the owner decides.

That is a forge slice, FV1 in section 8, not the PM mode's. The PM mode never reads a plan.

## 7. At the owner's job

**Conclusion.** It runs without the hook, since hooks are disabled there (ADR 27). That costs it little: it hides nothing, its skills cannot write, and every file is written by a script after the owner's approval. A PRD and tickets come in as exported files in a folder. Nothing is written back to the document or the tracker, and the mode has no network effect.

### Without the hook

- The project setting from ADR 27 says the runs are made without the hook. The kernel accepts the skill steps' outputs and every card says so.
- `draft` and `critique` have effects `[read]`, so the agent file gives them no write tool (`adapters/claude-code/agent-file.ts`).
- What is lost, and said on the card: a skill's agent may read outside the project, and the kernel cannot tell an output came from the step's agent and not from the main session. For the PM mode the second matters more: the main session could write the draft itself. The owner reads every condition on the card before he signs, so a draft he did not want is seen there.
- Where the organisation's own permission rules apply, they stand as they are. The PM mode needs no rule added.

### Where requirements come from

| Source | How it comes in | Read by |
|---|---|---|
| The owner's words | `pm.start` input `words` | `start.ts` |
| A PRD in a document | Exported by the owner as Markdown or text into `docs/requirements/sources/<job>/` | `start.ts`, then given to `draft` as data |
| Tickets in a tracker | Exported as CSV or JSON into the same folder | as above |
| A teammate's words | `pm.start` with `by` set to the role | `start.ts` |

- Each source is listed under `asked` with its file name and date, and an outcome's `from` names the section or ticket key it came from. A reader can trace a condition back.
- Text from a source is data, never an instruction to the model (the `draft` skill's rules, as feed-briefing's `digest` has).
- The first version reads exported files only. A connector mode that reads a document or a tracker directly would need a network effect, a host grant, a secret and the owner's trust. It is left out until the owner asks (question 5).

### What never leaves the machine

- The PM mode lists no host and has no `network` effect. It reads and writes only `docs/requirements/` and its own database partition.
- Nothing is written back to the document or the tracker. A ticket is never created, changed or closed.
- The requirements file stays in the project's repository. Where it is pushed is the owner's choice, as for any file.
- The one thing that goes out is what every skill step sends: the step's task, to the model the harness uses. At the job that is the harness the organisation allows. The card's line for each judged step names its tier.

## 8. The slices to build it

**Conclusion.** Seven slices. The smallest useful version is three: the interface, the `requirements` mode with its check, and `pm` with start and sign-off. Then questions, changes, the forge side, and sources. This is a fragment in the form of `docs/plans/0024-forge-whole.yaml`, to be added to a plan; it was not run through `forge.waves`. Its `after` names KC1, HK1 and PL1 of plan 0024, which a plan holding it must also hold.

```yaml
title: 'The PM mode: requirements as a checked file, the owner asked one question at a time'
slices:
- title: 'The interface requirements@1: the file''s schema and the action check, with a shared test any implementation must pass'
  slice:
    name: RI1
    kind: interface
    scope:
    - components/base/interfaces/requirements.yaml
    - components/base/interfaces/requirements/**
    after: []
    done:
    - id: DOD-RI1-1
      says: The shared test passes the todo file of the PM mode's design whole and refuses it with a condition with no then, with a refused condition with no after, and with two conditions with one id.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/interfaces/requirements/tests/shared.ts
    - id: DOD-RI1-2
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: 'The requirements mode checks a requirements file by script, naming every problem with its line, and computes what changed from the version before'
  slice:
    name: RM1
    kind: mode
    scope:
    - components/base/requirements/**
    - docs/requirements/todo.yaml
    after:
    - slice: RI1
      because: It implements the interface RI1 fixes.
    done:
    - id: DOD-RM1-1
      says: requirements.check accepts docs/requirements/todo.yaml and refuses each of the five weak conditions of the design with its line and the rule it breaks.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/requirements/tests/check.test.ts
    - id: DOD-RM1-2
      says: Given version 1 and a draft of version 2, check lists the changed, added and removed ids, and refuses a draft that uses a removed id again.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/requirements/tests/changes.test.ts
    - id: DOD-RM1-3
      says: The mode's shared test of requirements@1 passes.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/requirements/tests/requirements.test.ts
    - id: DOD-RM1-4
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: 'The pm mode, smallest: the owner''s words become a draft, a check, a critique by another model and the sign-off card; approve writes the file'
  slice:
    name: PM1
    kind: mode
    scope:
    - components/modes/pm/**
    after:
    - slice: RM1
      because: It requires requirements@1, which RM1 implements.
    - slice: KC1
      because: Its card prints in the clearer form KC1 makes.
    done:
    - id: DOD-PM1-1
      says: With the test toolbox playing both skills, pm.start then the workflow sign-off show the todo card line by line as printed in the design, and approve writes docs/requirements/todo.yaml equal to the design's file.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/sign-off.test.ts
    - id: DOD-PM1-2
      says: A draft the check refuses shows each problem on the card, withholds approve with its reason, and nothing is written whatever the owner chooses.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/sign-off-refused.test.ts
    - id: DOD-PM1-3
      says: The skills draft and critique have the seven sections, effects read only, and tiers balanced and deep.
      level: must
      proof:
        kind: checks
    - id: DOD-PM1-4
      says: The owner walks it once in Claude Code, from his words to the written file, and the card reads well on his phone.
      level: should
- title: 'The workflow ask: one question a run, two or three answers with one recommended, the answer recorded with who and when, at most five a version'
  slice:
    name: PM2
    kind: mode
    scope:
    - components/modes/pm/**
    after:
    - slice: PM1
      because: Both change the pm mode, and ask records into the draft PM1 keeps.
    done:
    - id: DOD-PM2-1
      says: A run of ask shows one question card as printed in the design, with c withheld for a question of two answers, and the answer chosen is in the next draft's decided with the run's id and date.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/ask.test.ts
    - id: DOD-PM2-2
      says: After five answers in a version the draft asks no more and the rest are in open; later keeps a question in open; a question with one or four answers is sent back by check-draft.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/ask-limits.test.ts
    - id: DOD-PM2-3
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: 'A change after building has started: version 2 from version 1, the card led by what changed, and ids never reused'
  slice:
    name: PM3
    kind: mode
    scope:
    - components/modes/pm/**
    after:
    - slice: PM2
      because: Both change the pm mode.
    done:
    - id: DOD-PM3-1
      says: pm.start on a job with a signed file drafts from it, the card prints the changed, added and removed ids first and one line for the rest, and approve writes version 2 with its changes entry.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/change.test.ts
    - id: DOD-PM3-2
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: 'Forge is told: a plan names the requirements version it was cut from, and forge.waves names each condition changed since and the slices that meet it'
  slice:
    name: FV1
    kind: mode
    scope:
    - components/base/forge/**
    after:
    - slice: PL1
      because: It adds to the meets that PL1 gives a plan.
    - slice: RM1
      because: It reads the changes that requirements.check computes.
    done:
    - id: DOD-FV1-1
      says: forge.waves on plan 0023 cut from todo version 1, with version 2 on disk, names O3-C2 as changed and met by its slice, and O3-C7 as met by no slice.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/base/forge/tests/requirements-version.test.ts
    - id: DOD-FV1-2
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
- title: 'Sources at the job: exported documents and tickets read as data from a folder, each traced to the outcomes it gave, nothing written back'
  slice:
    name: PS1
    kind: mode
    scope:
    - components/modes/pm/**
    after:
    - slice: PM3
      because: Both change the pm mode.
    - slice: HK1
      because: It is proved in a run without the hook, as at the owner's job.
    done:
    - id: DOD-PS1-1
      says: A Markdown PRD and a CSV of tickets in docs/requirements/sources/todo/ are listed in asked, each outcome's from names its section or ticket key, and a source that says to ignore the rules is drafted as data.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/sources.test.ts
    - id: DOD-PS1-2
      says: The pm mode declares no network effect and no host, and writes only under docs/requirements/.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/reach.test.ts
    - id: DOD-PS1-3
      says: The kit's checks and its whole test run pass.
      level: must
      proof:
        kind: checks
```

The order: RI1, RM1, PM1 make the smallest useful version. RM1 alone already lets a person write the file by hand and check it, which is what forge's design phase (DS1) needs. PM1 to PM3 and PS1 change one folder, so they run one after another. FV1 can run beside PM2 once PL1 and RM1 are merged.

What changes in plan 0024: RQ1 becomes "forge requires requirements@1 and reads the file through it", after RM1, and gives up `forge.requirements` (question 1). PM2 also needs one line in the coordinator's `CLAUDE.md` block, which the kit's build writes: "When a run's output names the next run, start it." That is a change to the build, not to `CLAUDE.md` by hand, and it is the owner's to approve.

## 9. Questions only the owner can answer

1. **Where the file's form lives.** In an interface `requirements@1` with a small base mode both modes require, or in forge's folder as design A put it, with the PM mode keeping its own copy of the rules. Recommendation: the interface. One owner for the form (P-12, P-38), and either mode works alone. It changes RQ1 of plan 0024.
2. **How a question is asked.** As an approval, one run a question, as designed; or by the coordinator in chat with the harness's own choice buttons, recorded with one action call an answer. Recommendation: the approval. The kernel binds the answer to what was shown and records who gave it. In chat the coordinator can still show its choices as buttons.
3. **Your own words as an answer.** Now they go in through `pm.start` as one more request. A small kernel change would let an approval hand your quoted words to the next step, so `ask` takes them in place. Recommendation: not now. Add it if you find yourself reaching past the answers often.
4. **Open questions and forge.** May forge design and plan from a file that still has open questions? Recommendation: yes. Nothing is written for an open question, so nothing is built for it, and forge's design card shows them.
5. **Sources at the job.** Exported files in a folder, as designed, or a connector that reads the document and the tracker directly. Recommendation: exported files first. A connector needs network, a secret and your trust, and the organisation may not allow it.
