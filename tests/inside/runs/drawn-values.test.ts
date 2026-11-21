import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import type { Drawn, Json, Scrubber } from "../../../bay/contracts.ts";
import type { Action } from "../../../bay/generated/mode.ts";
import { drawerFor, packedDrawn, unpackedDrawn } from "../../../bay/runs/drawn-values.ts";
import type { RunStore, StepChange } from "../../../bay/runs/run-store.ts";
import { scrubbedStore } from "../../../bay/runs/scrubbed-store.ts";
import { decodedStepDetail } from "../../../bay/runs/step-detail.ts";
import { finished, type Script } from "../../runs-fixture.ts";
import { harness, runOf } from "./engine-harness.ts";

const drawing: Action = {
  description: "When a test draws a random value.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read", "write"],
  run: [{ script: "scripts/log.ts" }],
};

const changes = { notesActions: { draw: drawing } };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function storedDrawn(file: string, key: string): readonly string[] | undefined {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const row = database.prepare("select detail from steps where key = ?").get(key);
    const detail: unknown = typeof row?.detail === "string" ? JSON.parse(row.detail) : null;
    const packed = typeof detail === "object" && detail !== null && "drawn" in detail ? detail.drawn : undefined;
    return typeof packed === "string" ? unpackedDrawn(packed) : undefined;
  } finally {
    database.close();
  }
}

function withDetailWrite(store: RunStore, saveStepDetail: RunStore["saveStepDetail"]): RunStore {
  return { ...store, saveStepDetail };
}

function deferringDetails(store: RunStore, milliseconds: number): RunStore {
  return withDetailWrite(store, async (writer, change, events) => {
    await delay(milliseconds);
    return store.saveStepDetail(writer, change, events);
  });
}

test("a script is given a random value only once the value is in kernel.db, however slow the write", async () => {
  const seen: { value: string; stored: readonly string[] | undefined }[] = [];
  const where = { file: "" };
  const draw: Script = async (request) => {
    const drawn = await request.random(16);
    assert.ok(drawn.status === "done", JSON.stringify(drawn));
    seen.push({ value: drawn.value, stored: storedDrawn(where.file, "0") });
    return finished({ drawn: 1 });
  };
  const { store, file, freshEngine, close } = await harness({ changes, scripts: { "notes:scripts/log.ts": draw } });
  where.file = file;
  runOf(await freshEngine({ store: deferringDetails(store, 30) }).startAction("notes.draw", {}));
  const [first] = seen;
  assert.ok(first !== undefined);
  assert.deepEqual(first.stored, [first.value]);
  close();
});

test("a value whose write fails is not given: the script gets a failed answer that says why", async () => {
  const answers: Drawn[] = [];
  const draw: Script = async (request) => {
    answers.push(await request.random(16));
    return finished({ drawn: 0 });
  };
  const { store, freshEngine, close } = await harness({ changes, scripts: { "notes:scripts/log.ts": draw } });
  const failing = withDetailWrite(store, () => Promise.reject(new Error("the disk is full")));
  runOf(await freshEngine({ store: failing }).startAction("notes.draw", {}));
  assert.deepEqual(answers, [
    {
      status: "failed",
      reason: "Random value 1 of step 0 could not be recorded, so it is not given: the disk is full",
    },
  ]);
  close();
});

test("values asked side by side are written in the order they were drawn, whichever write is slower", async () => {
  let stored: readonly string[] = [];
  const draw = drawerFor("0", [], async (drawn) => {
    await delay(drawn.length === 1 ? 30 : 0);
    stored = drawn;
  });
  const answers = await Promise.all([draw(4), draw(8)]);
  const values = answers.map((answer) => (answer.status === "done" ? answer.value : answer.reason));
  assert.deepEqual(stored, values);
});

const malformed = "kernel.db holds a script step whose detail has no valid drawn.";

test("a step whose recorded values are not a packed list of text refuses to load, with the kernel's sentence", () => {
  const corrupt: readonly Json[] = [5, "not packed at all", packedDrawn([]).slice(0, 6), packedOf('{"a":1}')];
  for (const drawn of corrupt) {
    assert.throws(() => decodedStepDetail("script", { script: "scripts/log.ts", drawn }), { message: malformed });
  }
  assert.throws(() => decodedStepDetail("check", { script: "scripts/c.ts", drawn: packedOf('["a", 1]') }), {
    message: "kernel.db holds a check step whose detail has no valid drawn.",
  });
});

function packedOf(text: string): string {
  return gzipSync(Buffer.from(text, "utf8")).toString("base64");
}

const scrubbingGzipHeaders: Scrubber = {
  redact: (text) => text.replaceAll("H4sI", "[redacted:HEADER]"),
  redactJson: (value) => scrubbed(value),
};

function scrubbed(value: Json): Json {
  if (typeof value === "string") {
    return scrubbingGzipHeaders.redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: Json) => scrubbed(item));
  }
  return value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubbed(item)]))
    : value;
}

test("the secret scrubber reads the stored detail but never the packed values, so no match can corrupt them", async () => {
  const { store, close } = await harness();
  const changes: StepChange[] = [];
  const capturing = withDetailWrite(store, (_writer, change) => {
    changes.push(change);
    return Promise.reject(new Error("captured"));
  });
  const writer = { runId: "run-1", owner: "engine-1" };
  const detail = { script: "scripts/log.ts H4sI", mode: "notes", drawn: ["abcd"] };
  await assert.rejects(
    scrubbedStore(capturing, scrubbingGzipHeaders).saveStepDetail(
      writer,
      { key: "0", kind: "script", detail, at: "2026-11-14T09:00:00.000Z" },
      [],
    ),
    { message: "captured" },
  );
  const [change] = changes;
  assert.deepEqual(change?.detail, { script: "scripts/log.ts [redacted:HEADER]", mode: "notes", drawn: ["abcd"] });
  close();
});
