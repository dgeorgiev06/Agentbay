import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { answer, failure, harness, runOf, storeKinds, waitingOf } from "./engine-fixture.ts";

for (const storeKind of storeKinds) {
  describe(`secrets are scrubbed before they reach the ${storeKind} store`, () => {
    test("a submitted output is stored redacted, and the next step receives the redacted value", async () => {
      const { engine, store, runner, close } = await harness({ storeKind });
      const id = runOf(await engine.startAction("notes.draft-and-store", {})).id;
      const output = { id: "d1", text: "the key is SECRET-ABC123", nested: ["SECRET-XYZ"] };
      const run = runOf(await engine.submit(id, "0#1", answer(output)));
      assert.equal(run.state.status, "done");
      const stored = JSON.stringify(await store.readRun(id));
      assert.ok(!stored.includes("SECRET-"), stored);
      assert.ok(stored.includes("the key is [redacted]"));
      assert.deepEqual(runner.calls[0]?.input, { id: "d1", text: "the key is [redacted]", nested: ["[redacted]"] });
      close();
    });

    test("a failure reason is stored redacted in the step and in the run", async () => {
      const scripts = { "notes:scripts/double.ts": () => failure("refused token SECRET-T0KEN9") };
      const { engine, store, close } = await harness({ storeKind, scripts });
      const run = runOf(await engine.startAction("notes.copy", { count: 1 }));
      assert.deepEqual(run.state, { status: "failed", reason: "refused token [redacted]" });
      const stored = await store.readRun(run.id);
      assert.deepEqual(stored?.state, { status: "failed", reason: "refused token [redacted]" });
      const failedStep = stored.steps.find((step) => step.key === "1");
      assert.ok(failedStep?.status === "failed");
      assert.equal(failedStep.reason, "refused token [redacted]");
      close();
    });

    test("a step refused before it starts is stored at once, redacted, with its start and its failure", async () => {
      const workflows = {
        "workflows/flow.yaml": {
          name: "flow",
          steps: [{ id: "each", foreach: "$settings.greeting", steps: [{ id: "keep", approval: "Send?" }] }],
        },
      };
      const config = { settings: { notes: { greeting: "hi SECRET-GREET1" } } };
      const { engine, store, close } = await harness({ storeKind, changes: { workflows, config } });
      const run = runOf(await engine.startWorkflow({ mode: "notes", path: "workflows/flow.yaml" }, null));
      assert.equal(run.state.status, "failed");
      const stored = await store.readRun(run.id);
      const refused = stored?.steps.find((step) => step.key === "each");
      assert.ok(refused?.status === "failed");
      assert.equal(refused.detail, null);
      assert.match(refused.reason, /which is the value "hi \[redacted\]", not a list/);
      assert.ok(!JSON.stringify(stored).includes("SECRET-"));
      const events = (await store.readEvents(run.id)).filter((event) =>
        JSON.stringify(event.detail).includes('"each"'),
      );
      assert.deepEqual(
        events.map((event) => event.kind),
        ["step.started", "step.failed"],
      );
      close();
    });

    test("approval content and event details are stored redacted", async () => {
      const workflows = {
        "workflows/flow.yaml": { name: "flow", steps: [{ id: "keep", approval: "Send?", show: "$settings.greeting" }] },
      };
      const config = { settings: { notes: { greeting: "hi SECRET-GREET1" } } };
      const { engine, store, close } = await harness({ storeKind, changes: { workflows, config } });
      const waiting = waitingOf(await engine.startWorkflow({ mode: "notes", path: "workflows/flow.yaml" }, null));
      assert.ok(waiting.reason === "approval");
      const approval = { hash: waiting.hash, decision: "approve", by: "owner SECRET-WHO7" } as const;
      runOf(await engine.approve("run-1", "keep", approval));
      const stored = await store.readRun("run-1");
      assert.equal(stored?.steps[0]?.input, "hi [redacted]");
      const events = await store.readEvents("run-1");
      const recorded = events.find((event) => event.kind === "approval.recorded");
      assert.deepEqual(recorded?.detail, {
        stepKey: "keep",
        hash: waiting.hash,
        decision: "approve",
        by: "owner [redacted]",
      });
      assert.ok(!JSON.stringify({ stored, events }).includes("SECRET-"));
      close();
    });
  });
}
