import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json, ScriptContext } from "../../../../bay/sdk.ts";
import { ProofStep } from "../scripts/lib/step.ts";
import { checkRun, testRun } from "../scripts/lib/toolchain.ts";

type Asked = (readonly [string, Json])[];

const notHere = { ok: false, kind: "failed", message: "This test does not answer it." } as const;

const stoppedCheck = "The check lint did not finish within 1770 seconds and was stopped.";

const stoppedRun = "The test run did not finish within 2400 seconds and was stopped.";

function contextOf(asked: Asked, answers: Readonly<Record<string, Json>>): ScriptContext {
  const unanswered = (): Promise<typeof notHere> => Promise.resolve(notHere);
  const statements = { execute: unanswered, query: unanswered };
  return {
    db: { ...statements, partition: () => ({ ...statements, migrate: unanswered, agentQuery: unanswered }) },
    files: {
      read: unanswered,
      write: unanswered,
      list: unanswered,
      makeFolder: unanswered,
      link: unanswered,
      remove: unanswered,
    },
    secrets: { get: unanswered },
    http: { request: unanswered },
    events: { emit: unanswered },
    commands: { run: unanswered },
    call: (reference, input) => {
      asked.push([reference, input]);
      const answer = answers[reference];
      return Promise.resolve(answer === undefined ? notHere : { ok: true, value: answer });
    },
    schemas: { check: unanswered, checkAgainst: unanswered },
    settings: { stepSeconds: 3600, longestCallSeconds: 2400 },
    now: () => new Date("2026-11-20T10:00:00Z"),
    spend: unanswered,
    caller: undefined,
    skillInput: undefined,
  };
}

const checksStopped: Json = {
  verdicts: [
    { name: "lint", verdict: "inconclusive", reason: stoppedCheck, seconds: 1770.1, stdout: "", stderr: "" },
    { name: "types", verdict: "inconclusive", reason: "It ended oddly.", seconds: 3, stdout: "", stderr: "" },
  ],
};

const testStoppedEarly: Json = {
  verdict: "inconclusive",
  reason: "The test run did not finish within 1761 seconds and was stopped.",
  seconds: 1761,
  stdout: "",
  stderr: "",
};

const testStopped: Json = { verdict: "inconclusive", reason: stoppedRun, seconds: 2400, stdout: "", stderr: "" };

test("a check and a test run stopped at the limits a project set say what proof asked for and which setting raises it", async () => {
  const asked: Asked = [];
  const step = new ProofStep(
    contextOf(asked, { "toolchain.check": checksStopped, "toolchain.test": testStoppedEarly }),
  );
  const checks = await checkRun(step, ".forge/copies/a", 2);
  const tests = await testRun(step, ".forge/copies/a");
  assert.deepEqual(asked, [
    ["toolchain.check", { folder: ".forge/copies/a", timeLimitSeconds: 1770 }],
    ["toolchain.test", { folder: ".forge/copies/a", timeLimitSeconds: 1761 }],
  ]);
  assert.deepEqual(checks, {
    ran: "ended",
    verdicts: [
      {
        name: "lint",
        verdict: "inconclusive",
        reason:
          `${stoppedCheck} Proof asked for 1770 seconds, what its step of 3600 seconds had left for it; ` +
          "settings.proof.stepSeconds in agentbay.config.yaml raises the step.",
      },
      { name: "types", verdict: "inconclusive", reason: "It ended oddly." },
    ],
  });
  assert.deepEqual(tests, {
    ran: "inconclusive",
    reason:
      "The test run did not finish within 1761 seconds and was stopped. Proof asked for 1761 seconds, " +
      "what its step of 3600 seconds had left for it; settings.proof.stepSeconds in agentbay.config.yaml raises the step.",
  });
});

test("a test run asked first gets the longest call a project set, and stopped there names that setting", async () => {
  const asked: Asked = [];
  const step = new ProofStep(contextOf(asked, { "toolchain.test": testStopped }));
  assert.deepEqual(await testRun(step, ".forge/copies/b"), {
    ran: "inconclusive",
    reason:
      `${stoppedRun} Proof asked for 2400 seconds, the most it asks for one call; ` +
      "settings.proof.longestCallSeconds in agentbay.config.yaml raises it.",
  });
  assert.deepEqual(asked, [["toolchain.test", { folder: ".forge/copies/b", timeLimitSeconds: 2400 }]]);
});
