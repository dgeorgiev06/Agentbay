import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { testProof } from "../../interfaces/proof/tests/shared.ts";

type Ran = { readonly passed: readonly string[]; readonly failed: readonly string[]; readonly output: string };

const sharedRunVariable = "PROOF_SHARED_TEST_ALONE";

const caseOfThisMode = "proof@1, proof: ";

const sharedTestMilliseconds = 15 * 60_000;

function casesEnded(output: string, how: "ok" | "not ok"): readonly string[] {
  const ended = [...output.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].filter((match) => match[1] === how);
  return ended.flatMap((match) => {
    const name = match[2] ?? "";
    return name.startsWith(caseOfThisMode) ? [name.slice(caseOfThisMode.length)] : [];
  });
}

function sharedTestRan(): Promise<Ran> {
  const file = join(import.meta.dirname, "proof.test.ts");
  const child = spawn(process.execPath, ["--test", "--test-reporter=tap", file], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", [sharedRunVariable]: "yes" },
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

if (process.env[sharedRunVariable] === "yes") {
  testProof({ mode: "proof" });
} else {
  test("proof passes every case of proof@1's shared test", async () => {
    const ran = await sharedTestRan();
    assert.deepEqual(ran.failed, [], ran.output);
    assert.ok(ran.passed.length > 0, ran.output);
  });
}
