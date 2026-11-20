import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fieldsOf, readYaml } from "../../../../bay/sdk.ts";
import { noTimeLeftSentence, reasonWithTheLimit, secondsToAsk, timeLimitsOf } from "../scripts/lib/step.ts";
import { broken, held, unknown, verdictOf } from "../scripts/lib/verdicts.ts";

test("an item whose parts all passed is passed, with the sentence for a pass", () => {
  assert.deepEqual(verdictOf("DOD-1", "checks", { parts: [held, held], whenPassed: "Every part held." }), {
    item: "DOD-1",
    kind: "checks",
    verdict: "passed",
    detail: "Every part held.",
  });
});

test("an item with a failed part is failed, with each failed part's sentence", () => {
  const found = { parts: [held, broken("The first broke."), broken("The second broke.")] as const, whenPassed: "x" };
  assert.deepEqual(verdictOf("DOD-1", "fails-first", found), {
    item: "DOD-1",
    kind: "fails-first",
    verdict: "failed",
    detail: "The first broke. The second broke.",
  });
});

test("an inconclusive part beside a failed one makes the item inconclusive, and the failure is not shown (open question 8)", () => {
  const found = { parts: [broken("It broke."), unknown("It did not finish."), held] as const, whenPassed: "x" };
  assert.deepEqual(verdictOf("DOD-1", "checks", found), {
    item: "DOD-1",
    kind: "checks",
    verdict: "inconclusive",
    reason: "It did not finish.",
  });
});

const byDefault = timeLimitsOf({});

const forTheKit = timeLimitsOf({ stepSeconds: 3600, longestCallSeconds: 2400 });

test("a project that sets no time limits gives proof's step 1800 seconds and a call at most 1000, and a project's own limits are used as given", () => {
  assert.deepEqual(
    [timeLimitsOf({}), forTheKit, timeLimitsOf({ stepSeconds: 600 }), timeLimitsOf({ longestCallSeconds: 7 })],
    [
      { stepSeconds: 1800, longestCallSeconds: 1000 },
      { stepSeconds: 3600, longestCallSeconds: 2400 },
      { stepSeconds: 600, longestCallSeconds: 1000 },
      { stepSeconds: 1800, longestCallSeconds: 7 },
    ],
  );
});

test("a toolchain call is asked what is left of proof's step, less the 60 seconds kept, and never more than its longest call", () => {
  const asked = [0, 739, 740, 1000, 1739.5, 1740, 2000].map((spent) => secondsToAsk(byDefault, spent, 1));
  assert.deepEqual(asked, [1000, 1000, 1000, 740, 0, 0, 0]);
  const askedByTheKit = [0, 1140, 1141, 3539, 3540].map((spent) => secondsToAsk(forTheKit, spent, 1));
  assert.deepEqual(askedByTheKit, [2400, 2400, 2399, 1, 0]);
});

test("a check call shares what is left among its checks, each asked at most its longest call", () => {
  const asked = [0, 1000, 1740].map((spent) => secondsToAsk(byDefault, spent, 5));
  assert.deepEqual(asked, [348, 148, 0]);
  assert.equal(secondsToAsk(byDefault, 0, 1), 1000);
  assert.equal(secondsToAsk(forTheKit, 0, 5), 708);
});

test("the most seconds a project may give proof's step are the seconds its manifest declares for prove", async () => {
  const manifest = await readFile(join(import.meta.dirname, "..", "mode.yaml"), "utf8");
  const declared = Number(/scriptTimeLimitSeconds: (\d+)/.exec(manifest)?.[1]);
  const settings = readYaml(await readFile(join(import.meta.dirname, "..", "schemas", "settings.json"), "utf8"));
  assert.ok(settings.ok);
  const stepSeconds = fieldsOf(fieldsOf(settings.value).properties ?? null).stepSeconds ?? null;
  assert.deepEqual([declared, fieldsOf(stepSeconds).maximum], [7200, 7200]);
});

test("a run stopped at its limit says what proof asked for and which setting raises it, and a run that ended sooner is left as it was", () => {
  const stopped = "The test run did not finish within 1000 seconds and was stopped.";
  assert.deepEqual(
    [
      reasonWithTheLimit(stopped, byDefault, { askedSeconds: 1000, tookSeconds: 1000.2 }),
      reasonWithTheLimit(stopped, byDefault, { askedSeconds: 640, tookSeconds: 640 }),
      reasonWithTheLimit("The run reported no tests.", byDefault, { askedSeconds: 1000, tookSeconds: 999.9 }),
    ],
    [
      `${stopped} Proof asked for 1000 seconds, the most it asks for one call; ` +
        "settings.proof.longestCallSeconds in agentbay.config.yaml raises it.",
      `${stopped} Proof asked for 640 seconds, what its step of 1800 seconds had left for it; ` +
        "settings.proof.stepSeconds in agentbay.config.yaml raises the step.",
      "The run reported no tests.",
    ],
  );
  assert.equal(
    noTimeLeftSentence(forTheKit, "made"),
    "Proof's own step of 3600 seconds had no time left for it, so it was not made; " +
      "settings.proof.stepSeconds in agentbay.config.yaml raises the step.",
  );
});
