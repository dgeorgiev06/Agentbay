import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { packed, unpacked } from "../scripts/lib/kept-tests.ts";
import {
  filesHolding,
  keptRows,
  kitTemplate,
  project,
  provedIn,
  removeAll,
  roundToCard,
  shortHead,
  started,
  type Handed,
} from "./kit-copy.ts";

const testFile = "components/modes/k1/tests/kept.test.ts";

const otherFile = "components/modes/k1/tests/other.test.ts";

function written(path: string, number: number): Handed {
  const mark = `zx${String(number * 7)}`;
  return {
    path,
    text: [
      `import { keptQuill } from "../scripts/kept-${mark}.ts";`,
      `const ${mark}Kept = keptQuill(${String(number)});`,
      `test("${mark}: a kept quill is counted once", () => ${mark}Kept === 1);`,
      "",
    ].join("\n"),
  };
}

const kept = written(testFile, 1013);

const other = written(otherFile, 1014);

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

test("packing a test gives none of its lines, and unpacking gives the text back whole", () => {
  for (const text of [kept.text, other.text, "", "é ü 🙂\n\ttab"]) {
    const packedText = packed(text);
    assert.equal(unpacked(packedText), text);
    assert.match(packedText, /^[A-Za-z0-9+/]*={0,2}$/);
    for (const line of text.split("\n").filter((each) => each.trim().length > 3)) {
      assert.ok(!packedText.includes(line), line);
    }
  }
});

test("two texts that differ in one line pack differently", () => {
  assert.notEqual(packed(kept.text), packed(kept.text.replace("1013);", "1012);")));
});

test("while the builder's step is open, the partition holds the tests packed and no other file under the project holds a line of them but the kernel's record", async () => {
  const root = await project(template);
  const files = ["components/modes/k1/scripts/kept.ts"];
  await provedIn(root, "K1", { verdicts: [], judgement: [], size: [] });
  const planned = {
    title: "The slice K1",
    slice: {
      name: "K1",
      kind: "mode",
      scope: ["components/modes/k1/**"],
      after: [],
      done: [
        {
          id: "DOD-K1-1",
          says: "A kept quill is counted once.",
          level: "must",
          proof: { kind: "fails-first", tests: [testFile, otherFile] },
        },
      ],
    },
  };
  const start = await started(root, { planned, base: shortHead(root), bugs: [] });
  const seen: { holding: readonly string[]; rows: readonly unknown[] }[] = [];
  await roundToCard(root, start, {
    name: "K1",
    files,
    tests: [kept, other],
    built: { outcome: "built" },
    whileBuilding: async () => {
      seen.push({ holding: await filesHolding(root, "", [kept.text, other.text]), rows: keptRows(root) });
    },
  });
  const [building] = seen;
  assert.ok(building !== undefined);
  assert.deepEqual(building.rows, [
    { slice: "K1", path: testFile, packed: packed(kept.text) },
    { slice: "K1", path: otherFile, packed: packed(other.text) },
  ]);
  assert.deepEqual(building.holding, [".agentbay/kernel.db"]);
  assert.deepEqual(keptRows(root), []);
  const afterwards = await filesHolding(root, "", [kept.text, other.text]);
  assert.deepEqual(afterwards, [
    ".agentbay/kernel.db",
    `.forge/worktrees/K1-tests/${testFile}`,
    `.forge/worktrees/K1-tests/${otherFile}`,
  ]);
});
