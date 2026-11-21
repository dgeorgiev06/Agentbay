import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Runs } from "../bay/runs/runs.ts";
import {
  answer,
  crashingOnce,
  failure,
  finished,
  fixtureSystem,
  messagesOf,
  notesFlow,
  openedRuns,
  runOf,
  secretValue,
  tokenOf,
  waitingOf,
  waitingTask,
  withFlow,
} from "./runs-fixture.ts";

const redacted = "[redacted:NOTES_TOKEN]";

const gitHubToken = `ghp_${"a1B2".repeat(9)}`;

const greetingWithSecret = { settings: { notes: { greeting: `hi ${secretValue}` } } };

const flow = { workflow: notesFlow };

const keepStep = { id: "keep", approval: "Send?", show: "$settings.greeting" };

const redactedHash = "96ea0fed2d8b3e13e8704f4cc6d72c6d834804e0ac050d88b6fdc05914260622";

const clearHash = "db5b10692f2ff8484a8c6e69cd8d5ebda1c38fde0fab854a467de69b0d4c9b5e";

const helloHash = "5aa762ae383fbb727af3c7a36d4940a5b8c40a989452d2304fc958ff3f354e7a";

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

describe("an approval's content is scrubbed again when it is shown", () => {
  test("content that changes to hold a secret is shown redacted, under the hash of the redacted content", async () => {
    const keep = withFlow([keepStep]);
    const { runs, reopen, close } = await openedRuns({ changes: keep });
    const started = await runs.start(flow, null);
    const id = runOf(started).id;
    const first = waitingOf(started);
    assert.ok(first.reason === "approval");
    assert.equal(first.hash, helloHash);
    const edited = await fixtureSystem({ ...keep, config: greetingWithSecret });
    const later = await reopen(edited.system);
    const decision = { stepKey: "keep", verdict: "approve", by: "owner" } as const;
    const back = await later.approve(id, { ...decision, hash: helloHash });
    assert.deepEqual(waitingOf(back), { ...redactedApproval, previousHash: helloHash });
    assert.ok(!JSON.stringify(runOf(back)).includes(secretValue), JSON.stringify(back));
    const run = runOf(await later.approve(id, { ...decision, hash: redactedHash }));
    assert.deepEqual(run.state, { status: "done", output: `hi ${redacted}` });
    close();
  });

  test("content stored before its secret was handed out is not shown once the secret is known", async () => {
    const keep = withFlow([keepStep]);
    const opening = { changes: { ...keep, config: greetingWithSecret }, secretHandedOut: "later" } as const;
    const { runs, handOutSecret, close } = await openedRuns(opening);
    const id = runOf(await runs.start(flow, null)).id;
    await handOutSecret();
    assert.deepEqual(waitingOf(await runs.show(id)), {
      reason: "approval",
      stepKey: "keep",
      question: "Send?",
      hash: clearHash,
      content: null,
    });
    close();
  });
});

function assertRedactedApproval(result: Awaited<ReturnType<Runs["show"]>>): void {
  assert.deepEqual(waitingOf(result), redactedApproval);
  assert.ok(!JSON.stringify(runOf(result)).includes(secretValue), JSON.stringify(result));
}

describe("every call that brings a run to an approval returns its content redacted", () => {
  test("start, where the secret is in a key of the content", async () => {
    const steps = [{ id: "keep", approval: "Send?", show: "$trigger" }];
    const { runs, reopen, close } = await openedRuns({ changes: withFlow(steps) });
    const started = await runs.start(flow, { [`key ${secretValue}`]: 1 });
    const waiting = waitingOf(started);
    assert.ok(waiting.reason === "approval");
    assert.deepEqual(waiting.content, { [`key ${redacted}`]: 1 });
    assert.ok(!JSON.stringify(runOf(started)).includes(secretValue), JSON.stringify(started));
    assert.deepEqual(waitingOf(await (await reopen()).show(runOf(started).id)), waiting);
    close();
  });

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
    assertRedactedApproval(await runs.extend(runOf(started).id, { items: 5 }, "The owner"));
    close();
  });
});

describe("a skill task returned with a run holds no secret text", () => {
  test("the task's input, from start", async () => {
    const steps = [{ id: "draft", action: "draft", input: { topic: "$settings.greeting" } }];
    const { runs, close } = await openedRuns({ changes: { ...withFlow(steps), config: greetingWithSecret } });
    const started = runOf(await runs.start(flow, null));
    assert.deepEqual(waitingTask(started).input, { topic: `hi ${redacted}` });
    assert.ok(!JSON.stringify(started).includes(secretValue), JSON.stringify(started));
    close();
  });

  test("the task's feedback, from a submit whose output fails its check", async () => {
    const scripts = {
      "notes:scripts/long-enough.ts": () => finished({ passed: false, feedback: `uses ${secretValue}` }),
    };
    const { runs, close } = await openedRuns({ scripts });
    const started = runOf(await runs.start({ action: "notes.draft" }, {}));
    const next = runOf(await runs.submit(tokenOf(started), answer({ text: "a long enough draft" })));
    assert.deepEqual(waitingTask(next).feedback, [`uses ${redacted}`]);
    assert.ok(!JSON.stringify(next).includes(secretValue), JSON.stringify(next));
    close();
  });
});
