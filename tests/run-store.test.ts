import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RunEvent } from "../bay/contracts.ts";
import { lockStaleMilliseconds, type NewRun, type RunStore, type StoredState, type Writer } from "../bay/run-store.ts";
import type { SkillDetail } from "../bay/step-detail.ts";
import { SqliteRunStore } from "../bay/sqlite-run-store.ts";
import { nodeFolders } from "../bay/node-ports.ts";
import { fakeFolders } from "./fakes.ts";
import { MemoryRunStore } from "./memory-run-store.ts";

type Opened = {
  readonly store: RunStore;
  readonly close: () => void;
};

const start = new Date("2026-11-14T09:00:00.000Z");

const spent = { items: 0, usd: 0, tokens: 0, minutes: 0 };

const script = { script: "scripts/a.ts" };

const call = { mode: "store", action: "put" };

const skillDetail: SkillDetail = {
  mode: "notes",
  action: "draft",
  skill: "skills/draft",
  tier: "fast",
  schemas: ["schemas/draft.json"],
  round: 1,
  feedback: [],
  earlierSpent: spent,
  calledSpent: spent,
};

function minutesLater(minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

function event(runId: string, kind: string): RunEvent {
  return { at: start.toISOString(), runId, kind, detail: { stepKey: "0" } };
}

const newRun: NewRun = {
  id: "run-1",
  target: { kind: "action", mode: "notes", name: "copy" },
  input: { count: 1 },
  limit: { items: 5 },
  at: start.toISOString(),
};

async function created(store: RunStore): Promise<Writer> {
  return store.createRun(newRun, "engine-a", [event(newRun.id, "run.started")]);
}

function runStoreContract(name: string, open: () => Opened): void {
  describe(`${name} run store`, () => {
    test("a created run reads back running, with its input and limit, locked by its creator", async () => {
      const { store, close } = open();
      await created(store);
      const run = await store.readRun("run-1");
      assert.ok(run);
      assert.deepEqual(run.state, { status: "running" });
      assert.deepEqual(run.target, newRun.target);
      assert.deepEqual(run.input, { count: 1 });
      assert.deepEqual(run.limit, { items: 5 });
      assert.deepEqual(run.extra, {});
      assert.deepEqual(run.spent, { items: 0, usd: 0, tokens: 0, minutes: 0 });
      assert.equal(run.stopReason, undefined);
      assert.deepEqual(run.steps, []);
      assert.equal((await store.acquire("run-1", "engine-b", start)).status, "held");
      assert.equal(await store.readRun("run-2"), undefined);
      close();
    });

    test("a step's input is saved before it starts and its output when it finishes, with the events", async () => {
      const { store, close } = open();
      const writer = await created(store);
      const at = start.toISOString();
      const startedRecord = await store.saveStepInput(
        writer,
        { key: "0", kind: "script", input: { a: 1 }, detail: script, at },
        [event("run-1", "step.started")],
      );
      assert.equal(startedRecord.status, "started");
      assert.deepEqual((await store.readRun("run-1"))?.steps, [startedRecord]);
      const spent = { items: 2, usd: 0.5, tokens: 10, minutes: 1 };
      const finished = await store.saveStepOutput(writer, { key: "0", status: "done", output: { b: 2 }, spent, at }, [
        event("run-1", "step.finished"),
      ]);
      assert.ok(finished.status === "done");
      assert.deepEqual(finished.output, { b: 2 });
      assert.deepEqual(finished.spent, spent);
      await store.saveStepInput(writer, { key: "1", kind: "call", input: null, detail: call, at }, []);
      const failed = await store.saveStepOutput(
        writer,
        { key: "1", status: "failed", reason: "no", spent: finished.spent, at },
        [],
      );
      assert.ok(failed.status === "failed");
      assert.equal(failed.reason, "no");
      assert.ok(failed.finishOrder > finished.finishOrder);
      const steps = (await store.readRun("run-1"))?.steps ?? [];
      assert.deepEqual(
        steps.map((step) => [step.key, step.status]),
        [
          ["0", "done"],
          ["1", "failed"],
        ],
      );
      const kinds = (await store.readEvents("run-1")).map((entry) => entry.kind);
      assert.deepEqual(kinds, ["run.started", "step.started", "step.finished"]);
      close();
    });

    test("saving a step twice, or finishing a step that never started, is refused as a bug", async () => {
      const { store, close } = open();
      const writer = await created(store);
      const at = start.toISOString();
      await store.saveStepInput(writer, { key: "0", kind: "script", input: 1, detail: script, at }, []);
      await assert.rejects(async () => {
        await store.saveStepInput(writer, { key: "0", kind: "script", input: 1, detail: script, at }, []);
      });
      const end = { key: "9", status: "done", output: 1, spent: { items: 0, usd: 0, tokens: 0, minutes: 0 }, at };
      await assert.rejects(async () => {
        await store.saveStepOutput(writer, { ...end, status: "done" }, []);
      });
      await store.saveStepOutput(writer, { ...end, key: "0", status: "done" }, []);
      await assert.rejects(async () => {
        await store.saveStepDetail(writer, { key: "0", kind: "script", detail: script, at }, []);
      });
      close();
    });

    test("a started step's detail can change until it finishes", async () => {
      const { store, close } = open();
      const writer = await created(store);
      const at = start.toISOString();
      await store.saveStepInput(writer, { key: "0", kind: "skill", input: 1, detail: skillDetail, at }, []);
      const secondRound = { ...skillDetail, round: 2, feedback: ["longer"] };
      const changed = await store.saveStepDetail(writer, { key: "0", kind: "skill", detail: secondRound, at }, [
        event("run-1", "run.waiting"),
      ]);
      assert.deepEqual(changed.detail, secondRound);
      assert.deepEqual((await store.readRun("run-1"))?.steps[0]?.detail, secondRound);
      await assert.rejects(async () => {
        await store.saveStepDetail(writer, { key: "0", kind: "script", detail: script, at }, []);
      }, /is a skill step, not a script step/);
      close();
    });

    test("a step refused before it could start is saved failed at once, with no detail and both events", async () => {
      const { store, close } = open();
      const writer = await created(store);
      const at = start.toISOString();
      const refusal = { key: "2", kind: "call" as const, input: { a: 1 }, reason: "not bound", at };
      const refused = await store.saveRefusal(writer, refusal, [
        event("run-1", "step.started"),
        event("run-1", "step.failed"),
      ]);
      assert.ok(refused.status === "failed");
      assert.equal(refused.detail, null);
      assert.equal(refused.reason, "not bound");
      assert.deepEqual(refused.spent, spent);
      assert.deepEqual((await store.readRun("run-1"))?.steps, [refused]);
      assert.deepEqual(
        (await store.readEvents("run-1")).map((entry) => entry.kind),
        ["run.started", "step.started", "step.failed"],
      );
      await assert.rejects(async () => {
        await store.saveRefusal(writer, refusal, []);
      });
      close();
    });

    test("every run state round-trips, and runs are listed by status", async () => {
      const { store, close } = open();
      const writer = await created(store);
      const states: readonly StoredState[] = [
        { status: "waiting", reason: "skill", stepKey: "0#1" },
        { status: "waiting", reason: "time", stepKey: "pause", until: minutesLater(30).toISOString() },
        { status: "done", output: { all: [1, 2] } },
        { status: "failed", reason: "no input" },
        { status: "undone", reason: "rejected", undo: { undone: [] } },
        { status: "running" },
      ];
      for (const state of states) {
        await store.updateRun(writer, { state, at: start.toISOString() }, [event("run-1", "run.waiting")]);
        assert.deepEqual((await store.readRun("run-1"))?.state, state);
        const listed = await store.listRuns(state.status);
        assert.deepEqual(
          listed.map((run) => run.id),
          ["run-1"],
        );
      }
      assert.deepEqual(await store.listRuns("done"), []);
      await store.updateRun(
        writer,
        { extra: { usd: 2 }, spent: { items: 1, usd: 1, tokens: 1, minutes: 1 }, stopReason: "stop", at: "later" },
        [],
      );
      const run = await store.readRun("run-1");
      assert.ok(run);
      assert.deepEqual(run.extra, { usd: 2 });
      assert.deepEqual(run.spent, { items: 1, usd: 1, tokens: 1, minutes: 1 });
      assert.equal(run.stopReason, "stop");
      assert.equal(run.updatedAt, "later");
      assert.deepEqual(run.state, { status: "running" });
      close();
    });

    test("one writer at a time: a live lock refuses everyone, a released one is free again", async () => {
      const { store, close } = open();
      const writer = await created(store);
      assert.deepEqual(await store.acquire("run-1", "engine-a", minutesLater(1)), {
        status: "held",
        owner: "engine-a",
        heartbeatAt: start.toISOString(),
      });
      assert.equal((await store.acquire("run-1", "engine-b", minutesLater(9))).status, "held");
      await store.release(writer);
      const second = await store.acquire("run-1", "engine-b", minutesLater(2));
      assert.equal(second.status, "acquired");
      assert.equal((await store.acquire("run-1", "engine-a", minutesLater(3))).status, "held");
      await assert.rejects(async () => {
        await store.updateRun(writer, { at: "x" }, []);
      }, /no longer holds the lock/);
      assert.deepEqual(await store.acquire("nowhere", "engine-a", start), { status: "missing" });
      close();
    });

    test("a heartbeat keeps a lock live; a stale lock is taken over and the takeover is an event", async () => {
      const { store, close } = open();
      const writer = await created(store);
      await store.heartbeat(writer, minutesLater(5));
      assert.equal((await store.acquire("run-1", "engine-b", minutesLater(14))).status, "held");
      const staleAt = new Date(minutesLater(5).getTime() + lockStaleMilliseconds + 1);
      const takeover = await store.acquire("run-1", "engine-b", staleAt);
      assert.deepEqual(takeover, { status: "acquired", writer: { runId: "run-1", owner: "engine-b" } });
      const events = await store.readEvents("run-1");
      assert.deepEqual(events.at(-1), {
        at: staleAt.toISOString(),
        runId: "run-1",
        kind: "lock.taken-over",
        detail: { previousOwner: "engine-a", heartbeatAt: minutesLater(5).toISOString(), owner: "engine-b" },
      });
      await assert.rejects(async () => {
        await store.saveStepInput(writer, { key: "0", kind: "script", input: 1, detail: script, at: "x" }, [
          event("run-1", "step.started"),
        ]);
      }, /no longer holds the lock/);
      await assert.rejects(async () => {
        await store.heartbeat(writer, staleAt);
      });
      assert.deepEqual((await store.readRun("run-1"))?.steps, []);
      assert.equal((await store.readEvents("run-1")).length, events.length);
      await store.release(writer);
      assert.equal((await store.acquire("run-1", "engine-c", staleAt)).status, "held");
      close();
    });

    test("every write by the lock's holder refreshes the lock, so a busy writer never looks stale", async () => {
      const { store, close } = open();
      const writer = await created(store);
      const writes = [
        (at: string) => store.saveStepInput(writer, { key: "0", kind: "skill", input: 1, detail: skillDetail, at }, []),
        (at: string) =>
          store.saveStepDetail(writer, { key: "0", kind: "skill", detail: { ...skillDetail, round: 2 }, at }, []),
        (at: string) => store.saveStepOutput(writer, { key: "0", status: "done", output: 1, spent, at }, []),
        (at: string) => store.updateRun(writer, { at }, []),
      ];
      for (const [index, write] of writes.entries()) {
        const at = minutesLater(9 * (index + 1));
        await write(at.toISOString());
        const later = new Date(at.getTime() + lockStaleMilliseconds);
        assert.equal((await store.acquire("run-1", "engine-b", later)).status, "held", `after write ${String(index)}`);
      }
      const silent = new Date(minutesLater(36).getTime() + lockStaleMilliseconds + 1);
      assert.equal((await store.acquire("run-1", "engine-b", silent)).status, "acquired");
      close();
    });

    test("events are read per run, in the order they were appended", async () => {
      const { store, close } = open();
      await created(store);
      await store.createRun({ ...newRun, id: "run-2" }, "engine-a", [event("run-2", "run.started")]);
      await store.append(event("run-1", "run.waiting"));
      await store.append(event("run-2", "run.finished"));
      assert.deepEqual(
        (await store.readEvents("run-1")).map((entry) => entry.kind),
        ["run.started", "run.waiting"],
      );
      assert.deepEqual(
        (await store.readEvents("run-2")).map((entry) => entry.kind),
        ["run.started", "run.finished"],
      );
      close();
    });
  });
}

function temporaryFile(): { readonly file: string; readonly remove: () => void } {
  const folder = mkdtempSync(join(tmpdir(), "agentbay-run-store-"));
  mkdirSync(join(folder, ".agentbay"));
  return {
    file: join(folder, ".agentbay", "kernel.db"),
    remove: () => {
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

runStoreContract("in-memory", () => ({ store: new MemoryRunStore(), close: () => undefined }));

runStoreContract("SQLite", () => {
  const { file, remove } = temporaryFile();
  const store = new SqliteRunStore(file);
  return {
    store,
    close: () => {
      store.close();
      remove();
    },
  };
});

test("a SQLite store keeps runs, steps and events when the file is opened again", async () => {
  const { file, remove } = temporaryFile();
  const first = new SqliteRunStore(file);
  const writer = await created(first);
  await first.saveStepInput(writer, { key: "0", kind: "script", input: [1], detail: script, at: "t" }, []);
  first.close();
  const second = new SqliteRunStore(file);
  const run = await second.readRun("run-1");
  assert.deepEqual(
    run?.steps.map((step) => [step.key, step.status, step.input]),
    [["0", "started", [1]]],
  );
  assert.equal((await second.readEvents("run-1")).length, 1);
  second.close();
  const database = new DatabaseSync(file);
  assert.equal(database.prepare("pragma user_version").get()?.user_version, 3);
  assert.deepEqual(
    database
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all()
      .map((row) => row.name),
    ["events", "runs", "steps", "task_tokens"],
  );
  database.close();
  remove();
});

test("a SQLite store keeps a finished step's status as done, the word every reader uses", async () => {
  const { file, remove } = temporaryFile();
  const store = new SqliteRunStore(file);
  const writer = await created(store);
  for (const key of ["0", "1"]) {
    await store.saveStepInput(writer, { key, kind: "script", input: null, detail: script, at: "t" }, []);
  }
  await store.saveStepOutput(writer, { key: "0", status: "done", output: 1, spent, at: "t" }, []);
  await store.saveStepOutput(writer, { key: "1", status: "failed", reason: "no", spent, at: "t" }, []);
  store.close();
  const database = new DatabaseSync(file);
  const statuses = database.prepare("select key, status from steps order by key").all();
  assert.deepEqual(
    statuses.map((row) => [row.key, row.status]),
    [
      ["0", "done"],
      ["1", "failed"],
    ],
  );
  assert.throws(() => {
    database.prepare("update steps set status = 'finished' where key = '0'").run();
  }, /CHECK constraint failed/);
  database.close();
  remove();
});

test("two SQLite stores on the same file see one lock: the second writer is refused", async () => {
  const { file, remove } = temporaryFile();
  const first = new SqliteRunStore(file);
  const second = new SqliteRunStore(file);
  const writer = await created(first);
  assert.equal((await second.acquire("run-1", "engine-b", minutesLater(1))).status, "held");
  await first.release(writer);
  assert.equal((await second.acquire("run-1", "engine-b", minutesLater(1))).status, "acquired");
  await assert.rejects(async () => {
    await first.updateRun(writer, { at: "x" }, []);
  }, /no longer holds the lock/);
  first.close();
  second.close();
  remove();
});

test("opening a SQLite store makes its file owner-only through the Folders port first", async () => {
  const folder = mkdtempSync(join(tmpdir(), "agentbay-open-"));
  const file = join(folder, "project", ".agentbay", "kernel.db");
  const recorded = fakeFolders();
  await assert.rejects(SqliteRunStore.open(recorded, file));
  assert.deepEqual(recorded.created, [file]);
  const store = await SqliteRunStore.open(nodeFolders, file);
  await created(store);
  assert.equal((await store.readRun("run-1"))?.id, "run-1");
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

test("a SQLite store that cannot get the database within its busy timeout answers busy instead of throwing", async () => {
  const { file, remove } = temporaryFile();
  const setup = new SqliteRunStore(file);
  await created(setup);
  setup.close();
  const blocker = new DatabaseSync(file);
  blocker.exec("begin immediate");
  const store = new SqliteRunStore(file, { busyMilliseconds: 50 });
  assert.deepEqual(await store.acquire("run-1", "engine-b", minutesLater(30)), { status: "busy" });
  blocker.exec("rollback");
  assert.equal((await store.acquire("run-1", "engine-b", minutesLater(30))).status, "acquired");
  blocker.close();
  store.close();
  remove();
});
