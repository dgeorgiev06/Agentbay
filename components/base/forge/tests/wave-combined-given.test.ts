import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedOf,
  branches,
  decided,
  git,
  into,
  kitTemplate,
  listOf,
  printedCard,
  project,
  removeAll,
  runOf,
  shown,
  textAt,
  waitingOf,
  worktrees,
} from "./kit-copy.ts";
import { givenIn, partStarted, withCommits } from "./part-run.ts";
import { checksFailed, checksPassed, codeOf, ownPassed, planOnInto, provedAs, testPath } from "./wave-run.ts";

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

function flowing(rows: readonly string[]): string {
  return rows.join(" ").replace(/\s+/g, " ");
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
  assert.equal(textAt(listOf(card.choices)[0] ?? null, "status"), "withheld");
  const rows = await printedCard(root, card.id);
  const printed = flowing(rows);
  assert.ok(printed.includes("Merge is not offered: the wave's checks failed on the slices combined."), printed);
  assert.ok(printed.includes("CA proved alone with the checks: DOD-CA-2, must, passed"), printed);
  assert.ok(printed.includes("CB fails the checks alone, so its work breaks the suite"), printed);
  assert.ok(printed.includes("on forge/wave-1, with CA, CB merged in plan order"), printed);
  assert.ok(rows.includes("judged   DOD-CA-1 held by 1 case"), printed);
  assert.ok(rows.includes("judged   DOD-CB-2 held by 1 case"), printed);
  assert.ok(rows.includes("checked: 0 ran, 32 computed, 6 judged"), printed);
  assert.equal((await askedOf(root, "wave-1")).length, 1);
  assert.deepEqual(kindsAsked((await askedOf(root, "CA")).slice(-1)), ["checks"]);
  const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
  const stay = ["forge/CA", "forge/CA-tests-1", "forge/CB", "forge/CB-tests-1", "forge/wave-1"];
  assert.deepEqual(fieldsOf(fieldsOf(kept).output ?? null).kept, stay);
  assert.deepEqual(branches(root), stay);
  assert.deepEqual(worktrees(root), []);
});
