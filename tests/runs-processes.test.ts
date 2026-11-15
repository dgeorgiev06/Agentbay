import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { openedRuns, runOf, waitingOf } from "./runs-fixture.ts";

type Driver = {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exited: Promise<number | null>;
};

function startDriver(arguments_: readonly string[]): Driver {
  const driver = join(import.meta.dirname, "inside", "runs", "race-driver.ts");
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
