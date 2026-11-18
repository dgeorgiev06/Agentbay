import assert from "node:assert/strict";
import { test } from "node:test";
import type { BayRun } from "../scripts/kinds/bay-run.ts";
import { realThingParts } from "../scripts/kinds/real-thing.ts";
import type { RealRun } from "../scripts/lib/request.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

const expected: readonly RealRun[] = [
  { bay: ["print", "src/main/sum.txt"], stdout: "5\n", exitCode: 0 },
  { bay: ["check"], stdout: "Nothing found.\n", exitCode: 1 },
];

function judged(runs: readonly BayRun[]): Verdict {
  return verdictOf("real", "real-thing", realThingParts(expected, { found: "ran", runs }));
}

test("real-thing: passed when every run printed exactly the expected text and ended with the expected exit code", () => {
  const runs: readonly BayRun[] = [
    { ran: "ended", exitCode: 0, stdout: "5\n" },
    { ran: "ended", exitCode: 1, stdout: "Nothing found.\n" },
  ];
  assert.deepEqual(judged(runs), {
    item: "real",
    kind: "real-thing",
    verdict: "passed",
    detail: "Every run printed the expected text and ended with the expected exit code: 2 of 2.",
  });
});

test("real-thing: failed when a run printed other text or ended with another exit code, and the detail holds no output", () => {
  const runs: readonly BayRun[] = [
    { ran: "ended", exitCode: 0, stdout: "5" },
    { ran: "ended", exitCode: 0, stdout: "Nothing found.\n" },
  ];
  assert.deepEqual(judged(runs), {
    item: "real",
    kind: "real-thing",
    verdict: "failed",
    detail: "Run 1 of 2 printed other than the item expects. Run 2 of 2 ended with the exit code 0, not 1.",
  });
});

test("real-thing: a run that printed other text and ended otherwise is named for both", () => {
  const runs: readonly BayRun[] = [
    { ran: "ended", exitCode: 0, stdout: "5\n" },
    { ran: "ended", exitCode: 2, stdout: "" },
  ];
  assert.deepEqual(judged(runs), {
    item: "real",
    kind: "real-thing",
    verdict: "failed",
    detail: "Run 2 of 2 printed other than the item expects. Run 2 of 2 ended with the exit code 2, not 1.",
  });
});

test("real-thing: inconclusive when a run is not known, even beside a run that failed", () => {
  const runs: readonly BayRun[] = [
    { ran: "ended", exitCode: 0, stdout: "6\n" },
    { ran: "not known", reason: "./bay.sh check did not finish within 30 seconds." },
  ];
  assert.deepEqual(judged(runs), {
    item: "real",
    kind: "real-thing",
    verdict: "inconclusive",
    reason: "Run 2 of 2 is not known: ./bay.sh check did not finish within 30 seconds.",
  });
});

test("real-thing: inconclusive with the worktrees interface's reason when the copy was not made", () => {
  const evidence = { found: "not copied", reason: "No copy of head could be made: no such commit." } as const;
  assert.deepEqual(verdictOf("real", "real-thing", realThingParts(expected, evidence)), {
    item: "real",
    kind: "real-thing",
    verdict: "inconclusive",
    reason: "No copy of head could be made: no such commit.",
  });
});
