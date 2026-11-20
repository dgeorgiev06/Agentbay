import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { packed, unpacked } from "../scripts/lib/kept-tests.ts";
import { marked, markOf } from "../scripts/lib/mark.ts";
import {
  allHeld,
  bay,
  askedOf,
  branches,
  builderWrites,
  declared,
  filesHolding,
  git,
  keptRows,
  listOf,
  kitTemplate,
  playedTo,
  printedCard,
  project,
  provedIn,
  removeAll,
  roundToCard,
  shortHead,
  shown,
  started,
  textAt,
  waitingOf,
  type Handed,
  type Proved,
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

test("while the builder's step is open, the partition holds the tests packed and no file under the project holds a line of them, the kernel's record included", async () => {
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
  const seen: { holding: readonly string[]; rows: readonly Json[] }[] = [];
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
  const mark = markOf(unpacked(textAt(building.rows[0] ?? null, "packed"))) ?? "";
  assert.match(mark, /^[0-9a-f]{32}$/);
  assert.deepEqual(building.rows, [
    { slice: "K1", path: testFile, packed: packed(marked(kept.text, mark)) },
    { slice: "K1", path: otherFile, packed: packed(marked(other.text, mark)) },
  ]);
  assert.deepEqual(building.holding, []);
  assert.deepEqual(keptRows(root), []);
  assert.deepEqual(await filesHolding(root, "", [kept.text, other.text]), []);
});

const quotedFile = "components/modes/k2/tests/quoted.test.ts";

const quotedCode = "components/modes/k2/scripts/quoted.ts";

const quoted: Handed = {
  path: quotedFile,
  text: [
    'import { quotedQuill } from "../scripts/quoted-zx9091.ts";',
    'const zx9092Sample = "a sample the builder must never be shown";',
    'test("counts once", () => quotedQuill(zx9092Sample) === 1);',
    'test("counts twice", () => quotedQuill(zx9092Sample + zx9092Sample) === 2);',
    "",
  ].join("\n"),
};

const quotedLine = 'const zx9092Sample = "a sample the builder must never be shown";';

const quotedRun = "the builder must nev";

const plainMessage = "expected 2 to be 1";

function quotedSlice(): Json {
  return {
    name: "K2",
    kind: "mode",
    scope: ["components/modes/k2/**"],
    after: [],
    done: [
      {
        id: "DOD-K2-1",
        says: "A quill is counted once.",
        level: "must",
        proof: { kind: "fails-first", tests: [quotedFile] },
      },
    ],
  };
}

function quotedProof(verdict: "passed" | "failed"): Proved {
  const file = `/tmp/proof-copy/${quotedFile}`;
  const failures = [
    { name: "counts once", file, message: quotedLine, charactersCut: 0 },
    { name: "counts twice", file, message: `got ${quotedRun} back`, charactersCut: 0 },
    { name: "counts thrice", file, message: plainMessage, charactersCut: 0 },
  ];
  const cases = { failures, failuresNotListed: 0, notLoaded: [] };
  const judged = { item: "DOD-K2-1", kind: "fails-first", verdict, detail: "The named tests fail on the head." };
  return {
    verdicts: [verdict === "failed" ? { ...judged, cases } : judged],
    judgement: [],
    size: [{ path: quotedCode, head: 1 }],
  };
}

function runsOf(text: string, length: number): readonly string[] {
  const characters = Array.from(text);
  const runs: string[] = [];
  for (let start = 0; start + length <= characters.length; start += 1) {
    runs.push(characters.slice(start, start + length).join(""));
  }
  return [...new Set(runs)];
}

function quotedForms(): readonly string[] {
  const lines = quoted.text.split("\n").filter((line) => line.trim() !== "");
  const forms = [...lines, ...runsOf(quoted.text, 20)];
  return forms.flatMap((form) => [form, JSON.stringify(form).slice(1, -1)]);
}

function tableTexts(root: string): readonly string[] {
  const database = new DatabaseSync(join(root, ".agentbay/kernel.db"), { readOnly: true });
  try {
    const tables = database.prepare("select name from sqlite_master where type = 'table'").all();
    return tables.flatMap((table) => {
      const rows = database.prepare(`select * from "${String(table.name)}"`).all();
      return rows.map((row) => `${String(table.name)}: ${JSON.stringify(row)}`);
    });
  } finally {
    database.close();
  }
}

async function agentbayFiles(root: string, at: string): Promise<readonly string[]> {
  const entries = await readdir(join(root, at), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = `${at}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await agentbayFiles(root, path)));
    } else if (entry.isFile() && !entry.name.startsWith("forge--kept-tests.db")) {
      found.push(path);
    }
  }
  return found;
}

type Found = {
  readonly rows: readonly string[];
  readonly files: readonly string[];
};

async function quotedIn(root: string): Promise<Found> {
  const forms = quotedForms();
  const bytes = forms.map((form) => Buffer.from(form, "utf8").toString("latin1"));
  const rows = tableTexts(root).filter((row) => forms.some((form) => row.includes(form)));
  const files: string[] = [];
  for (const path of await agentbayFiles(root, ".agentbay")) {
    const content = (await readFile(join(root, path))).toString("latin1");
    if (bytes.some((form) => content.includes(form))) {
      files.push(path);
    }
  }
  return { rows, files };
}

const nothingFound: Found = { rows: [], files: [] };

test("after a round whose proof quotes a test, no table of kernel.db and no other file under .agentbay holds a line or a 20-character run of it, and the builder still gets its filtered failing cases", async () => {
  const root = await project(template);
  const start = await started(root, {
    planned: { title: "K2", slice: quotedSlice() },
    base: shortHead(root),
    bugs: [],
  });
  await declared(root, start, [quotedCode]);
  await provedIn(root, "K2", quotedProof("failed"));
  const builderTasks: Json[] = [];
  const whileBuilding: Found[] = [];
  await playedTo(root, start.id, {
    tests: () => Promise.resolve({ tests: [quoted] }),
    builder: async (given) => {
      builderTasks.push(given);
      whileBuilding.push(await quotedIn(root));
      await builderWrites(root, textAt(fieldsOf(given).input ?? null, "folder"), [quotedCode]);
      await provedIn(root, "K2", quotedProof(builderTasks.length === 1 ? "failed" : "passed"));
      return { outcome: "built" };
    },
    reviewer: (given) => Promise.resolve(allHeld(given)),
  });
  assert.deepEqual(whileBuilding, [nothingFound, nothingFound]);
  const [, second] = builderTasks;
  assert.deepEqual(fieldsOf(fieldsOf(second ?? null).input ?? null).failing, {
    items: ["DOD-K2-1"],
    cases: [
      { name: "counts once", file: quotedFile },
      { name: "counts twice", file: quotedFile },
      { name: "counts thrice", file: quotedFile, message: plainMessage },
    ],
    withheld: 2,
    notListed: 0,
    notLoaded: [],
  });
  const heads = (await askedOf(root, "K2")).map((each) => textAt(each, "head"));
  const head = (branch: string): string => git(root, ["rev-parse", branch]).trim();
  assert.deepEqual(heads.slice(1), [head("forge/K2-tests-2"), head("forge/K2-tests-2")]);
  assert.notEqual(heads[0], heads[1]);
  assert.deepEqual(branches(root), ["forge/K2-2", "forge/K2-tests-2"]);
  waitingOf(await shown(root, start.id), "card");
  assert.deepEqual(await quotedIn(root), nothingFound);
});

test("after a final proof whose failing cases quote a test, kernel.db holds no line or 20-character run of it, the kept tests are forgotten, and the card shows only the message that quotes nothing", async () => {
  const root = await project(template);
  const start = await started(root, {
    planned: { title: "K3", slice: { ...fieldsOf(quotedSlice()), name: "K3" } },
    base: shortHead(root),
    bugs: [],
  });
  await declared(root, start, [quotedCode]);
  await provedIn(root, "K3", quotedProof("failed"));
  await playedTo(root, start.id, {
    tests: () => Promise.resolve({ tests: [quoted] }),
    builder: async (given) => {
      await builderWrites(root, textAt(fieldsOf(given).input ?? null, "folder"), [quotedCode]);
      return { outcome: "built" };
    },
    reviewer: (given) => Promise.resolve(allHeld(given)),
  });
  waitingOf(await shown(root, start.id), "card");
  assert.deepEqual(await quotedIn(root), nothingFound);
  assert.deepEqual(keptRows(root), []);
  const printed = await printedCard(root, start.id);
  const failing = printed.indexOf("  failing: counts once");
  assert.deepEqual(printed.slice(failing, failing + 4), [
    "  failing: counts once",
    "  failing: counts twice",
    "  failing: counts thrice",
    `  its message: ${plainMessage}`,
  ]);
});

function forgetRows(root: string): void {
  const database = new DatabaseSync(join(root, ".agentbay/data/forge--kept-tests.db"));
  try {
    database.prepare("delete from kept_tests").run();
  } finally {
    database.close();
  }
}

test("when the kept tests are gone before the final proof, it fails closed: no message and no reason of proof reaches the card or kernel.db", async () => {
  const root = await project(template);
  const done = listOf(fieldsOf(quotedSlice()).done);
  const caught = { id: "DOD-K4-2", says: "Planted bugs are caught.", level: "must", proof: { kind: "bugs-caught" } };
  const start = await started(root, {
    planned: { title: "K4", slice: { ...fieldsOf(quotedSlice()), name: "K4", done: [...done, caught] } },
    base: shortHead(root),
    bugs: [],
  });
  await declared(root, start, [quotedCode]);
  await provedIn(root, "K4", quotedProof("failed"));
  const builderLine = "Written by the builder in .forge/worktrees/K4.";
  const patch = [`--- a/${quotedCode}`, `+++ b/${quotedCode}`, "@@ -1 +1 @@", `-${builderLine}`, "+Nothing.", ""];
  await playedTo(root, start.id, {
    tests: () => Promise.resolve({ tests: [quoted] }),
    builder: async (given) => {
      await builderWrites(root, textAt(fieldsOf(given).input ?? null, "folder"), [quotedCode]);
      return { outcome: "built" };
    },
    reviewer: (given) => Promise.resolve(allHeld(given)),
    planter: () => {
      forgetRows(root);
      return Promise.resolve({ bugs: [{ name: "the quill is lost", patch: patch.join("\n"), tests: [quotedFile] }] });
    },
  });
  waitingOf(await shown(root, start.id), "card");
  assert.deepEqual(keptRows(root), []);
  assert.deepEqual(await quotedIn(root), nothingFound);
  const printed = (await printedCard(root, start.id)).join("\n");
  assert.ok(!printed.includes(plainMessage), printed);
  assert.ok(!printed.includes("its message:"), printed);
  assert.ok(printed.includes("  failing: counts thrice"), printed);
  assert.ok(printed.includes("proof's reason: Proof's reason is kept"), printed);
  const full = await bay(root, ["runs", start.id, "--full"]);
  const steps = listOf(fieldsOf(fieldsOf(full).run ?? null).steps);
  const prove = steps.find((step) => textAt(step, "key") === "prove") ?? null;
  const said = JSON.stringify(fieldsOf(prove).output ?? null);
  assert.ok(said.includes('"message":""'), said);
  assert.ok(!said.includes(plainMessage), said);
  assert.ok(!said.includes("The named tests fail on the head."), said);
});
