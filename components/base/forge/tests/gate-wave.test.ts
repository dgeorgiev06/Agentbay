import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedOf,
  decided,
  factsOf,
  kitTemplate,
  listOf,
  modeGateTestsOfTheKit,
  offeredOf,
  project,
  removeAll,
  scopePassed,
  shown,
  testsFromAsked,
  waitingOf,
  type Proved,
  type Waiting,
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

function wordsIn(waiting: Waiting, section: string): readonly string[] {
  return factsOf(waiting, section).map((fact) => fact.words);
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
    const gate =
      "Gate: the mode's own tests and the fast checks of the whole project, since TD1 writes only inside " +
      "components/modes/td1; the other tests are not run.";
    assert.ok(wordsIn(start, "checks").includes(gate), wordsIn(start, "checks").join("\n"));
    assert.ok(!wordsIn(start, "checks").some((words) => words.includes("whole test run")));
    await decided(root, start, { step: "start", choice: "build" });
    await playedSideBySide(root, start.id, wavePlayers(root));
    const card = waitingOf(await shown(root, start.id), "card");
    assert.deepEqual(testsFromAsked(await askedOf(root, "wave-1")), [[testPath("TD1"), ...modeGateTestsOfTheKit]]);
    const short = factsOf(card, "checks")
      .filter((fact) => fact.short)
      .map((fact) => fact.words);
    assert.ok(short.includes("Not run: tests outside the td1 mode."), short.join("\n"));
    assert.ok(
      wordsIn(card, "checks").includes(
        "Gate: the mode's own tests and the fast checks of the whole project ran, since TD1 writes only inside " +
          "components/modes/td1; the other tests were not run.",
      ),
    );
    assert.ok(wordsIn(card, "checks").includes("Bay check on the head found no error."));
    const asked = (await askedOf(root, "wave-1"))[0] ?? null;
    const proof = fieldsOf(listOf(fieldsOf(fieldsOf(asked).slice ?? null).done)[0] ?? null).proof ?? null;
    assert.equal(fieldsOf(proof).bayCheck, true);
    assert.deepEqual(offeredOf(card), ["merge", "keep"]);
    assert.ok(wordsIn(card, "what").includes("In the combined head: 1 of 1 slice."));
  });

  test("a wave with a slice in a base mode's folder: the start card names the whole test run and why", async () => {
    const root = await project(template);
    await slicesPlannedOnInto(root, [plannedSlice("TD1"), inBase("TB")]);
    const start = await waveStarted(root);
    const checks = wordsIn(start, "checks");
    assert.ok(
      checks.includes("Gate: the whole test run, since TB writes outside a mode's folder (components/base/tb/**)."),
      checks.join("\n"),
    );
    assert.ok(!checks.some((words) => words.includes("the mode's own tests")), checks.join("\n"));
  });
});
