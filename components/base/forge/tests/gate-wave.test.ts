import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedOf,
  decided,
  kitTemplate,
  listOf,
  modeGateTestsOfTheKit,
  printedCard,
  project,
  removeAll,
  scopePassed,
  shown,
  testsFromAsked,
  waitingOf,
  type Proved,
} from "./kit-copy.ts";
import { playedSideBySide } from "./side-by-side-play.ts";
import {
  checksPassed,
  ownPassed,
  plannedSlice,
  provedAs,
  slicesPlannedOnInto,
  testPath,
  wavePlayers,
  waveStarted,
} from "./wave-run.ts";

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

function flowing(rows: readonly string[]): string {
  return rows.join(" ").replace(/\s+/g, " ");
}

function combinedPassed(): Proved {
  const detail =
    "Every check passed (typecheck, lint), and so did the run of the 5 test files chosen from testsFrom: 9 tests. " +
    "bay check on the head found no error.";
  const checks = { item: "checks", kind: "checks", verdict: "passed", detail };
  return { ...checksPassed("checks"), verdicts: [checks, scopePassed] };
}

function inBase(name: string): Json {
  const planned = fieldsOf(plannedSlice(name));
  const slice = fieldsOf(planned.slice ?? null);
  return { ...planned, slice: { ...slice, scope: [`components/base/${name.toLowerCase()}/**`] } };
}

describe("the gate a wave runs by", { concurrency: true }, () => {
  test("a wave of one mode's slice: the start card names the mode gate, proof gets the mode's tests and the setting's, and the merge card says the mode gate ran", async () => {
    const root = await project(template);
    await slicesPlannedOnInto(root, [plannedSlice("TD1")]);
    await provedAs(root, "TD1", ownPassed("TD1"));
    await provedAs(root, "wave-1.checks", combinedPassed());
    const start = await waveStarted(root);
    const startSaid = flowing(await printedCard(root, start.id, "Build "));
    const gate =
      "gate: the mode's own tests and the fast checks of the whole project, since TD1 writes only inside " +
      "components/modes/td1; the other tests are not run";
    assert.ok(startSaid.includes(gate), startSaid);
    assert.ok(!startSaid.includes("whole test run"), startSaid);
    await decided(root, start, { step: "start", choice: "build" });
    await playedSideBySide(root, start.id, wavePlayers(root));
    const card = waitingOf(await shown(root, start.id), "card");
    assert.deepEqual(testsFromAsked(await askedOf(root, "wave-1")), [[testPath("TD1"), ...modeGateTestsOfTheKit]]);
    const said = flowing(await printedCard(root, card.id));
    assert.ok(said.includes("gate: the mode's own tests and the fast checks of the whole project ran"), said);
    assert.ok(said.includes("bay check on the head found no error"), said);
    const asked = (await askedOf(root, "wave-1"))[0] ?? null;
    const proof = fieldsOf(listOf(fieldsOf(fieldsOf(asked).slice ?? null).done)[0] ?? null).proof ?? null;
    assert.equal(fieldsOf(proof).bayCheck, true);
    assert.ok(said.includes("Merge is offered for 1 of 1 slice"), said);
  });

  test("a wave with a slice in a base mode's folder: the start card names the whole test run and why", async () => {
    const root = await project(template);
    await slicesPlannedOnInto(root, [plannedSlice("TD1"), inBase("TB")]);
    const start = await waveStarted(root);
    const said = flowing(await printedCard(root, start.id, "Build "));
    assert.ok(
      said.includes("gate: the whole test run, since TB writes outside a mode's folder (components/base/tb/**)"),
      said,
    );
    assert.ok(!said.includes("the mode's own tests"), said);
  });
});
