import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { ChildProcesses } from "../bay/ports.ts";
import { fieldOf, numberField, textField, toJson, isRecord } from "../bay/json.ts";
import { bay, fakeTerminal, listOf } from "./cli-fixture.ts";
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
    const writer = join(project.root, "components/modes/writer");
    assert.equal(textField(task ?? null, "skillFile"), join(writer, "skills/draft/SKILL.md"));
    assert.equal(textField(task ?? null, "outputSchema"), join(writer, "schemas/draft-output.json"));
    assert.equal(numberField(task ?? null, "round"), 1);
    assert.equal(textField(runOf(ran.json), "notice"), "A task token was issued with this task; it is shown only now.");
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

function query(project: Project, token: string): Promise<{ readonly exitCode: number; readonly output: string }> {
  return bay([
    "call",
    "--tool",
    "db_query",
    JSON.stringify({ token, sql: "select 1 as one" }),
    "--project",
    project.root,
  ]);
}

test("showing a waiting run, alone or in the list, never issues or replaces its token", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const first = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const shown = await bay(["runs", first.runId, ...root, "--json"]);
    const task = fieldOf(runOf(shown.json), "task") ?? null;
    assert.equal(fieldOf(task, "token"), undefined);
    assert.equal(textField(task, "stepKey"), "1#1");
    assert.match(textField(runOf(shown.json), "notice") ?? "", /The token was shown when this task was issued/);
    await bay(["runs", ...root]);
    await bay(["runs", first.runId, "--events", "--full", ...root]);
    assert.equal((await query(project, first.token)).exitCode, 0);
    const resumed = await bay(["resume", first.runId, ...root, "--json"]);
    assert.equal(fieldOf(fieldOf(runOf(resumed.json), "task") ?? null, "token"), undefined);
    assert.equal((await query(project, first.token)).exitCode, 0);
    const human = await bay(["runs", first.runId, ...root]);
    assert.match(human.output, new RegExp(`bay runs ${first.runId} --new-token replaces it`));
    assert.ok(!human.output.includes(first.token));
  });
});

test("runs <id> --new-token replaces the token, and the old one cannot be replayed", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const first = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const renewed = await bay(["runs", first.runId, "--new-token", ...root, "--json"]);
    const second = taskOf(renewed.json);
    assert.notEqual(first.token, second.token);
    assert.match(
      textField(runOf(renewed.json), "notice") ?? "",
      /the token shown earlier for this task no longer works/,
    );
    const replayed = await query(project, first.token);
    assert.equal(replayed.exitCode, 1);
    assert.match(replayed.output, /The token is not valid/);
    assert.equal((await query(project, second.token)).exitCode, 0);
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
    assert.match(
      badInput.output,
      /^components\/modes\/writer\/schemas\/compose-input\.json: .*missing the required field name/m,
    );
    const noWorkflow = await bay(["call", "--workflow", "writer:workflows/none.yaml", ...root]);
    assert.equal(noWorkflow.exitCode, 1);
    assert.match(noWorkflow.output, /Mode writer has no workflow workflows\/none\.yaml/);
  });
});

test("submit takes the output and the task's token, and reads the output from JSON, a file or stdin", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const task = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const output = '{"text":"short"}';
    const badSpend = await bay(["submit", output, "--token", task.token, "--usd", "-2", ...root]);
    assert.equal(badSpend.exitCode, 2);
    assert.match(badSpend.output, /--usd takes a number of at least 0/);
    await project.write("short.json", output);
    const fromFile = await bay(["submit", "@short.json", "--token", task.token, ...root, "--json"], {
      workingDirectory: project.root,
    });
    const retry = taskOf(fromFile.json);
    assert.equal(retry.stepKey, "1#2");
    assert.deepEqual(fieldOf(fieldOf(runOf(fromFile.json), "task") ?? {}, "feedback"), [
      "The note has 5 characters; write at least 20.",
    ]);
    const terminal = fakeTerminal({ input: '{"text":"Hello, Ada, and welcome back."}' });
    const fromStdin = await bay(["submit", "-", "--token", retry.token, "--tokens", "42", ...root, "--json"], {
      terminal,
    });
    assert.equal(fromStdin.exitCode, 0, fromStdin.output);
    assert.equal(textField(runOf(fromStdin.json), "status"), "done");
    assert.equal(numberField(fieldOf(runOf(fromStdin.json), "spent") ?? {}, "tokens"), 42);
    const missing = await bay(["submit", "@nowhere.json", "--token", retry.token, ...root]);
    assert.equal(missing.exitCode, 2);
    assert.match(missing.output, /The file nowhere\.json does not exist\./);
  });
});

test("submit refuses a run or step argument, a missing token, an unknown token and a spent token", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const task = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const output = '{"text":"Hello, Ada, and welcome back."}';
    const named = await bay(["submit", task.runId, task.stepKey, output, "--token", task.token, ...root]);
    assert.equal(named.exitCode, 2);
    assert.match(named.output, /^bay submit takes 1 arguments, but 3 were given\.$/m);
    const runOnly = await bay(["submit", task.runId, output, "--token", task.token, ...root]);
    assert.equal(runOnly.exitCode, 2);
    assert.match(runOnly.output, /^bay submit takes 1 arguments, but 2 were given\.$/m);
    const tokenless = await bay(["submit", output, ...root]);
    assert.equal(tokenless.exitCode, 2);
    assert.match(tokenless.output, /^submit needs --token: the token the task carries\.$/m);
    const unknown = await bay(["submit", output, "--token", "made-up", ...root]);
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.output, /The token is not valid: it was never issued/);
    assert.equal((await bay(["submit", output, "--token", task.token, ...root])).exitCode, 0);
    const spent = await bay(["submit", output, "--token", task.token, ...root]);
    assert.equal(spent.exitCode, 1);
    assert.match(spent.output, new RegExp(`issued for step 1#1 of run ${task.runId}, which is no longer waiting`));
  });
});

test("submit never prints the token of the next skill step, and says how the coordinator gets its task", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const started = await bay(["call", "--workflow", "writer:workflows/twice.yaml", ...root, "--json"]);
    const first = taskOf(started.json);
    assert.equal(first.stepKey, "first/1#1");
    const good = '{"text":"Hello, Ada, and welcome back."}';
    const submitted = await bay(["submit", good, "--token", first.token, ...root, "--json"]);
    assert.equal(submitted.exitCode, 0, submitted.output);
    const task = fieldOf(runOf(submitted.json), "task") ?? null;
    assert.equal(textField(task, "stepKey"), "second/1#1");
    assert.equal(fieldOf(task, "token"), undefined);
    assert.doesNotMatch(submitted.output, /"token":/);
    const notice = textField(runOf(submitted.json), "notice") ?? "";
    assert.match(notice, new RegExp(`bay runs ${first.runId} --new-token gives its task`));
    const second = taskOf((await bay(["runs", first.runId, "--new-token", ...root, "--json"])).json);
    assert.equal(second.stepKey, "second/1#1");
    assert.equal((await query(project, second.token)).exitCode, 0);
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

test("runs shows which run and step asked for a run that call_action started", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const task = taskOf((await bay(["call", "writer.compose", '{"name":"Ada"}', ...root, "--json"])).json);
    const input = { token: task.token, action: "greeting-source.fetch", input: { name: "Bo" } };
    const called = await bay(["call", "--tool", "call_action", JSON.stringify(input), ...root, "--json"]);
    const child = textField(fieldOf(toJson(called.json), "result") ?? null, "run") ?? "";
    const shown = await bay(["runs", child, ...root, "--json"]);
    assert.deepEqual(fieldOf(runOf(shown.json), "askedBy"), { runId: task.runId, stepKey: "1#1" });
    const human = await bay(["runs", child, ...root]);
    assert.match(human.output, new RegExp(`asked for by step 1#1 of run ${task.runId} \\(call_action\\)`));
  });
});

test("resume --extend raises a spent budget and the run continues; too little waits again; --stop ends it", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const started = runOf((await bay(["call", "greeter.tally", '{"name":"Ada"}', ...root, "--json"])).json);
    const runId = textField(started, "id") ?? "";
    assert.equal(textField(started, "waitingFor"), "budget");
    assert.deepEqual(fieldOf(fieldOf(started, "waiting") ?? null, "overrun"), {
      measure: "tokens",
      limit: 5,
      spent: 10,
    });
    const little = runOf((await bay(["resume", runId, "--extend", "tokens=2", ...root, "--json"])).json);
    assert.equal(textField(little, "waitingFor"), "budget");
    const enough = await bay(["resume", runId, "--extend", "tokens=3, usd=1", ...root, "--json"]);
    assert.equal(enough.exitCode, 0);
    assert.equal(textField(runOf(enough.json), "status"), "done");
    assert.deepEqual(fieldOf(runOf(enough.json), "output"), { greeting: "Hello, Ada" });
    const other = textField(
      runOf((await bay(["call", "greeter.tally", '{"name":"Bo"}', ...root, "--json"])).json),
      "id",
    );
    const stopped = await bay(["resume", other ?? "", "--stop", ...root, "--json"]);
    assert.equal(stopped.exitCode, 1);
    assert.equal(textField(runOf(stopped.json), "reason"), "The owner stopped the run.");
  });
});

test("resume --extend refuses unknown measures, negative or missing amounts, and mixed options with exit 2", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const cases: readonly (readonly [readonly string[], RegExp])[] = [
      [["resume", "r", "--extend", "dollars=1"], /--extend names the measure dollars; the measures are items, usd/],
      [["resume", "r", "--extend", "tokens=-1"], /gives tokens the amount -1; an amount is a number of at least 0/],
      [["resume", "r", "--extend", "tokens="], /gives tokens the amount ;/],
      [["resume", "r", "--extend", "tokens=1=2"], /an amount is a number/],
      [["resume", "r", "--extend", "tokens=x"], /an amount is a number/],
      [["resume", "r", "--extend", "tokens=1", "--stop"], /Give at most one of --rerun, --extend and --stop/],
      [["resume", "r", "--stop", "--rerun"], /Give at most one of/],
      [["resume", "--due", "--stop"], /--due wakes every due run and takes no run and no other option/],
      [["resume", "--extend", "tokens=1"], /Name the run to resume, or give --due/],
    ];
    for (const [argv, message] of cases) {
      const ran = await bay([...argv, ...root]);
      assert.equal(ran.exitCode, 2, argv.join(" "));
      assert.match(ran.output, message);
    }
  });
});

test("resume --rerun runs again a step with effects that an unexpected error left unfinished", async () => {
  await withProject(async (project) => {
    const root = ["--project", project.root];
    const childProcesses: ChildProcesses = {
      start: () => {
        throw new Error("no process could start");
      },
    };
    const crashed = await bay(["call", "writer.compose", '{"name":"Ada"}', ...root], { ports: { childProcesses } });
    assert.equal(crashed.exitCode, 1);
    assert.match(crashed.output, /no process could start/);
    const runId = textField(
      listOf(fieldOf(toJson((await bay(["runs", ...root, "--json"])).json), "runs"))[0] ?? null,
      "id",
    );
    const asked = runOf((await bay(["resume", runId ?? "", ...root, "--json"])).json);
    assert.equal(textField(asked, "waitingFor"), "owner");
    const rerun = await bay(["resume", runId ?? "", "--rerun", ...root, "--json"]);
    assert.equal(rerun.exitCode, 0, rerun.output);
    assert.equal(textField(runOf(rerun.json), "waitingFor"), "skill");
  });
});
