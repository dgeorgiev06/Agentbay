import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Runs } from "../bay/runs/runs.ts";
import {
  answer,
  crashingOnce,
  failure,
  finished,
  messagesOf,
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

const keepStep = { id: "keep", approval: "Send?", show: "$settings.greeting" };

const redactedHash = "96ea0fed2d8b3e13e8704f4cc6d72c6d834804e0ac050d88b6fdc05914260622";

const clearHash = "db5b10692f2ff8484a8c6e69cd8d5ebda1c38fde0fab854a467de69b0d4c9b5e";

const redactedApproval = {
  reason: "approval",
  stepKey: "keep",
  question: "Send?",
  hash: redactedHash,
  content: `hi ${redacted}`,
};

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

  test("an approval shows its content redacted, and a fresh show gives the same content and hash", async () => {
    const keep = withFlow([keepStep]);
    const { runs, reopen, close } = await openedRuns({ changes: { ...keep, config: greetingWithSecret } });
    const started = await runs.start(flow, null);
    const id = runOf(started).id;
    assert.deepEqual(waitingOf(started), redactedApproval);
    assert.ok(!JSON.stringify(runOf(started)).includes(secretValue));
    const fresh = await reopen();
    assert.deepEqual(waitingOf(await fresh.show(id)), redactedApproval);
    const clear = { stepKey: "keep", hash: clearHash, verdict: "approve", by: "owner" } as const;
    assert.match(messagesOf(await fresh.approve(id, clear)), /is not the hash of what step keep showed/);
    const decision = { stepKey: "keep", hash: redactedHash, verdict: "approve", by: `owner ${secretValue}` } as const;
    assert.deepEqual(runOf(await fresh.approve(id, decision)).state, { status: "done", output: `hi ${redacted}` });
    const stored = runOf(await (await reopen()).show(id));
    assert.equal(stored.steps[0]?.input, `hi ${redacted}`);
    const recorded = stored.events.find((event) => event.kind === "approval.recorded");
    assert.deepEqual(recorded?.detail, {
      stepKey: "keep",
      hash: redactedHash,
      decision: "approve",
      by: `owner ${redacted}`,
    });
    assert.ok(!JSON.stringify(stored).includes(secretValue));
    close();
  });
});

function assertRedactedApproval(result: Awaited<ReturnType<Runs["show"]>>): void {
  assert.deepEqual(waitingOf(result), redactedApproval);
  assert.ok(!JSON.stringify(runOf(result)).includes(secretValue), JSON.stringify(result));
}

describe("every call that brings a run to an approval returns its content redacted", () => {
  test("resume after a crash before the approval", async () => {
    const scripts = { "notes:scripts/double.ts": crashingOnce((request) => finished(request.input)) };
    const steps = [{ id: "first", action: "copy", input: { count: 1 } }, keepStep];
    const { runs, close } = await openedRuns({ scripts, changes: { ...withFlow(steps), config: greetingWithSecret } });
    assert.match(messagesOf(await runs.start(flow, null)), /the process died/);
    const id = (await runs.list())[0]?.id ?? "";
    assertRedactedApproval(await runs.resume(id));
    close();
  });

  test("submit whose next step is an approval", async () => {
    const steps = [{ id: "draft", action: "draft" }, keepStep];
    const { runs, close } = await openedRuns({ changes: { ...withFlow(steps), config: greetingWithSecret } });
    const started = runOf(await runs.start(flow, null));
    assertRedactedApproval(await runs.submit(tokenOf(started), answer({ text: "a long enough draft" })));
    close();
  });

  test("wakeDue after a wait", async () => {
    const steps = [{ id: "pause", wait: "1m" }, keepStep];
    const { runs, clock, close } = await openedRuns({ changes: { ...withFlow(steps), config: greetingWithSecret } });
    runOf(await runs.start(flow, null));
    clock.advance(60_000);
    const [woken, ...others] = await runs.wakeDue();
    assert.deepEqual(others, []);
    assert.ok(woken);
    assertRedactedApproval(woken);
    close();
  });

  test("approve of an earlier approval", async () => {
    const steps = [{ id: "first", approval: "Begin?" }, keepStep];
    const { runs, close } = await openedRuns({ changes: { ...withFlow(steps), config: greetingWithSecret } });
    const started = await runs.start(flow, null);
    const first = waitingOf(started);
    assert.ok(first.reason === "approval");
    const decision = { stepKey: "first", hash: first.hash, verdict: "approve", by: "owner" } as const;
    assertRedactedApproval(await runs.approve(runOf(started).id, decision));
    close();
  });

  test("extend of a run that waits for budget", async () => {
    const steps = [{ id: "spend", action: "spend", input: { measure: "items" } }, keepStep];
    const config = { ...greetingWithSecret, budget: { items: 1 } };
    const { runs, close } = await openedRuns({ changes: { ...withFlow(steps), config } });
    const started = await runs.start(flow, null);
    assert.equal(waitingOf(started).reason, "budget");
    assertRedactedApproval(await runs.extend(runOf(started).id, { items: 5 }));
    close();
  });
});
