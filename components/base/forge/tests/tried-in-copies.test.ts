import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { plannedTrials, resultOf, type Entry, type Result, type Trial } from "../scripts/lib/tried-examples.ts";
import { trialsIn } from "../scripts/lib/tried-block.ts";
import {
  askedOf,
  git,
  jsonOf,
  kitTemplate,
  listOf,
  printedCard,
  project,
  provedIn,
  removeAll,
  roundToCard,
  shortHead,
  started,
  textAt,
  type Handed,
} from "./kit-copy.ts";
import { addToTry, countToTry, emptyName, inRounds, tallyFiles, twentyA, type TallyVariant } from "./tally-design.ts";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const variants: readonly TallyVariant[] = ["as designed", "counts once", "refuses tersely", "broken manifest"];

let template: string;

const heads = new Map<TallyVariant, string>();

const scratch: string[] = [];

async function committed(root: string, variant: TallyVariant): Promise<string> {
  git(root, ["checkout", "-q", "-B", `tally-${variant.replace(/ /g, "-")}`, "main"]);
  for (const [path, text] of Object.entries(tallyFiles(variant))) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
  git(root, ["add", "-A", "components/modes/tally"]);
  git(root, ["commit", "-q", "-m", `tally, ${variant}`]);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "main"]);
  return head;
}

async function freshCopy(head: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "forge-tried-")));
  scratch.push(folder);
  git(template, ["worktree", "add", "-q", "--detach", folder, head]);
  await symlink(await realpath(join(kit, "node_modules")), join(folder, "node_modules"));
  return folder;
}

function bayIn(folder: string, words: readonly string[]): { readonly exitCode: number; readonly stdout: string } {
  const ran = spawnSync(process.execPath, ["bay/cli.ts", ...words], { cwd: folder, encoding: "utf8" });
  return { exitCode: ran.status ?? 1, stdout: ran.stdout };
}

type Printed = { readonly exitCode: number; readonly stdout: string };

async function printedOf(head: string, trial: Trial): Promise<Printed> {
  const folder = await freshCopy(head);
  const printed = trial.runs.map((words) => bayIn(folder, words));
  return printed.at(-1) ?? assert.fail("a trial makes at least one call");
}

async function triedInCopies(head: string, entries: readonly Entry[]): Promise<readonly Result[]> {
  const results: Result[] = [];
  for (const entry of entries) {
    results.push(entry.outcome === "to try" ? resultOf(entry, { printed: await printedOf(head, entry) }) : entry);
  }
  return results;
}

function outcomes(results: readonly Result[]): readonly string[] {
  return results.map((result) => `${result.action} ${String(result.number)}: ${result.outcome}`);
}

function addEntries(): readonly Entry[] {
  return plannedTrials("TL1", [addToTry], inRounds);
}

before(async () => {
  template = await kitTemplate();
  for (const variant of variants) {
    heads.set(variant, await committed(template, variant));
  }
});

after(async () => {
  for (const folder of scratch) {
    git(template, ["worktree", "remove", "--force", folder]);
    await rm(folder, { recursive: true, force: true });
  }
  await removeAll();
});

function headOf(variant: TallyVariant): string {
  return heads.get(variant) ?? assert.fail(`no head for ${variant}`);
}

describe("the design's examples, run by bay call against a made-up mode, each in a fresh copy of its own", () => {
  test("a mode that answers as designed: every example of add, the long text spelled out, answers as the design says", async () => {
    const results = await triedInCopies(headOf("as designed"), addEntries());
    assert.deepEqual(outcomes(results), [
      "counting.add 1: as designed",
      "counting.add 2: as designed",
      "counting.add 3: as designed",
      "counting.add 4: as designed",
    ]);
  });

  test("a mode whose count does not rise answers example 2 otherwise, after its earlier call, and the others as designed", async () => {
    const results = await triedInCopies(headOf("counts once"), addEntries());
    assert.deepEqual(outcomes(results), [
      "counting.add 1: as designed",
      "counting.add 2: otherwise",
      "counting.add 3: as designed",
      "counting.add 4: as designed",
    ]);
    assert.deepEqual(results[1], {
      slice: "TL1",
      action: "counting.add",
      number: 2,
      outcome: "otherwise",
      designed: { how: "answers", text: '{"name":"ann","count":2}' },
      built: { how: "answered", text: '{"name":"ann","count":1}' },
    });
  });

  test("a mode that refuses with another sentence answers the refusal otherwise, showing both sentences", async () => {
    const results = await triedInCopies(headOf("refuses tersely"), addEntries());
    assert.deepEqual(results[2], {
      slice: "TL1",
      action: "counting.add",
      number: 3,
      outcome: "otherwise",
      designed: { how: "refuses", text: emptyName },
      built: { how: "refused", text: "Name missing." },
    });
  });

  test("a mode whose manifest the kernel cannot load leaves every example not known, which withholds merge under must", async () => {
    const results = await triedInCopies(headOf("broken manifest"), addEntries());
    assert.deepEqual(outcomes(results), [
      "counting.add 1: not known",
      "counting.add 2: not known",
      "counting.add 3: not known",
      "counting.add 4: not known",
    ]);
    assert.ok(results.every((result) => !JSON.stringify(result).includes("builder-key")));
  });

  test("an example of count that needs add, which the slice does not build, is not tried yet and runs nothing", () => {
    const entries = plannedTrials("TL2", [countToTry], { ...inRounds, built: ["counting.count"] });
    assert.deepEqual(trialsIn(entries), []);
    assert.deepEqual(outcomes(entries.flatMap((entry) => (entry.outcome === "to try" ? [] : [entry]))), [
      "counting.count 1: not tried",
    ]);
  });

  test("the long text is spelled out before the call: the mode is given twenty a's, not the rule", () => {
    const trial: Trial | undefined = trialsIn(addEntries())[3];
    assert.deepEqual(trial?.runs, [["call", "tally.add", JSON.stringify({ name: twentyA }), "--json"]]);
  });
});

function testPath(file: string): string {
  return `components/modes/tally/tests/${file}`;
}

const handedTest: Handed = {
  path: testPath("tally.test.ts"),
  text: ['import { test } from "node:test";', 'test("tally counts a name", () => {});', ""].join("\n"),
};

function sliceOf(name: string): Json {
  return {
    name,
    kind: "mode",
    scope: ["components/modes/tally/**"],
    after: [],
    done: [
      {
        id: `DOD-${name}-1`,
        says: "A name added is counted.",
        level: "must",
        proof: { kind: "fails-first", tests: [testPath("tally.test.ts")] },
      },
      { id: `DOD-${name}-2`, says: "The checks pass.", level: "must", proof: { kind: "checks" } },
    ],
  };
}

function passed(item: string, kind: string): Json {
  return { item, kind, verdict: "passed", detail: "It held." };
}

const baseVerdicts = (name: string): readonly Json[] => [
  passed(`DOD-${name}-1`, "fails-first"),
  passed(`DOD-${name}-2`, "checks"),
  passed("scope", "in-scope"),
  passed("declared", "as-declared"),
];

async function standInAnswers(root: string, name: string, variant: TallyVariant): Promise<void> {
  const files = [...Object.keys(tallyFiles(variant)), handedTest.path];
  const size = files.map((path) => ({ path, head: 1 }));
  await provedIn(root, name, { verdicts: baseVerdicts(name), judgement: [], size });
  const tried: Json[] = [];
  for (const trial of trialsIn(plannedTrials(name, [addToTry], inRounds))) {
    const printed = await printedOf(headOf(variant), trial);
    tried.push({
      item: `tried-${String(tried.length + 1)}`,
      kind: "printed",
      verdict: "passed",
      detail: "Ran.",
      printed,
    });
  }
  const answer = { verdicts: [...baseVerdicts(name), ...tried], judgement: [], size };
  await writeFile(join(root, ".stand-in", `${name}.checks-fails-first-printed.json`), JSON.stringify(answer), "utf8");
}

type Rounded = {
  readonly card: Awaited<ReturnType<typeof roundToCard>>;
  readonly lines: readonly string[];
  readonly printedItems: readonly Json[];
};

async function withSetting(root: string, setting: string | undefined): Promise<void> {
  if (setting === undefined) {
    return;
  }
  const file = join(root, "agentbay.config.yaml");
  const config = fieldsOf(jsonOf(await readFile(file, "utf8")));
  const settings = fieldsOf(config.settings ?? null);
  const forge = { ...fieldsOf(settings.forge ?? null), tryExamples: setting };
  await writeFile(file, JSON.stringify({ ...config, settings: { ...settings, forge } }), "utf8");
}

async function roundedTo(name: string, setting?: string): Promise<Rounded> {
  const root = await project(template);
  await withSetting(root, setting);
  await standInAnswers(root, name, "counts once");
  const planned = { title: "The tally mode counts names", slice: sliceOf(name) };
  const interfaceFiles = [testPath("schema.json")];
  const request = { planned, base: shortHead(root), bugs: [], interface: interfaceFiles, examples: [addToTry] };
  const start = await started(root, request);
  const files = Object.keys(tallyFiles("counts once"));
  const card = await roundToCard(root, start, { name, files, tests: [handedTest], built: { outcome: "built" } });
  const asked = await askedOf(root, name);
  const final = listOf(fieldsOf(fieldsOf(asked.at(-1) ?? null).slice ?? null).done).map(fieldsOf);
  const printedItems = final.filter((item) => fieldsOf(item.proof ?? null).kind === "printed");
  return { card, lines: await printedCard(root, start.id), printedItems };
}

function mergeOf(rounded: Rounded): Json {
  return listOf(rounded.card.choices)[0] ?? null;
}

describe(
  "the rounds' merge card says what the built mode answered to the design's examples",
  { concurrency: true },
  () => {
    test("must: one example answered otherwise withholds merge, the card shows both sides, and proof was asked one printed item per example", async () => {
      const rounded = await roundedTo("TL1");
      assert.equal(textAt(mergeOf(rounded), "status"), "withheld");
      assert.equal(textAt(mergeOf(rounded), "reason"), "1 of the design's examples answered otherwise.");
      assert.deepEqual(
        rounded.printedItems.map((item) => listOf(fieldsOf(fieldsOf(item).proof ?? null).runs).length),
        [1, 2, 1, 1],
      );
      const text = rounded.lines.join("\n");
      assert.ok(rounded.lines.includes("  examples, must, failed: The design's"), text);
      assert.ok(!rounded.lines.some((line) => line.startsWith("  tried-")), text);
      assert.ok(text.includes('"{\\"name\\":\\"ann\\",\\"count\\":1}"'), text);
    });

    test("shown: the same block with the item a should, and merge is offered", async () => {
      const rounded = await roundedTo("TL3", "shown");
      assert.equal(textAt(mergeOf(rounded), "status"), "offered");
      assert.ok(rounded.lines.includes("  examples, should, failed: The design's"), rounded.lines.join("\n"));
    });

    test("off: proof is asked no example, the card says so in one line, and merge is offered", async () => {
      const rounded = await roundedTo("TL4", "off");
      assert.deepEqual(rounded.printedItems, []);
      assert.equal(textAt(mergeOf(rounded), "status"), "offered");
      assert.ok(rounded.lines.includes("  the design's examples: not tried, since"), rounded.lines.join("\n"));
    });
  },
);
