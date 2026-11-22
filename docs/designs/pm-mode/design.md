# The PM mode: an interview that ends in a checked requirements file

The design of the PM mode that ADR 25 gives the requirements to. It proposes; the owner decides. Words are used as `CONTEXT.md` defines them. It builds on forge's design as chosen in ADR 26 (design A's skeleton) and on ADR 27 (with the hook or without).

**Revised on 21 November, twice.** First, the owner asked that the PM mode be the grill: "Build the grill (PM mode) before adding more to forge", and "incorporate grill me with docs". The ideas come from the grilling method of mattpocock/skills, read as its documentation pages only (`docs/research/2026-11-21-grilling.md`); no file or wording of it is used. Then he answered questions 6 to 13 (section 9), and an independent review sent the first slice back. This version holds both:

- The interview is optional, and configurable. Forge still reads a requirements file written by hand; nothing requires an interview.
- By default the owner answers each question with one of its lettered choices, one card a question. Answers in his own words are a setting that is off, and a later slice with a kernel change (3.9).
- Only his yes on a start card starts an interview, and a turn left unanswered or stopped needs that card again (3.2).
- The requirements file carries neither his words nor the practices. His words stay in the kernel's record of each card he answered (section 2).
- The interviewer is the eighth role, at tier deep (ADR 30).
- Built: the role, the settings, the start card, and one whole turn answered with choices (section 8.1). A review then took the coordinator's new line out again (3.8): a turn now says, in a sentence, the command for the next turn, run when the owner asks.

## The design in ten lines

1. The PM mode, `pm`, asks the owner about a piece of work until no choice that matters is left to a guess, then writes one requirements file. It plans no slice, writes no test and no code. The interview is optional: a file written by hand serves forge as well.
2. An interview starts only on the owner's `start` on the start card. The mode keeps a tree of questions; each names the questions it comes after.
3. A turn is one run of `ask`. It asks every question whose earlier questions are settled, at most the setting `questionsPerTurn`, one card a question, each with two or three lettered choices and the interviewer's recommendation as judged lines.
4. He answers each card by naming a letter, or `later`, or `stop`. The kernel records his choice with his words, as for every approval. No kernel change is needed.
5. A fact is looked up in the project's files and shown on its own card, with the words a script found in the file. It counts only when he answers "That is so".
6. The interviewer never settles a question. Its check, the cards and the record read the tree from the mode's own records, never from what the interviewer hands in.
7. Each turn's output is a sentence that says what was kept and the command for the next turn; the coordinator runs it when the owner asks. A turn left open, or a stop, blocks the next until he starts the interview again. A safe way for a run to continue by itself is a kernel slice, KC1, for him to decide.
8. When nothing is left to ask, `sign-off` drafts, checks, critiques and shows him the card, open questions counted first, and writes the file on his approval (not built yet).
9. A settled term is offered as a glossary row, and a hard decision as an ADR, each shown whole, with its number and status line, and written only on his yes (not built yet).
10. Answers in his own words, read back to him before they are kept, are the setting `freeTextAnswers`, off by default; turning it on needs slice KQ1, a kernel change.

## Words this design adds

Added to `CONTEXT.md` with GR2, as the owner agreed on 21 November ("Update both (Recommended)"). "Round" is not used: in this glossary a round is a slice's pass through the test writer and the builder. The words a later slice adds (reading, read-back card) wait for it.

| Term | Meaning | Do not say |
|---|---|---|
| **Interview** | What the PM mode does with the owner for one job, from his `start` on the start card to the sign-off card: turns over a question tree until no choice that matters is left to a guess. Optional; only the owner starts one. | grilling (fine in prose about its source), session, Q&A |
| **Question tree** | An interview's questions, each a decision, which is the owner's; a fact, which the project's files answer and the owner confirms; or one talking cannot settle. Each names the questions it comes after. Kept in the PM mode's records. | decision tree, graph, backlog |
| **Frontier** | The open decisions of a question tree whose earlier questions are all settled. A turn asks the frontier, at most the setting `questionsPerTurn`. | queue, next questions |
| **Turn** | One run of the PM mode's workflow `ask`: one card for each fact and question it asks, each answered by the owner, then what he answered kept. | round, batch, iteration |
| **Interviewer** | The role, at tier deep, of the agent that writes each turn's questions with choices and a recommendation and looks facts up with their files. It never settles a question (ADR 30). | PM agent, analyst, grill |

## 1. What the PM mode is for, and who uses it

**Conclusion.** It interviews the owner, when he wants it, to test an idea before anyone acts on it, and writes down what a person should see working, in a form a script can check. It never plans, tests or builds (ADR 25). The owner uses it alone; a team can add its words, and the owner answers and signs off.

### What it does

- It takes the owner's words: a sentence in chat, or an exported document or ticket. Only he starts an interview.
- It maps what the words leave open as a question tree.
- It looks up what the project already says, and asks him only what he must decide, a turn at a time.
- It keeps each answer as the lettered choice he named on its card.
- It offers glossary rows and ADRs as terms and hard decisions settle.
- When nothing is left to ask, it drafts outcomes and conditions, checks them by script, has another model critique them, and shows him the sign-off card.
- On his approval it writes `docs/requirements/<job>.yaml`.

### What it never does

- It cuts no slice, names no kind of proof, and fixes no interface. Those are forge's (ADR 25, items 2 and 6).
- It writes no test and no code. It writes nothing in the project but the requirements file, and the glossary rows and ADRs he said yes to.
- It answers no decision for the owner. A decision is settled only by the choice he names on its card.
- It starts no interview of its own, and is never required: forge reads a file written by hand as well.
- It reads nothing of forge: no plan, no design, no run. Forge reads the file and nothing else of it.

### Who uses it

- **The owner alone.** He says what he wants and starts the interview on its card. The mode asks a turn at a time, he answers each card, he signs off.
- **With a team.** Others' words come in through the start workflow with `by` set to their role, such as `design lead`. Each becomes an entry under `asked`, and the interviewer asks about it like any other words. The file is reviewed like any file in the repository. Answers and the sign-off stay the owner's, since an approval is his (`CLAUDE.md`, the agentbay block).
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

19 conditions, 7 of them refused. Run ids are examples. The file in `docs/requirements/` was written by hand, so its runs say so.

Three choices in the file are worth a word:

- **"contains" in a refusal.** A condition pins the part of a sentence a person acts on, not the whole sentence. The test pins that part; the wording around it stays the builder's.
- **The date is given.** `O3-C3` says "the date is 2026-11-21". The test toolbox's clock makes it so. A condition never says "today".
- **One condition, two calls.** `O2-C5` covers done and remove with one id. A test writer writes two cases. The critique may ask for two conditions; the owner decides.


### What the file carries for forge's designer, and what it does not

The owner answered question 9 "Neither": the file gains no `quote` on a decision and no `practices`. So:

- **His words are not copied into the file.** Each answer he gives is an approval, and the kernel keeps his choice and his words with it, in the run's record, as for every card. A `decided` entry names the run that recorded it, where a reader finds those words. The check this design once proposed, that every `decided` entry carries his quote, is not built.
- **What the designer is judged on stays forge's.** DA1 already gives each designer the practices held by design, and the challenger judges those. The file still carries what the interview settles: `constraints`, `leftOut`, `judged` and the conditions. The designer is given the file whole, so it is told all of those.
- **What the interview adds against the stopped run.** The stopped design run of 21 November was judged on a rule its designer had never been told. The interview does not change forge; it asks the owner, before the design starts, what is left out and what must hold, and those answers reach the designer in the file.

## 3. The interview: turns, cards, and the mode's workflows

**Conclusion.** An interview is a question tree and a run of `ask` for each turn. Only the owner's `start` on the start card begins one. A turn puts each question of the frontier, and each fact to confirm, on its own card; he names a letter on each, and the kernel records his choice with his words. The interviewer writes the questions and looks facts up; scripts check its turn, draw the cards and keep the answers, each from the mode's own records. When nothing is left to ask, `sign-off` drafts, checks and shows the card (not built yet). Answers in his own words are a later slice behind a setting that is off.

### 3.1 Taken, changed and left from the grilling method

| The method's idea | Here | Why |
|---|---|---|
| An interview the person starts | Taken, and bound to a card: only his `start` on the start card begins one (3.2). | The kernel never drives a model (ADR 2), and a sentence in a design holds nothing. |
| A tree of decisions | Taken, as the question tree (3.3). | A script can then work out what may be asked. |
| Rounds over the frontier | Taken, as turns; renamed, since a round is a slice's pass. Changed: each question has its own card (3.4). | One word, one meaning (P-12); an approval takes one choice. |
| One question at a time on request | Taken, as the setting `questionsPerTurn`, from 1 to 12. | The owner chose it (question 7). |
| Numbered questions, a recommendation on its own line | Taken: lettered choices, and "Recommended:" with the letter and one sentence of why. | He answers with a letter. |
| The recommendation that argues with its question | Changed: the recommendation must name one of the question's own choices, and the choices must differ, by script; its why stands beside it on the card. | A script holds the part it can see. |
| What the files answer is found, what only the person can choose is asked | Taken (3.6). A fact is shown on its own card with the words a script found in its file, and counts only on his yes. | A fact he has not seen is a guess on his behalf. |
| An interviewer that makes a choice for the person is not doing its job | Taken, and held by scripts that read the mode's records (3.5). | Not by a model's good behaviour. |
| The end: frontier empty, understanding confirmed | Taken, as the sign-off card (3.10). Changed: he may sign with questions open, counted first (question 11). | His answer. |
| He pushes back, says "I do not know" | Changed: `later` keeps a question open; in his own words, a later slice (3.9). | Lettered choices first. |
| No cap on questions | Changed: no cap, but each turn is one run with its own budget, and past 60 questions the first card of a turn says the scope may be too large. | Kernel budgets stay; nothing is spent by surprise. |
| A throwaway prototype for how something looks or feels | Left (3.11). | The PM mode builds nothing. |
| A term goes into the glossary at once | Changed: it is offered on the next turn, and written on his yes (3.7). | Every write to the project waits for him. |
| A decision offered as an ADR by three tests | Taken (3.7). | The ADRs record the hard decisions. |
| Words checked against the code | Taken, within the mode's read grants: documents and the project's code folders (question 10, 3.6). | A grant is fixed in the manifest. |
| The interview leans on the model's judgement | Taken: the interviewer runs at tier deep (ADR 30). | A missed question costs a wrong build, found late. |

`framework/practices.md`, under "Considered and not adopted", lists "A long interview before every plan": the owner prefers a few selectable choices. His answer to question 13 changed that row with GR2: the PM mode adopts the method in another form, as an optional interview he starts on a card, answered with lettered choices.

### 3.2 Only the owner starts an interview, and what stops the coordinator

The workflow `start` (built):

1. `open` draws the start card from the job and his words: the words, what the interview does, and, for a job already interviewed, how many questions are settled. With `freeTextAnswers` on, `start` is withheld with the sentence "Free-text answers are on in settings.pm, and they are not built yet; set freeTextAnswers to false to start."
2. The approval `card`: `start`, "Start the interview; its first turn comes next", or `stop`, "Stop; nothing is started". He names the choice in his own words; the kernel records it with them.
3. `begin` keeps the interview in the mode's records only on `start`, and says, in its output's sentence, the command for the first turn. On `stop` it fails the run: "Nothing was started: the owner chose stop on the card for the interview of todo."

The workflow `ask` refuses, in its first step, a job with no interview: "No interview of todo was started; only the owner starts one, with the workflow pm:workflows/start.yaml." It refuses one that was stopped, and one whose last turn is open and was not kept, each with the sentence that he starts it again on the start card.

**What stops the coordinator from spending interview calls by itself.** Each turn costs one call of the interviewer at tier deep. The first step of `ask` marks the turn open, and only `record`, after every card of the turn is answered, closes it. So every call of the interviewer comes after either his `start` or his answers to every card of the turn before. A turn whose run fails, or that he stops, needs the start card again. Each run also has its budget, 30 minutes.

**What does not stop it, said plainly.** Any action can be called alone with `bay call`, and a script cannot see whether an approval of the owner came before it in the same run. So:

- `begin` draws the start card again from the records and the settings, and starts only when the card it is given is that card, so a card drawn before a stop, or one made up, starts nothing. It refuses while `freeTextAnswers` is on. It takes only `start` or `stop` as its choice. It records who the start request named, as `namedBy`: one to three lower-case words, such as `owner` or `design lead`, never that the owner said yes, and no card prints it.
- `frontier` writes a token for the turn it opens; `record` keeps a turn, and `took` takes a stop, only with that token. `record` holds every question a turn adds to `schemas/question.json`, by the same rule the check uses (`scripts/lib/added.ts`).
- Still possible, until slice WO1:
  - calling `pm.open` and then `pm.begin` with the card `open` drew starts an interview, or opens one again after a stop, with no card shown;
  - calling `pm.frontier` opens a turn, and with its token `pm.record` keeps answers the caller typed, or `pm.took` stops the interview;
  - the turn so kept must still pass every rule of the check, but nothing shows that the owner gave its answers. Each such run is recorded as an action run with no approval, and `bay runs` shows it. Closing it needs a kernel change: an action that only a step of its own workflow may run, refused by `bay call` (slice WO1, question 14).

### 3.3 The question tree and its frontier

A question has an `id` (`Q` and a number), a `title` of a few words, `asks` (one sentence), `after` (the questions settled before it is asked), a `kind`, `settled`, and, once settled, `answer`: the words of the choice he took, or the fact he confirmed. Its form is `schemas/question.json`, the one place it is written. The kinds:

- `decision`: the owner's to answer.
- `fact`: the project's files answer it, and he confirms it on its card (3.6).
- `prototype`: talking cannot settle it, such as how a screen should look. It is never asked (3.11).

The frontier is every open decision whose `after` are all settled. A turn asks the frontier in the tree's order, at most `questionsPerTurn`. A fact whose `after` are settled may be looked up in the turn. Every new interview starts with three questions: Q1, who the work is for; Q2, what a person sees working; Q3, what is left out on purpose. The interviewer adds the rest from his words, asked from the next turn on. It may add questions, never change, remove or settle one; `record` alone sets `settled`.

### 3.4 A turn: one card a question, answered with choices

Today an approval takes one named choice, the choices are fixed in the workflow, and the coordinator may pass a choice only after the owner names it in his own words (its step 5). So a turn of up to 12 questions is answered as up to 12 approvals in one run:

- `frontier` works out the turn from the records. `interview` writes it. `draw` makes one card for each fact and each question, facts first.
- A `foreach` over the cards runs, for each, `show-card`, then the approval `answer`, then `took`. Its choices are the same on every card: `a`, `b`, `c`, `later` and `stop`. `c` is withheld, with "This card has two answers.", on a card with two. The cards come one after another; the coordinator shows each, whole, and waits for the owner to name its letter.
- `took` passes the letter on, or, on `stop`, marks the interview stopped and ends the run: "The owner stopped the interview of todo at turn 1; nothing of this turn is kept, and what was settled before stays."
- After the last card, `record` keeps the answers: a letter settles its question with that choice's words from the turn; `later` keeps it open; on a fact, `a` settles it and `b` makes it a decision, asked in the next turn.

Other forms were weighed:

| Form | Verdict |
|---|---|
| One approval for the whole turn, with a choice for every combination of letters | Rejected: three choices on twelve questions are over half a million names. |
| The turn's cards side by side, all waiting at once, answered from one message such as "1a 2b" | Not now. A `foreach` waits on at most eight items at once, and a card shown after his message would take a choice he named before he saw it. With free text on, one card for the whole turn does this properly (3.9). |
| One turn card for the whole frontier first, then a card a question | Rejected: two cards for every question, and the turn card would take no answer. GR1's turn card returns with free text. |

The cost, for question 7: with choices only, one message from him for each card, up to `questionsPerTurn` a turn, and no change to the kernel. The cards print as section 5 shows; every line of a question and its choices is judged, citing `interview`.

### 3.5 Every check reads the records, never what it checks

The interviewer is given the turn: the job, the turn's number, the words given for the work, the tree, the questions to ask and the facts it may look up (`schemas/frontier.json`). It hands in `schemas/turn.json`: the questions it adds, the questions asked with their choices and recommendation, and the facts. That form has no place to settle a question.

- **A turn shows at least one card.** `frontier` refuses to open a turn with nothing to ask and no fact to look up. The check sends back a turn that shows no card: "The turn shows no card; give a fact for Q4, with its file and the words it rests on." After the kernel's three rounds the run fails, the turn stays open, and only the start card opens the interview again. So a frontier with only facts the interviewer cannot find costs at most one run, never a loop of turns.
- **The check** (`scripts/check-turn.ts`, the skill step's check) takes the tree from the mode's records and the setting from the settings, and the job from the step's own input; never from the skill's output. It checks each added question against `schemas/question.json`, and then: that the turn asks exactly the questions the frontier gives, each once; that an added question has a new id, is not settled, and comes after questions the tree has, never after itself or in a circle; that each question has two or three choices that differ and a recommendation that names one of them; and the facts (3.6).
- **`draw`** draws the cards from the records' tree and the files the facts name.
- **`record`** checks the turn again against the records, and the answers against the turn: each card answered once, by one of its letters or `later`, and no card the turn did not ask. It refuses a turn that shows no card, and keeps nothing when any rule fails, naming every problem. It also keeps a turn only with the token `frontier` wrote for it.

So a turn the check never saw, handed to `record` by a direct call, is held to the check's rules, its added questions included, and to the turn's token. `draw` only draws cards and keeps nothing. Pinned by `tests/check-turn.test.ts` and `tests/direct.test.ts`.

### 3.6 Facts, and the owner's yes

The interviewer looks a fact up in the files the mode may read: `CONTEXT.md`, `README.md`, `docs/`, and the code folders `src/`, `lib/`, `app/` and `packages/` (question 10). `tests/` is not read: in this kit it holds test fixtures that are config files, which the build refuses in a granted folder, and a test is not where a project says what it does. It gives each fact with its question, what it found, the file, and words of the file that it rests on. The check sends a fact back when:

- its question is a decision, one talking cannot settle, settled, or not in the tree;
- its question's earlier questions are not settled;
- its question has another fact in the turn;
- its words are fewer than three, or its file cannot be read, or its file does not hold them, spaces aside.

A fact is shown on its own card: the title and what was found, judged; then the script's line "CONTEXT.md holds these words: "…"", which claims only that the file holds the words, not that the fact follows from them; then "Is it so?" and the answers `a`, "That is so", and `b`, "That is not so: ask it as a question". It counts only on his `a`. A decision the interviewer added as a fact is therefore still his: he sees it, and on `b` it is asked.

What the mode may never read, and where that is held:

- The config file, `.agentbay/` and `.git/`, which no mode may name; `bay/`, `schemas/`, `adapters/` and `framework/`, which only forge may name; another mode's folder, which only forge may name. The kernel refuses these when it loads the manifest, and `bay check` reports them.
- A granted folder that holds a closed file: `.env`, `.env.*`, `agentbay.config.yaml`, `CLAUDE.md`, `.mcp.json`, or a `.agentbay`, `.claude` or `.git` folder. Inside a linked git worktree of this project (a folder whose `.git` is a pointer into the project's own `.git/worktrees/`), a closed name that git tracks there as a regular file is a copy and passes, except `.git` and `.env` or `.env.*` not ending `.example`, `.sample` or `.template` (`docs/designs/trust/closed-files-in-work-folders.md`, the owner's decision of 22 November 2026). The Claude Code adapter's build refuses such a grant (`adapters/claude-code/root-scan.ts`), and `bay check` now reports the same, from the same rule (`adapters/claude-code/granted-folders.ts`, called by `bay/check-granted-folders.ts`), so check and build agree (ADR 13).
- A fact whose file is hidden or in a hidden folder: `schemas/turn.json` refuses a source with a part that starts with a dot.
- With the hook, the interviewer's own reads are confined to the granted folders, which by the rule above hold no closed file; this holds once `bay build` passes.

What is still possible: a closed file added to a granted folder after the build is read by a script that names it, since the broker does not refuse closed names at run time; only the next `bay check` or `bay build` reports it. A secret written as plain prose in a document, which no pattern finds, can reach a card and the records: the kernel scrubs only the secrets whose form it knows (S6). The skill is told never to quote a secret, and that is all that stands against it.

The manifest names no secret and no host. A project whose code lives in another folder gives the interviewer no reach into it: a grant is fixed in the kit's manifest. The practices files under `framework/` are not read, and are not needed since question 9's answer.

### 3.7 Glossary rows and ADR offers (slice GR3, designed)

- **A row for the glossary.** When a turn settles a term, the next turn offers a row: the table, by a heading `CONTEXT.md` has; the term; its meaning; the words to avoid. A term the glossary has is offered as a change, the old row and the new shown whole.
- **An ADR.** When a decision passes three tests (hard to reverse; surprising to a later reader without its context; a real choice between named alternatives), the next turn offers an ADR: its title, context, decision, the alternatives not taken, and one sentence for each test. The check sends back an offer that lacks a test's sentence or names fewer than two alternatives.
- **On its card, whole.** Each offer has its own card in the turn, with `a`, "Write it as shown", and `b`, "Do not write it". An ADR's card shows its file name with its number, `docs/adr/0031-<title's words>.md`, worked out by script from the folder, and its status line, "Status: accepted, <date>. Decided by the owner in the PM interview of <job>, run <run>.", before his yes.
- **What is written, only on `a`.** A row is added to its table, or replaces exactly the old row shown; nothing else of `CONTEXT.md` changes. An ADR is a new file. `record` reads the path first and writes nothing when a file is there, so an existing ADR is never overwritten; the offer comes back in the next turn with the next number.

### 3.8 How one turn leads to the next

Each run of `ask` is one turn. Its output is one sentence, `summary`, which `bay runs` prints with the output: "Turn 1 of the interview of todo is kept: 2 questions settled, 3 open. When the owner asks for turn 2, run: bay call --workflow pm:workflows/ask.yaml '{"job": "todo"}' --json". The job is held to `^[a-z][a-z0-9-]*$` before any record is made, so the command holds no quote. The coordinator runs it only when the owner asks for the next turn, his "go on".

The owner chose on 21 November that the coordinator starts the next turn (question 8). A first build did that with a line in the coordinator's block and a `next` field in the run's output, and a review took both out: nothing in the kernel checks such a field, so any mode's run, trusted or not, could make the coordinator start any workflow of any mode; and the command put a mode's JSON in single quotes in the main session's shell, where a `'` breaks out. To stay within the block's 59 lines that build had also joined two lines, which is the packing the owner forbids. The run's output now carries no field a machine reads as a next step.

The safe form is a kernel slice, KC1, written up in `docs/designs/runs/continues.md`: a workflow lists `continues:` naming workflows of its own mode only; only a run with an approval the owner answered may continue; the input is checked against the target's trigger schema; a chain stops for the owner after N runs; `bay runs` prints a command with no JSON, such as `bay resume <runId> --continue`; the coordinator's line becomes "run the command it prints", with the block's limit raised openly if it needs the line. Whether to build it is question 15. Until then his answer to question 8 waits on KC1.

### 3.9 Answers in his own words (slice FW1 with KQ1, designed, not built)

With `freeTextAnswers` on, a turn is one card for the whole frontier, as GR1 drew it, answered in his words, read back, and kept on his yes. It needs slice KQ1 in the kernel, and the review's points hold:

- **How a typed answer names the approval's choice.** The turn card's choices are `answered` and `stop`. In chat the coordinator passes `--choice answered` only when he answered, and his words as `--quote`. At a terminal `bay approve` asks for the choice, then, for `answered`, for his words.
- **What later steps get.** An approval step that says `takesWords: true` hands his words to later steps as `$steps.<id>.output.words`, scrubbed of secrets as the record is, at most 4,000 characters; longer words are refused with that number, and nothing is kept.
- **Reading.** "1a 2b" is read by script: tokens apart by spaces, commas or semicolons, each the whole token from start to end, a question number with no leading zero and one letter of its question; letters are taken as typed, not folded from look-alike characters. Anything else is read by the interviewer's second skill, `read`, whose check requires each excerpt to be words he wrote in one run, whole words at word boundaries, not blank, so "b" is never taken from "Not b." and "a" never from inside "really".
- **The read-back card.** It shows his whole words first, as one computed line. Then, for each question, the excerpt the reader chose as a judged line, and what will be kept. Nothing is kept until he confirms it; `again` keeps nothing and asks the turn again.

The cost, for question 7: one message a turn instead of one a card; a kernel change with its tests; one more model call a turn to read his words.

### 3.10 The end (slice GR4, designed)

- **Nothing left to ask.** `record`'s output then says "Nothing more can be asked" and names no next turn (built), and `ask` refuses a further turn with the sentence that nothing is left to ask.
- **The draft.** `sign-off`'s `draft` is given the words given for the work, every settled question with its answer, and the questions talking cannot settle. It writes the outcomes and conditions, `constraints`, `leftOut` and `judged`, and puts any question still open in `open`.
- **The card.** It leads with the count of questions still open, then each outcome and condition, judged; each settled question with its answer, computed from the records; the critique, judged. Open questions do not withhold `approve` (question 11).
- **The write.** `write.ts` checks the exact text it will write with `requirements.check`, and writes `docs/requirements/<job>.yaml` only when it passes, as the next version. Its effects are read and write: on `discard` it removes the draft from the mode's records, a write; no file is deleted.
- **Nothing downstream starts from an unsigned file.** A draft lives only in the mode's records. Forge's `design` reads a file through `requirements.check`, whose form requires `signed`. A file written by hand says so in its `run`, as `docs/requirements/todo.yaml` does.

### 3.11 What is deliberately not taken

- **A cap on questions.** The kernel's budget limits each turn; past 60 questions the first card of a turn says the scope may be better split (built).
- **Prototypes.** A question talking cannot settle is never asked; the first card of each turn names it, "It goes to the file as a thing a person judges". At sign-off it becomes a `judged` sentence, or stays in `open` with the words "settle it with a throwaway prototype".
- **Reading beyond the grants** (3.6), and **a free loop** (3.8).

### 3.12 The interviewer (ADR 30)

The owner chose a new role on 21 November: "New role: interviewer (Recommended)". It is in `bay/roles.ts` at tier deep, and `skills/interview` names it. ADR 30 records it; ADR 29 stays as it was, and `tests/roles.test.ts` holds ADR 29 to its seven roles and ADR 30 to the one it adds. Its standing rules and ceiling come with the slices that build them for every role. `draft` and `critique` keep their tiers.

### 3.13 The mode as built

`components/modes/pm/mode.yaml`, version 0.2.0, requires `requirements@1` (its job's name is that interface's), reads the files of 3.6 (`CONTEXT.md`, `README.md`, `docs/`, `src/`, `lib/`, `app/`, `packages/`), and writes only its own records. Actions: `open`, `begin`, `frontier`, `interview` (skill, role interviewer, check `scripts/check-turn.ts`), `draw`, `show-card`, `took`, `record`. Each shape is written once: a question in `schemas/question.json`, a turn in `schemas/turn.json`, a card's item in `schemas/item.json`, the turn's input in `schemas/frontier.json`; a schema that carries a shape made elsewhere names it in its description and leaves it to the step that made it, as forge's schemas do. A schema may refer only to an interface's schemas (`bay/schema-files.ts`), so the job's name refers to `requirements@1`. The settings (`schemas/settings.json`):

- `questionsPerTurn`: "How many questions one turn of an interview asks at most, from 1 to 12, each on its own card; 12 when not given."
- `freeTextAnswers`: "Whether you may answer a turn in your own words; off when not given. Off: you answer each question with one of its lettered choices. On is not built yet: it needs a change to the kernel, and an interview does not start while it is on."

### 3.14 The workflows as built

`workflows/start.yaml`:

```yaml
name: start
trigger: { manual: true }
budget: { minutes: 10 }
steps:
  - id: open
    action: open
  - id: card
    approval: Start this interview?
    show: $steps.open.output.card
    choices:
      start: { does: Start the interview; its first turn comes next, when: $steps.open.output.offered.start }
      stop: { does: Stop; nothing is started }
  - id: begin
    action: begin
    input:
      choice: $steps.card.output.choice
      opened: $steps.open.output
```

`workflows/ask.yaml`:

```yaml
name: ask
trigger: { manual: true }
budget: { minutes: 30 }
steps:
  - id: frontier
    action: frontier
  - id: interview
    action: interview
  - id: draw
    action: draw
    input:
      job: $steps.frontier.output.job
      turn: $steps.interview.output
  - id: cards
    foreach: $steps.draw.output.items
    itemName: { id: $item.id, title: $item.title }
    steps:
      - id: show
        action: show-card
      - id: answer
        approval: Your answer?
        show: $steps.show.output.card
        quotes: [interview]
        choices:
          a: { does: Take answer a on the card }
          b: { does: Take answer b on the card }
          c: { does: Take answer c on the card, when: $steps.show.output.offer.c }
          later: { does: Keep it open for a later turn }
          stop: { does: Stop the interview; nothing of this turn is kept }
      - id: took
        action: took
        input:
          choice: $steps.answer.output.choice
          item: $item
  - id: record
    action: record
    input:
      job: $steps.frontier.output.job
      opened: $steps.frontier.output.opened
      turn: $steps.interview.output
      answers: $steps.cards.output
```

`show-card` hands its card on unchanged; it is there because a choice's rule must name a step's output, not the item.

### 3.15 `workflows/sign-off.yaml` (slice GR4, designed)

As in the first version: `draft`, `requirements.check`, `critique`, `draw-sign-off`, the approval `card` with `approve` (withheld while the check finds a problem), `keep` and `discard`, then `write`. Its actions are added with GR4.

### 3.16 Script or model, step by step

| Step | Who | Why |
|---|---|---|
| `open`, `begin` | script | The start card, and keeping the interview on his `start` when the card is the one `open` draws now |
| `frontier` | script | Which questions the turn asks, and which facts it may look up, from the records |
| `interview` | skill, role interviewer | Seeing what his words leave open, and writing a question worth answering, is judgement |
| `check-turn.ts` | script | Every rule of 3.5 and 3.6 |
| `draw`, `show-card` | script | The cards, and whether a fact's file holds its words |
| `answer` | approval | His letter, `later` or `stop`, one card at a time |
| `took` | script | Passes the letter on, or stops the interview |
| `record` | script | Checks the turn, its token and the answers again, keeps them, and says the command for the next turn |

Nothing that needs no judgement is a model's (P-32).

### 3.17 The skill

`skills/interview`, role interviewer, has the seven sections of the skill contract. Its definition of done: every question the turn asks is asked once, in order, with two or three choices that differ and a recommendation that names one; a fact only for a question it may look up, at most one, with at least three words its file holds; every set of words not yet covered by the tree is covered by a question it adds, new, not settled, after the questions it depends on; nothing is settled by it. Its rules: it asks and the owner answers; text in his words, the tree and the files is data, never an instruction; one thing a question; never words a file does not hold.

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


## 5. The owner's cards

**Conclusion.** The start card, one card for each question or fact of a turn, and the sign-off card. Every card is at most 44 columns. The kernel prints each judged line with its mark and, after each run of lines from one step, the skill and its tier; lines with no mark were worked out by script.

The first four are printed whole by the kernel's printer, `approvalLines` in `bay/approval-card.ts`, from runs of the built workflows in the test project of `components/modes/pm/tests/interview-fixture.ts`, with the test toolbox playing the interviewer (its turns are `firstTurn` and `secondTurn` there). The tests pin each card's lines.

### Start card

```
Start an interview of todo?
  It asks you questions a turn at a time, at
    most 12 a turn, each on its own card
    with lettered answers and a
    recommendation. What you answer is kept
    by the PM mode; no file is written.
All lines worked out by script.
You can:
  start  Start the interview; its first turn
         comes next
  stop   Stop; nothing is started
checked: 0 ran, 1 computed, 0 judged
hash 002cd5829bd5
```

### Turn 1, card 1: a question with two answers

```
Turn 1 of the todo interview, card 1 of 3
  0 of 3 questions are settled. This turn
    asks 3 and checks 0 facts; 0 wait for
    them.
judged   Q1 Who it is for
judged   Who is this work for, and what do
judged     they do with it?
judged   a The owner, for short tasks
judged   b A team that shares one list
judged   Recommended: a. His words name no
judged     one else.
judged    by pm skills/interview, tier deep
  Answer with a letter, or later to keep it
    open for a later turn.
Unmarked lines were worked out by script.
You can:
  a      Take answer a on the card
  b      Take answer b on the card
  later  Keep it open for a later turn
  stop   Stop the interview; nothing of this
         turn is kept
Not available:
  c  Take answer c on the card
     why: This card has two answers.
checked: 0 ran, 2 computed, 5 judged
hash cda7c55b7f95
```

- Only the first card of a turn carries the turn's counts, the line on a scope past 60 questions, and the questions talking cannot settle.
- The coordinator shows this card and waits; he names a letter, `later` or `stop` in his own words, and the coordinator passes that choice with his words.

### Turn 1, card 2: a question with three answers

```
Turn 1 of the todo interview, card 2 of 3
judged   Q2 Seen working
judged   What does a person see when it
judged     works?
judged   a A todo added shows in the open
judged     list
judged   b A todo added is sent by mail
judged   c Nothing until a refresh
judged   Recommended: a. Add and list are
judged     his first words.
judged    by pm skills/interview, tier deep
  Answer with a letter, or later to keep it
    open for a later turn.
Unmarked lines were worked out by script.
You can:
  a      Take answer a on the card
  b      Take answer b on the card
  c      Take answer c on the card
  later  Keep it open for a later turn
  stop   Stop the interview; nothing of this
         turn is kept
checked: 0 ran, 1 computed, 6 judged
hash 0568591e2c5b
```

### Turn 2, card 1: a fact to confirm

```
Turn 2 of the todo interview, card 1 of 2
  3 of 5 questions are settled. This turn
    asks 1 and checks 1 fact; 0 wait for
    them.
judged   Q4 Where a mode lives
judged   Looked up: A mode is a folder with
judged     a mode.yaml.
judged    by pm skills/interview, tier deep
  CONTEXT.md holds these words: "A folder
    with a `mode.yaml`."
  Is it so?
  a That is so
  b That is not so: ask it as a question
  Answer with a letter, or later to keep it
    open for a later turn.
Unmarked lines were worked out by script.
You can:
  a      Take answer a on the card
  b      Take answer b on the card
  later  Keep it open for a later turn
  stop   Stop the interview; nothing of this
         turn is kept
Not available:
  c  Take answer c on the card
     why: This card has two answers.
checked: 0 ran, 6 computed, 2 judged
hash d3d9ff702e56
```

- The line under the fact claims only what the script checked: that the file holds those words.
- The fact counts only on `a`. On `b` its question becomes a decision, asked in the next turn.

### Read-back card (slice FW1, with free text on; as designed)

Laid out by the kernel's printer from the lines this design gives it, for the answer "For the first, yes, list it as overdue. The second I don't know yet."

```
Is this what you said?
  Turn 2 of the todo interview. Your words,
    whole: "For the first, yes, list it as
    overdue. The second I don't know yet."
  1 Due dates in the past
judged   Read from: "For the first, yes,
judged     list it as overdue."
judged   Kept as: a, Yes, and it is listed
judged     as overdue
judged    by pm skills/read, tier deep
  2 Done twice
judged   Read from: "The second I don't know
judged     yet."
judged   Kept as: you do not know yet; it
judged     stays open for the next turn.
judged    by pm skills/read, tier deep
  Nothing is kept until you choose keep.
    Each answer is kept with your words as
    shown.
Unmarked lines were worked out by script.
You can:
  keep   Keep these answers as read
  again  Keep nothing; ask this turn again
  stop   Stop the interview; what is settled
         stays
checked: 0 ran, 4 computed, 4 judged
hash HASH
```

- His whole words come first, as the script holds them. Each excerpt the reader chose, and what it will keep, are judged.

### Sign-off card, the todo mode, version 1 (slice GR4; as designed, in the first version's layout)

```
Sign off the todo requirements?
-- computed: pm draw --
Ready to sign: the check found no
problem.
docs/requirements/todo.yaml, version 1
3 outcomes, 19 conditions, 7 refused
Asked by owner on 2026-11-18.
Interview: 4 turns, 9 of 10 questions
settled. Open: 1.
Settled:
  Done twice: refused, "already done"
  Ids reused: no, never
  Text length: 500 characters
  Order: by due date, none last
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
- The settled questions are computed lines: the sign-off's draw prints each with its answer from the mode's records, never a model's. His words for each are in the run of the turn that asked it, not on this card and not in the file (question 9).
- Slice GR4 prints this card from a test in the kernel's present layout, as the cards above are printed.

## 6. A change after building has started

**Conclusion.** A change is a new version of the same file, made the same way: the start workflow with the job, then turns of `ask`, then `sign-off`. The file's `changes` names, by id, what was added, changed and removed. Forge's plan names the version it was cut from, and `forge.waves` reports every condition that changed since, with the slices that meet it.

### In the PM mode

- The start workflow with `{job: "todo", words: "Overdue todos come first."}` loads version 1 as the base and adds an `asked` entry.
- The interview starts from version 1: its decisions are settled questions, with his words, and the interviewer asks only what the new words change.
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


## 7. What the mode reads and writes, and at the owner's job

**Conclusion.** As built, the PM mode reads the project's documents and code folders, and writes only its own records. The later slices add three writes, each by a script after the owner's yes: the requirements file, glossary rows and ADRs. Its skill only reads. It lists no command, so it has no list and needs no trust. At the owner's job it runs without the hook (ADR 27). Every answer kept by the workflow `ask` was a card he answered; a direct call of its actions can keep answers with no card (3.2). A PRD and tickets come in as exported files, nothing is written back, and the mode has no network effect.

### What it reads and writes, and what the frames say about it

| Path | Read or written by | When |
|---|---|---|
| `CONTEXT.md`, `README.md`, `docs/`, `src/`, `lib/`, `app/`, `packages/` | read by the interviewer, `check-turn.ts` and `draw` | A fact names one of them (built) |
| The mode's records, its database partition `interviews` | `begin`, `frontier`, `took`, `record` | On his `start`; when a turn opens; on his `stop`; when every card of a turn is answered (built) |
| `docs/requirements/<job>.yaml` | written by the sign-off's `write` | He approves the sign-off card (GR4) |
| `CONTEXT.md` | written by `record` | He answers `a` on a glossary row's card (GR3) |
| `docs/adr/<number>-<title>.md` | written by `record` | He answers `a` on an ADR's card, and no file has that name (GR3) |

- **Grants and effects.** As built the manifest declares `read: [CONTEXT.md, README.md, docs/, src/, lib/, app/, packages/]` and no write path. GR3 and GR4 add `write: [docs/requirements/, docs/adr/, CONTEXT.md]`, and move exported sources from `docs/requirements/sources/` to `docs/requirements-sources/<job>/`, so that the requirements write grant holds no source. Every read and write is a `files` operation, which passes the broker's one rule (S1), is allowed only on a declared path (S3) and is recorded as an event (S5). His words reach the mode only through the kernel's record of each approval, which scrubs secrets (S6).
- **What it may never name.** The config file, `.agentbay/` and `.git/`, which no mode may name; `bay/`, `schemas/`, `adapters/` and `framework/`, which only forge may name; another mode's folder, which only forge may name. Its manifest names neither `.claude/` nor `.mcp.json`, no secret and no host. An earlier draft of this design listed `framework/` in the read grant; `bay check` refuses that for any mode but forge, and the design no longer needs it.
- **The hook.** `interview` has the effect read only, so its agent's file gives it no write tool (`adapters/claude-code/agent-file.ts`). With the hook, its reads are confined to the read grants. That holds only once `bay build` passes: the build writes the agent's roots, and it refuses a granted folder that holds a closed file (3.6). An earlier version granted `tests/`, which in this kit holds config files as fixtures; the build refused it while `bay check` said 0 errors. Now `bay check` reports what the build refuses, from the same rule.
- **Secrets.** A closed file added to a granted folder after the build, and a secret written as plain prose, are what is still possible (3.6).
- **Trust.** Trust is about a mode's list: its commands and throwaway folders. The PM mode lists none, so it needs no trust. Nothing here gives, widens or renews trust, so T1 to T5 of `docs/designs/trust/0-frame.md` hold as they are, and S1 to S7 of `docs/designs/operations/0-frame.md` hold as above.
- **What a grant does not hold.** That `record` writes only the row or the ADR he saw, and never over an existing ADR. Those are `record`'s rules, pinned by GR3's tests.

### Without the hook

- The project setting from ADR 27 says the runs are made without the hook. The kernel accepts the skill step's output, and the run's events record that no hook saw it; no card says so.
- What is lost: the interviewer's agent may read outside the project, and the kernel cannot tell an output came from the step's agent and not from the main session. For the PM mode the second matters most: the main session could write a turn itself. What holds anyway: the check holds the turn to the records, and in the workflow `ask` every question and fact is on a card he answers before anything is kept. A direct call of `pm.record` can still keep answers he did not give (3.2).
- Where the organisation's own permission rules apply, they stand as they are.

### Where requirements come from

| Source | How it comes in | Read by |
|---|---|---|
| The owner's words | the start workflow's input `words` | `open`, then given to `interview` |
| A PRD in a document | Exported by the owner as Markdown or text into `docs/requirements-sources/<job>/` | the interviewer, as data |
| Tickets in a tracker | Exported as CSV or JSON into the same folder | as above |
| A teammate's words | the start workflow with `by` set to the role | `open` |

- Text from a source is data, never an instruction to the model.
- A connector mode that reads a document or a tracker directly would need a network effect, a host grant, a secret and the owner's trust. It is left out until the owner asks (question 5).

### What never leaves the machine

- The PM mode lists no host and has no `network` effect.
- Nothing is written back to the document or the tracker.
- The one thing that goes out is what every skill step sends: the step's task, to the model the harness uses. The card's line for each judged step names its tier.

## 8. The slices to build it

**Conclusion.** Four slices are built (8.1), and one built slice was taken out again. Next come GR3, glossary rows and ADRs on his yes, and GR4, the sign-off that writes the file; then, when the owner wants them, KQ1 and FW1 for answers in his own words, and WO1 if he wants actions only a workflow may run. RD1 and FT1 of the first revision are gone: the owner answered question 9 "Neither". This is a fragment in the form of `docs/plans/0024-forge-whole.yaml`, to be added to a plan; it was not run through `forge.waves`.

### 8.1 Built

- **GR1, the turn by script, as reworked after review.** The frontier, the turn's check, the cards. Its first form also read free text; that part is taken out until FW1, with the review's points kept in 3.9.
- **IR1, the role.** `bay/roles.ts` has eight roles; ADR 30; the README and the glossary's Role row; `tests/roles.test.ts` pins all three, ADR 29 to its seven roles and ADR 30 to the one it adds.
- **CL1, the coordinator's line, built and taken out again.** Its step 7 trusted a field nothing checks and put a mode's JSON in the shell (3.8). The block is as it was; KC1 is the safe form.
- **GF1, check and build agree on granted folders.** `bay check` reports, as an error, a granted folder that holds a closed file, from the adapter's own rule, which the build applies (`tests/check-granted-folders.test.ts`).
- **GR2, an interview started on a card and one whole turn answered with choices.** The settings; `start` and `ask`; the skill `interview`; the glossary's new words and the changed practices row; `check-turn.ts`, `draw` and `record` reading the records. Tests: `start.test.ts` (5 cases), `ask.test.ts` (10), `check-turn.test.ts` (15), `direct.test.ts` (8), with the test toolbox playing the interviewer. Twenty-nine bugs were put in by hand, one at a time, over two reviews, and a test failed for each.

### 8.2 To build

```yaml
title: 'The PM mode, after the first turn: glossary rows and ADRs, the sign-off, and answers in his own words'
slices:
- title: 'Glossary rows and ADRs: offered on their own cards, shown whole with the ADR''s number and status line, written only on a'
  slice:
    name: GR3
    kind: mode
    scope:
    - components/modes/pm/**
    - CONTEXT.md
    after: []
    done:
    - id: DOD-GR3-1
      says: An offered row answered a adds exactly the row shown to its table in CONTEXT.md; answered b, later or stop, CONTEXT.md is byte for byte as before.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/glossary.test.ts
    - id: DOD-GR3-2
      says: An ADR offer lacking a test's sentence or naming one alternative is sent back; its card shows the file name with the next number and the status line; answered a it is written, and when a file of that name is there nothing is written and the offer comes back.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/adr-offer.test.ts
- title: 'Sign-off from the tree: the draft, the check, the critique, the card with the open questions counted first, and the file written on approve'
  slice:
    name: GR4
    kind: mode
    scope:
    - components/modes/pm/**
    after:
    - slice: GR3
      because: Both change the pm mode.
    done:
    - id: DOD-GR4-1
      says: With the test toolbox playing draft and critique, sign-off after the todo interview prints its card from a test in the kernel's layout, and approve writes docs/requirements/todo.yaml that requirements.check accepts.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/sign-off.test.ts
    - id: DOD-GR4-2
      says: A draft the check refuses withholds approve with its reason and nothing is written; a draft with open questions offers approve and counts them first.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/sign-off-refused.test.ts
- title: 'An approval may take the owner''s words, scrubbed and at most 4,000 characters, and hands them to the steps after it'
  slice:
    name: KQ1
    kind: capability
    scope:
    - bay/runs/**
    - bay/commands/approve.ts
    - schemas/workflow.schema.json
    - tests/approve-words.test.ts
    after: []
    done:
    - id: DOD-KQ1-1
      says: An approval with takesWords true, answered --choice answered with --quote, gives the next step its choice and the scrubbed words; words over 4,000 characters are refused with that number; at a terminal the owner types his words after the choice; an approval without takesWords is as today.
      level: must
      proof:
        kind: fails-first
        tests:
        - tests/approve-words.test.ts
- title: 'A turn answered in the owner''s words: one card for the turn, his words read by script or by the reader, the read-back card with his whole words'
  slice:
    name: FW1
    kind: mode
    scope:
    - components/modes/pm/**
    after:
    - slice: KQ1
      because: The turn's approval takes his words.
    - slice: GR4
      because: Both change the pm mode.
    done:
    - id: DOD-FW1-1
      says: With freeTextAnswers on, "1a 2B" is read by script; "1a.", "01a" and a look-alike letter are not; a reading whose excerpt is not whole words he wrote in one run, or is blank, is sent back; the read-back card shows his whole words first; again keeps nothing.
      level: must
      proof:
        kind: fails-first
        tests:
        - components/modes/pm/tests/free-text.test.ts
- title: 'A run continues into a workflow of its own mode only after the owner answered a card, by a command that takes no JSON'
  slice:
    name: KC1
    kind: capability
    scope:
    - bay/**
    - schemas/workflow.schema.json
    - adapters/claude-code/coordinator.ts
    - tests/continues.test.ts
    after: []
    done:
    - id: DOD-KC1-1
      says: A workflow's continues naming another mode's workflow is refused at load and by bay check; a run with no approval the owner answered does not continue; an input its target's trigger refuses starts nothing; the Nth run of a chain waits for the owner; bay runs prints bay resume <runId> --continue and no JSON.
      level: must
      proof:
        kind: fails-first
        tests:
        - tests/continues.test.ts
- title: 'An action only a step of its own workflow may run: bay call refuses it'
  slice:
    name: WO1
    kind: capability
    scope:
    - bay/**
    - schemas/mode.schema.json
    - tests/workflow-only.test.ts
    after: []
    done:
    - id: DOD-WO1-1
      says: bay call of an action marked from workflow is refused with a sentence naming its workflows, and the same action runs as a step of them.
      level: must
      proof:
        kind: fails-first
        tests:
        - tests/workflow-only.test.ts
```

PM3 (a change after building has started), FV1 (forge names each condition changed since its plan) and PS1 (sources at the job, now from `docs/requirements-sources/<job>/`) are as in the first version, after GR4. Their fragment is in this file's history.

### 8.3 The order

1. **GR3**, then **GR4**: after GR4 the PM mode can replace writing `docs/requirements/<job>.yaml` by hand.
2. **KQ1**, **WO1** and **KC1** are kernel slices that wait for the owner: KQ1 when he wants answers in his own words, WO1 on question 14, KC1 on question 15. **FW1** after KQ1 and GR4.
3. **PM3**, then **FV1** and **PS1**.

## 9. Questions only the owner can answer

**Answered.**

1. **Where the file's form lives.** On 19 November: the shared interface `requirements@1` (built as slice RQ1).
2. **How a question is asked.** On 20 November, "Agree with pm recommendations": as an approval, one run a question. Reopened by turns: a turn is one run with one approval for each question (3.4). Each question is still an approval, but not one run each.
3. **Your own words as an answer.** On 20 November, "Agree with pm recommendations": not now. Question 7 answered it again.
4. **Open questions and forge.** On 20 November, "Agree with pm recommendations": forge may design and plan from a file with open questions.
5. **Sources at the job.** On 20 November, "Agree with pm recommendations": exported files in a folder first.
6. **The interviewer's role.** On 21 November: "New role: interviewer (Recommended)". An eighth role at tier deep, ADR 30.
7. **How your words reach the next step.** On 21 November he typed: "Grill is optional. And configurable". Asked which settings, he chose "Questions per turn" and "Free-text answers on or off". Not chosen: glossary and ADR offers on or off, and fact look-ups on or off, so both stay always on. As put to him: questions per turn from 1 to 12, default 12; free-text answers default off, lettered choices only, with no kernel change; on needs the kernel change KQ1. Optional means forge keeps accepting a requirements file written by hand, with no interview.
8. **How one turn leads to the next.** On 21 November: "Coordinator starts it (Recommended)". One turn a run; one new line in the coordinator's block. Built, then taken out after review (3.8); it waits on question 15.
9. **What the file carries for forge.** On 21 November: "Neither". No `quote` on decisions and no `practices` in the file; forge's own DA1 tells the designer the practices.
10. **What the interviewer may read.** On 21 November: "Documents and code" (not the recommendation).
11. **Signing with questions open.** On 21 November: "Yes, with a count (Recommended)".
12. **The new words**, and 13. **the practices row**, asked together. On 21 November: "Update both (Recommended)". The glossary's new words with the next grill slice; the practices row changed to say the PM mode adopts the method as an optional interview the owner starts.

**Open.**

14. **Actions only a workflow may run.** Any action of a mode can be run alone with `bay call`. So the coordinator, or anyone with your shell, could start an interview or keep answers without showing you a card. Such a run shows in `bay runs` with no approval; nothing stops it.
    - a. Build WO1: an action may say it runs only as a step of its own workflows, and `bay call` refuses it. **Recommended:** it closes the gap where it is, for every mode with steps that should follow a card, such as forge's commit steps. The cost is one manifest field and a refusal in `bay call`.
    - b. Leave it: the coordinator's block forbids approving on its own, and `bay runs` shows an action run that no card preceded.
15. **Letting a turn start the next by itself (KC1).** Today each turn ends by printing the command for the next, and the coordinator runs it only when you say "go on". Letting a run start the next one safely needs a kernel change: a workflow may continue only into a workflow of its own mode, only after you answered one of its cards, a chain stops for you after a few runs, and the command it prints holds no text from the mode.
    - a. Build KC1, then put back the coordinator's line as "run the command it prints". **Recommended:** it gives you question 8's answer without letting any mode start another mode's work.
    - b. Keep saying "go on" between turns. Nothing is built.
16. **An approval's words must name the choice they take.** Today an answer from chat is taken with any words as its quote: words like "nothing like a choice" took choice `a`. Trust already refuses words that do not name the mode.
    - a. Propose a kernel slice: in chat, the owner's words must contain the choice's name, or the kernel refuses the answer and says so. **Recommended:** the record then shows that his words chose it.
    - b. Leave it to the coordinator's block, which says to quote only his words.

