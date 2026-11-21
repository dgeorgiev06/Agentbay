import { appendFileSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { ScriptRequest } from "../../../bay/contracts.ts";
import { finished } from "../../runs-fixture.ts";
import { harness } from "./engine-harness.ts";

const [file, runId, markerFile, goFile, owner] = process.argv.slice(2);

async function race(): Promise<void> {
  if (
    file === undefined ||
    runId === undefined ||
    markerFile === undefined ||
    goFile === undefined ||
    owner === undefined
  ) {
    throw new Error("usage: race-driver.ts <kernel.db> <run id> <marker file> <go file> <owner>");
  }
  const scripts = {
    "notes:scripts/spend.ts": async (request: ScriptRequest) => {
      appendFileSync(markerFile, `${owner} ran ${request.place.stepKey}\n`);
      await sleep(1500);
      return finished(request.input, { items: 1 });
    },
  };
  const { freshEngine, close } = await harness({ scripts, file, changes: { config: { budget: { items: 1 } } } });
  const engine = freshEngine({ owner });
  process.stdout.write("ready\n");
  while (!existsSync(goFile)) {
    await sleep(10);
  }
  const result = await engine.extendBudget(runId, { items: 5 }, "The owner");
  const summary = result.ok
    ? { ok: true, status: result.value.state.status }
    : { ok: false, problems: result.problems };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  close();
}

await race();
