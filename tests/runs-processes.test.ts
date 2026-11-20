import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { answer, openedRuns, runOf, waitingOf, withFlow } from "./runs-fixture.ts";

type Waits = readonly { readonly task?: { readonly token?: string } }[];

function waitsOf(run: ReturnType<typeof runOf>): Waits {
  const state = run.state;
  assert.ok(state.status === "waiting");
  return [state.waiting, ...(state.alsoWaiting ?? [])].map((waiting) =>
    waiting.reason === "skill" ? { task: waiting.task } : {},
  );
}

type Driver = {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exited: Promise<number | null>;
};

function startDriver(arguments_: readonly string[], name = "race-driver.ts"): Driver {
  const driver = join(import.meta.dirname, "inside", "runs", name);
  const child = spawn(process.execPath, [driver, ...arguments_], { stdio: ["ignore", "pipe", "ignore"] });
  let text = "";
  child.stdout.on("data", (chunk: Buffer) => {
    text += chunk.toString("utf8");
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => {
      resolve(code);
    });
  });
  return { child, output: () => text, exited };
}

async function untilReady(drivers: readonly Driver[]): Promise<void> {
  while (!drivers.every((driver) => driver.output().includes("ready\n"))) {
    await sleep(20);
  }
}

function resultOf(driver: Driver): unknown {
  const lines = driver.output().trim().split("\n");
  return JSON.parse(lines.at(-1) ?? "null");
}

test(
  "two OS processes race to advance one run in one kernel.db: one advances, one is refused",
  { timeout: 60_000 },
  async () => {
    const { runs, database, close } = await openedRuns({ changes: { config: { budget: { items: 1 } } } });
    const folder = dirname(database);
    const marker = join(folder, "marker.txt");
    const go = join(folder, "go");
    writeFileSync(marker, "");
    const started = await runs.start({ action: "notes.spend" }, { measure: "items" });
    assert.equal(waitingOf(started).reason, "budget");
    const id = runOf(started).id;
    const drivers = [
      startDriver([database, id, marker, go, "process-a"]),
      startDriver([database, id, marker, go, "process-b"]),
    ];
    await untilReady(drivers);
    writeFileSync(go, "");
    const codes = await Promise.all(drivers.map((driver) => driver.exited));
    assert.deepEqual(codes, [0, 0]);
    const results = drivers.map(resultOf);
    const advanced = results.filter((result) => JSON.stringify(result) === '{"ok":true,"status":"done"}');
    const refusal = new RegExp(`"ok":false.*(being advanced by process-|Another engine is writing run ${id})`);
    const refused = results.filter((result) => refusal.test(JSON.stringify(result)));
    assert.deepEqual([advanced.length, refused.length], [1, 1], JSON.stringify(results));
    const ran = readFileSync(marker, "utf8").trim().split("\n");
    assert.equal(ran.length, 1, ran.join(" | "));
    assert.match(ran[0] ?? "", /^process-[ab] ran 2$/);
    assert.equal(runOf(await runs.show(id)).state.status, "done");
    close();
  },
);

const drafts = [
  {
    id: "each",
    foreach: "$trigger",
    sideBySide: 2,
    steps: [{ id: "write", action: "draft", input: { topic: "$item" } }],
  },
];

test(
  "two OS processes hand in the answers of two side-by-side steps at once: both are taken, each once",
  { timeout: 60_000 },
  async () => {
    const { runs, database, close } = await openedRuns({ changes: withFlow(drafts) });
    const folder = dirname(database);
    const marker = join(folder, "marker.txt");
    const go = join(folder, "go");
    writeFileSync(marker, "");
    const started = runOf(await runs.start({ workflow: { mode: "notes", path: "workflows/flow.yaml" } }, ["a", "b"]));
    const keys = ["each[0].write/0#1", "each[1].write/0#1"];
    const texts = ["tea is long enough", "coffee is long enough"];
    const drivers = keys.map((key, index) =>
      startDriver([database, started.id, key, texts[index] ?? "", marker, go], "answer-driver.ts"),
    );
    await untilReady(drivers);
    writeFileSync(go, "");
    assert.deepEqual(await Promise.all(drivers.map((driver) => driver.exited)), [0, 0]);
    const results = drivers.map((driver) => JSON.stringify(resultOf(driver)));
    const busy = keys.filter((_key, index) => (results[index] ?? "").includes("try again"));
    for (const key of busy) {
      const index = keys.indexOf(key);
      const token = waitsOf(started)[index]?.task?.token ?? "";
      runOf(await runs.submit(token, answer({ text: texts[index] ?? "" })));
    }
    const answered = results.filter((result) => /"ok":true,"taken":"(recorded|waiting|done)"/.test(result));
    assert.equal(answered.length + busy.length, 2, results.join(" | "));
    const shown = runOf(await runs.show(started.id));
    assert.deepEqual(shown.state, { status: "done", output: [{ text: texts[0] }, { text: texts[1] }] });
    assert.equal(shown.recordedAnswers, undefined);
    const checked = readFileSync(marker, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line !== "");
    const checkedInDrivers = keys.filter((key) => !busy.includes(key)).map((key) => `${key}.check0`);
    assert.deepEqual(checked.sort(), checkedInDrivers, results.join(" | "));
    close();
  },
);
