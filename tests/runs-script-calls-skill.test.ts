import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json, RunEvent } from "../bay/contracts.ts";
import { fieldOf, isRecord, textField, toJson } from "../bay/json.ts";
import { bay } from "./cli-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";
import { openModeProject, type ModeProject, type Run } from "./test-toolbox.ts";

const config = {
  bindings: { "greeting-source": "greeter" },
  adapter: "claude-code",
};

const folder = "components/modes/relay";

const relayManifest = {
  name: "relay",
  version: "1.0.0",
  description:
    "Makes the calls it is given in order, some to plain actions and some to a skill, and returns each output.",
  resources: { db: { migrations: "migrations" } },
  actions: {
    count: {
      description: "When a call is to be counted by a row in the counts partition.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/count.ts" }],
    },
    ask: {
      description: "When an agent is to write a sentence on a topic.",
      input: "schemas/any.json",
      output: "schemas/ask-output.json",
      effects: ["read"],
      run: [{ skill: "skills/ask", tier: "balanced", checks: ["scripts/long-enough.ts"] }],
    },
    relay: {
      description: "When a list of calls is made one after another.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/relay.ts" }],
    },
  },
};

const askSkill = [
  "---",
  "name: ask",
  "description: Writes one sentence on the topic given.",
  "metadata:",
  "  output: schemas/ask-output.json",
  "---",
  "",
  "## Input",
  "",
  "A topic.",
  "",
  "## Output",
  "",
  "One sentence, as schemas/ask-output.json.",
  "",
  "## Definition of done",
  "",
  "- [DOD-1] (must) The sentence is at least twelve characters long; scripts/long-enough.ts checks it.",
  "",
  "## Instructions",
  "",
  "1. Read the topic.",
  "2. Write one sentence on it.",
  "",
  "## Tools",
  "",
  "- files",
  "",
  "## Resources",
  "",
  "- the input",
  "",
  "## Rules and constraints",
  "",
  "- Write nothing.",
  "",
].join("\n");

const relayScript = [
  'import { defineScript, fail, fieldsOf } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const outputs = [];",
  "  for (const call of fieldsOf(input).calls) {",
  "    const answer = await context.call(call.action, call.input);",
  "    if (!answer.ok) {",
  "      fail(answer.message);",
  "    }",
  "    outputs.push(answer.value);",
  "  }",
  "  return { outputs };",
  "});",
  "",
].join("\n");

const countScript = [
  'import { defineScript, fail, fieldsOf } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const label = fieldsOf(input).label;",
  '  const inserted = await context.db.partition("counts").execute("insert into calls (label) values (?)", [label]);',
  "  if (!inserted.ok) {",
  "    fail(inserted.message);",
  "  }",
  "  return { counted: label };",
  "});",
  "",
].join("\n");

const longEnoughScript = [
  'import { defineScript, fieldsOf } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  "  const text = fieldsOf(input).text;",
  "  return text.length >= 12",
  "    ? { passed: true }",
  "    : { passed: false, feedback: `The sentence ${text} is shorter than twelve characters.` };",
  "});",
  "",
].join("\n");

function schemaText(schema: Json): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

const askOutput = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
};

async function projectWithRelay(): Promise<Project> {
  const beside = await makeProject();
  await beside.write(`${folder}/mode.yaml`, stringify(relayManifest));
  await beside.write(`${folder}/schemas/any.json`, "{}\n");
  await beside.write(`${folder}/schemas/ask-output.json`, schemaText(askOutput));
  await beside.write(`${folder}/skills/ask/SKILL.md`, askSkill);
  await beside.write(`${folder}/scripts/relay.ts`, relayScript);
  await beside.write(`${folder}/scripts/count.ts`, countScript);
  await beside.write(`${folder}/scripts/long-enough.ts`, longEnoughScript);
  await beside.write(`${folder}/migrations/0001-calls.sql`, "create table calls (label text not null);\n");
  return beside;
}

async function opened(beside: Project): Promise<ModeProject> {
  const project = await openModeProject(config, { project: beside.root });
  assert.deepEqual(await project.partition("relay", "counts").migrate(), { ok: true, value: ["0001-calls.sql"] });
  return project;
}

async function withRelay(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await projectWithRelay();
  const project = await opened(beside);
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

function count(label: string): Json {
  return { action: "count", input: { label } };
}

function ask(topic: string): Json {
  return { action: "ask", input: { topic } };
}

const taskFields = ["stepKey", "round", "feedback", "skill", "tier", "input", "place", "toolCalls"];

function fieldsNamed(value: unknown, names: readonly string[]): Json {
  const fields = isRecord(value) ? value : {};
  return toJson(Object.fromEntries(names.filter((name) => name in fields).map((name) => [name, fields[name]])));
}

function skillWaitingOf(run: Run): Json {
  if (run.state.status !== "waiting" || run.state.waiting.reason !== "skill") {
    assert.fail(`expected the run to wait for a skill, got ${JSON.stringify(run.state)}`);
  }
  const { reason, stepKey, task } = run.state.waiting;
  return { reason, stepKey, task: fieldsNamed(task, taskFields) };
}

function tokenOf(run: Run): string | undefined {
  return run.state.status === "waiting" && run.state.waiting.reason === "skill"
    ? run.state.waiting.task.token
    : undefined;
}

function givenToken(run: Run): string {
  const token = tokenOf(run);
  assert.ok(token !== undefined, `the skill's task carries no token: ${JSON.stringify(run.state)}`);
  return token;
}

async function newToken(project: ModeProject, runId: string): Promise<string> {
  const shown = await bay(["runs", runId, "--new-token", "--project", project.root, "--json"]);
  const token = textField(fieldOf(fieldOf(toJson(shown.json), "run") ?? null, "task") ?? null, "token");
  assert.ok(token !== undefined, JSON.stringify(shown.json));
  return token;
}

type Expected = {
  readonly runId: string;
  readonly call: number;
  readonly topic: string;
  readonly round?: number;
  readonly feedback?: readonly string[];
  readonly toolCalls?: number;
};

function waitingFor(expected: Expected): Json {
  const round = expected.round ?? 1;
  const stepKey = `0.call${String(expected.call)}/0`;
  return {
    reason: "skill",
    stepKey: `${stepKey}#${String(round)}`,
    task: {
      stepKey: `${stepKey}#${String(round)}`,
      round,
      feedback: expected.feedback ?? [],
      skill: "skills/ask",
      tier: "balanced",
      input: { topic: expected.topic },
      place: { runId: expected.runId, mode: "relay", action: "ask", stepKey },
      toolCalls: expected.toolCalls ?? 0,
    },
  };
}

async function countedLabels(project: ModeProject): Promise<readonly Json[]> {
  const rows = await project.partition("relay", "counts").query("select label from calls order by rowid");
  assert.ok(rows.ok, JSON.stringify(rows));
  return rows.value.map((row) => row.label ?? null);
}

function scriptReruns(events: readonly RunEvent[]): number {
  const reran = events.filter(
    (event) => event.kind === "step.started" && isRecord(event.detail) && event.detail.rerun === true,
  );
  return reran.filter((event) => isRecord(event.detail) && event.detail.stepKey === "0").length;
}

const rain = "Rain falls on the hills.";

const oneSkill = { calls: [count("a"), ask("rain"), count("c")] };

const oneSkillOutput = { outputs: [{ counted: "a" }, { text: rain }, { counted: "c" }] };

test("a script that calls a skill action waits for that skill with its task, and only call A has been made", async () => {
  await withRelay(async (project) => {
    const started = await project.run("relay.relay", oneSkill);
    assert.deepEqual(skillWaitingOf(started), waitingFor({ runId: started.id, call: 1, topic: "rain" }));
    assert.deepEqual(await countedLabels(project), ["a"]);
    assert.deepEqual(await project.runs(), [{ id: started.id, status: "waiting" }]);
  });
});

test("the answer to the skill resumes the script, which ends with the skill's output, calls A and C made once each", async () => {
  await withRelay(async (project) => {
    const started = await project.run("relay.relay", oneSkill);
    const done = await project.answer(givenToken(started), { text: rain });
    assert.equal(done.id, started.id);
    assert.deepEqual(done.state, { status: "done", output: oneSkillOutput });
    assert.deepEqual(await countedLabels(project), ["a", "c"]);
    assert.equal(scriptReruns(done.events), 1);
  });
});

test("across a kernel restart between the wait and the answer, the script still ends rightly with A and C made once", async () => {
  const beside = await projectWithRelay();
  let project = await opened(beside);
  try {
    const started = await project.run("relay.relay", oneSkill);
    const token = givenToken(started);
    project = await project.endKernel().openAgain();
    const waiting = waitingFor({ runId: started.id, call: 1, topic: "rain" });
    assert.deepEqual(skillWaitingOf(await project.show(started.id)), waiting);
    assert.deepEqual(await countedLabels(project), ["a"]);
    const done = await project.answer(token, { text: rain });
    assert.deepEqual(done.state, { status: "done", output: oneSkillOutput });
    assert.deepEqual(await countedLabels(project), ["a", "c"]);
    assert.equal(scriptReruns(done.events), 1);
  } finally {
    await project.close();
    await beside.remove();
  }
});

test("a skill answer its schema refuses is refused with the kernel's sentence, and the run still waits as it did", async () => {
  await withRelay(async (project) => {
    const started = await project.run("relay.relay", oneSkill);
    const token = givenToken(started);
    assert.equal(
      await project.answerRefusal(token, { words: 3 }),
      "output is missing the required field text. output has the field words, which is not allowed here.",
    );
    const waiting = waitingFor({ runId: started.id, call: 1, topic: "rain", toolCalls: 1 });
    assert.deepEqual(skillWaitingOf(await project.show(started.id)), waiting);
    assert.deepEqual(await countedLabels(project), ["a"]);
    const done = await project.answer(token, { text: rain });
    assert.deepEqual(done.state, { status: "done", output: oneSkillOutput });
    assert.deepEqual(await countedLabels(project), ["a", "c"]);
  });
});

test("two skill calls in one script wait and are answered one after the other, every plain call made once", async () => {
  await withRelay(async (project) => {
    const snow = "Snow covers the fields.";
    const started = await project.run("relay.relay", {
      calls: [count("a"), ask("rain"), count("c"), ask("snow"), count("e")],
    });
    assert.deepEqual(skillWaitingOf(started), waitingFor({ runId: started.id, call: 1, topic: "rain" }));
    const between = await project.answer(givenToken(started), { text: rain });
    assert.deepEqual(skillWaitingOf(between), waitingFor({ runId: started.id, call: 3, topic: "snow" }));
    assert.equal(tokenOf(between), undefined);
    assert.deepEqual(await countedLabels(project), ["a", "c"]);
    const done = await project.answer(await newToken(project, started.id), { text: snow });
    const output = { outputs: [{ counted: "a" }, { text: rain }, { counted: "c" }, { text: snow }, { counted: "e" }] };
    assert.deepEqual(done.state, { status: "done", output });
    assert.deepEqual(await countedLabels(project), ["a", "c", "e"]);
    assert.equal(scriptReruns(done.events), 2);
  });
});

test("a skill answer its check sends back makes the run wait for round 2, and the script then ends rightly", async () => {
  await withRelay(async (project) => {
    const started = await project.run("relay.relay", oneSkill);
    const sentBack = await project.answer(givenToken(started), { text: "Wet." });
    const feedback = ["The sentence Wet. is shorter than twelve characters."];
    assert.deepEqual(
      skillWaitingOf(sentBack),
      waitingFor({ runId: started.id, call: 1, topic: "rain", round: 2, feedback }),
    );
    assert.deepEqual(await countedLabels(project), ["a"]);
    const done = await project.answer(givenToken(sentBack), { text: rain });
    assert.deepEqual(done.state, { status: "done", output: oneSkillOutput });
    assert.deepEqual(await countedLabels(project), ["a", "c"]);
    assert.equal(scriptReruns(done.events), 2);
  });
});
