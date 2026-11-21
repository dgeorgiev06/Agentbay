import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedOf,
  bay,
  branches,
  decided,
  git,
  into,
  keptRows,
  kitTemplate,
  listOf,
  onlyWhenRecapturing,
  printedCard,
  project,
  removeAll,
  runOf,
  shown,
  actionOutputs,
  textAt,
  waitingOf,
  worktrees,
} from "./kit-copy.ts";
import { playedSideBySide } from "./side-by-side-play.ts";
import {
  checksFailed,
  checksPassed,
  codeOf,
  ownFailed,
  ownPassed,
  planOnInto,
  provedAs,
  waveStarted,
  wavePlayers,
} from "./wave-run.ts";

let template: string;

before(async () => {
  template = await kitTemplate({ sideBySide: 3 });
});

after(async () => {
  await removeAll();
});

function kindsAsked(requests: readonly Json[]): readonly string[] {
  const kinds = requests.flatMap((request) =>
    listOf(fieldsOf(fieldsOf(request).slice ?? null).done).map((item) => textAt(fieldsOf(item).proof ?? null, "kind")),
  );
  return [...new Set(kinds)].sort();
}

function keptSlices(root: string): readonly string[] {
  return [...new Set(keptRows(root).map((row) => textAt(row, "slice")))].sort();
}

function flowing(rows: readonly string[]): string {
  return rows.join(" ").replace(/\s+/g, " ");
}

function unmarked(rows: readonly string[]): string {
  return flowing(rows.map((row) => row.replace(/^judged\s+/, "")));
}

function sliceAsked(task: Json): string {
  return textAt(fieldsOf(fieldsOf(task).input ?? null).slice ?? null, "name");
}

function cardOf(run: Json): ReturnType<typeof waitingOf> {
  return waitingOf(run, "card");
}

describe("a wave of a plan, its slices side by side", { concurrency: true }, () => {
  test("three slices built at once; one fails as a run and is rerun, one fails its own proof; the other two are merged with the whole suite asked once", async () => {
    const root = await project(template);
    await planOnInto(root, ["TD1", "TD10", "TD2"]);
    await provedAs(root, "TD1", ownPassed("TD1"));
    await provedAs(root, "TD2", ownPassed("TD2"));
    await provedAs(root, "wave-1.checks", checksPassed("checks"));
    const start = await waveStarted(root);
    await decided(root, start, { step: "start", choice: "build" });
    const players = wavePlayers(root, {
      reviewed: async (name) => (name === "TD2" ? provedAs(root, "TD2", ownFailed("TD2")) : undefined),
    });
    const first = await playedSideBySide(root, start.id, players);
    assert.equal(first.mostAtOnce, 3, JSON.stringify(first.asked.map((each) => each.step)));
    const asking = await shown(root, start.id);
    const question = textAt(fieldsOf(asking).waiting ?? null, "question");
    assert.equal(textAt(fieldsOf(asking).waiting ?? null, "reason"), "owner", JSON.stringify(asking));
    assert.match(question, /1 of 3 items: TD10 \(The td10 mode counts what was added\) at slices\[1\]: /);
    assert.deepEqual(keptSlices(root), ["TD1", "TD10", "TD2"]);
    await provedAs(root, "TD10", ownPassed("TD10"));
    await bay(root, ["resume", start.id, "--rerun"]);
    const second = await playedSideBySide(root, start.id, players);
    const builds = [...first.asked, ...second.asked].filter((each) => each.action === "build-without-tests");
    assert.deepEqual(builds.map((each) => sliceAsked(each.task)).sort(), ["TD1", "TD10", "TD10", "TD2"]);
    const card = cardOf(await shown(root, start.id));
    const printed = await printedCard(root, card.id);
    assert.equal(printed[0], "Merge wave 1 into integration?");
    const said = flowing(printed);
    assert.ok(said.includes("Merge is offered for 2 of 3 slices: each passed its own proof"), said);
    assert.ok(
      said.includes("left out: TD2 (The td2 mode counts what was added), as its own proof did not pass."),
      said,
    );
    assert.ok(said.includes("TD2 is left out: 1 must item failed. Its branches stay"), said);
    const td10 = "the work and the tests are on forge/TD10-tests-1, the builder's work alone on forge/TD10";
    assert.ok(said.includes(`TD10 is in the combined head; ${td10}`), said);
    const judged = unmarked(printed);
    for (const name of ["TD1", "TD10", "TD2"]) {
      const named = `${name} (The ${name.toLowerCase()} mode counts what was added)`;
      assert.ok(judged.includes(`by forge skills/review, tier deep, for ${named}`), judged);
    }
    assert.ok(!judged.includes(" in item "), judged);
    assert.deepEqual(kindsAsked(await askedOf(root, "wave-1")), ["checks"]);
    assert.equal((await askedOf(root, "wave-1")).length, 1);
    for (const name of ["TD1", "TD10", "TD2"]) {
      assert.ok(!kindsAsked(await askedOf(root, name)).includes("checks"), name);
    }
    await decided(root, card, { step: "card", choice: "merge" });
    assert.equal(textAt(await shown(root, start.id), "status"), "done");
    const merged = git(root, ["ls-tree", "-r", "--name-only", into]);
    assert.ok(merged.includes(codeOf("TD1")) && merged.includes(codeOf("TD10")) && !merged.includes(codeOf("TD2")));
    assert.deepEqual(branches(root), ["forge/TD2", "forge/TD2-tests-1"]);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(keptRows(root), []);
  });

  test(
    "two slices that pass alone but fail the checks combined are each proved alone, the breaker is named, and keep leaves nothing on disk",
    onlyWhenRecapturing,
    async () => {
      const root = await project(template);
      await planOnInto(root, ["CA", "CB"]);
      await provedAs(root, "CA", ownPassed("CA"));
      await provedAs(root, "CB", ownPassed("CB"));
      await provedAs(root, "wave-1.checks", checksFailed("checks", "store lists every table"));
      await provedAs(root, "CA.checks", checksPassed("DOD-CA-2"));
      await provedAs(root, "CB.checks", checksFailed("DOD-CB-2", "store lists every table"));
      const start = await waveStarted(root);
      await decided(root, start, { step: "start", choice: "build" });
      const played = await playedSideBySide(root, start.id, wavePlayers(root));
      assert.equal(played.mostAtOnce, 2);
      const card = cardOf(await shown(root, start.id));
      assert.equal(textAt(listOf(card.choices)[0] ?? null, "status"), "withheld");
      const printed = flowing(await printedCard(root, card.id));
      assert.ok(printed.includes("Merge is not offered: the wave's checks failed on the slices combined."), printed);
      assert.ok(printed.includes("CA proved alone with the checks: DOD-CA-2, must, passed"), printed);
      assert.ok(printed.includes("CB fails the checks alone, so its work breaks the suite"), printed);
      assert.ok(printed.includes("on forge/wave-1, with CA, CB merged in plan order"), printed);
      assert.equal((await askedOf(root, "wave-1")).length, 1);
      assert.deepEqual(kindsAsked((await askedOf(root, "CA")).slice(-1)), ["checks"]);
      const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
      const stay = ["forge/CA", "forge/CA-tests-1", "forge/CB", "forge/CB-tests-1", "forge/wave-1"];
      assert.deepEqual(fieldsOf(fieldsOf(kept).output ?? null).kept, stay);
      assert.deepEqual(branches(root), stay);
      assert.deepEqual(worktrees(root), []);
      assert.deepEqual(keptRows(root), []);
    },
  );

  test("a wave whose only slice fails its own proof joins nothing, asks proof for no checks, and withholds merge", async () => {
    const root = await project(template);
    await planOnInto(root, ["NA"]);
    await provedAs(root, "NA", ownFailed("NA"));
    const start = await waveStarted(root);
    await decided(root, start, { step: "start", choice: "build" });
    await playedSideBySide(root, start.id, wavePlayers(root));
    const card = cardOf(await shown(root, start.id));
    const printed = flowing(await printedCard(root, card.id));
    assert.ok(
      printed.includes(
        "Merge is not offered: no slice passed its own proof; left out: NA (The na mode counts what was added)",
      ),
      printed,
    );
    assert.ok(printed.includes("no combined head: no slice passed its own proof"), printed);
    await decided(root, card, { step: "card", choice: "keep" });
    assert.deepEqual(branches(root), ["forge/NA-3", "forge/NA-tests-3"]);
    assert.deepEqual(worktrees(root), []);
    assert.deepEqual(keptRows(root), []);
  });

  test("a wave stopped after a slice failed as a run forgets every kept test", async () => {
    const root = await project(template);
    await planOnInto(root, ["SA"]);
    const start = await waveStarted(root);
    await decided(root, start, { step: "start", choice: "build" });
    await playedSideBySide(root, start.id, wavePlayers(root));
    assert.deepEqual(keptSlices(root), ["SA"]);
    const stopped = runOf(await bay(root, ["resume", start.id, "--stop"]));
    assert.ok(["undone", "failed"].includes(textAt(stopped, "status")), JSON.stringify(stopped));
    assert.deepEqual(keptRows(root), []);
    assert.deepEqual(branches(root), ["forge/SA", "forge/SA-tests-1"]);
    const left = branches(root).map((branch) => ({ branch, commit: git(root, ["rev-parse", branch]).trim() }));
    const again = await waveStarted(root);
    const said = flowing(await printedCard(root, again.id, "Build wave"));
    const short = left.map((each) => each.commit.slice(0, 7));
    assert.ok(said.includes(`an earlier run left forge/SA at ${short[0] ?? ""}`), said);
    assert.ok(said.includes(`an earlier run left forge/SA-tests-1 at ${short[1] ?? ""}`), said);
    assert.ok(said.includes("why: An earlier run left branches of this wave; build over them or stop."), said);
    await decided(root, again, { step: "start", choice: "build-over" });
    assert.deepEqual(await actionOutputs(root, again.id, "wave-begin"), [{ choice: "build-over", slices: ["SA"] }]);
    assert.deepEqual(await actionOutputs(root, again.id, "attempt"), [{ dropped: left }]);
    assert.deepEqual(branches(root), ["forge/SA"]);
  });
});
