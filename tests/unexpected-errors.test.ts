import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { DatabaseProcess } from "../bay/database-process.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { lastResortHandler, lastResortWording } from "../bay/last-resort.ts";
import { replyTo } from "../bay/mcp-server.ts";
import { nodeChildProcesses, nodeFileInspector, nodeFileSystem, systemClock } from "../bay/node-ports.ts";
import { createScriptRunner } from "../bay/script-runner.ts";
import { SecretStore } from "../bay/secrets.ts";
import type { ChildProcesses } from "../bay/ports.ts";
import { issueTaskToken } from "../bay/task-tokens.ts";
import { callKernelTool } from "../bay/tools.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingSink,
  scriptedHttp,
  sdkFile,
  withProject,
  writeProjectFile,
} from "./broker-fixture.ts";
import { bay } from "./cli-fixture.ts";
import { harness, finished, problemsOf, runOf } from "./engine-fixture.ts";
import { openProject, testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject, type Project } from "./project-fixture.ts";

const anything = `${JSON.stringify({ type: "object" })}\n`;

async function addProber(project: Project, scriptBody: readonly string[]): Promise<void> {
  const mode = {
    name: "prober",
    version: "1.0.0",
    description: "Reads what its script is told to read.",
    resources: { files: { read: ["data/"] } },
    actions: {
      probe: {
        input: "schemas/anything.json",
        output: "schemas/anything.json",
        effects: ["read"],
        run: [{ script: "scripts/probe.ts" }],
      },
    },
  };
  const script = [
    'import { defineScript, fail } from "agentbay/sdk";',
    "",
    "export const run = defineScript(async (input, context) => {",
    ...scriptBody,
    "});",
    "",
  ];
  await project.write("components/modes/prober/mode.yaml", stringify(mode));
  await project.write("components/modes/prober/schemas/anything.json", anything);
  await project.write("components/modes/prober/scripts/probe.ts", script.join("\n"));
  await mkdir(join(project.root, "data", "inner"), { recursive: true });
}

type Spawned = { readonly status: number | null; readonly json: Json; readonly stderr: string };

function spawnedBay(project: Project, argv: readonly string[]): Spawned {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), ...argv, "--json"], {
    cwd: project.root,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  const lines = result.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, `bay ${argv.join(" ")} printed:\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, json: parseJson(lines[0] ?? ""), stderr: result.stderr };
}

test("a script that reads a folder as a file gets a failed answer; bay call prints one JSON object", async () => {
  const project = await makeProject();
  try {
    await addProber(project, [
      '  const read = await context.files.read("data/inner");',
      "  return read.ok ? { text: read.value } : fail(read.message);",
    ]);
    const called = spawnedBay(project, ["call", "prober.probe", "{}"]);
    assert.equal(called.status, 1, called.stderr);
    assert.doesNotMatch(called.stderr, new RegExp(lastResortWording));
    const run = fieldOf(called.json, "run") ?? null;
    assert.equal(textField(run, "status"), "failed");
    assert.match(textField(run, "reason") ?? "", /could not read data\/inner/);
    const runId = textField(run, "id") ?? "";
    const resumed = spawnedBay(project, ["resume", runId]);
    assert.match(JSON.stringify(resumed.json), /has ended \(failed\)/);
  } finally {
    await project.remove();
  }
});

test("a script whose call to another action throws gets a failed answer and the step ends", async () => {
  await withProject(async (root) => {
    const script = [
      `import { defineScript, fail } from ${JSON.stringify(sdkFile)};`,
      "export const run = defineScript(async (input, context) => {",
      '  const asked = await context.call("store.get", {});',
      "  return asked.ok ? { asked: asked.value } : fail(asked.message);",
      "});",
      "",
    ];
    await writeProjectFile(root, "components/modes/notes/scripts/probe.ts", script.join("\n"));
    const runner = createScriptRunner({
      layout: projectLayout(root),
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
      script: "scripts/probe.ts",
      input: null,
      permissions: permissionsIn(root),
      settings: {},
      remaining: {},
      timeLimitMilliseconds: 30_000,
      call: () => Promise.reject(new Error("the run store went away")),
    });
    assert.ok(outcome.status === "failed", JSON.stringify(outcome));
    assert.match(outcome.reason, /The call to store.get stopped at an unexpected/);
  });
});

test("files_write onto a folder is a refusal, not a rejected tool call", async () => {
  const opened = await openProject();
  try {
    const { kernel, project } = opened;
    const result = await kernel.engine.startAction("writer.compose", { name: "Ada" });
    assert.ok(result.ok && result.run.state.status === "waiting", JSON.stringify(result));
    const place = { runId: result.run.id, stepKey: result.run.state.waiting.stepKey, round: 1 };
    const token = await issueTaskToken(kernel.store, place, new Date());
    await mkdir(join(project.root, "out", "notes", "taken"), { recursive: true });
    const written = await callKernelTool(kernel, "files_write", { token, path: "out/notes/taken", text: "x" });
    assert.ok(!written.ok);
    assert.match(written.refusal, /could not write out\/notes\/taken/);
  } finally {
    await opened.close();
  }
});

test("a migration that cannot be read makes db_query a refusal, not a rejected tool call", async () => {
  const opened = await openProject();
  try {
    const { kernel, project } = opened;
    await mkdir(join(project.root, "components", "modes", "writer", "migrations", "0002-folder.sql"));
    const result = await kernel.engine.startAction("writer.compose", { name: "Ada" });
    assert.ok(result.ok && result.run.state.status === "waiting", JSON.stringify(result));
    const place = { runId: result.run.id, stepKey: result.run.state.waiting.stepKey, round: 1 };
    const token = await issueTaskToken(kernel.store, place, new Date());
    const queried = await callKernelTool(kernel, "db_query", { token, sql: "select 1" });
    assert.ok(!queried.ok);
    assert.match(queried.refusal, /could not read the migrations/);
  } finally {
    await opened.close();
  }
});

test("a tool server that throws still answers the request, without the error's text", async () => {
  const server = {
    definitions: [],
    call: () => Promise.reject(new Error("disk on fire, token=abcdefghijklmnop")),
  };
  const line = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "files_read" } });
  const reply = parseJson((await replyTo(server, line)) ?? "");
  assert.equal(fieldOf(reply, "id"), 7);
  const error = fieldOf(reply, "error") ?? null;
  assert.equal(fieldOf(error, "code"), -32603);
  assert.doesNotMatch(JSON.stringify(reply), /disk on fire|abcdefghijklmnop/);
});

test("a database process whose end cannot be observed answers its waiting requests with an error", async () => {
  const childProcesses: ChildProcesses = {
    start: () => ({
      send: () => undefined,
      kill: () => undefined,
      ended: Promise.reject(new Error("the process table is gone")),
    }),
  };
  const database = new DatabaseProcess({ childProcesses, databaseFile: "/x.db", lifetimeMilliseconds: 1000 });
  const result = await database.request({ method: "query", sql: "select 1", parameters: [] });
  assert.ok(result.status === "error", JSON.stringify(result));
  assert.match(result.message, /could not be watched/);
});

test("an engine whose runner throws returns a problem, releases the lock and can resume the run", async () => {
  let throwing = true;
  const setup = await harness({
    scripts: {
      "notes:scripts/add-one.ts": (request) => {
        if (throwing) {
          throw new Error("the runner broke on SECRET-ABC123");
        }
        const count = fieldOf(request.input, "count");
        return finished({ count: (typeof count === "number" ? count : 0) + 1 });
      },
    },
  });
  try {
    const started = await setup.engine.startAction("notes.copy", { count: 1 });
    const [problem] = problemsOf(started);
    assert.match(problem ?? "", /stopped at an unexpected error: the runner broke on \[redacted\]/);
    throwing = false;
    const resumed = await setup.freshEngine().resume("run-1");
    assert.deepEqual(runOf(resumed).state, { status: "done", output: { count: 5 } });
  } finally {
    setup.close();
  }
});

test("a command whose files cannot be read prints one JSON object with the reason", async () => {
  const unreadable = {
    ...nodeFileSystem,
    readText: () => Promise.reject(new Error("EACCES: permission denied, open 'agentbay.config.yaml'")),
  };
  const project = await makeProject();
  try {
    const ran = await bay(["check", "--project", project.root, "--json"], { ports: { files: unreadable } });
    assert.equal(ran.exitCode, 1);
    assert.match(JSON.stringify(ran.json), /stopped at an unexpected error: EACCES: permission denied/);
    const runs = await bay(["runs", "--project", project.root, "--json"], { ports: { files: unreadable } });
    assert.equal(runs.exitCode, 1);
    assert.match(JSON.stringify(runs.json), /stopped at an unexpected error/);
  } finally {
    await project.remove();
  }
});

test("the last-resort handler prints one line and exits non-zero", () => {
  const written: string[] = [];
  const exits: number[] = [];
  const handler = lastResortHandler("bay", {
    write: (text) => written.push(text),
    exit: (code) => exits.push(code),
  });
  handler(new Error("first line\nsecond line with token=abcdefghijklmnopqrstuvwxyz"));
  assert.deepEqual(exits, [70]);
  assert.equal(written.length, 1);
  assert.equal(written[0], `bay: ${lastResortWording}: first line\n`);
});
