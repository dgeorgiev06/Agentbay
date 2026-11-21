import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, readYaml, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

type Expected = readonly [number, string, string];

const folder = "docs/requirements";

const kit = join(import.meta.dirname, "..", "..", "..", "..");

const kitTodo = join(kit, folder, "todo.yaml");

const todoVersionOne = join(kit, "tests", "fixtures", "todo-v1.yaml");

const brokenEverywhere = `job: desk
version: 2
title: A desk lamp
for: A person at a desk.
asked:
  - by: owner
    on: 2026-11-18
    words: A lamp.
outcomes:
  - id: O1
    says: A person switches the lamp on.
    conditions:
      - id: O1-C1
        path: works
        given: the lamp was off yesterday
        when: the person switches it on quickly
        then: the lamp is lit
      - id: O1-C1
        path: refused
        given: the lamp is on
        when: the person switches it on
        then: it is refused
      - id: O2-C4
        path: works
        given: the lamp is off
        when: the person reads it
        then: the lamp shows "off"
  - id: O2
    says: A person reads the lamp.
    conditions:
      - id: O2-C2
        path: works
        given: the lamp is on, and the time is now
        when: the person reads it
        then: it shows "on"
leftOut: []
open:
  - id: Q1
    asks: May the lamp blink?
    answers: ["Yes", "No"]
    recommended: 2
    why: Blinking tires the eyes.
decided: []
signed: { by: owner, on: 2026-11-19, run: run-2 }
changes:
  - version: 2
    on: 2026-11-19
    added: [O1-C9, O1-C8]
    changed: [O2-C7]
    removed: [O2-C2]
  - version: 3
    on: 2026-11-20
    added: [O2-C2]
    changed: []
    removed: []
`;

const firstVersion = brokenEverywhere
  .replace("job: desk\n", "job: lamp\n")
  .replace("version: 2\ntitle", "version: 1\ntitle")
  .replace("  - version: 2\n", "  - version: 1\n")
  .replace("changed: [O2-C7]", "changed: [O1-C1]")
  .replace(/ {2}- version: 3[\s\S]*$/, "");

const noLiteral =
  "then holds no literal value. Write the value a person sees, in double quotes or as a number, " +
  "such as 0 todos are listed in place of the list is empty.";

const noAfter =
  "O1-C1 is refused but has no after. Add after: what a person sees once the refusal is over, with its value, " +
  'such as the open list shows only "buy milk".';

const sameInBoth: readonly Expected[] = [
  [
    15,
    "date that moves",
    'O1-C1\'s given says "yesterday" outside a quoted value, a date that moves. Give the date itself, such as the date is 2026-11-21.',
  ],
  [
    16,
    "vague word",
    'O1-C1\'s when holds "quickly" outside a quoted value, which a person cannot check. Say what a person sees, with its value; a word inside double quotes is a value and may stay.',
  ],
  [17, "no literal in then", `O1-C1's ${noLiteral}`],
  [18, "no literal in after", noAfter],
  [
    18,
    "id used twice",
    "The id O1-C1 is given twice: to condition 1 of outcome 1 and to condition 2 of outcome 1. " +
      "Give each its own id, since forge and the tests name each by it.",
  ],
  [22, "no literal in then", `O1-C1's ${noLiteral}`],
  [
    23,
    "id not its outcome's",
    "O2-C4 is a condition of O1, so its id starts with O1-C. Renumber it, or move it under the outcome its id names.",
  ],
  [
    28,
    "no refusal",
    "O2 has no refused condition. Add one that says what is refused and what a person sees after, " +
      "or say in noRefusal why no input of it can be refused.",
  ],
];

const recommendedTwo: Expected = [
  41,
  "recommended is not an answer",
  "Q1 recommends answer 2, but it has 2 answers, counted from 0. Recommend one of 0 to 1.",
];

const nowIsMoving: Expected = [
  33,
  "date that moves",
  'O2-C2\'s given says "now" outside a quoted value, a date that moves. Give the date itself, such as the date is 2026-11-21.',
];

const unmatched = "changes do not match the version";

let project: ModeProject;

before(async () => {
  project = await openModeProject({ modes: ["requirements"], bindings: {}, adapter: "claude-code" });
  await mkdir(join(project.root, folder), { recursive: true });
});

after(async () => {
  await project.close();
});

async function checked(name: string, text: string): Promise<Json> {
  await writeFile(join(project.root, folder, name), text, "utf8");
  return project.output("requirements.check", { file: `${folder}/${name}` });
}

function problemsOf(answer: Json): readonly Expected[] {
  const problems = fieldsOf(answer).problems;
  assert.ok(Array.isArray(problems), JSON.stringify(answer));
  return problems.map((problem: Json) => {
    const { line, rule, sentence } = fieldsOf(problem);
    assert.ok(typeof line === "number" && typeof rule === "string" && typeof sentence === "string");
    return [line, rule, sentence] as const;
  });
}

test("the kit's own docs/requirements/todo.yaml is accepted, and the check hands back what the file holds", async () => {
  const text = await readFile(kitTodo, "utf8");
  const read = readYaml(text);
  assert.ok(read.ok);
  const answer = fieldsOf(await checked("todo.yaml", text));
  assert.equal(answer.answer, "accepted", JSON.stringify(answer));
  assert.deepEqual(answer.requirements, read.value);
});

test("a file that breaks every rule of version 2 is refused with each problem, its line and its sentence, by line", async () => {
  const answer = await checked("lamp.yaml", brokenEverywhere);
  assert.deepEqual(problemsOf(answer), [
    [
      1,
      "job is not the file's name",
      "The job is desk, but the file is lamp.yaml. Name the job lamp, or the file desk.yaml.",
    ],
    ...sameInBoth,
    [
      31,
      "removed id used again",
      "O2-C2 was removed in version 2, and a removed id is never used again. Give this condition a new id.",
    ],
    nowIsMoving,
    recommendedTwo,
    [
      46,
      unmatched,
      "The file is version 2, and changes has no entry for version 1. " +
        "Add one entry per version, with the condition ids it added, changed and removed.",
    ],
    [
      48,
      unmatched,
      "Version 2 lists O1-C9 and O1-C8 as added, but no condition of the file has those ids. " +
        "Remove them from added, or add the conditions.",
    ],
    [
      49,
      unmatched,
      "Version 2 lists O2-C7 as changed, but no condition of the file has that id. Remove it from changed, or add the condition.",
    ],
    [
      51,
      unmatched,
      "changes has an entry for version 3 that the file cannot have: it is version 2, and each version has one entry. " +
        "Remove this entry, or correct its version.",
    ],
    [
      53,
      "removed id used again",
      "O2-C2 was removed in version 2 and is added again in version 3. A removed id is never used again: add the condition with a new id.",
    ],
  ]);
});

test("a first version whose changes do not add exactly its conditions is refused for each list", async () => {
  const answer = await checked("lamp.yaml", firstVersion);
  assert.deepEqual(problemsOf(answer), [
    ...sameInBoth,
    [
      31,
      "removed id used again",
      "O2-C2 was removed in version 1, and a removed id is never used again. Give this condition a new id.",
    ],
    nowIsMoving,
    recommendedTwo,
    [
      48,
      unmatched,
      "Version 1 lists O1-C9 and O1-C8 as added, but no condition of the file has those ids. " +
        "Remove them from added, or add the conditions.",
    ],
    [
      48,
      unmatched,
      "Version 1 adds every condition, but its added leaves out O1-C1, O2-C4 and O2-C2. Add them to added.",
    ],
    [49, unmatched, "Version 1 is the first, so it changed nothing. Make its changed empty."],
    [50, unmatched, "Version 1 is the first, so it removed nothing. Make its removed empty."],
  ]);
});

test("whole words only: a vague word or a moving date inside another word is not refused", async () => {
  const text = (await readFile(todoVersionOne, "utf8")).replace(
    "        given: no todos\n",
    "        given: something known, handled at breakfast, nowhere\n",
  );
  const answer = fieldsOf(await checked("todo.yaml", text));
  assert.equal(answer.answer, "accepted", JSON.stringify(answer));
});

test("a vague word or a moving date inside a quoted value is the owner's data and is accepted", async () => {
  const text = (await readFile(todoVersionOne, "utf8")).replace(
    'when: the person adds "buy milk", then lists the open todos',
    'when: the person adds "buy some milk now", then lists the open todos',
  );
  const answer = fieldsOf(await checked("todo.yaml", text));
  assert.equal(answer.answer, "accepted", JSON.stringify(answer));
});

test("the same words outside the quotes are refused, each with its line and the word quoted", async () => {
  const text = (await readFile(todoVersionOne, "utf8")).replace(
    'when: the person adds "buy milk", then lists the open todos',
    'when: the person adds some text "buy milk" now, then lists the open todos',
  );
  assert.deepEqual(problemsOf(await checked("todo.yaml", text)), [
    [
      20,
      "vague word",
      'O1-C1\'s when holds "some" outside a quoted value, which a person cannot check. ' +
        "Say what a person sees, with its value; a word inside double quotes is a value and may stay.",
    ],
    [
      20,
      "date that moves",
      'O1-C1\'s when says "now" outside a quoted value, a date that moves. ' +
        "Give the date itself, such as the date is 2026-11-21.",
    ],
  ]);
});
