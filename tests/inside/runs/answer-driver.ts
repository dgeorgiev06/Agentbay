import { appendFileSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { ScriptRequest } from "../../../bay/contracts.ts";
import { answer, finished, withFlow } from "../../runs-fixture.ts";
import { harness } from "./engine-harness.ts";

const [file = "", runId = "", stepKey = "", text = "", markerFile = "", goFile = ""] = process.argv.slice(2);

const drafts = [
  {
    id: "each",
    foreach: "$trigger",
    sideBySide: 2,
    steps: [{ id: "write", action: "draft", input: { topic: "$item" } }],
  },
];

async function hand(): Promise<void> {
  if (goFile === "") {
    throw new Error("usage: answer-driver.ts <kernel.db> <run id> <step key> <text> <marker file> <go file>");
  }
  const scripts = {
    "notes:scripts/long-enough.ts": async (request: ScriptRequest) => {
      appendFileSync(markerFile, `${request.place.stepKey}\n`);
      await sleep(300);
      return finished({ passed: true });
    },
  };
  const { freshEngine, close } = await harness({ scripts, file, changes: withFlow(drafts) });
  const engine = freshEngine({ owner: `driver-${text}` });
  process.stdout.write("ready\n");
  while (!existsSync(goFile)) {
    await sleep(10);
  }
  const result = await engine.submit(runId, stepKey, answer({ text }));
  const summary = result.ok
    ? { ok: true, taken: "recorded" in result.value ? "recorded" : result.value.state.status }
    : { ok: false, problems: result.problems.map((problem) => problem.message) };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  close();
}

await hand();
