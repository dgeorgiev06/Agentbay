import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { noInterfaceSchemas } from "./broker-fixture.ts";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { lastResortHandler } from "../bay/last-resort.ts";
import { replyTo } from "../bay/mcp-server.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import { createBroker } from "../bay/broker/broker.ts";
import { SecretStore } from "../bay/secrets.ts";
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
import { finished, messagesOf, openedRuns, runOf, secretValue } from "./runs-fixture.ts";
import { openProject, startedTask, testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject, type Project } from "./project-fixture.ts";
import { problemText } from "../bay/outcome.ts";

const anything = `${JSON.stringify({ type: "object" })}\n`;

async function addProber(project: Project, scriptBody: readonly string[]): Promise<void> {
  const mode = {
    name: "prober",
    version: "1.0.0",
    description: "Reads what its script is told to read.",
    resources: { files: { read: ["data/"] } },
    actions: {
      probe: {
        description: "When a test probes a file.",
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
    assert.doesNotMatch(called.stderr, /an error escaped every handler/);
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
    const runner = createBroker({
      layout: projectLayout(root),
      files: nodeFileSystem,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events: recordingSink(),
      clock: systemClock,
      childProcesses: nodeChildProcesses,
      processes: noProcesses,
      commandSearchPath: "/usr/bin:/bin",
      interfaceSchemas: noInterfaceSchemas,
    }).scripts;
    const outcome = await runner.run({
      place,
      script: "scripts/probe.ts",
      input: null,
      permissions: permissionsIn(root),
      settings: {},
      remaining: {},
      timeLimitMilliseconds: 30_000,
      timeLimitSetBy: "kernel",
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
    const { token } = await startedTask(kernel, "writer.compose", { name: "Ada" });
    await mkdir(join(project.root, "out", "notes", "taken"), { recursive: true });
    const written = await callKernelTool(kernel, "files_write", { token, path: "out/notes/taken", text: "x" });
    assert.ok(!written.ok);
    assert.match(problemText(written.problems), /could not write out\/notes\/taken/);
  } finally {
    await opened.close();
  }
});

test("a migration that cannot be read makes db_query a refusal, not a rejected tool call", async () => {
  const opened = await openProject();
  try {
    const { kernel, project } = opened;
    await mkdir(join(project.root, "components", "modes", "writer", "migrations", "0002-folder.sql"));
    const { token } = await startedTask(kernel, "writer.compose", { name: "Ada" });
    const queried = await callKernelTool(kernel, "db_query", { token, sql: "select 1" });
    assert.ok(!queried.ok);
    assert.match(problemText(queried.problems), /could not read the migrations/);
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

test("a run whose runner throws returns a problem, releases the lock and can be resumed", async () => {
  let throwing = true;
  const setup = await openedRuns({
    scripts: {
      "notes:scripts/add-one.ts": (request) => {
        if (throwing) {
          throw new Error(`the runner broke on ${secretValue}`);
        }
        const count = fieldOf(request.input, "count");
        return finished({ count: (typeof count === "number" ? count : 0) + 1 });
      },
    },
  });
  try {
    const started = await setup.runs.start({ action: "notes.copy" }, { count: 1 });
    assert.match(messagesOf(started), /stopped at an unexpected error: the runner broke on \[redacted:NOTES_TOKEN\]/);
    const [run] = await setup.runs.list();
    assert.ok(run?.status === "running");
    throwing = false;
    const resumed = await (await setup.reopen()).resume(run.id);
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

test("bay exits 70 with one line on stderr when it breaks before any command handler runs", async () => {
  const project = await makeProject({ ownKernel: true });
  try {
    await project.write(
      "bay/bay-command.ts",
      'export function bayCommand(): never {\n  throw new Error("The command line broke before any handler ran.");\n}\n',
    );
    const result = spawnSync(process.execPath, [project.cli, "actions", "--json"], {
      cwd: project.root,
      env: testEnvironment,
      input: "",
      encoding: "utf8",
    });
    assert.equal(result.status, 70, result.stdout + result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^internal error: The command line broke before any handler ran\.$/m);
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
  assert.equal(written[0], "bay: an error escaped every handler and agentbay stopped: first line\n");
});

test("a kernel tool whose skill file cannot be read answers with a refusal, not a rejection", async () => {
  const opened = await openProject();
  try {
    const { kernel, project } = opened;
    const { token } = await startedTask(kernel, "writer.compose", { name: "Ada" });
    const skillFile = join(project.root, "components", "modes", "writer", "skills", "draft", "SKILL.md");
    await rm(skillFile);
    await mkdir(skillFile);
    const queried = await callKernelTool(kernel, "db_query", { token, sql: "select 1" });
    assert.ok(!queried.ok);
    assert.match(problemText(queried.problems), /The tool db_query stopped at an unexpected error: EISDIR/);
  } finally {
    await opened.close();
  }
});

test("a command that fails inside the kernel answers with a problem that says the run can be resumed", async () => {
  const project = await makeProject();
  try {
    const terminal = {
      isInteractive: () => true,
      ask: () => Promise.reject(new Error("the terminal went away")),
      readAll: () => Promise.resolve(""),
    };
    const argv = ["approve", "no-run", "keep", "--hash", "abc", "--project", project.root, "--json"];
    const ran = await bay(argv, { terminal });
    assert.equal(ran.exitCode, 1);
    const text = JSON.stringify(ran.json);
    assert.match(text, /bay stopped at an unexpected error: the terminal went away/);
    assert.match(text, /a run it was advancing can be resumed/);
  } finally {
    await project.remove();
  }
});
