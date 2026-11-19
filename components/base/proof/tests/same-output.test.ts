import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandRun } from "../scripts/kinds/command-run.ts";
import { sameOutputParts, type CommandRuns } from "../scripts/kinds/same-output.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

const printed: CommandRun = { ran: "ended", exitCode: 0, stdout: "sound checks\n" };

const printedLouder: CommandRun = {
  ran: "ended",
  exitCode: 0,
  stdout: "sound checks, louder\n",
};

const endedOtherwise: CommandRun = {
  ran: "ended",
  exitCode: 1,
  stdout: "sound checks\n",
};

const stopped: CommandRun = {
  ran: "not known",
  reason: "It was stopped by the signal SIGKILL.",
};

function same(name: string): CommandRuns {
  return { name, base: printed, head: printed };
}

function judged(differ: readonly string[], commands: readonly CommandRuns[]): Verdict {
  return verdictOf("output", "same-output", sameOutputParts(differ, { found: "ran", commands }));
}

test("same-output: passed when every command not named prints the same and every named one differs", () => {
  const commands = [same("sound-check"), { name: "grants-check", base: printed, head: printedLouder }];
  assert.deepEqual(judged(["grants-check"], commands), {
    item: "output",
    kind: "same-output",
    verdict: "passed",
    detail: "Every declared command printed as the item says: 2 of 2, and 1 of them differs as named.",
  });
  assert.deepEqual(judged([], [same("sound-check")]), {
    item: "output",
    kind: "same-output",
    verdict: "passed",
    detail: "Every declared command printed as the item says: 1 of 1, and 0 of them differ as named.",
  });
});

test("same-output: failed when a command not named prints otherwise or ends otherwise, and the detail names it and not its output", () => {
  const commands = [
    { name: "sound-check", base: printed, head: printedLouder },
    { name: "grants-check", base: printed, head: endedOtherwise },
    same("debt-check"),
  ];
  assert.deepEqual(judged([], commands), {
    item: "output",
    kind: "same-output",
    verdict: "failed",
    detail:
      "sound-check printed or ended otherwise at the head than at the base. " +
      "grants-check printed or ended otherwise at the head than at the base.",
  });
});

test("same-output: failed when a command named in differ printed the same at the base and the head", () => {
  assert.deepEqual(judged(["sound-check"], [same("sound-check"), same("debt-check")]), {
    item: "output",
    kind: "same-output",
    verdict: "failed",
    detail: "sound-check printed the same at the base and the head, though the item says it differs.",
  });
});

test("same-output: inconclusive when a run is not known on either side, even beside a command that failed", () => {
  const commands = [
    { name: "sound-check", base: printed, head: stopped },
    { name: "grants-check", base: stopped, head: printed },
    { name: "debt-check", base: printed, head: printedLouder },
  ];
  assert.deepEqual(judged([], commands), {
    item: "output",
    kind: "same-output",
    verdict: "inconclusive",
    reason:
      "The output of sound-check at the head is not known. It was stopped by the signal SIGKILL. " +
      "The output of grants-check at the base is not known. It was stopped by the signal SIGKILL.",
  });
});

test("same-output: inconclusive with the interface's sentence when the project declares no commands", () => {
  assert.deepEqual(
    verdictOf("output", "same-output", sameOutputParts(["sound-check"], { found: "ran", commands: [] })),
    {
      item: "output",
      kind: "same-output",
      verdict: "inconclusive",
      reason: "This project declares no commands whose output must not change, so nothing is known.",
    },
  );
});

test("same-output: inconclusive when the item names commands the project does not declare, counted and not named", () => {
  assert.deepEqual(judged(["made-up", "also-made-up"], [same("sound-check")]), {
    item: "output",
    kind: "same-output",
    verdict: "inconclusive",
    reason: "The item names 2 commands in differ that the project does not declare, so nothing is known.",
  });
  assert.deepEqual(judged(["sound-check", "made-up"], [same("sound-check")]), {
    item: "output",
    kind: "same-output",
    verdict: "inconclusive",
    reason: "The item names 1 command in differ that the project does not declare, so nothing is known.",
  });
});

test("same-output: inconclusive with the worktrees interface's reason when a copy was not made", () => {
  const evidence = {
    found: "not copied",
    reason: "No copy of base could be made: no such commit.",
  } as const;
  assert.deepEqual(verdictOf("output", "same-output", sameOutputParts([], evidence)), {
    item: "output",
    kind: "same-output",
    verdict: "inconclusive",
    reason: "No copy of base could be made: no such commit.",
  });
});
