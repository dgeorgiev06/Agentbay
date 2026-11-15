import { join } from "node:path";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, systemClock } from "../bay/node-ports.ts";
import { createScriptRunner } from "../bay/script-runner.ts";
import { SecretStore } from "../bay/secrets.ts";
import { noProcesses, permissionsIn, place, recordingSink, scriptedHttp } from "./broker-fixture.ts";

async function main(root: string): Promise<void> {
  const runner = createScriptRunner({
    root,
    files: nodeFileSystem,
    inspector: nodeFileInspector,
    http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
    secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
    events: recordingSink(),
    clock: systemClock,
    childProcesses: nodeChildProcesses,
  });
  const outcome = await runner.run({
    place,
    script: join("scripts", "probe.ts"),
    input: null,
    permissions: permissionsIn(root),
    settings: {},
    remaining: {},
    timeLimitMilliseconds: 30_000,
    call: () =>
      Promise.resolve({ status: "failed", reason: "no calls", spent: { items: 0, usd: 0, tokens: 0, minutes: 0 } }),
  });
  process.stdout.write(JSON.stringify(outcome));
}

await main(process.argv[2] ?? "");
