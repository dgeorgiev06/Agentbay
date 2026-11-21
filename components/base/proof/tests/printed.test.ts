import assert from "node:assert/strict";
import { test } from "node:test";
import { printedParts } from "../scripts/kinds/printed.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";
import type { RunsInCopy } from "../scripts/kinds/command-run.ts";

function judged(runs: RunsInCopy): Verdict {
  return verdictOf("tried", "printed", printedParts(runs));
}

test("printed: passed when every run ended, handing back each run's exit code and what it printed, in order", () => {
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
    detail: "Every run ended and what it printed was read whole: 2 of 2.",
    printed: [
      { exitCode: 0, stdout: '{"ok":true}\n' },
      { exitCode: 1, stdout: '{"ok":false}\n' },
    ],
  });
});

test("printed: inconclusive when a run is not known, naming it by its number, and nothing printed is handed back", () => {
  const runs: RunsInCopy = {
    copied: true,
    runs: [
      { ran: "ended", exitCode: 0, stdout: "first\n" },
      { ran: "not known", reason: "It printed more than proof reads." },
    ],
  };
  assert.deepEqual(judged(runs), {
    item: "tried",
    kind: "printed",
    verdict: "inconclusive",
    reason: "Run 2 of 2 is not known. It printed more than proof reads.",
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
