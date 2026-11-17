import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { makeProject } from "./project-fixture.ts";
import { openModeProject, type ModeProject, type Run } from "./test-toolbox.ts";

const toolboxFile = new URL("./test-toolbox.ts", import.meta.url);

const config = {
  bindings: { "greeting-source": "greeter" },
  adapter: "claude-code",
  settings: { writer: { signature: "Yours, the writer" } },
};

async function withProject(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await makeProject();
  const project = await openModeProject(config, { project: beside.root });
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

type WaitingTask = {
  readonly token: string;
  readonly round: number;
  readonly feedback: readonly string[];
};

function waitingTaskOf(run: Run): WaitingTask {
  if (run.state.status !== "waiting" || run.state.waiting.reason !== "skill") {
    assert.fail(`expected the run to wait for a skill, got ${JSON.stringify(run.state)}`);
  }
  const task = run.state.waiting.task;
  assert.ok(task.token !== undefined, "the task carries no token");
  return { token: task.token, round: task.round, feedback: task.feedback };
}

function exportedNames(text: string): readonly string[] {
  const found = text.matchAll(/^export (?:async function|function|type|const) (\w+)/gm);
  return [...found].map((match) => match[1] ?? "").sort();
}

test("the test toolbox exports these names and no others", async () => {
  const text = await readFile(toolboxFile, "utf8");
  assert.deepEqual(exportedNames(text), [
    "CallOptions",
    "Decision",
    "ModeProject",
    "ProjectFolder",
    "ProjectOptions",
    "Run",
    "openModeProject",
  ]);
  assert.deepEqual(text.match(/^export\b(?! (?:async function|function|type|const) \w+)/gm), null);
});

test("a project opened with the modes of a project beside the kit offers these operations and no others", async () => {
  await withProject(async (project) => {
    assert.deepEqual(Object.keys(project).sort(), [
      "answer",
      "answerRefusal",
      "approve",
      "close",
      "extend",
      "failure",
      "output",
      "partition",
      "refusal",
      "reopen",
      "root",
      "run",
      "runWorkflow",
      "runs",
      "setTime",
    ]);
    assert.deepEqual(await project.output("greeter.fetch", { name: "Ada" }), { greeting: "Hello, Ada" });
  });
});

async function writtenConfig(project: ModeProject): Promise<unknown> {
  return parse(await readFile(join(project.root, "agentbay.config.yaml"), "utf8"));
}

test("a folder inside a project opens that project, its config under the one given, and again when it is reopened", async () => {
  const beside = await makeProject();
  const inside = join(beside.root, "components/modes/writer/tests");
  const given = { bindings: {}, adapter: "claude-code", settings: { writer: { signature: "From the test" } } };
  let project = await openModeProject({ ...given, modes: ["store"] }, { project: inside });
  try {
    assert.deepEqual(await writtenConfig(project), {
      bindings: { "greeting-source": "greeter" },
      adapter: "claude-code",
      settings: { writer: { signature: "From the test" } },
      modes: ["store"],
    });
    assert.deepEqual(await project.output("greeter.fetch", { name: "Ada" }), { greeting: "Hello, Ada" });
    project = await project.reopen({ bindings: {}, adapter: "claude-code" });
    assert.deepEqual(await writtenConfig(project), {
      bindings: { "greeting-source": "greeter" },
      adapter: "claude-code",
      settings: { writer: { signature: "Yours, the writer" } },
      modes: [],
    });
    const run = await project.run("writer.compose", { name: "Ada" });
    assert.equal(run.state.status === "waiting" ? run.state.waiting.reason : run.state.status, "skill");
  } finally {
    await project.close();
    await beside.remove();
  }
});

test("a project's mode with the name of a kit mode is refused, and the kit's mode does not take its place", async () => {
  const beside = await makeProject();
  const manifest = { name: "store", version: "1.0.0", description: "Has the name of a kit mode.", actions: {} };
  await beside.write("components/modes/store/mode.yaml", stringify(manifest));
  try {
    await assert.rejects(openModeProject(config, { project: beside.root }), /Two modes are named store/);
  } finally {
    await beside.remove();
  }
});

test("a folder that is in no project is refused with a reason", async () => {
  await assert.rejects(
    openModeProject(config, { project: tmpdir() }),
    /no folder at or above the one given holds agentbay.config.yaml/,
  );
});

const innerFiles = ["../bay/kernel.ts", "../bay/runs/runs.ts", "../bay/ports.ts"];

function namesImportedFrom(text: string, files: readonly string[]): readonly string[] {
  const imports = text.matchAll(/^import (?:type )?\{([^}]*)\} from "([^"]+)";$/gm);
  return [...imports].flatMap(([, names = "", file = ""]) =>
    files.includes(file) || file.startsWith("../bay/broker/")
      ? names.split(",").map((name) => name.replace(/^\s*type\s+/, "").trim())
      : [],
  );
}

function declaredTypes(text: string): readonly string[] {
  return text
    .split(/^(?=export |type |function |async function |const )/m)
    .filter((part) => /^(?:export )?type /.test(part));
}

test("no type the test toolbox declares names the kernel, the runs entry, the broker or a port", async () => {
  const text = await readFile(toolboxFile, "utf8");
  const inner = namesImportedFrom(text, innerFiles);
  assert.deepEqual([...inner].sort(), ["Clock", "Kernel", "loadKernel", "nodeKernelPorts"]);
  const naming = declaredTypes(text).filter((part) => inner.some((name) => new RegExp(`\\b${name}\\b`).test(part)));
  assert.deepEqual(
    naming.map((part) => part.split("=")[0]?.trim()),
    ["type SettableClock"],
  );
});

test("a refused call is a refusal, never an output or a failure, and an accepted call is no refusal", async () => {
  await withProject(async (project) => {
    assert.equal(await project.refusal("greeter.fetch", {}), "input is missing the required field name.");
    await assert.rejects(project.output("greeter.fetch", {}), /missing the required field name/);
    await assert.rejects(project.failure("greeter.fetch", {}), /missing the required field name/);
    await assert.rejects(project.refusal("greeter.fetch", { name: "Ada" }), /expected greeter.fetch to be refused/);
    await assert.rejects(project.failure("greeter.fetch", { name: "Ada" }), /expected the run to fail/);
  });
});

test("runs lists each run with its id and where it stands", async () => {
  await withProject(async (project) => {
    assert.deepEqual(await project.runs(), []);
    const run = await project.run("greeter.fetch", { name: "Ada" });
    assert.deepEqual(await project.runs(), [{ id: run.id, status: "done" }]);
  });
});

test("a skill step is answered as the agent would: a refused answer is a refusal, a checked one comes back", async () => {
  await withProject(async (project) => {
    const first = waitingTaskOf(await project.run("writer.compose", { name: "Ada" }));
    assert.equal(await project.answerRefusal(first.token, {}), "output is missing the required field text.");
    await assert.rejects(project.answer(first.token, {}), /missing the required field text/);
    const second = waitingTaskOf(await project.answer(first.token, { text: "short" }));
    assert.deepEqual([second.round, second.feedback], [2, ["The note has 5 characters; write at least 20."]]);
    const done = await project.answer(second.token, { text: "Hello, Ada, and welcome back." });
    assert.deepEqual(done.state, {
      status: "done",
      output: { text: "Hello, Ada, and welcome back.", saved: "out/notes/note.txt" },
    });
  });
});

test("an answer that is accepted is no refusal", async () => {
  await withProject(async (project) => {
    const first = waitingTaskOf(await project.run("writer.compose", { name: "Ada" }));
    await assert.rejects(project.answerRefusal(first.token, { text: "short" }), /expected the answer to be refused/);
  });
});

test("a run that waits for budget goes on when its budget is extended", async () => {
  await withProject(async (project) => {
    const run = await project.run("greeter.tally", { name: "Ada" });
    assert.equal(run.state.status === "waiting" ? run.state.waiting.reason : run.state.status, "budget");
    const extended = await project.extend(run.id, { tokens: 10 });
    assert.deepEqual(extended.state, { status: "done", output: { greeting: "Hello, Ada" } });
    assert.equal(extended.spent.tokens, 10);
  });
});

test("a workflow is started with its input and goes on when the owner approves what it shows", async () => {
  await withProject(async (project) => {
    const review = await project.runWorkflow("writer", "workflows/review.yaml", { name: "Ada" });
    if (review.state.status !== "waiting" || review.state.waiting.reason !== "approval") {
      assert.fail(`expected an approval, got ${JSON.stringify(review.state)}`);
    }
    const shown = review.state.waiting;
    assert.deepEqual(shown.content, { greeting: "Hello, Ada" });
    const decision = { stepKey: shown.stepKey, hash: shown.hash, verdict: "approve" as const, by: "the owner" };
    const done = await project.approve(review.id, decision);
    assert.equal(done.state.status, "done");
  });
});

test("a mode's database is reached through the broker, with the rules a script's call has", async () => {
  await withProject(async (project) => {
    const partition = project.partition("writer", "owner");
    assert.deepEqual(await partition.query("select text from notes"), {
      ok: false,
      kind: "failed",
      message: "The mode writer has no database yet; run its migrations first.",
    });
    assert.deepEqual(await partition.migrate(), { ok: true, value: ["0001-notes.sql"] });
    const refused = await partition.query("select 1; select 2");
    assert.equal(
      refused.ok ? "" : refused.message,
      "The step test-toolbox asked to run more than one statement in one call, " +
        "but the broker runs exactly one statement per call. Send each statement in its own call.",
    );
    assert.deepEqual(await partition.query("select text from notes"), {
      ok: true,
      value: [{ text: "The first note." }],
    });
  });
});
