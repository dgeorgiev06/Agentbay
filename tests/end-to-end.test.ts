import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";

type Ran = {
  readonly status: number | null;
  readonly json: Json;
  readonly stderr: string;
};

function bayProcess(project: Project, argv: readonly string[]): Ran {
  const result = spawnSync(process.execPath, [project.cli, ...argv, "--project", project.root, "--json"], {
    cwd: project.root,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  const lines = result.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, `bay ${argv.join(" ")} printed:\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, json: parseJson(lines[0] ?? ""), stderr: result.stderr };
}

function runOf(ran: Ran): Json {
  const run = fieldOf(ran.json, "run");
  assert.ok(run !== undefined, JSON.stringify(ran.json));
  return run;
}

function taskOf(ran: Ran): Json {
  const task = fieldOf(runOf(ran), "task");
  assert.ok(task !== undefined, JSON.stringify(ran.json));
  return task;
}

function toolCall(project: Project, name: string, input: Json): Ran {
  return bayProcess(project, ["call", "--tool", name, JSON.stringify(input)]);
}

test("an action runs end to end through the command line: script, skill with a check, script", async () => {
  const project = await makeProject({ ownKernel: true });
  const checked = bayProcess(project, ["check"]);
  assert.equal(checked.status, 0, JSON.stringify(checked.json));
  assert.equal(fieldOf(checked.json, "errors"), 0);

  const called = bayProcess(project, ["call", "writer.compose", '{"name":"Ada"}']);
  assert.equal(called.status, 0);
  assert.equal(textField(runOf(called), "waitingFor"), "skill");
  const task = taskOf(called);
  const runId = textField(task, "runId") ?? "";
  const token = textField(task, "token") ?? "";
  assert.equal(textField(task, "agent"), "agentbay-writer-draft");
  assert.equal(textField(task, "stepKey"), "1#1");
  assert.deepEqual(fieldOf(task, "input"), { name: "Ada", greeting: { greeting: "Hello, Ada" } });

  const queried = toolCall(project, "db_query", { token, sql: "select text from notes" });
  assert.equal(queried.status, 0);
  assert.deepEqual(fieldOf(queried.json, "result"), { columns: ["text"], rows: [["The first note."]] });
  const stolen = toolCall(project, "db_query", { token: `${token.slice(0, -2)}xx`, sql: "select 1" });
  assert.equal(stolen.status, 1);
  assert.match(JSON.stringify(stolen.json), /The token is not valid/);

  const short = toolCall(project, "submit", { token, output: { text: "Too short." } });
  assert.equal(short.status, 0);
  const feedback = fieldOf(short.json, "result") ?? null;
  assert.equal(fieldOf(feedback, "accepted"), false);
  assert.equal(numberField(feedback, "round"), 2);
  assert.deepEqual(fieldOf(feedback, "feedback"), ["The note has 10 characters; write at least 20."]);
  const shown = bayProcess(project, ["runs", runId]);
  assert.equal(textField(runOf(shown), "stepKey"), "1#2");
  assert.equal(numberField(taskOf(shown), "round"), 2);

  assert.equal(fieldOf(taskOf(shown), "token"), undefined);
  const fresh = textField(feedback, "token") ?? "";
  const accepted = toolCall(project, "submit", { token: fresh, output: { text: "Hello, Ada, and welcome back." } });
  assert.deepEqual(fieldOf(accepted.json, "result"), { accepted: true, run: { id: runId, status: "done" } });
  assert.equal(await project.read("out/notes/note.txt"), "Hello, Ada, and welcome back.");

  const events = listOf(fieldOf(runOf(bayProcess(project, ["runs", runId, "--events"])), "events"));
  const order = events
    .map((event) => [textField(event, "kind"), textField(fieldOf(event, "detail") ?? null, "stepKey")])
    .filter(([kind]) => kind !== "tool.called")
    .map(([kind, stepKey]) => (stepKey === undefined ? kind : `${kind ?? ""} ${stepKey}`));
  assert.deepEqual(order, [
    "run.started",
    "step.started 0",
    "step.started 0.call0",
    "step.started 0.call0/0",
    "step.finished 0.call0/0",
    "step.finished 0.call0",
    "step.finished 0",
    "step.started 1",
    "run.waiting 1#1",
    "run.resumed",
    "step.started 1#1.check0",
    "step.finished 1#1.check0",
    "run.waiting 1#2",
    "run.resumed",
    "step.started 1#2.check0",
    "step.finished 1#2.check0",
    "step.finished 1",
    "step.started 2",
    "step.finished 2",
    "run.finished",
  ]);
  const tools = events.filter((event) => textField(event, "kind") === "tool.called");
  assert.deepEqual(
    tools.map((event) => textField(fieldOf(event, "detail") ?? null, "tool")),
    ["db_query", "submit", "submit"],
  );
  await project.remove();
});

test("a workflow waits for an approval that only the owner can give, from a terminal or from chat if allowed", async () => {
  const project = await makeProject({ ownKernel: true });
  const started = bayProcess(project, ["call", "--workflow", "writer:workflows/review.yaml", '{"name":"Cy"}']);
  const run = runOf(started);
  const runId = textField(run, "id") ?? "";
  const waiting = fieldOf(run, "waiting") ?? null;
  assert.equal(textField(waiting, "reason"), "approval");
  const hash = textField(waiting, "hash") ?? "";
  assert.match(hash, /^[0-9a-f]{64}$/);

  const piped = bayProcess(project, ["approve", runId, "keep", "--hash", hash]);
  assert.equal(piped.status, 1);
  assert.match(JSON.stringify(piped.json), /needs an interactive terminal/);
  const chatOff = bayProcess(project, [
    "approve",
    runId,
    "keep",
    "--hash",
    hash,
    "--via",
    "chat",
    "--quote",
    "keep it",
  ]);
  assert.equal(chatOff.status, 1);
  assert.match(JSON.stringify(chatOff.json), /Approvals from chat are off/);
  assert.equal(textField(runOf(bayProcess(project, ["runs", runId])), "status"), "waiting");

  const config = await project.read("agentbay.config.yaml");
  await project.write("agentbay.config.yaml", `${config}approvals:\n  from: [terminal, chat]\n`);
  const approved = bayProcess(project, [
    "approve",
    runId,
    "keep",
    "--hash",
    hash,
    "--via",
    "chat",
    "--quote",
    "keep it",
  ]);
  assert.equal(approved.status, 0, JSON.stringify(approved.json));
  assert.equal(textField(runOf(approved), "status"), "done");
  assert.deepEqual(fieldOf(runOf(approved), "output"), { greeting: "Hello, Cy" });
  const events = listOf(fieldOf(runOf(bayProcess(project, ["runs", runId, "--events"])), "events"));
  const recorded = events.find((event) => textField(event, "kind") === "approval.recorded");
  assert.deepEqual(fieldOf(recorded ?? null, "detail"), {
    stepKey: "keep",
    hash,
    decision: "approve",
    by: 'owner via chat, quoted: "keep it"',
  });
  await project.remove();
});
