import assert from "node:assert/strict";
import { test } from "node:test";
import { mostPrinted, printedParts } from "../scripts/kinds/printed.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";
import type { RunsInCopy } from "../scripts/kinds/command-run.ts";

function judged(runs: RunsInCopy): Verdict {
  return verdictOf("tried", "printed", printedParts(runs));
}

test("printed: passed when every run ended, handing back only the last run's exit code and what it printed", () => {
  const runs: RunsInCopy = {
    copied: true,
    runs: [
      { ran: "ended", exitCode: 0, stdout: '{"ok":true}\n' },
      { ran: "ended", exitCode: 1, stdout: '{"ok":false}\n' },
    ],
  };
  assert.deepEqual(judged(runs), {
    item: "tried",
    kind: "printed",
    verdict: "passed",
    detail: "Every run ended and the last printed what is handed back: 2 of 2.",
    printed: { exitCode: 1, stdout: '{"ok":false}\n' },
  });
});

test("printed: inconclusive when an earlier run is not known, naming it by its number, and nothing printed is handed back", () => {
  const runs: RunsInCopy = {
    copied: true,
    runs: [
      { ran: "not known", reason: "It printed more than proof reads." },
      { ran: "ended", exitCode: 0, stdout: "last\n" },
    ],
  };
  assert.deepEqual(judged(runs), {
    item: "tried",
    kind: "printed",
    verdict: "inconclusive",
    reason: "Run 1 of 2 is not known. It printed more than proof reads.",
  });
});

test("printed: a last run that printed more than proof hands back makes the item inconclusive; at the bound it passes", () => {
  const at = judged({ copied: true, runs: [{ ran: "ended", exitCode: 0, stdout: "x".repeat(mostPrinted) }] });
  assert.equal(at.verdict, "passed");
  const past = judged({ copied: true, runs: [{ ran: "ended", exitCode: 0, stdout: "x".repeat(mostPrinted + 1) }] });
  assert.deepEqual(past, {
    item: "tried",
    kind: "printed",
    verdict: "inconclusive",
    reason: "Run 1 of 1 printed more than the 20000 characters proof hands back for the kind printed.",
  });
});

test("printed: inconclusive with the worktrees interface's reason when the copy was not made", () => {
  assert.deepEqual(judged({ copied: false, reason: "No copy of head could be made: no such commit." }), {
    item: "tried",
    kind: "printed",
    verdict: "inconclusive",
    reason: "No copy of head could be made: no such commit.",
  });
});

test("printed: a verdict of another kind never carries what was printed", () => {
  const verdict = verdictOf("other", "checks", { parts: [{ verdict: "passed" }], whenPassed: "Held." });
  assert.deepEqual(verdict, { item: "other", kind: "checks", verdict: "passed", detail: "Held." });
});
