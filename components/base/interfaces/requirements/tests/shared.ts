import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { openModeProject, type ModeProject, type TestProject } from "../../../../../tests/test-toolbox.ts";

type Value = Awaited<ReturnType<ModeProject["output"]>>;

type Fields = { readonly [key: string]: Value };

export type RequirementsUnderTest = {
  readonly mode: string;
};

type Replacement = readonly [string, string];

type Expected = {
  readonly rule: string;
  readonly line: number;
};

type Found = {
  readonly rule: string;
  readonly line: number | undefined;
  readonly sentence: string;
};

type Checker = {
  readonly check: (name: string, text: string) => Promise<Fields>;
  readonly refusal: (file: string) => Promise<string>;
};

type Case = {
  readonly name: string;
  readonly restsOn: string;
  readonly run: (checker: Checker) => Promise<void>;
};

const interfaceName = "requirements";

const folder = "docs/requirements";

const lamp = `job: lamp
version: 2
title: A lamp a person switches on and reads
for: A person at a desk.
asked:
  - by: owner
    on: 2026-11-18
    words: A lamp that switches on, and says how bright it is.
outcomes:
  - id: O1
    says: A person switches the lamp on and sees it lit.
    conditions:
      - id: O1-C1
        path: works
        given: the lamp is off
        when: the person switches it on
        then: the lamp shows "on"
      - id: O1-C3
        path: refused
        given: the lamp is on
        when: the person switches it on again
        then: it is refused with a sentence that contains "already on"
        after: the lamp shows "on"
  - id: O2
    says: A person reads how bright the lamp is.
    noRefusal: Reading takes no input, so nothing of it can be refused.
    conditions:
      - id: O2-C1
        path: works
        given: the lamp is on at 40 percent
        when: the person reads the brightness
        then: 40 is shown
leftOut:
  - A timer.
open:
  - id: Q1
    asks: May the lamp be dimmed below 10 percent?
    answers: ["Yes", "No, 10 is the least"]
    recommended: 1
    why: Below 10 percent the lamp looks off.
decided: []
signed: { by: owner, on: 2026-11-19, run: run-2 }
changes:
  - version: 1
    on: 2026-11-18
    added: [O1-C1, O1-C2, O2-C1]
    changed: []
    removed: []
  - version: 2
    on: 2026-11-19
    added: [O1-C3]
    changed: [O1-C1]
    removed: [O1-C2]
`;

const lampAsData = {
  job: "lamp",
  version: 2,
  title: "A lamp a person switches on and reads",
  for: "A person at a desk.",
  asked: [{ by: "owner", on: "2026-11-18", words: "A lamp that switches on, and says how bright it is." }],
  outcomes: [
    {
      id: "O1",
      says: "A person switches the lamp on and sees it lit.",
      conditions: [
        {
          id: "O1-C1",
          path: "works",
          given: "the lamp is off",
          when: "the person switches it on",
          then: 'the lamp shows "on"',
        },
        {
          id: "O1-C3",
          path: "refused",
          given: "the lamp is on",
          when: "the person switches it on again",
          then: 'it is refused with a sentence that contains "already on"',
          after: 'the lamp shows "on"',
        },
      ],
    },
    {
      id: "O2",
      says: "A person reads how bright the lamp is.",
      noRefusal: "Reading takes no input, so nothing of it can be refused.",
      conditions: [
        {
          id: "O2-C1",
          path: "works",
          given: "the lamp is on at 40 percent",
          when: "the person reads the brightness",
          then: "40 is shown",
        },
      ],
    },
  ],
  leftOut: ["A timer."],
  open: [
    {
      id: "Q1",
      asks: "May the lamp be dimmed below 10 percent?",
      answers: ["Yes", "No, 10 is the least"],
      recommended: 1,
      why: "Below 10 percent the lamp looks off.",
    },
  ],
  decided: [],
  signed: { by: "owner", on: "2026-11-19", run: "run-2" },
  changes: [
    { version: 1, on: "2026-11-18", added: ["O1-C1", "O1-C2", "O2-C1"], changed: [], removed: [] },
    { version: 2, on: "2026-11-19", added: ["O1-C3"], changed: ["O1-C1"], removed: ["O1-C2"] },
  ],
};

const thenOfFirst = '        then: the lamp shows "on"\n';

const afterOfRefused = '        after: the lamp shows "on"\n';

const switchedOff = `        path: works
        given: the lamp is on
        when: the person switches it off
        then: the lamp shows "off"
`;

const conditionsOfSecond = `    conditions:
      - id: O2-C1
        path: works
        given: the lamp is on at 40 percent
        when: the person reads the brightness
        then: 40 is shown
`;

const secondVersion = `  - version: 2
    on: 2026-11-19
    added: [O1-C3]
    changed: [O1-C1]
    removed: [O1-C2]
`;

const readsTheBrightness = "        when: the person reads the brightness\n";

function isFields(value: Value | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldsOf(value: Value | undefined): Fields {
  assert.ok(isFields(value), JSON.stringify(value));
  return value;
}

function isList(value: Value | undefined): value is readonly Value[] {
  return Array.isArray(value);
}

function listOf(value: Value | undefined): readonly Value[] {
  assert.ok(isList(value), JSON.stringify(value));
  return value;
}

function textOf(value: Value | undefined): string {
  assert.ok(typeof value === "string", JSON.stringify(value));
  return value;
}

function foundOf(value: Value): Found {
  const fields = fieldsOf(value);
  const line = fields.line;
  assert.ok(line === undefined || (typeof line === "number" && Number.isInteger(line)), JSON.stringify(line));
  const sentence = textOf(fields.sentence);
  assert.notEqual(sentence.trim(), "", JSON.stringify(value));
  return { rule: textOf(fields.rule), line, sentence };
}

function changed(text: string, replacements: readonly Replacement[]): string {
  return replacements.reduce((before, [from, to]) => {
    assert.ok(before.includes(from), `the file does not hold ${from}`);
    return before.replace(from, to);
  }, text);
}

function shown(expected: readonly { readonly rule: string; readonly line: number | undefined }[]): readonly string[] {
  return expected.map(({ rule, line }) => `line ${String(line)}: ${rule}`).sort();
}

async function problemsOf(checker: Checker, name: string, text: string): Promise<readonly Found[]> {
  const answer = await checker.check(name, text);
  assert.equal(answer.answer, "refused", JSON.stringify(answer));
  assert.equal(answer.file, `${folder}/${name}`);
  return listOf(answer.problems).map(foundOf);
}

function refusedAt(replacements: readonly Replacement[], expected: readonly Expected[]): Case["run"] {
  return async (checker) => {
    const problems = await problemsOf(checker, "lamp.yaml", changed(lamp, replacements));
    assert.deepEqual(shown(problems), shown(expected), JSON.stringify(problems, null, 2));
  };
}

const cases: readonly Case[] = [
  {
    name: "a sound file is accepted, and its outcomes and conditions come back as data, each with its id",
    restsOn: "check-response accepted: file, requirements (the file's value, in $defs/requirements)",
    run: async (checker) => {
      const answer = await checker.check("lamp.yaml", lamp);
      assert.deepEqual(answer, { answer: "accepted", file: `${folder}/lamp.yaml`, requirements: lampAsData });
    },
  },
  {
    name: "a condition with no then is refused at the condition's line",
    restsOn: "$defs/condition required then; problem rule not the form and line",
    run: refusedAt([[thenOfFirst, ""]], [{ rule: "not the form", line: 13 }]),
  },
  {
    name: "two conditions with one id are refused at the second id's line",
    restsOn: "problem rule id used twice: ids are unique in the file",
    run: refusedAt(
      [[thenOfFirst, `${thenOfFirst}      - id: O1-C1\n${switchedOff}`]],
      [{ rule: "id used twice", line: 18 }],
    ),
  },
  {
    name: "an outcome with no condition is refused at its conditions' line",
    restsOn: "$defs/outcome conditions minItems 1; problem rule not the form",
    run: refusedAt([[conditionsOfSecond, "    conditions: []\n"]], [{ rule: "not the form", line: 27 }]),
  },
  {
    name: "a condition id that breaks its pattern is refused at its line, once",
    restsOn: "$defs/conditionId pattern; a value the form refuses is not refused again by a rule",
    run: refusedAt([["      - id: O2-C1\n", "      - id: O2-1\n"]], [{ rule: "not the form", line: 28 }]),
  },
  {
    name: "a refused condition with no after is refused at the condition's line",
    restsOn: "problem rule no literal in after: every refused condition has an after with a literal value",
    run: refusedAt([[afterOfRefused, ""]], [{ rule: "no literal in after", line: 18 }]),
  },
  {
    name: "a then with no double-quoted value and no number is refused at its line",
    restsOn: "problem rule no literal in then",
    run: refusedAt([[thenOfFirst, "        then: the lamp is lit\n"]], [{ rule: "no literal in then", line: 17 }]),
  },
  {
    name: "a refused condition's after with no literal value is refused at its line",
    restsOn: "problem rule no literal in after",
    run: refusedAt(
      [[afterOfRefused, "        after: the lamp stays lit\n"]],
      [{ rule: "no literal in after", line: 23 }],
    ),
  },
  {
    name: "a vague word, in any case, is refused at its line",
    restsOn: "problem rule vague word: whole words, any case",
    run: refusedAt(
      [[readsTheBrightness, "        when: the person reads the brightness Quickly\n"]],
      [{ rule: "vague word", line: 31 }],
    ),
  },
  {
    name: "a vague word or a date that moves inside a longer word is not refused",
    restsOn: "problem rules vague word and date that moves: whole words only",
    run: async (checker) => {
      const text = changed(lamp, [
        [readsTheBrightness, "        when: the person somewhere reads the brightness known\n"],
      ]);
      const answer = await checker.check("lamp.yaml", text);
      assert.equal(answer.answer, "accepted", JSON.stringify(answer));
    },
  },
  {
    name: "a date that moves is refused at its line",
    restsOn: "problem rule date that moves: today, now, yesterday, tomorrow",
    run: refusedAt(
      [["        given: the lamp is off\n", "        given: the lamp was switched off yesterday\n"]],
      [{ rule: "date that moves", line: 15 }],
    ),
  },
  {
    name: "an outcome with no refused condition and no noRefusal is refused at its id's line",
    restsOn: "problem rule no refusal; $defs/outcome noRefusal",
    run: refusedAt(
      [["    noRefusal: Reading takes no input, so nothing of it can be refused.\n", ""]],
      [{ rule: "no refusal", line: 24 }],
    ),
  },
  {
    name: "a condition whose id names another outcome is refused at its id's line",
    restsOn: "problem rule id not its outcome's: a condition's id starts with its outcome's",
    run: refusedAt([["      - id: O2-C1\n", "      - id: O1-C9\n"]], [{ rule: "id not its outcome's", line: 28 }]),
  },
  {
    name: "a condition with an id that an earlier version removed is refused at its id's line",
    restsOn: "problem rule removed id used again; $defs/change removed",
    run: refusedAt(
      [[afterOfRefused, `${afterOfRefused}      - id: O1-C2\n${switchedOff}`]],
      [{ rule: "removed id used again", line: 24 }],
    ),
  },
  {
    name: "a file with no changes entry for its version is refused at the line its changes start",
    restsOn: "problem rule changes do not match the version: one entry per version",
    run: refusedAt([[secondVersion, ""]], [{ rule: "changes do not match the version", line: 44 }]),
  },
  {
    name: "version 1 whose changes do not add exactly its conditions is refused at the added line",
    restsOn: "problem rule changes do not match the version: version 1 adds every condition, and names no other",
    run: refusedAt(
      [
        ["version: 2\n", "version: 1\n"],
        [secondVersion, ""],
      ],
      [
        { rule: "changes do not match the version", line: 46 },
        { rule: "changes do not match the version", line: 46 },
      ],
    ),
  },
  {
    name: "an open question that recommends an answer it does not have is refused at its line",
    restsOn: "problem rule recommended is not an answer; $defs/question recommended",
    run: refusedAt(
      [["    recommended: 1\n", "    recommended: 2\n"]],
      [{ rule: "recommended is not an answer", line: 39 }],
    ),
  },
  {
    name: "a job that is not the file's name is refused at its line",
    restsOn: "problem rule job is not the file's name",
    run: refusedAt([["job: lamp\n", "job: lantern\n"]], [{ rule: "job is not the file's name", line: 1 }]),
  },
  {
    name: "a file that is not YAML is refused at the line YAML cannot read",
    restsOn: "problem rule not YAML",
    run: refusedAt([["title: A lamp a person", 'title: "A lamp a person']], [{ rule: "not YAML", line: 3 }]),
  },
  {
    name: "a file with problems of the form and of the rules is refused with every problem at once, each with its line",
    restsOn: "check-response refused problems: every problem found at once, by line",
    run: async (checker) => {
      const text = changed(lamp, [
        ["job: lamp\n", "job: lantern\n"],
        [thenOfFirst, ""],
        [readsTheBrightness, "        when: the person reads the brightness quickly\n"],
      ]);
      const problems = await problemsOf(checker, "lamp.yaml", text);
      const lines = problems.map((problem) => problem.line);
      assert.deepEqual(
        lines,
        lines.toSorted((first, second) => (first ?? 0) - (second ?? 0)),
      );
      assert.deepEqual(
        shown(problems),
        shown([
          { rule: "job is not the file's name", line: 1 },
          { rule: "not the form", line: 13 },
          { rule: "vague word", line: 30 },
        ]),
      );
    },
  },
  {
    name: "a file that does not exist is refused with one problem that has no line",
    restsOn: "problem rule file not read; problem line absent only when the file could not be read",
    run: async (checker) => {
      const answer = fieldsOf(await checker.check("", ""));
      assert.equal(answer.answer, "refused", JSON.stringify(answer));
      const problems = listOf(answer.problems).map(foundOf);
      assert.deepEqual(
        problems.map(({ rule, line }) => ({ rule, line })),
        [{ rule: "file not read", line: undefined }],
      );
    },
  },
  {
    name: "a path that leaves the project, is absolute, or is not a .yaml file is refused before the check runs",
    restsOn: "check-request file: relative to the project, ends in .yaml, holds no ..",
    run: async (checker) => {
      for (const file of ["../lamp.yaml", "docs/../../lamp.yaml", "/etc/lamp.yaml", `${folder}/lamp.yml`]) {
        assert.notEqual((await checker.refusal(file)).trim(), "", file);
      }
    },
  },
];

function checkerFor(project: ModeProject, mode: string): Checker {
  let written = 0;
  return {
    check: async (name, text) => {
      written += 1;
      const file = name === "" ? `${folder}/missing-${String(written)}.yaml` : `${folder}/${name}`;
      if (name !== "") {
        const place = join(project.root, file);
        await mkdir(dirname(place), { recursive: true });
        await writeFile(place, text, "utf8");
      }
      return fieldsOf(await project.output(`${mode}.check`, { file }));
    },
    refusal: (file) => project.refusal(`${mode}.check`, { file }),
  };
}

export function testRequirements(underTest: RequirementsUnderTest, testProject: TestProject = {}): void {
  const { mode } = underTest;
  let project: ModeProject;
  before(async () => {
    project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: [mode] }, testProject);
  });
  after(async () => {
    await project.close();
  });
  for (const entry of cases) {
    test(`${interfaceName}@1, ${mode}: ${entry.name}`, async () => {
      await entry.run(checkerFor(project, mode));
    });
  }
}
