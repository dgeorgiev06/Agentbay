import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptRequest } from "../bay/contracts.ts";
import { numberField } from "../bay/json.ts";
import type { Outcome } from "../bay/outcome.ts";
import type { Run, Runs } from "../bay/runs/runs.ts";
import { eventKinds, finished, messagesOf, openedRuns, runOf, type Script } from "./runs-fixture.ts";

function blockingScripts(
  reached: PromiseWithResolvers<undefined>,
  held: Promise<undefined>,
): Readonly<Record<string, Script>> {
  return {
    "notes:scripts/double.ts": async (request: ScriptRequest) => {
      reached.resolve(undefined);
      await held;
      return finished({ count: 2 * (numberField(request.input, "count") ?? 0) });
    },
  };
}

test("a second openRuns on the same kernel.db is refused while the first advances the run", async () => {
  const reached = Promise.withResolvers<undefined>();
  const held = Promise.withResolvers<undefined>();
  const { runs, reopen, close } = await openedRuns({ scripts: blockingScripts(reached, held.promise) });
  const first = runs.start({ action: "notes.copy" }, { count: 1 });
  await reached.promise;
  const second = await reopen();
  const [running] = await second.list();
  assert.ok(running?.status === "running");
  const id = running.id;
  assert.match(messagesOf(await second.resume(id)), /being advanced by engine-\S+ \(last heartbeat /);
  assert.match(messagesOf(await second.stop(id, "The owner")), /only one writer may advance a run/);
  assert.match(messagesOf(await runs.resume(id)), /being advanced by engine-/);
  held.resolve(undefined);
  assert.equal(runOf(await first).state.status, "done");
  assert.equal(runOf(await second.show(id)).state.status, "done");
  assert.match(messagesOf(await second.resume(id)), /has ended \(done\)/);
  close();
});

type Watcher = {
  second: Runs | undefined;
  silentAt: number | undefined;
  takeover: Outcome<Run> | undefined;
  tries: number;
  refusedTries: number;
};

test("a live engine whose steps each take seven minutes is never taken over; a silent one is", async () => {
  const watcher: Watcher = { second: undefined, silentAt: undefined, takeover: undefined, tries: 0, refusedTries: 0 };
  const scripts = {
    "notes:scripts/slow.ts": async (request: ScriptRequest) => {
      const silent = watcher.silentAt === Number(request.place.stepKey);
      clock.advance((silent ? 11 : 7) * 60_000);
      const second = watcher.second;
      assert.ok(second);
      if (silent) {
        watcher.silentAt = undefined;
        watcher.takeover = await second.resume(request.place.runId);
        return finished(request.input);
      }
      watcher.tries += 1;
      const result = await second.resume(request.place.runId);
      if (!result.ok && /being advanced by engine-/.test(messagesOf(result))) {
        watcher.refusedTries += 1;
      }
      return finished(request.input);
    },
  };
  const { runs, clock, reopen, close } = await openedRuns({ scripts });
  watcher.second = await reopen();
  const live = runOf(await runs.start({ action: "notes.long" }, {}));
  assert.equal(live.state.status, "done");
  assert.deepEqual([watcher.tries, watcher.refusedTries], [6, 6]);
  assert.ok(!eventKinds(live).includes("lock.taken-over"));
  watcher.silentAt = 3;
  const lost = await runs.start({ action: "notes.long" }, {});
  assert.match(messagesOf(lost), /stopped at an unexpected error: .*no longer holds the lock/);
  assert.ok(watcher.takeover?.ok);
  const takenOver = watcher.takeover.value;
  assert.equal(takenOver.state.status, "done");
  assert.ok(eventKinds(takenOver).includes("lock.taken-over"));
  close();
});
