import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  answer,
  failure,
  notesFlow,
  openedRuns,
  runOf,
  secretValue,
  tokenOf,
  waitingOf,
  withFlow,
} from "./runs-fixture.ts";

const redacted = "[redacted:NOTES_TOKEN]";

const gitHubToken = `ghp_${"a1B2".repeat(9)}`;

const greetingWithSecret = { settings: { notes: { greeting: `hi ${secretValue}` } } };

const flow = { workflow: notesFlow };

describe("secrets are scrubbed before they are stored", () => {
  test("a submitted output is stored redacted, and the next step receives the redacted value", async () => {
    const { runs, runner, reopen, close } = await openedRuns();
    const started = runOf(await runs.start({ action: "notes.draft-and-store" }, {}));
    const output = { id: "d1", text: `the key is ${secretValue}`, nested: [gitHubToken] };
    const run = runOf(await runs.submit(tokenOf(started), answer(output)));
    assert.equal(run.state.status, "done");
    const stored = JSON.stringify(runOf(await (await reopen()).show(started.id)));
    assert.ok(!stored.includes(secretValue) && !stored.includes(gitHubToken), stored);
    assert.ok(stored.includes(`the key is ${redacted}`));
    assert.deepEqual(runner.calls[0]?.input, {
      id: "d1",
      text: `the key is ${redacted}`,
      nested: ["[redacted:api-key]"],
    });
    close();
  });

  test("a failure reason is stored redacted in the step and in the run", async () => {
    const scripts = { "notes:scripts/double.ts": () => failure(`refused token ${secretValue}`) };
    const { runs, reopen, close } = await openedRuns({ scripts });
    const run = runOf(await runs.start({ action: "notes.copy" }, { count: 1 }));
    assert.deepEqual(run.state, { status: "failed", reason: `refused token ${redacted}` });
    const stored = runOf(await (await reopen()).show(run.id));
    assert.deepEqual(stored.state, { status: "failed", reason: `refused token ${redacted}` });
    const failedStep = stored.steps.find((step) => step.key === "1");
    assert.ok(failedStep?.status === "failed");
    assert.equal(failedStep.reason, `refused token ${redacted}`);
    close();
  });

  test("a step refused before it starts is stored at once, redacted, with its start and its failure", async () => {
    const each = withFlow([{ id: "each", foreach: "$settings.greeting", steps: [{ id: "keep", approval: "Send?" }] }]);
    const { runs, reopen, close } = await openedRuns({ changes: { ...each, config: greetingWithSecret } });
    const run = runOf(await runs.start(flow, null));
    assert.equal(run.state.status, "failed");
    const stored = runOf(await (await reopen()).show(run.id));
    const refused = stored.steps.find((step) => step.key === "each");
    assert.ok(refused?.status === "failed");
    assert.equal(refused.detail, null);
    assert.match(refused.reason, /which is the value "hi \[redacted:NOTES_TOKEN\]", not a list/);
    assert.ok(!JSON.stringify(stored).includes(secretValue));
    const events = stored.events.filter((event) => JSON.stringify(event.detail).includes('"each"'));
    assert.deepEqual(
      events.map((event) => event.kind),
      ["step.started", "step.failed"],
    );
    close();
  });

  test("approval content and event details are stored redacted", async () => {
    const keep = withFlow([{ id: "keep", approval: "Send?", show: "$settings.greeting" }]);
    const { runs, reopen, close } = await openedRuns({ changes: { ...keep, config: greetingWithSecret } });
    const started = await runs.start(flow, null);
    const id = runOf(started).id;
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    assert.deepEqual(waitingOf(await (await reopen()).show(id)), {
      reason: "approval",
      stepKey: "keep",
      question: "Send?",
      hash: waiting.hash,
      content: null,
    });
    const decision = { stepKey: "keep", hash: waiting.hash, verdict: "approve", by: `owner ${secretValue}` } as const;
    runOf(await runs.approve(id, decision));
    const stored = runOf(await (await reopen()).show(id));
    assert.equal(stored.steps[0]?.input, `hi ${redacted}`);
    const recorded = stored.events.find((event) => event.kind === "approval.recorded");
    assert.deepEqual(recorded?.detail, {
      stepKey: "keep",
      hash: waiting.hash,
      decision: "approve",
      by: `owner ${redacted}`,
    });
    assert.ok(!JSON.stringify(stored).includes(secretValue));
    close();
  });
});
