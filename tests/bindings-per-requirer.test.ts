import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, textField } from "../bay/json.ts";
import type { Kernel } from "../bay/kernel.ts";
import type { RunView } from "../bay/runs/run-state.ts";
import { issueTaskToken } from "../bay/runs/task-tokens.ts";
import { callKernelTool } from "../bay/tools.ts";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject, skillText, type Project } from "./project-fixture.ts";
import { problemText } from "../bay/outcome.ts";

const nameSchema = { type: "object", additionalProperties: false, required: ["name"], properties: { name: {} } };

const greetingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["greeting"],
  properties: { greeting: { type: "string" } },
};

const draftSchema = { type: "object", required: ["text"], properties: { text: { type: "string" } } };

function requirerManifest(name: string): Json {
  const greet = { input: "schemas/name.json", output: "schemas/greeting.json", effects: ["read"] };
  return {
    name,
    version: "1.0.0",
    description: `Asks for a greeting through greeting-source, as ${name}.`,
    requires: { interfaces: ["greeting-source@1"] },
    actions: {
      direct: { ...greet, run: [{ call: "greeting-source.fetch" }] },
      scripted: { ...greet, run: [{ script: "scripts/ask.ts" }] },
      ask: { ...greet, output: "schemas/draft-output.json", run: [{ skill: "skills/draft", tier: "fast" }] },
    },
    workflows: ["workflows/flow.yaml"],
  };
}

const askScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const answer = await context.call("greeting-source.fetch", input);',
  "  return answer.ok ? answer.value : fail(answer.message);",
  "});",
  "",
].join("\n");

const echoScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  '  const name = typeof input === "object" && input !== null && "name" in input ? String(input.name) : "";',
  "  return { greeting: `Echo, ${name}` };",
  "});",
  "",
].join("\n");

function json(value: Json): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeRequirer(project: Project, name: string): Promise<void> {
  const folder = `components/modes/${name}`;
  const flow = { name: "flow", steps: [{ id: "fetch", action: "greeting-source.fetch", input: { name: "Ada" } }] };
  await project.write(`${folder}/mode.yaml`, stringify(requirerManifest(name)));
  await project.write(`${folder}/schemas/name.json`, json(nameSchema));
  await project.write(`${folder}/schemas/greeting.json`, json(greetingSchema));
  await project.write(`${folder}/schemas/draft-output.json`, json(draftSchema));
  await project.write(`${folder}/scripts/ask.ts`, askScript);
  await project.write(`${folder}/skills/draft/SKILL.md`, skillText);
  await project.write(`${folder}/workflows/flow.yaml`, stringify(flow));
}

async function writeEchoer(project: Project): Promise<void> {
  const folder = "components/modes/echoer";
  const fetch = {
    input: "schemas/fetch-input.json",
    output: "schemas/fetch-output.json",
    effects: ["read"],
    run: [{ script: "scripts/fetch.ts" }],
  };
  const manifest = {
    name: "echoer",
    version: "1.0.0",
    description: "Serves greeting-source with an echo instead of a greeting.",
    implements: ["greeting-source@1"],
    actions: { fetch },
  };
  const interfaceFolder = "components/interfaces/greeting-source";
  await project.write(`${folder}/mode.yaml`, stringify(manifest));
  for (const schema of ["fetch-input.json", "fetch-output.json"]) {
    await project.write(`${folder}/schemas/${schema}`, await project.read(`${interfaceFolder}/${schema}`));
  }
  await project.write(`${folder}/scripts/fetch.ts`, echoScript);
}

type Bindings = Readonly<Record<string, Json>>;

async function twoRequirers(bindings: Bindings, body: (kernel: Kernel) => Promise<void>): Promise<void> {
  const project = await makeProject();
  await writeRequirer(project, "alpha");
  await writeRequirer(project, "beta");
  await writeEchoer(project);
  const config = { bindings, adapter: "fake", settings: { writer: { signature: "Yours, the writer" } } };
  await project.write("agentbay.config.yaml", stringify(config));
  const kernel = await openKernel(project);
  try {
    await body(kernel);
  } finally {
    kernel.close();
    await project.remove();
  }
}

function doneOutput(result: Awaited<ReturnType<Kernel["engine"]["startAction"]>>): Json {
  assert.ok(result.ok, JSON.stringify(result));
  const state = result.value.state;
  if (state.status !== "done") {
    assert.fail(`expected the run to be done, got ${JSON.stringify(state)}`);
  }
  return state.output;
}

function calledMode(run: RunView, key: string): Json {
  const record = run.steps.find((step) => step.key === key);
  return fieldOf(record?.detail ?? null, "mode") ?? null;
}

async function greetingByTool(kernel: Kernel, requirer: string): Promise<string | undefined> {
  const result = await kernel.engine.startAction(`${requirer}.ask`, { name: "Ada" });
  assert.ok(result.ok && result.value.state.status === "waiting", JSON.stringify(result));
  const waiting = result.value.state.waiting;
  const place = { runId: result.value.id, stepKey: waiting.stepKey, round: 1 };
  const token = await issueTaskToken(kernel.store, place, new Date());
  const called = await callKernelTool(kernel, "call_action", {
    token,
    action: "greeting-source.fetch",
    input: { name: "Ada" },
  });
  assert.ok(called.ok, called.ok ? "" : problemText(called.problems));
  return textField(fieldOf(called.value, "output") ?? null, "greeting");
}

const split = { "greeting-source": { alpha: "greeter", beta: "echoer", default: "greeter" } };

test("two requirers bound to two servers each reach their own through a call step and a script call", async () => {
  await twoRequirers(split, async (kernel) => {
    const engine = kernel.engine;
    assert.deepEqual(doneOutput(await engine.startAction("alpha.direct", { name: "Ada" })), { greeting: "Hello, Ada" });
    assert.deepEqual(doneOutput(await engine.startAction("beta.direct", { name: "Ada" })), { greeting: "Echo, Ada" });
    const alphaScript = await engine.startAction("alpha.scripted", { name: "Bo" });
    const betaScript = await engine.startAction("beta.scripted", { name: "Bo" });
    assert.deepEqual(doneOutput(alphaScript), { greeting: "Hello, Bo" });
    assert.deepEqual(doneOutput(betaScript), { greeting: "Echo, Bo" });
    assert.ok(betaScript.ok);
    assert.equal(calledMode(betaScript.value, "0.call0"), "echoer");
  });
});

test("two requirers bound to two servers each reach their own through a workflow step", async () => {
  await twoRequirers(split, async (kernel) => {
    const engine = kernel.engine;
    const alpha = await engine.startWorkflow({ mode: "alpha", path: "workflows/flow.yaml" }, {});
    const beta = await engine.startWorkflow({ mode: "beta", path: "workflows/flow.yaml" }, {});
    assert.deepEqual(doneOutput(alpha), { greeting: "Hello, Ada" });
    assert.deepEqual(doneOutput(beta), { greeting: "Echo, Ada" });
  });
});

test("two requirers bound to two servers each reach their own through the call_action tool", async () => {
  await twoRequirers(split, async (kernel) => {
    assert.equal(await greetingByTool(kernel, "alpha"), "Hello, Ada");
    assert.equal(await greetingByTool(kernel, "beta"), "Echo, Ada");
  });
});

test("a requirer without an entry is served by default, and the plain string form serves every requirer", async () => {
  await twoRequirers({ "greeting-source": { beta: "echoer", default: "greeter" } }, async (kernel) => {
    const alpha = await kernel.engine.startAction("alpha.scripted", { name: "Cy" });
    assert.deepEqual(doneOutput(alpha), { greeting: "Hello, Cy" });
    assert.equal(await greetingByTool(kernel, "beta"), "Echo, Ada");
  });
  await twoRequirers({ "greeting-source": "echoer" }, async (kernel) => {
    const engine = kernel.engine;
    assert.deepEqual(doneOutput(await engine.startAction("alpha.direct", { name: "Di" })), { greeting: "Echo, Di" });
    assert.deepEqual(doneOutput(await engine.startAction("beta.scripted", { name: "Di" })), { greeting: "Echo, Di" });
    const flow = await engine.startWorkflow({ mode: "alpha", path: "workflows/flow.yaml" }, {});
    assert.deepEqual(doneOutput(flow), { greeting: "Echo, Ada" });
    assert.equal(await greetingByTool(kernel, "alpha"), "Echo, Ada");
  });
});
