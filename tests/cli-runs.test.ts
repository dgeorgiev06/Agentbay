import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, textField, toJson } from "../bay/json.ts";
import { bay, fakeTerminal, listOf } from "./cli-fixture.ts";
import { isRecord } from "../bay/spec.ts";
import { makeProject, type Project } from "./project-fixture.ts";

type Task = {
  readonly runId: string;
  readonly stepKey: string;
  readonly token: string;
};

function runOf(json: unknown): Json {
  const run = fieldOf(toJson(json), "run");
  assert.ok(run !== undefined, JSON.stringify(json));
  return run;
}

function taskOf(json: unknown): Task {
  const task = fieldOf(runOf(json), "task");
  assert.ok(task !== undefined, JSON.stringify(json));
  return {
    runId: textField(task, "runId") ?? "",
    stepKey: textField(task, "stepKey") ?? "",
    token: textField(task, "token") ?? "",
  };
}

async function withProject(body: (project: Project) => Promise<void>): Promise<void> {
  const project = await makeProject();
  try {
    await body(project);
  } finally {
    await project.remove();
  }
}

test("call starts an action and prints the waiting skill's task with every field the contract names", async () => {
  await withProject(async (project) => {
    const ran = await bay(["call", "writer.compose", '{"name":"Ada"}', "--project", project.root, "--json"]);
    assert.equal(ran.exitCode, 0, ran.output);
    const task = fieldOf(runOf(ran.json), "task");
    assert.deepEqual(Object.keys(isObject(task)).sort(), [
      "agent",
      "feedback",
      "input",
      "outputSchema",
      "round",
      "runId",
      "skillFile",
      "stepKey",
      "token",
    ]);
    assert.equal(textField(task ?? null, "agent"), "agentbay-writer-draft");
    assert.equal(textField(task ?? null, "stepKey"), "1#1");
    assert.equal(textField(task ?? null, "skillFile"), "components/modes/writer/skills/draft/SKILL.md");
    assert.equal(textField(task ?? null, "outputSchema"), "components/modes/writer/schemas/draft-output.json");
    assert.equal(numberField(task ?? null, "round"), 1);
    assert.match(textField(runOf(ran.json), "notice") ?? "", /no longer works/);
    const text = await bay(["call", "greeter.fetch", '{"name":"Bo"}', "--project", project.root]);
    assert.equal(text.exitCode, 0);
    assert.match(
      text.output,
      /^run \S+ \(action greeter\.fetch\): done\noutput:\n\{\n {2}"greeting": "Hello, Bo"\n\}$/,
    );
  });
});

function isObject(value: Json | undefined): Readonly<Record<string, unknown>> {
  assert.ok(isRecord(value));
  return value;
}

test("showing a waiting task again issues a fresh token and kills the old one", async () => {
  await withProject(async (project) => {
    const first = taskOf(
      (await bay(["call", "writer.compose", '{"name":"Ada"}', "--project", project.root, "--json"])).json,
    );
    const shown = await bay(["runs", first.runId, "--project", project.root, "--json"]);
    const second = taskOf(shown.json);
    assert.notEqual(first.token, second.token);
    const query = (token: string): Promise<{ readonly exitCode: number; readonly output: string }> =>
      bay(["call", "--tool", "db_query", JSON.stringify({ token, sql: "select 1 as one" }), "--project", project.root]);
    assert.equal((await query(first.token)).exitCode, 1);
    assert.match((await query(first.token)).output, /The token is not valid/);
    assert.equal((await query(second.token)).exitCode, 0);
    const human = await bay(["runs", first.runId, "--project", project.root]);
    assert.match(human.output, /A new task token was issued with this task; any token shown earlier/);
  });
});

test("call refuses a wrong command line with exit 2 and an engine refusal with exit 1", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    for (const argv of [
      ["call", "writer.compose", "{not json"],
      ["call"],
      ["call", "--tool", "db_query", "--workflow", "writer:workflows/review.yaml", "{}"],
      ["call", "--workflow", "review", "{}"],
      ["call", "--tool", "db_query", "{}", "{}"],
    ]) {
      assert.equal((await bay([...argv, ...root])).exitCode, 2, argv.join(" "));
    }
    const unknown = await bay(["call", "writer.erase", "{}", ...root]);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.output, /Mode writer has no action erase; it has: compose\./);
    const badInput = await bay(["call", "writer.compose", '{"nom":"x"}', ...root]);
    assert.equal(badInput.exitCode, 1);
    assert.match(badInput.output, /missing the required field name/);
    const noWorkflow = await bay(["call", "--workflow", "writer:workflows/none.yaml", ...root]);
    assert.equal(noWorkflow.exitCode, 1);
    assert.match(noWorkflow.output, /Mode writer has no workflow workflows\/none\.yaml/);
  });
});

test("submit needs the task's own token and reads the output from JSON, a file or stdin", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const task = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const other = taskOf((await bay(["call", "writer.compose", '{"name":"Bo"}', ...root, "--json"])).json);
    const output = '{"text":"short"}';
    assert.equal((await bay(["submit", task.runId, task.stepKey, output, ...root])).exitCode, 2);
    const wrong = await bay(["submit", task.runId, task.stepKey, output, "--token", other.token, ...root]);
    assert.equal(wrong.exitCode, 1);
    assert.match(wrong.output, new RegExp(`The token belongs to step 1#1 of run ${other.runId}`));
    const badSpend = await bay([
      "submit",
      task.runId,
      task.stepKey,
      output,
      "--token",
      task.token,
      "--usd",
      "-2",
      ...root,
    ]);
    assert.equal(badSpend.exitCode, 2);
    assert.match(badSpend.output, /--usd takes a number of at least 0/);
    await project.write("short.json", output);
    const fromFile = await bay(
      ["submit", task.runId, task.stepKey, "@short.json", "--token", task.token, ...root, "--json"],
      {
        workingDirectory: project.root,
      },
    );
    const retry = taskOf(fromFile.json);
    assert.equal(retry.stepKey, "1#2");
    assert.deepEqual(fieldOf(fieldOf(runOf(fromFile.json), "task") ?? {}, "feedback"), [
      "The note has 5 characters; write at least 20.",
    ]);
    const terminal = fakeTerminal({ input: '{"text":"Hello, Ada, and welcome back."}' });
    const fromStdin = await bay(
      ["submit", task.runId, retry.stepKey, "-", "--token", retry.token, "--tokens", "42", ...root, "--json"],
      { terminal },
    );
    assert.equal(fromStdin.exitCode, 0, fromStdin.output);
    assert.equal(textField(runOf(fromStdin.json), "status"), "done");
    assert.equal(numberField(fieldOf(runOf(fromStdin.json), "spent") ?? {}, "tokens"), 42);
    const missing = await bay(["submit", task.runId, "1#3", "@nowhere.json", "--token", retry.token, ...root]);
    assert.equal(missing.exitCode, 2);
  });
});

test("runs lists every run newest first, and shows one run's steps, payloads with --full and events", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    assert.equal((await bay(["runs", ...root])).output, "No runs yet.");
    const older = runOf((await bay(["call", "greeter.fetch", '{"name":"A"}', ...root, "--json"])).json);
    const newer = runOf((await bay(["call", "writer.compose", '{"name":"B"}', ...root, "--json"])).json);
    const listed = await bay(["runs", ...root, "--json"]);
    const runs = listOf(fieldOf(toJson(listed.json), "runs"));
    assert.deepEqual(
      runs.map((run) => [textField(run, "id"), textField(run, "status"), textField(run, "waitingFor") ?? null]),
      [
        [textField(newer, "id"), "waiting", "skill"],
        [textField(older, "id"), "done", null],
      ],
    );
    const id = textField(older, "id") ?? "";
    const shown = runOf((await bay(["runs", id, ...root, "--json"])).json);
    const steps = listOf(fieldOf(shown, "steps"));
    assert.equal(fieldOf(steps[0] ?? null, "input"), undefined);
    assert.equal(numberField(steps[0] ?? null, "inputBytes"), Buffer.byteLength(JSON.stringify({ name: "A" })));
    const full = runOf((await bay(["runs", id, "--full", ...root, "--json"])).json);
    const fullSteps = listOf(fieldOf(full, "steps"));
    assert.deepEqual(fieldOf(fullSteps[0] ?? null, "output"), { greeting: "Hello, A" });
    const events = await bay(["runs", id, "--events", ...root]);
    assert.match(events.output, /events:\n.*run\.started.*\n.*step\.started.*\n.*step\.finished.*\n.*run\.finished/);
    const unknown = await bay(["runs", "no-such-run", ...root]);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.output, /There is no run no-such-run/);
  });
});

test("resume continues a run, refuses an ended one, and --due wakes nothing when nothing is due", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    for (const argv of [["resume"], ["resume", "x", "--due"], ["resume", "--due", "--rerun"]]) {
      assert.equal((await bay([...argv, ...root])).exitCode, 2, argv.join(" "));
    }
    const waiting = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const resumed = await bay(["resume", waiting.runId, ...root, "--json"]);
    assert.equal(resumed.exitCode, 0);
    assert.equal(taskOf(resumed.json).stepKey, "1#1");
    const ended = runOf((await bay(["call", "greeter.fetch", '{"name":"A"}', ...root, "--json"])).json);
    const again = await bay(["resume", textField(ended, "id") ?? "", ...root]);
    assert.equal(again.exitCode, 1);
    assert.match(again.output, /has ended \(done\)/);
    const due = await bay(["resume", "--due", ...root, "--json"]);
    assert.deepEqual(due.json, { ok: true, woken: [] });
  });
});

test("a project with problems makes every command that needs the kernel print them, exit 1", async () => {
  await withProject(async (project) => {
    await project.write("agentbay.config.yaml", "adapter: fake\n");
    for (const argv of [["runs"], ["call", "greeter.fetch", "{}"], ["config"], ["resume", "--due"]]) {
      const ran = await bay([...argv, "--project", project.root]);
      assert.equal(ran.exitCode, 1, argv.join(" "));
      assert.match(
        ran.output,
        /agentbay\.config\.yaml:1: This file is missing the required field bindings\.\n  fix: Add bindings\./,
      );
    }
  });
});
