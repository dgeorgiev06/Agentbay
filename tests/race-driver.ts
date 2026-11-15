import { appendFileSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { ScriptRequest } from "../bay/contracts.ts";
import { SqliteRunStore } from "../bay/sqlite-run-store.ts";
import { finished, harness } from "./engine-fixture.ts";

const [file, markerFile, goFile, owner] = process.argv.slice(2);

async function race(): Promise<void> {
  if (file === undefined || markerFile === undefined || goFile === undefined || owner === undefined) {
    throw new Error("usage: race-driver.ts <kernel.db> <marker file> <go file> <owner>");
  }
  const store = new SqliteRunStore(file);
  const scripts = {
    "notes:scripts/spend.ts": async (request: ScriptRequest) => {
      appendFileSync(markerFile, `${owner} ran ${request.place.stepKey}\n`);
      await sleep(1500);
      return finished(request.input, { items: 1 });
    },
  };
  const { freshEngine } = await harness({ scripts, store, changes: { config: { budget: { items: 1 } } } });
  const engine = freshEngine({ owner });
  process.stdout.write("ready\n");
  while (!existsSync(goFile)) {
    await sleep(10);
  }
  const result = await engine.extendBudget("race", { items: 5 });
  const summary = result.ok
    ? { ok: true, status: result.value.state.status }
    : { ok: false, problems: result.problems };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  store.close();
}

await race();
