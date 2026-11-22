import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedOf,
  branches,
  decided,
  factsOf,
  git,
  into,
  kitTemplate,
  listOf,
  project,
  removeAll,
  runOf,
  shown,
  textAt,
  waitingOf,
  withheldOf,
  worktrees,
  type Waiting,
} from "./kit-copy.ts";
import { givenIn, partStarted, withCommits } from "./part-run.ts";
import { playedSideBySide } from "./side-by-side-play.ts";
import {
  checksFailed,
  checksPassed,
  codeOf,
  ownPassed,
  planOnInto,
  provedAs,
  testPath,
  wavePlayers,
} from "./wave-run.ts";

type Made = {
  readonly builder: string;
  readonly head: string;
};

let template: string;

before(async () => {
  template = await kitTemplate({ sideBySide: 3 });
});

after(async () => {
  await removeAll();
});

function rev(root: string, name: string): string {
  return git(root, ["rev-parse", name]).trim();
}

async function committed(folder: string, path: string, message: string): Promise<string> {
  await mkdir(dirname(join(folder, path)), { recursive: true });
  await writeFile(join(folder, path), `${message}.\n`, "utf8");
  git(folder, ["add", path]);
  git(folder, ["commit", "-q", "-m", message]);
  return rev(folder, "HEAD");
}

async function sliceBranches(root: string, name: string, base: string): Promise<Made> {
  const folder = join(root, `.made-${name}`);
  git(root, ["worktree", "add", "-q", "-b", `forge/${name}`, folder, base]);
  const builder = await committed(folder, codeOf(name), `${name}: the builder's work`);
  git(folder, ["checkout", "-q", "-b", `forge/${name}-tests-1`]);
  const head = await committed(folder, testPath(name), `${name}: the tests`);
  git(root, ["worktree", "remove", folder]);
  return { builder, head };
}

function capturedAs(captured: Json, made: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const commits = fieldsOf(captured);
  return new Map(Object.entries(made).map(([branch, commit]) => [textAt(commits, branch), commit]));
}

function kindsAsked(requests: readonly Json[]): readonly string[] {
  const kinds = requests.flatMap((request) =>
    listOf(fieldsOf(fieldsOf(request).slice ?? null).done).map((item) => textAt(fieldsOf(item).proof ?? null, "kind")),
  );
  return [...new Set(kinds)].sort();
}

function wordsIn(waiting: Waiting, section: string): readonly string[] {
  return factsOf(waiting, section).map((fact) => fact.words);
}

test("given a wave's slices built and each passing its own proof, the combined head fails the checks, each slice is proved alone, the breaker is named, and keep leaves no worktree", async () => {
  const root = await project(template);
  await planOnInto(root, ["CA", "CB"]);
  const base = rev(root, into);
  const ca = await sliceBranches(root, "CA", base);
  const cb = await sliceBranches(root, "CB", base);
  await provedAs(root, "CA", ownPassed("CA"));
  await provedAs(root, "CB", ownPassed("CB"));
  await provedAs(root, "wave-1.checks", checksFailed("checks", "store lists every table"));
  await provedAs(root, "CA.checks", checksPassed("DOD-CA-2"));
  await provedAs(root, "CB.checks", checksFailed("DOD-CB-2", "store lists every table"));
  const captured = fieldsOf(await givenIn("given-wave-ca-cb.json"));
  const commits = capturedAs(captured.commits ?? null, {
    integration: base,
    "forge/CA": ca.builder,
    "forge/CA-tests-1": ca.head,
    "forge/CB": cb.builder,
    "forge/CB-tests-1": cb.head,
  });
  const given = withCommits(captured.given ?? null, commits);
  const trigger = { plan: "docs/plans/0099-wave.yaml", wave: 1 };
  const runId = await partStarted(root, "forge:workflows/wave.yaml", { trigger, part: { given } });
  const card = waitingOf(await shown(root, runId), "card");
  assert.deepEqual(withheldOf(card), { merge: "The wave's checks failed on the slices combined." });
  assert.deepEqual(wordsIn(card, "problems"), [
    "The checks on the slices combined: the must item checks failed, as a check or the test run failed.",
    "CB fails the checks alone, so its work breaks the suite.",
  ]);
  const alone = factsOf(card).filter((fact) => fact.about === "CA alone with the checks");
  assert.equal(alone[0]?.words, "The must item DOD-CA-2 passed.");
  assert.ok(
    wordsIn(card, "what").some((words) => words.endsWith("on forge/wave-1, with CA, CB merged in plan order.")),
  );
  const judged = factsOf(card)
    .filter((fact) => fact.mark === "judged")
    .map((fact) => fact.words);
  assert.ok(
    judged.includes("DOD-CA-1 held by 1 case.") && judged.includes("DOD-CB-2 held by 1 case."),
    judged.join("\n"),
  );
  assert.ok(
    wordsIn(card, "checks").includes(
      "Gate: the whole test run, since the slices write inside more than one mode's folder " +
        "(components/modes/ca and components/modes/cb).",
    ),
  );
  assert.equal((await askedOf(root, "wave-1")).length, 1);
  assert.deepEqual(kindsAsked((await askedOf(root, "CA")).slice(-1)), ["checks"]);
  const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
  const stay = ["forge/CA", "forge/CA-tests-1", "forge/CB", "forge/CB-tests-1", "forge/wave-1"];
  assert.deepEqual(fieldsOf(fieldsOf(kept).output ?? null).kept, stay);
  assert.deepEqual(branches(root), stay);
  assert.deepEqual(worktrees(root), []);
});

function done(output: Json): string {
  return `${JSON.stringify({ ok: true, run: { id: "r1", status: "done", output } })}\n`;
}

function printedVerdict(item: string, output: Json): Json {
  const printed = { exitCode: 0, stdout: done(output) };
  return { item, kind: "printed", verdict: "passed", detail: "Ran.", printed };
}

const examplesOf: Readonly<Record<string, Json>> = {
  CA: [
    {
      action: "counting.add",
      mode: "tally",
      examples: [{ input: { name: "ann" }, answer: { name: "ann", count: 1 } }],
    },
  ],
  CB: [
    {
      action: "counting.count",
      mode: "tally",
      examples: [{ earlier: [{ action: "add", input: { name: "bo" } }], input: { name: "bo" }, answer: { count: 1 } }],
    },
  ],
};

function withExamples(request: Json): Json {
  const fields = fieldsOf(request);
  const name = textAt(fieldsOf(fields.planned ?? null).slice ?? null, "name");
  return { ...fields, examples: examplesOf[name] ?? [] };
}

async function provedWithExamples(root: string): Promise<void> {
  await provedAs(root, "CA", ownPassed("CA"));
  await provedAs(root, "CB", ownPassed("CB"));
  const tried = [printedVerdict("tried-1", { name: "ann", count: 1 }), printedVerdict("tried-2", { count: 0 })];
  const checks = checksPassed("checks");
  await provedAs(root, "wave-1.checks-printed", { ...checks, verdicts: [...checks.verdicts, ...tried] });
}

async function calledModes(root: string): Promise<readonly (readonly Json[])[]> {
  const asked = fieldsOf((await askedOf(root, "wave-1"))[0] ?? null);
  const done = listOf(fieldsOf(asked.slice ?? null).done);
  return done.map((item) =>
    listOf(fieldsOf(fieldsOf(item).proof ?? null).runs).map((run) => listOf(fieldsOf(run).bay)[1] ?? null),
  );
}

test("given a wave whose slice requests carry the design's examples, settle and combine hand them on, the combined head tries them, and the card withholds merge for the slice that answered otherwise", async () => {
  const root = await project(template);
  await planOnInto(root, ["CA", "CB"]);
  const base = rev(root, into);
  await provedWithExamples(root);
  const captured = fieldsOf(await givenIn("given-wave-ca-cb.json"));
  const commits = capturedAs(captured.commits ?? null, { integration: base });
  const given = fieldsOf(withCommits(captured.given ?? null, commits));
  const wave = fieldsOf(given.wave ?? null);
  const requests = listOf(wave.requests).map(withExamples);
  const part = {
    given: { wave: { ...wave, requests, builtBefore: [] }, start: given.start ?? null, begin: given.begin ?? null },
  };
  const runId = await partStarted(root, "forge:workflows/wave.yaml", { trigger: { plan: "x", wave: 1 }, part });
  await playedSideBySide(root, runId, wavePlayers(root));
  const card = waitingOf(await shown(root, runId), "card");
  assert.equal(textAt(listOf(card.choices)[0] ?? null, "reason"), "1 of CB's examples answered otherwise.");
  assert.deepEqual(await calledModes(root), [[], ["tally.add"], ["tally.add", "tally.count"]]);
  const otherwise = 'counting.count example 1: the design answers {"count":1}; the built mode answered:';
  assert.ok(
    wordsIn(card, "problems").some((words) => words.startsWith(`CB's ${otherwise}`)),
    wordsIn(card, "problems").join("\n"),
  );
  const examples = (name: string): readonly string[] =>
    factsOf(card)
      .filter((fact) => fact.about === `${name}'s examples`)
      .map((fact) => fact.words);
  assert.equal(examples("CA")[0], "Examples, must, passed: The design's examples answer as designed.");
  assert.equal(examples("CB")[0], "Examples, must, failed: The design's examples answer as designed.");
  assert.ok(
    examples("CB").some((words) => words.startsWith(otherwise)),
    examples("CB").join("\n"),
  );
});
