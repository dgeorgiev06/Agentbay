import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

type Ran = { readonly passed: readonly string[]; readonly failed: readonly string[]; readonly output: string };

const caseOfThisMode = "proof@1, proof: ";

const sharedTestMilliseconds = 15 * 60_000;

const notBuilt: readonly string[] = [
  "in-scope: the item scope is passed when every changed path, and the old path of every move, matches the write scope",
  "in-scope: a path outside the scope fails the item scope and is named, also one that only starts like a folder of the scope and the old path of a move (K3)",
  "as-declared: the item declared is passed when the changed files and the changed action names are those declared (TR2)",
  "as-declared: a file declared and not changed and one changed and not declared fail the item declared with counts, never the builder's text (V2)",
  "as-declared: an action name declared as changed that did not change, and one that did, fail the item declared with counts (V2)",
  "as-declared: a move declared by its new path alone fails the item declared, since a move changes its old path too",

  "bugs-caught: passed when the covering tests fail with each bug applied (TR2, K1)",
  "bugs-caught: a bug that survives fails the item and is named (K2)",
  "bugs-caught: a bug whose patch does not apply makes the item inconclusive, with a reason that names the bug and says it could not be applied, never passed or failed",
  "a bug's run is a copy of the head with only that bug applied, and runs only the bug's covering test files",

  "same-output: passed when every declared command prints the same at the base and the head, and those the item names differ (TR2, K1)",
  "same-output: failed when a declared command prints otherwise at the head and the item does not name it",
  "same-output: in a project that declares no commands it is inconclusive with the sentence that says so (K6)",
  "real-thing: passed when every run in a fresh copy of the head printed the expected text and exit code",
  "real-thing: failed when a run printed other than the expected text",

  "count: passed when the head has at most the most, and when a declared count did not rise (TR2, K1)",
  "count: failed when the head has more than the most",
];

function casesEnded(output: string, how: "ok" | "not ok"): readonly string[] {
  const ended = [...output.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].filter((match) => match[1] === how);
  return ended.flatMap((match) => {
    const name = match[2] ?? "";
    return name.startsWith(caseOfThisMode) ? [name.slice(caseOfThisMode.length)] : [];
  });
}

function sharedTestRan(): Promise<Ran> {
  const file = join(import.meta.dirname, "shared-run.ts");
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", file], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeout: sharedTestMilliseconds,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  return new Promise((resolve) => {
    child.on("close", () => {
      resolve({ passed: casesEnded(output, "ok"), failed: casesEnded(output, "not ok"), output });
    });
  });
}

test("proof passes every case of proof@1's shared test but those of the kinds not built yet, which are named here and fail", async () => {
  const ran = await sharedTestRan();
  assert.deepEqual([...ran.failed].sort(), [...notBuilt].sort(), ran.output);
  assert.ok(ran.passed.length > 0, ran.output);
});
