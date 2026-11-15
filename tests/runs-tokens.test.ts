import assert from "node:assert/strict";
import { test } from "node:test";
import { answer, messagesOf, notesFlow, openedRuns, runOf, tokenOf, waitingTask, withFlow } from "./runs-fixture.ts";

const good = answer({ text: "long enough to pass" });

test("a token is 32 random bytes, and a wrong token is refused", async () => {
  const { runs, close } = await openedRuns();
  const token = tokenOf(runOf(await runs.start({ action: "notes.draft" }, {})));
  assert.equal(Buffer.from(token, "base64url").length, 32);
  for (const wrong of ["", "nope", `${token}x`, token.slice(1), token.toUpperCase()]) {
    assert.match(messagesOf(await runs.task(wrong, "db_query")), /The token is not valid/, wrong);
  }
  assert.ok((await runs.task(token, "db_query")).ok);
  close();
});

test("a token dies when its step finishes", async () => {
  const { runs, close } = await openedRuns();
  const token = tokenOf(runOf(await runs.start({ action: "notes.draft" }, {})));
  assert.equal(runOf(await runs.submit(token, good)).state.status, "done");
  assert.match(messagesOf(await runs.task(token, "db_query")), /is no longer waiting for it \(the run is done\)/);
  close();
});

test("a token dies when its run moves on to another skill step", async () => {
  const steps = [
    { id: "first", action: "draft" },
    { id: "second", action: "draft" },
  ];
  const { runs, close } = await openedRuns({ changes: withFlow(steps) });
  const token = tokenOf(runOf(await runs.start({ workflow: notesFlow }, {})));
  const next = runOf(await runs.submit(token, good));
  assert.equal(waitingTask(next).stepKey, "second/0#1");
  assert.match(
    messagesOf(await runs.task(token, "db_query")),
    /issued for step first\/0#1 of run \S+, which is no longer waiting for it \(the run is waiting for skill at second\/0#1\)/,
  );
  close();
});

test("tokens of different runs live side by side, and one run ending leaves the other's token working", async () => {
  const { runs, close } = await openedRuns();
  const first = runOf(await runs.start({ action: "notes.draft" }, {}));
  const second = runOf(await runs.start({ action: "notes.draft" }, {}));
  const firstTask = await runs.task(tokenOf(first), "db_query");
  const secondTask = await runs.task(tokenOf(second), "db_query");
  assert.ok(firstTask.ok && firstTask.value.runId === first.id);
  assert.ok(secondTask.ok && secondTask.value.runId === second.id);
  runOf(await runs.submit(tokenOf(first), good));
  assert.ok(!(await runs.task(tokenOf(first), "db_query")).ok);
  assert.ok((await runs.task(tokenOf(second), "db_query")).ok);
  close();
});
