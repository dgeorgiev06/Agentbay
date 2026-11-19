import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { unpacked } from "../scripts/lib/kept-tests.ts";
import { markOf } from "../scripts/lib/mark.ts";
import {
  allHeld,
  askedOf,
  bayRan,
  branches,
  decided,
  declared,
  filesHolding,
  git,
  keptRows,
  kitTemplate,
  listOf,
  playedTo,
  project,
  provedIn,
  removeAll,
  shortHead,
  shown,
  started,
  textAt,
  waitingOf,
  worktrees,
  type Asked,
  type Handed,
  type Played,
  type Proved,
} from "./kit-copy.ts";

const condition = "A quill is counted once, even when the ink is dry and the moon is full.";

const sdkImport = 'import { defineScript, fail, fieldsOf, type Json, type JsonFields } from "../../../../bay/sdk.ts";';

const assertion =
  'assert.deepEqual(quill("north and south", { strict: true }), { quills: 2, spilled: 0, ink: "dry" });';

const second = 'assert.equal(quill("east").quills + quill("west").quills, 2, "east and west count one each");';

const baseLine = 'export const northAndSouth = quill("north and south", { strict: true, ink: "dry" });';

const interfaceLine = '"description": "How many quills were counted, and how many spilled on the way out",';

const proofRequest = "components/base/interfaces/proof/prove-request.json";

const requestLine = `const request = "${proofRequest}";`;

const spilledLine = '  assert.equal(quill("north and south", { strict: false }).spilled, 1, "the south quill spills");';

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

function folderOf(name: string): string {
  return `components/modes/${name.toLowerCase()}`;
}

function testPath(name: string): string {
  return `${folderOf(name)}/tests/quill.test.ts`;
}

function codeOf(name: string): string {
  return `${folderOf(name)}/scripts/quill.ts`;
}

function schemaOf(name: string): string {
  return `${folderOf(name)}/schemas/count.json`;
}

function otherOf(name: string): string {
  return `${folderOf(name)}/scripts/ink.ts`;
}

function testsOf(name: string): Handed {
  return {
    path: testPath(name),
    text: [
      'import assert from "node:assert/strict";',
      sdkImport,
      'import { quill } from "../scripts/quill.ts";',
      `const codeFile = "${codeOf(name)}";`,
      requestLine,
      `const says = "${condition}";`,
      baseLine,
      "const schema = {",
      `  ${interfaceLine}`,
      "};",
      'test("a quill is counted once", () => {',
      `  ${assertion}`,
      `  ${second}`,
      "});",
      "",
    ].join("\n"),
  };
}

function testLines(tests: Handed): readonly string[] {
  return tests.text.split("\n").filter((line) => line.trim().length > 3);
}

function sliceOf(name: string): Json {
  return {
    name,
    kind: "mode",
    scope: [`${folderOf(name)}/**`],
    after: [],
    done: [
      {
        id: `DOD-${name}-1`,
        says: condition,
        level: "must",
        proof: { kind: "fails-first", tests: [testPath(name)] },
      },
      { id: `DOD-${name}-2`, says: "The tests catch planted bugs.", level: "must", proof: { kind: "bugs-caught" } },
    ],
  };
}

function allPassed(name: string, files: readonly string[]): Proved {
  return {
    verdicts: [
      { item: `DOD-${name}-1`, kind: "fails-first", verdict: "passed", detail: "It held." },
      { item: `DOD-${name}-2`, kind: "bugs-caught", verdict: "passed", detail: "It held." },
    ],
    judgement: [],
    size: files.map((path) => ({ path, head: 3 })),
  };
}

function inputOf(task: Json): Json {
  return fieldsOf(task).input ?? null;
}

async function written(root: string, folder: string, files: readonly Handed[]): Promise<void> {
  for (const file of files) {
    const path = join(root, folder, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.text, "utf8");
  }
}

function keptMarkNow(root: string): string {
  const [row] = keptRows(root);
  return row === undefined ? "" : (markOf(unpacked(textAt(row, "packed"))) ?? "");
}

async function printedCard(root: string, runId: string): Promise<readonly string[]> {
  const printed = (await bayRan(root, ["runs", runId])).stdout.split("\n");
  const first = printed.findIndex((line) => line.startsWith("Merge "));
  const last = printed.findIndex((line) => line.startsWith("hash "));
  return printed.slice(first, last);
}

type Ran = {
  readonly runId: string;
  readonly asked: readonly Asked[];
  readonly mark: string;
};

type Building = {
  readonly name: string;
  readonly code: (mark: string) => readonly Handed[];
  readonly interface?: readonly string[];
  readonly writer?: Played;
  readonly reviewer?: Played;
};

async function ranWith(root: string, building: Building): Promise<Ran> {
  const { name, code } = building;
  const tests = testsOf(name);
  const files = code("").map((file) => file.path);
  const start = await started(root, {
    planned: { title: name, slice: sliceOf(name) },
    base: shortHead(root),
    bugs: [],
    interface: [...(building.interface ?? [])],
  });
  await declared(root, start, files);
  await provedIn(root, name, allPassed(name, files));
  let mark = "";
  const asked = await playedTo(root, start.id, {
    tests: building.writer ?? (() => Promise.resolve({ tests: [tests] })),
    builder: async (given) => {
      mark = keptMarkNow(root);
      await written(root, textAt(inputOf(given), "folder"), code(mark));
      return { outcome: "built" };
    },
    reviewer: building.reviewer ?? ((given) => Promise.resolve(allHeld(given))),
    planter: () => {
      const path = codeOf(name);
      const patch = [
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1 +1 @@",
        "-export const ink = 1;",
        "+export const ink = 2;",
        "",
      ];
      return Promise.resolve({
        bugs: [{ name: "the ink is off by one", patch: patch.join("\n"), tests: [testPath(name)] }],
      });
    },
  });
  return { runId: start.id, asked, mark };
}

function holding(texts: readonly string[], within: string): readonly string[] {
  return texts.filter((text) => within.includes(text) || within.includes(JSON.stringify(text).slice(1, -1)));
}

async function assertNothingLeft(root: string, name: string, ran: Ran): Promise<void> {
  assert.deepEqual(worktrees(root), []);
  assert.deepEqual(keptRows(root), []);
  assert.ok(!branches(root).some((branch) => branch.includes("-base-")));
  assert.equal(git(root, ["show", `forge/${name}-tests-1:${testPath(name)}`]), testsOf(name).text);
  assert.deepEqual(await filesHolding(root, "", [ran.mark]), []);
}

describe(
  "after each build, forge looks in the builder's work for text of the tests and for the mark",
  { concurrency: true },
  () => {
    test("a build that copies lines of a test ends the rounds; the card names each file and no line of the test, and merge is withheld", async () => {
      const root = await project(template);
      const name = "L1";
      const ran = await ranWith(root, {
        name,
        code: () => [
          { path: codeOf(name), text: ["export const ink = 1;", `    ${assertion}`, second, ""].join("\n") },
          { path: otherOf(name), text: ["export function spill() {", `  ${second}`, "}", ""].join("\n") },
        ],
      });
      assert.deepEqual(
        ran.asked.map((each) => each.action),
        ["write-tests", "build-without-tests"],
      );
      assert.equal((await askedOf(root, name)).length, 1);
      const printed = await printedCard(root, ran.runId);
      assert.deepEqual(printed.slice(0, 6), [
        "Merge L1 into integration?",
        "  leak: components/modes/l1/scripts/ink.ts",
        "    shares 1 line with the tests",
        "  leak: components/modes/l1/scripts/quill.ts",
        "    shares 2 lines with the tests",
        "  2 files changed; the work and the tests",
      ]);
      assert.deepEqual(holding([...testLines(testsOf(name)), ran.mark], printed.join("\n")), []);
      const card = waitingOf(await shown(root, ran.runId), "card");
      assert.deepEqual(
        listOf(card.choices).map((choice) => [
          textAt(choice, "name"),
          textAt(choice, "status"),
          textAt(choice, "reason"),
        ]),
        [
          ["merge", "withheld", "the builder's work holds text from the tests."],
          ["send-back", "withheld", "no round runs after the card."],
          ["keep", "offered", ""],
          ["discard", "withheld", "discarding comes with slice WD1."],
        ],
      );
      await decided(root, card, { step: "card", choice: "keep" });
      await assertNothingLeft(root, name, ran);
    });

    test("a build that holds the mark planted in the kept tests ends the rounds, and the mark is nowhere but in its own branch", async () => {
      const root = await project(template);
      const name = "L2";
      const ran = await ranWith(root, {
        name,
        code: (mark) => [
          { path: codeOf(name), text: ["export const ink = 1;", `export const seen = "${mark}";`, ""].join("\n") },
        ],
      });
      assert.match(ran.mark, /^[0-9a-f]{32}$/);
      assert.deepEqual(
        ran.asked.map((each) => each.action),
        ["write-tests", "build-without-tests"],
      );
      assert.deepEqual(holding([ran.mark], JSON.stringify(ran.asked)), []);
      const printed = await printedCard(root, ran.runId);
      assert.deepEqual(printed.slice(0, 4), [
        "Merge L2 into integration?",
        "  leak: components/modes/l2/scripts/quill.ts",
        "    holds the mark planted in the tests",
        "  1 file changed; the work and the tests are",
      ]);
      assert.deepEqual(holding([...testLines(testsOf(name)), ran.mark], printed.join("\n")), []);
      const card = waitingOf(await shown(root, ran.runId), "card");
      assert.equal(textAt(listOf(card.choices)[0] ?? null, "reason"), "the builder's work holds text from the tests.");
      assert.ok(git(root, ["show", `forge/${name}:${codeOf(name)}`]).includes(ran.mark));
      await decided(root, card, { step: "card", choice: "keep" });
      await assertNothingLeft(root, name, ran);
    });

    test("a build that shares only imports, a path, a name and a condition's sentence goes on to review, the planter and a merge on offer, and no later task holds the mark", async () => {
      const root = await project(template);
      const name = "L3";
      await written(root, "", [
        { path: codeOf(name), text: ["export const ink = 1;", baseLine, ""].join("\n") },
        { path: schemaOf(name), text: ["{", `  ${interfaceLine}`, '  "type": "object"', "}", ""].join("\n") },
      ]);
      git(root, ["add", folderOf(name)]);
      git(root, ["commit", "-q", "-m", "The quill and its schema before the slice"]);
      const first = testsOf(name);
      const amended = { ...first, text: first.text.replace("});\n", `${spilledLine}\n});\n`) };
      const marks: string[] = [];
      let reviews = 0;
      const ran = await ranWith(root, {
        name,
        interface: [schemaOf(name), proofRequest],
        writer: () => {
          marks.push(keptMarkNow(root));
          return Promise.resolve({ tests: [marks.length === 1 ? first : amended] });
        },
        reviewer: (given) => {
          reviews += 1;
          marks.push(keptMarkNow(root));
          const findings = [
            { to: "test-writer", case: "a quill is counted once", question: "Q2", fix: "Count the spill." },
          ];
          return Promise.resolve({ ...fieldsOf(allHeld(given)), findings: reviews === 1 ? findings : [] });
        },
        code: () => [
          {
            path: codeOf(name),
            text: [
              "export const ink = 1;",
              sdkImport,
              `const codeFile = "${codeOf(name)}";`,
              requestLine,
              `const says = "${condition}";`,
              baseLine,
              interfaceLine,
              "export function quill(text: string): { readonly quills: number } {",
              "  return { quills: text.split(' and ').length };",
              "}",
              "",
            ].join("\n"),
          },
        ],
      });
      assert.deepEqual(
        ran.asked.map((each) => each.action),
        ["write-tests", "build-without-tests", "review", "write-tests", "review", "plant"],
      );
      assert.deepEqual(marks, ["", ran.mark, ran.mark, ran.mark]);
      const later = ran.asked.slice(2);
      assert.deepEqual(holding([ran.mark], JSON.stringify(later)), []);
      const reviewed = later.map((each) => listOf(fieldsOf(inputOf(each.task)).tests));
      assert.deepEqual(reviewed.slice(0, 3), [[first], [], [amended]]);
      assert.deepEqual(fieldsOf(inputOf(later[1]?.task ?? null)).earlier, [first]);
      const printed = await printedCard(root, ran.runId);
      assert.ok(!printed.some((line) => line.includes("leak")));
      assert.deepEqual(holding([ran.mark], printed.join("\n")), []);
      const card = waitingOf(await shown(root, ran.runId), "card");
      assert.equal(textAt(listOf(card.choices)[0] ?? null, "status"), "offered");
      await decided(root, card, { step: "card", choice: "keep" });
      await assertNothingLeft(root, name, ran);
    });
  },
);
