import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { stringify } from "yaml";
import { numberField } from "../bay/json.ts";
import { openModeProject, type ModeProject } from "./test-toolbox.ts";

const anything = "schemas/anything.json";

function scriptAction(script: string, fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    description: "When a test needs a script step that takes long.",
    input: anything,
    output: anything,
    effects: ["read"],
    run: [{ script }],
    ...fields,
  };
}

const timerMode = {
  name: "timer",
  version: "1.0.0",
  description: "Runs scripts and commands that take long, for the kernel's tests of time limits.",
  resources: { commands: { wait: { run: "sleep", effects: ["read"] } } },
  actions: {
    "take-thirty-seconds": scriptAction("scripts/thirty-seconds.ts", { scriptTimeLimitSeconds: 2 }),
    "take-thirty-seconds-on-a-budget": scriptAction("scripts/thirty-seconds.ts", {
      scriptTimeLimitSeconds: 900,
      budget: { minutes: 0.02 },
    }),
    wait: scriptAction("scripts/wait.ts", { scriptTimeLimitSeconds: 4 }),
  },
};

const thirtySecondsScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async () => {",
  "  await new Promise((resolve) => setTimeout(resolve, 30_000));",
  '  return { ran: "thirty seconds" };',
  "});",
  "",
].join("\n");

const waitScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (_input, context) => {",
  '  const asked = { name: "wait", arguments: ["30"], folder: ".", timeLimitSeconds: 600 };',
  "  const ran = await context.commands.run(asked);",
  '  return ran.ok ? { verdict: "inconclusive", end: ran.value.end.how } : { refused: ran.message };',
  "});",
  "",
].join("\n");

const files: Readonly<Record<string, string>> = {
  "agentbay.config.yaml": stringify({ adapter: "claude-code" }),
  "components/modes/timer/mode.yaml": stringify(timerMode),
  [`components/modes/timer/${anything}`]: "{}\n",
  "components/modes/timer/scripts/thirty-seconds.ts": thirtySecondsScript,
  "components/modes/timer/scripts/wait.ts": waitScript,
};

let beside = "";

let project: ModeProject | undefined;

function opened(): ModeProject {
  assert.ok(project !== undefined, "the project did not open");
  return project;
}

before(async () => {
  beside = await realpath(await mkdtemp(join(tmpdir(), "agentbay-timer-")));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(beside, path)), { recursive: true });
    await writeFile(join(beside, path), text, "utf8");
  }
  project = await openModeProject({ adapter: "claude-code", bindings: {} }, { project: beside, trusted: ["timer"] });
});

after(async () => {
  await project?.close();
  await rm(beside, { recursive: true, force: true });
});

test(
  "a script that overruns the limit its action declares is stopped, and the run fails saying where it was set",
  { timeout: 60_000 },
  async () => {
    const manifest = join(opened().root, "components/modes/timer/mode.yaml");
    assert.equal(
      await opened().failure("timer.take-thirty-seconds", {}),
      `The script was stopped at its time limit of 2 seconds, set by actions.take-thirty-seconds.scriptTimeLimitSeconds in ${manifest}.`,
    );
  },
);

test(
  "a budget of fewer minutes than the declared limit stops the script first, and the run's end says so",
  { timeout: 60_000 },
  async () => {
    assert.equal(
      await opened().failure("timer.take-thirty-seconds-on-a-budget", {}),
      "The script was stopped at its time limit of 1.2 seconds, the minutes left of the run's budget.",
    );
  },
);

test(
  "a command stopped because its step's time ran short returns to the script, which answers, and the run is done",
  { timeout: 60_000 },
  async () => {
    const run = await opened().run("timer.wait", {});
    assert.deepEqual(run.state, { status: "done", output: { verdict: "inconclusive", end: "timed-out" } });
    const command = run.events.find((event) => event.kind === "command");
    const milliseconds = numberField(command?.detail ?? null, "milliseconds");
    assert.ok(milliseconds !== undefined && milliseconds < 10_000, `the command took ${String(milliseconds)} ms`);
  },
);
