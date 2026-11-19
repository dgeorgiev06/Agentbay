import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  filesHolding,
  kitTemplate,
  project,
  provedIn,
  removeAll,
  roundToCard,
  shortHead,
  started,
  task,
  textAt,
  type Handed,
} from "./kit-copy.ts";

const named = "components/modes/d1/tests/disk.test.ts";

const second = "components/modes/d1/tests/second.test.ts";

const schema = "components/modes/d1/schemas/count-request.json";

const folder = ".forge/worktrees/D1";

const practices = ["framework/practices.md", "components/base/typescript/practices.md"];

function written(path: string, number: number): Handed {
  const mark = `dq${String(number * 3)}`;
  return {
    path,
    text: [
      `import { diskQuill } from "../scripts/disk-${mark}.ts";`,
      `const ${mark}Seen = diskQuill(${String(number)});`,
      `test("${mark}: a quill on disk is counted", () => ${mark}Seen === 1);`,
      "",
    ].join("\n"),
  };
}

const tests = [written(named, 2041), written(second, 2042)];

const slice = {
  name: "D1",
  kind: "mode",
  scope: ["components/modes/d1/**"],
  after: [],
  done: [
    { id: "DOD-D1-1", says: "A quill is counted.", level: "must", proof: { kind: "fails-first", tests: [named] } },
    { id: "DOD-D1-2", says: "Another is counted.", level: "must", proof: { kind: "fails-first", tests: [second] } },
  ],
};

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

type Seen = {
  readonly holding: readonly string[];
  readonly step: string;
  readonly input: Json;
};

test("the test writer is asked before any builder works; while the builder's task waits, no file under .forge/worktrees/ holds the tests, and its task holds their paths and none of their text; after the review none is on disk", async () => {
  const root = await project(template);
  const files = ["components/modes/d1/scripts/disk.ts"];
  await provedIn(root, "D1", { verdicts: [], judgement: [], size: [] });
  const start = await started(root, {
    planned: { title: "The slice D1", slice },
    base: shortHead(root),
    bugs: [],
    interface: [schema],
  });
  const seen: Seen[] = [];
  const asked: Seen[] = [];
  await roundToCard(root, start, {
    name: "D1",
    files,
    tests,
    built: { outcome: "built" },
    whileWriting: async (runId) => {
      const given = await task(root, runId);
      const holding = await filesHolding(root, ".forge/worktrees", [`Written by the builder in ${folder}.`]);
      asked.push({ holding, step: textAt(given, "stepKey"), input: fieldsOf(given).input ?? null });
    },
    whileBuilding: async (runId) => {
      const given = await task(root, runId);
      const holding = await filesHolding(
        root,
        ".forge/worktrees",
        tests.map((each) => each.text),
      );
      seen.push({ holding, step: textAt(given, "stepKey"), input: fieldsOf(given).input ?? null });
    },
  });
  const [writing] = asked;
  assert.ok(writing !== undefined);
  assert.equal(writing.step, "round-1/0.call0/0#1");
  assert.deepEqual(writing.input, { slice, interface: [schema], folder, practices });
  assert.deepEqual(writing.holding, []);
  const [building] = seen;
  assert.ok(building !== undefined);
  assert.deepEqual(building.holding, []);
  assert.equal(building.step, "round-1/0.call1/0#1");
  assert.deepEqual(building.input, {
    slice,
    interface: [schema],
    fixed: [named, second],
    folder,
    practices,
    declared: { files, names: { gained: [], lost: [], changed: [] } },
  });
  const afterwards = await filesHolding(
    root,
    ".forge/worktrees",
    tests.map((each) => each.text),
  );
  assert.deepEqual(afterwards, []);
});
