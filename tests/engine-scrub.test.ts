import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { answer, failure, harness, notesFlow, runOf, secretValue, waitingOf, withFlow } from "./engine-fixture.ts";

const redacted = "[redacted:NOTES_TOKEN]";

const gitHubToken = `ghp_${"a1B2".repeat(9)}`;

const greetingWithSecret = { settings: { notes: { greeting: `hi ${secretValue}` } } };

describe("secrets are scrubbed before they reach the store", () => {
  test("a submitted output is stored redacted, and the next step receives the redacted value", async () => {
    const { engine, store, runner, close } = await harness();
    const id = runOf(await engine.startAction("notes.draft-and-store", {})).id;
    const output = { id: "d1", text: `the key is ${secretValue}`, nested: [gitHubToken] };
    const run = runOf(await engine.submit(id, "0#1", answer(output)));
    assert.equal(run.state.status, "done");
    const stored = JSON.stringify(await store.readRun(id));
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
    const { engine, store, close } = await harness({ scripts });
    const run = runOf(await engine.startAction("notes.copy", { count: 1 }));
    assert.deepEqual(run.state, { status: "failed", reason: `refused token ${redacted}` });
    const stored = await store.readRun(run.id);
    assert.deepEqual(stored?.state, { status: "failed", reason: `refused token ${redacted}` });
    const failedStep = stored.steps.find((step) => step.key === "1");
    assert.ok(failedStep?.status === "failed");
    assert.equal(failedStep.reason, `refused token ${redacted}`);
    close();
  });

  test("a step refused before it starts is stored at once, redacted, with its start and its failure", async () => {
    const flow = withFlow([{ id: "each", foreach: "$settings.greeting", steps: [{ id: "keep", approval: "Send?" }] }]);
    const { engine, store, close } = await harness({ changes: { ...flow, config: greetingWithSecret } });
    const run = runOf(await engine.startWorkflow(notesFlow, null));
    assert.equal(run.state.status, "failed");
    const stored = await store.readRun(run.id);
    const refused = stored?.steps.find((step) => step.key === "each");
    assert.ok(refused?.status === "failed");
    assert.equal(refused.detail, null);
    assert.match(refused.reason, /which is the value "hi \[redacted:NOTES_TOKEN\]", not a list/);
    assert.ok(!JSON.stringify(stored).includes(secretValue));
    const events = (await store.readEvents(run.id)).filter((event) => JSON.stringify(event.detail).includes('"each"'));
    assert.deepEqual(
      events.map((event) => event.kind),
      ["step.started", "step.failed"],
    );
    close();
  });

  test("approval content and event details are stored redacted", async () => {
    const flow = withFlow([{ id: "keep", approval: "Send?", show: "$settings.greeting" }]);
    const { engine, store, close } = await harness({ changes: { ...flow, config: greetingWithSecret } });
    const waiting = waitingOf(await engine.startWorkflow(notesFlow, null));
    assert.ok(waiting.reason === "approval");
    const approval = { hash: waiting.hash, decision: "approve", by: `owner ${secretValue}` } as const;
    runOf(await engine.approve("run-1", "keep", approval));
    const stored = await store.readRun("run-1");
    assert.equal(stored?.steps[0]?.input, `hi ${redacted}`);
    const events = await store.readEvents("run-1");
    const recorded = events.find((event) => event.kind === "approval.recorded");
    assert.deepEqual(recorded?.detail, {
      stepKey: "keep",
      hash: waiting.hash,
      decision: "approve",
      by: `owner ${redacted}`,
    });
    assert.ok(!JSON.stringify({ stored, events }).includes(secretValue));
    close();
  });
});
